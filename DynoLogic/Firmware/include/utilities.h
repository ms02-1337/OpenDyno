// utilities.h - Utility functions for filtering, CRC, PWM, and validation

#ifndef UTILITIES_H
#define UTILITIES_H

#include "datatypes.h"

/**
 * Low-Pass Filter
 */
float lowPassFilter(float x, float frequency, LowPassFilter& filter);

/**
 * Cascaded variable-rate low-pass filter (exponential form)
 *
 * Runs N first-order IIR stages in series using alpha = exp(-dt/tau).
 * Honours a brief warm-up after reset (returns raw input while state seeds).
 * Cutoff passed in Hz; tau computed internally as 1/(2*pi*frequency).
 */
float cascadedLowPassFilter(float x, float frequency, CascadedLowPassFilter &filter);

/**
 * Re-seed a cascaded low-pass filter
 *
 * Clears state, sets warm-up to 3 samples, and clamps stage count to
 * [1, MAX_LPF_STAGES]. Call on boot and whenever filter parameters change.
 */
void cascaded_lpf_reset(CascadedLowPassFilter &filter, uint8_t stages);

/**
 * Calculate CRC-16 checksum
 */
uint16_t crc16(const uint8_t* data, size_t length);

/**
 * Set PWM duty cycle with filtering
 */
void set_pwm(float value, Configuration &config, LowPassFilter &outputFilter, Status &status);

/**
 * Set PWM frequency
 */
void set_pwm_frequency(uint16_t freq);

/**
 * Set PWM as percentage
 */
void setDutyPercent(float percent);

/**
 * Check if speed is within tolerance
 */
bool speed_within_tol(float current_speed, float target, float tol);

/**
 * Sample Hall effect sensor synchronously
 */
void sample_hall_sensor_sync(HallSensorAverager &averager);

#endif // UTILITIES_H
