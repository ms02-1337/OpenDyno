// can.h - CAN bus communication interface for the DynoLogic control system.

#ifndef CAN_H
#define CAN_H

#include "datatypes.h"
#include <ACAN_T4.h>

// Microcontroller to Server (0x01 - 0x13)
#define LIVE_SPEED_TORQUE_ID         0x01  // Real-time speed (RPM) and torque (kg)
#define STATUS_ID                    0x02  // System status and operational state
#define REQUEST_CONFIG_ID            0x03  // Request configuration from server
#define ELECTRICAL_ID_CURRENT        0x04  // Current measurement (Amps)
#define ELECTRICAL_ID_VOLTAGE        0x05  // Voltage measurement (Volts)
#define MICRO_HEARTBEAT_ID           0x06  // Microcontroller heartbeat (1s interval)
#define ENV_ID                       0x07  // Environmental data (temp/humidity)
#define DEBUG_LIVE_ID                0x08  // PID debug data (setpoint, PWM)
#define ACCELERATION_ID              0x09  // Acceleration measurement (filtered)
#define BRAKE_TEMPERATURE_ID         0x10  // Brake temperature (MLX90614)
#define ACCELERATION_DEBUG_ID        0x11  // Acceleration (raw, unfiltered)
#define LIVE_SPEED_TORQUE_DEBUG_ID   0x12  // Speed/torque (raw, unfiltered)
#define DS18B20_TEMPERATURE_ID       0x13  // Ambient temperature (DS18B20)

// Server to Microcontroller (0x100 - 0x126)
#define RUN_MODE_ID                  0x100  // Set operation mode
#define INSTRUCTION_ID               0x101  // Start (1) / Stop (0) command
#define APP_HEARTBEAT_ID             0x102  // Server heartbeat
#define CHECKSUM_ID                  0x103  // Configuration CRC16 checksum
#define DEBUG_CONFIG_ID              0x104  // Enable/disable debug mode
#define ENABLE_LIVE_ID               0x105  // Enable live data streaming
#define SET_PWM_VALUE                0x106  // Manual PWM override value
#define TARE_LOAD_CELL_ID            0x107  // Tare load cell command
#define TORQUE_KP_CONFIG_ID          0x109  // Torque PID proportional gain
#define TORQUE_KI_CONFIG_ID          0x110  // Torque PID integral gain
#define TORQUE_KD_CONFIG_ID          0x111  // Torque PID derivative gain
#define SPEED_KP_CONFIG_ID           0x112  // Speed PID proportional gain
#define SPEED_KI_CONFIG_ID           0x113  // Speed PID integral gain
#define SPEED_KD_CONFIG_ID           0x114  // Speed PID derivative gain
#define DYNAMIC_KP_CONFIG_ID         0x115  // Dynamic PID proportional gain
#define DYNAMIC_KI_CONFIG_ID         0x116  // Dynamic PID integral gain
#define DYNAMIC_KD_CONFIG_ID         0x117  // Dynamic PID derivative gain
#define LOAD_CELL_CONFIG_1_ID        0x118  // Load cell gain and offset
#define PWM_CONFIG_ID                0x119  // PWM frequency and limits
#define LOW_PASS_FILTERS_ID          0x120  // Low-pass filter cutoff frequencies
#define SPEED_LIMITS_ID              0x121  // Min/max speed limits
#define DYNAMIC_CONFIG_1_ID          0x122  // Start speed, stability time
#define DYNAMIC_CONFIG_2_ID          0x123  // Acceleration rate, end speed
#define DYNAMIC_CONFIG_3_ID          0x124  // Hold time, deceleration rate
#define DYNAMIC_CONFIG_4_ID          0x125  // Final speed
#define LOAD_CELL_CONFIG_2_ID        0x126  // Load cell scale, distance

// Control Commands (INSTRUCTION_ID)
#define STOP                         0  // Stop system operation
#define START                        1  // Start system operation

// System Status Codes
#define STOPPED                      0x00  // System stopped, safe state
#define RUNNING                      0x01  // System actively running
#define DEBUG                        0x02  // Debug mode enabled

// Operation Modes (RUN_MODE_ID)
#define TORQUE_MODE                  0  // Constant torque control
#define SPEED_MODE                   1  // Constant speed control
#define DYNAMIC_MODE                 2  // Dynamic acceleration test mode
#define ACCELERATION_MODE            3  // Acceleration rate control (debug)

// Protocol Constants
#define CONFIG_REQUEST_BYTE          0x01   // Value sent in config request
#define APP_HEARTBEAT_VALUE          0x10   // Server heartbeat value
#define MICRO_HEARTBEAT_VALUE        0x20   // Microcontroller heartbeat value

// Error Codes
#define INVALID_RUN_MODE_ERROR       0x22   // Unknown operation mode
#define INVALID_INSTRUCTION          0x30   // Invalid command received

// FUNCTION PROTOTYPES

/**
 * Send PID debug data via CAN
 */
bool send_pid_debug_data(const Configuration &config, const Status &status);

/**
 * Send electrical measurements via CAN
 */
bool send_electrical_data(const Status &status);

/**
 * Send environmental data via CAN
 */
bool send_env(const Status &status);

/**
 * Send acceleration data via CAN
 */
bool send_acceleration_timestamp(const Status &status);

/**
 * Send speed and torque data via CAN
 */
bool send_speed_torque_timestamp(const Status &status);

/**
 * Request configuration from server
 */
bool send_configuration_request(Status &status);

/**
 * Send brake temperature via CAN
 */
bool send_brake_temperature(const Status &status);

/**
 * Send ambient temperature via CAN
 */
bool send_ds18b20_temperature(const Status &status);

/**
 * Send microcontroller heartbeat via CAN
 */
bool send_heartbeat(void);

/**
 * Send system status via CAN
 */
bool send_can_status(const Status &status);

/**
 * Send raw acceleration data via CAN
 */
bool send_acceleration_debug_timestamp(const Status &status);

/**
 * Send raw speed and torque data via CAN
 */
bool send_speed_torque_debug_timestamp(const Status &status);

/**
 * Process CAN transmit queue
 */
void process_can_tx_queue(void);

/**
 * Receive CAN message from RX queue
 */
CANMessage receive_can_message(Status &status);

/**
 * Poll CAN interface for new messages
 */
void check_new_can_message(void);

#endif // CAN_H