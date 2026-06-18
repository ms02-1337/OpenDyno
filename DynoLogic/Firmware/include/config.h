// config.h - System configuration parameters

#ifndef CONFIG_H
#define CONFIG_H

// SERIAL
#define SERIAL_PORT Serial                    // Primary serial interface for debug/output
#define SERIAL_SPEED 500000                   // Baud rate [bps]

// DEBUG OUTPUT
//#define ENABLE_DEBUG_OUTPUT

#ifdef ENABLE_DEBUG_OUTPUT
// Debug macros - compile to nothing when debug is disabled
#define DEBUG_PRINT(...)  if(SERIAL_PORT){ SERIAL_PORT.print(__VA_ARGS__); }
#define DEBUG_PRINTLN(...) if(SERIAL_PORT){ SERIAL_PORT.println(__VA_ARGS__); }
#else
#define DEBUG_PRINT(...)
#define DEBUG_PRINTLN(...)
#endif

// EDDY CURRENT BRAKE PWM
#define DEFAULT_PWM_FREQUENCY 1000            // PWM frequency [Hz] - 1kHz for smooth brake control
#define PWM_START_DUTY 0                      // Initial PWM duty cycle at startup
#define DEFAULT_MIN_PWM_OUTPUT 0              // Minimum PWM value (safety floor)
#define DEFAULT_MAX_PWM_OUTPUT 330            // Maximum PWM value (safety ceiling)

// CAN BUS
#define CAN_INTERFACE ACAN_T4::can1           // CAN controller instance
#define CAN_SPEED 500000                      // CAN bus speed [500 kbps]

// VOLTAGE MEASUREMENT (MAX22530 ADC)
// UNUSED
#define MAX22530_SPI &SPI                     // SPI interface for MAX22530
#define MAX22530_SPI_SPEED 1000000            // SPI clock frequency [1 MHz]

// ENCODER (SPEED MEASUREMENT)
#define ENC_PPR 50                            // Pulses per revolution (base resolution)
#define ENC_REVERSE_DIRECTION 1               // Reverse quadrature sign so normal dyno rotation reports positive RPM
#define STOP_TIMEOUT_MS 200                   // Timeout [ms] to detect stopped condition

// PID CONTROL LOOP
#define PID_FREQUENCY 1000                    // PID update interval [us] = 1ms (1000Hz)
#define PWM_FREQUENCY 1000

// MAIN LOOP TIMING INTERVALS
#define SECURITY_CHECK_INTERVAL 4000          // Security check interval [ms]

// LOW-PASS FILTER DEFAULTS
#define LOW_PASS_FILTER_SPEED_FREQ 20.0       // Speed filter cutoff [Hz] (per-stage)
#define LOW_PASS_FILTER_TORQUE_FREQ 15.0      // Torque filter cutoff [Hz] (per-stage)
#define LOW_PASS_FILTER_ACC_FREQ 10.0         // Acceleration filter cutoff [Hz] (per-stage)
#define LOW_PASS_FILTER_OUTPUT_FREQ 20.0      // PID output filter cutoff [Hz]

// Cascaded IIR stage counts (serial first-order sections, exp-form coefficient).
#define SPEED_LPF_STAGES 1
#define TORQUE_LPF_STAGES 4
#define ACCEL_LPF_STAGES 2

// DYNO OPERATIONAL LIMITS
#define DEFAULT_MINIMUM_SPEED 500             // Minimum operating speed [RPM]
#define DEFAULT_MAXIMUM_SPEED 4500            // Maximum operating speed [RPM]

// LOAD CELL SELECTION
//#define USE_HX711_LOAD_CELL                 // HX711 external load cell (alternative)
#define USE_ADS1220_LOAD_CELL                 // ADS1220 internal load cell (default)

// PHYSICAL CONSTANTS
#define GRAVITY 9.80665                       // Standard gravity [m/s^2] for torque calculations

// HALL EFFECT CURRENT SENSOR
#define ADC_MAX 4096.0f                       // ADC maximum value
#define ADC_REF_V 3.3f                        // ADC reference voltage [V]
#define V_OFFSET 0.33f                        // Zero-current output [V]
#define SENSITIVITY 0.0396f                   // V per Amp

#endif // CONFIG_H
