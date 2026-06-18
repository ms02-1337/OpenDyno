// datatypes.h - Data structure definitions for DynoLogic

#pragma once
#ifndef DATATYPES_H
#define DATATYPES_H

#include <cstdint>
#include <Arduino.h>
#include <ACAN_T4.h>
#include "config.h"

// Boolean constants
#define TRUE 1
#define FALSE 0

/**
 * PID controller tuning parameters
 */
struct pid_data
{
	float kp; // Proportional gain - response to current error
	float ki; // Integral gain - eliminates steady-state error
	float kd; // Derivative gain - dampens overshoot
};
typedef struct pid_data Pid_data;

/**
 * Operation mode configuration
 */
struct run_mode
{
	uint8_t mode; // TORQUE_MODE, SPEED_MODE, DYNAMIC_MODE, or ACCELERATION_MODE
	float value;  // Target setpoint (units depend on mode)
};
typedef struct run_mode Run_mode;

/**
 * Load cell calibration parameters
 */
struct load_cell
{
	uint16_t gain;    // HX711 amplifier gain setting (128 or 64)
	float offset;     // Zero-offset value from tare operation
	float scale;      // Conversion factor: ADC counts to grams
	float distance;   // Torque arm length in meters (for Nm = kg * 9.81 * d)
};
typedef struct load_cell Load_cell;

/**
 * PWM output configuration
 */
struct pwm_config
{
	uint16_t pwm_start;     // Minimum PWM for brake engagement (safety floor)
	uint16_t pwm_limit;     // Maximum PWM allowed (safety ceiling)
	uint16_t pwm_frequency; // PWM frequency in Hz (typically 1000Hz)
};
typedef struct pwm_config Pwm_config;

/**
 * Low-pass filter configuration
 */
struct low_pass_filters
{
	uint16_t speed;        // Speed filter cutoff [Hz]
	uint16_t torque;       // Torque filter cutoff [Hz]
	uint16_t acceleration; // Acceleration filter cutoff [Hz]
	uint16_t pid_output;   // PID output filter cutoff [Hz]
};
typedef struct low_pass_filters Low_pass_filters;

/**
 * Dynamic testing sequence parameters
 */
struct dynamic_config {
	float start_speed;    // Initial RPM before acceleration phase
	float stable_time_ms; // Time to hold for speed stabilization [ms]
	float accel_rate;     // Target acceleration rate [RPM/s]
	float end_speed;      // Maximum test speed [RPM]
	float hold_ms;        // Time to hold at peak speed [ms]
	float accel_down;     // Deceleration rate [RPM/s]
	float final_speed;    // Target RPM after deceleration
};
typedef struct dynamic_config Dynamic_config;

/**
 * Fixed dynamic testing parameters
 */
struct dynamic_config_static {
	float torque_drop_threshold;  // Torque drop ratio for test end [0-1]
	float stable_speed_tolerance; // Speed tolerance window for stability [RPM]
};
typedef struct dynamic_config_static Dynamic_config_static;

/**
 * Speed safety limits
 */
struct speed_limits
{
	uint16_t min_speed; // Minimum RPM for valid PID control
	uint16_t max_speed; // Maximum RPM for safe operation
};
typedef struct speed_limits Speed_limits;

/**
 * Master configuration structure
 */
struct config
{
	uint8_t debug_mode;            // Debug output flag (TRUE/FALSE)
	pid_data torque_pid;          // Torque control PID gains
	pid_data speed_pid;           // Speed control PID gains
	pid_data dynamic_pid;         // Acceleration control PID gains
	Run_mode mode;                // Current operation mode and setpoint
	Load_cell load_cell;          // Load cell calibration
	Pwm_config pwm_config;        // PWM limits and frequency
	Low_pass_filters low_pass_filters; // Signal filter settings
	Speed_limits speed_limits;    // RPM safety boundaries
	Dynamic_config dynamic_config; // Dynamic test profile
};
typedef struct config Configuration;

/**
 * Multi-rate task scheduler flags
 */
struct time_control
{
	volatile uint8_t pending_5s = 0;    // Number of pending 5s tasks
	volatile uint8_t pending_1s = 0;    // Number of pending 1s tasks
	volatile uint8_t pending_500ms = 0; // Number of pending 500ms tasks
	volatile uint8_t pending_100ms = 0; // Number of pending 100ms tasks
	volatile uint8_t pending_10ms = 0;  // Number of pending 10ms tasks
	volatile uint8_t pending_1ms = 0;   // Number of pending 1ms tasks
	volatile uint32_t missed_5s = 0;    // Dropped 5s ticks due to loop backlog
	volatile uint32_t missed_1s = 0;    // Dropped 1s ticks due to loop backlog
	volatile uint32_t missed_500ms = 0; // Dropped 500ms ticks due to loop backlog
	volatile uint32_t missed_100ms = 0; // Dropped 100ms ticks due to loop backlog
	volatile uint32_t missed_10ms = 0;  // Dropped 10ms ticks due to loop backlog
	volatile uint32_t missed_1ms = 0;   // Dropped 1ms ticks due to loop backlog
};
typedef struct time_control TimeControl;

/**
 * Low-pass filter
 */
struct LowPassFilter
{
	unsigned long timestamp_prev = 0; // Last filter execution time [μs]
	float y_prev = 0.0f;              // Last filter output value
};
typedef struct LowPassFilter LowPassFilter;

/**
 * Cascaded first-order low-pass filter (variable-rate, exponential-form)
 *
 * Implements N serial first-order IIR stages. Each call advances all stages
 * with alpha = exp(-dt/tau), where dt is the actual time since the last call.
 * A brief warm-up window after reset returns raw input while the state is
 * still being updated, so the output is continuous once warm-up ends.
 */
#define MAX_LPF_STAGES 4

struct CascadedLowPassFilter
{
	unsigned long timestamp_prev = 0;        // Last filter execution time [μs]; 0 = uninit
	float y_prev[MAX_LPF_STAGES] = {0, 0, 0, 0}; // Per-stage output memory
	uint8_t stages = 1;                       // Active stage count (1..MAX_LPF_STAGES)
	uint8_t warmup_remaining = 0;             // Samples to pass through raw after (re)init
	bool initialised = false;                 // Seeded on first real sample
};
typedef struct CascadedLowPassFilter CascadedLowPassFilter;

/**
 * Real-time system status
 */
struct status
{
	// Communication and System States
	uint8_t connected;     // CAN link status (0=disconnected, 1=connected)
	uint8_t status;        // System state: STOPPED, RUNNING, or DEBUG
	uint8_t info;          // Supplementary status message code
	uint8_t live_mode;     // Real-time data streaming flag
	bool manual_pwm_enabled; // Manual PWM override flag

	// Actuator Control
	float pwm_value; // Current PWM output to brake (0-100%)

	// Measured Values (volatile - modified by encoder ISRs)
	volatile float current_speed;          // Speed [RPM]
	volatile float current_speed_filtered; // Filtered speed [RPM]
	volatile float current_acc;            // Acceleration [RPM/s]
	volatile float current_acc_filtered;   // Filtered acceleration [RPM/s]
	volatile float current_torque;         // Torque [Nm]
	volatile float current_torque_kg;      // Force [kg]
	volatile float current_torque_kg_filtered; // Filtered force [kg]

	// Thermal Management
	float brake_temperature; // Brake temperature from MLX90614 [°C]
	float env_temperature;   // Ambient temperature from DS18B20 [°C]

	// Additional System Parameters
	uint32_t current_timestamp; // Sample timestamp [ms]
	int voltage;             // System voltage [mV]
	float current;           // System current [A]
	float temperature;       // BME280 temperature [°C]
	float humidity;          // BME280 humidity [%]
	uint8_t new_can_message; // CAN RX queue not empty flag

	// PID Controller I/O
	float pid_output; // Control output to PWM

	// Error Handling
	uint8_t error; // System error code

	// Configuration Management
	uint16_t config_checksum;      // Local CRC16 of configuration
	uint16_t server_checksum;      // Server-provided CRC16
	uint8_t valid_checksum = false; // Checksums match
	uint8_t updated_config = false; // New config received via CAN
	uint8_t requested_config = false; // Config download initiated
};
typedef struct status Status;

/**
 * Float to byte converter
 */
union Float_converter
{
	byte bytes[4]; // Byte representation (little-endian)
	float value;   // Float value
};
typedef union Float_converter Float_converter;

/**
 * Dynamic test sequence states
 */
enum dynamic_dyno_state {
	IDLE,                  // Ready to start test
	SPINUP_TO_START_SPEED, // Accelerating to start_speed
	WAIT_STABLE,           // Holding at start_speed for stabilization
	ACCELERATING,          // Applying controlled acceleration rate
	HOLD_TOP_SPEED,        // Holding at end_speed
	WAIT_TORQUE_DROP,      // Monitoring for torque drop (engine power peak)
	DECELERATING,          // Ramp down to final_speed
	FINISHED               // Test complete
};

// Global state variable for dynamic testing state machine
inline volatile dynamic_dyno_state dyno_state = IDLE;

/**
 * Hall effect sensor oversampling and averaging
 */
struct hall_sensor_averager
{
	volatile float sum;           // Running sum of ADC readings [volts]
	volatile uint16_t count;      // Number of samples in current block
	float last_average;           // Most recent averaged value [volts]

	void reset()
	{
		sum = 0.0f;
		count = 0;
	}

	void add_sample(float voltage)
	{
		sum += voltage;
		count++;
	}

	float compute_average()
	{
		if (count > 0)
		{
			last_average = sum / count;
			reset();
			return last_average;
		}
		return last_average;  // Return previous if no new data
	}
};
typedef struct hall_sensor_averager HallSensorAverager;

#endif // DATATYPES_H
