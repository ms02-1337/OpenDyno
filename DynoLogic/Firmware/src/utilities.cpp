// utilities.cpp - Utility functions for filtering, CRC, PWM, and validation

#include <Arduino.h>
#include "utilities.h"
#include "datatypes.h"
#include "main.h"
#include "pins.h"
#include "config.h"

/**
 * Low Pass Filter
 */
float lowPassFilter(float x, float frequency, LowPassFilter &filter)
{
    if (frequency <= 0) return x;

    unsigned long timestamp = micros();

    // Handle initialization/timer rollover
    if (filter.timestamp_prev == 0) {
        filter.timestamp_prev = timestamp;
        filter.y_prev = x; // Snap to initial reading instantly
    }

    // Calculate time delta [seconds]
    float dt = (timestamp - filter.timestamp_prev) * 1e-6f;
    filter.timestamp_prev = timestamp;

    // Sanity check for dt (handle overflow, paused execution, etc.)
    if (dt <= 0.0f || dt > 0.5f) dt = 1e-3f;

    // Time constant from cutoff frequency: Tf = 1 / (2 * pi * fc)
    float Tf = 1.0f / (6.2831853f * frequency);

    // Calculate smoothing factor: a = dt / (Tf + dt)
    float alpha = dt / (Tf + dt);

    // Apply filter equation
    float y = alpha * x + (1.0f - alpha) * filter.y_prev;

    filter.y_prev = y;
    return y;
}

/**
 * Cascaded variable-rate low-pass filter (exponential form)
 */
float cascadedLowPassFilter(float x, float frequency, CascadedLowPassFilter &filter)
{
    if (frequency <= 0) return x;

    unsigned long timestamp = micros();

    if (!filter.initialised) {
        for (uint8_t i = 0; i < filter.stages && i < MAX_LPF_STAGES; i++) {
            filter.y_prev[i] = x;
        }
        filter.timestamp_prev = timestamp;
        filter.initialised = true;
        return x;
    }

    float dt = (timestamp - filter.timestamp_prev) * 1e-6f;
    filter.timestamp_prev = timestamp;
    if (dt <= 0.0f || dt > 0.5f) dt = 1e-3f;

    float tau = 1.0f / (6.2831853f * frequency);
    if (tau <= 0.0f) return x;

    float alpha = expf(-dt / tau);
    float one_minus_alpha = 1.0f - alpha;

    // Advance every stage in series; last stage's output is the result.
    float stage_in = x;
    uint8_t n = filter.stages;
    if (n == 0) n = 1;
    if (n > MAX_LPF_STAGES) n = MAX_LPF_STAGES;
    for (uint8_t i = 0; i < n; i++) {
        float y = alpha * filter.y_prev[i] + one_minus_alpha * stage_in;
        filter.y_prev[i] = y;
        stage_in = y;
    }

    // Warm-up: bridge the transient by passing raw x while state continues to settle.
    if (filter.warmup_remaining > 0) {
        filter.warmup_remaining--;
        return x;
    }

    return stage_in;
}

/**
 * Re-seed a cascaded low-pass filter
 */
void cascaded_lpf_reset(CascadedLowPassFilter &filter, uint8_t stages)
{
    if (stages == 0) stages = 1;
    if (stages > MAX_LPF_STAGES) stages = MAX_LPF_STAGES;
    filter.stages = stages;
    filter.timestamp_prev = 0;
    filter.initialised = false;
    filter.warmup_remaining = 3;
    for (uint8_t i = 0; i < MAX_LPF_STAGES; i++) {
        filter.y_prev[i] = 0.0f;
    }
}

/**
 * Calculate CRC-16 checksum
 */
uint16_t crc16(const uint8_t *data, size_t length)
{
	uint16_t crc = 0xFFFF;

	for (size_t i = 0; i < length; i++) {
		crc ^= data[i];
		// Process each bit
		for (uint8_t j = 0; j < 8; j++) {
			if (crc & 1) {
				crc = (crc >> 1) ^ 0xA001; // IBM polynomial
			} else {
				crc >>= 1;
			}
		}
	}
	return crc;
}

/**
 * Set PWM duty cycle with filtering and limits
 */
void set_pwm(float value, Configuration &config, LowPassFilter &outputFilter, Status &status){
	// Apply safety limits from configuration
	if (value < config.pwm_config.pwm_start)
		value = config.pwm_config.pwm_start;
	if (value > config.pwm_config.pwm_limit)
		value = config.pwm_config.pwm_limit;

	// Apply output filtering (unless manual mode)
	float final;
	if (!status.manual_pwm_enabled){
		final = lowPassFilter(value, config.low_pass_filters.pid_output, outputFilter);
	} else {
		final = value;
	}

	status.pwm_value = final;
	setDutyPercent(final);
}

/**
 * Set PWM frequency 
 */
void set_pwm_frequency(uint16_t freq){
	if (freq < 10) freq = 10;
	if (freq > 50000) freq = 50000;
	
	analogWriteFrequency(PWM_PIN, freq);
}

/**
 * Set PWM duty cycle as percentage
 */
void setDutyPercent(float percent) {
    // Clamp to valid range
    if (percent < 0.0f) percent = 0.0f;
    if (percent > 100.0f) percent = 100.0f;

    // Convert to 16-bit PWM value (0-65535)
    const uint32_t maxVal = 0xFFFF;
    uint32_t pwmVal = (uint32_t)((percent / 100.0f) * (float)maxVal + 0.5f);

    // Write to hardware PWM (pin 4)
    analogWrite(PWM_PIN, pwmVal);
}

/**
 * Check if speed is within tolerance
 */
bool speed_within_tol(float current_speed, float target, float tol)
{
	return fabsf(current_speed - target) <= tol;
}

/**
 * Sample Hall effect sensor synchronously
 */
void sample_hall_sensor_sync(HallSensorAverager &averager)
{
    // Wait slightly to let the IGBT switch fully and ringing to subside.
    // 3us is well within the 10us ON-time of a 1% duty cycle at 1kHz.
    delayMicroseconds(3);

    // Read raw ADC and convert to voltage
    uint16_t raw_adc = analogRead(HALL_ADC_PIN);
    float voltage = (raw_adc / ADC_MAX) * ADC_REF_V;

    // Add to oversampling buffer
    averager.add_sample(voltage);
}
