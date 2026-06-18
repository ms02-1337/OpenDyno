// messages.h - System status and information messages

#ifndef MESSAGES_H
#define MESSAGES_H

// SYSTEM INITIALIZATION AND STATUS
#define INFO_MSG_INIT             0x01  // System initialization in progress
#define INFO_MSG_LCELL_ERROR      0x02  // Load cell hardware error
#define INFO_MSG_LCELL_OK         0x03  // Load cell functioning normally
#define INFO_MSG_UPDATING         0x04  // Configuration update in progress
#define INFO_MSG_EMERGENCY        0x05  // Emergency stop activated
#define INFO_MSG_UPDATED          0x06  // Configuration updated successfully

// DATA INTEGRITY AND VALIDATION
#define INFO_MSG_INVALID_CHECKSUM 0x07  // Checksum mismatch detected
#define INFO_MSG_CHECKSUM_OK      0x08  // Checksum validation successful
#define INFO_MSG_CHECKSUM_ERROR   0x09  // Checksum calculation error

// OPERATIONAL STATUS
#define INFO_MSG_LOW_SPEED        0x11  // Speed below minimum threshold
#define INFO_MSG_RUNNING          0x12  // System actively running
#define INFO_MSG_STOPPED          0x13  // System in stopped/safe state
#define INFO_MSG_SPEED            0x14  // Speed control mode active
#define INFO_MSG_TORQUE           0x15  // Torque control mode active
#define INFO_MSG_DYNAMIC          0x16  // Dynamic testing mode active

// ERROR AND INVALID OPERATION
#define INFO_MSG_RUN_MODE_RUNNING 0x17    // Cannot change mode while running
#define INFO_MSG_INVALID_INSTRUCTION 0x18 // Invalid instruction received
#define INFO_MSG_PWM_INVALID      0x19    // Invalid PWM operation
#define INFO_MSG_INVALID_LIVE_ID  0x20    // Invalid live data transmission ID
#define INFO_MSG_INVALID_CAN_MESSAGE 0x21 // Unrecognized CAN message
#define INFO_MSG_INVALID_MODE     0x22    // Invalid operation mode

// DYNAMIC MODE STATE MACHINE
#define INFO_MSG_IDLE             0x23    // Idle state - ready to start test
#define INFO_MSG_SPINUP           0x24    // Spinning up to initial speed
#define INFO_MSG_WAIT_STABLE      0x25    // Waiting for speed stabilization
#define INFO_MSG_ACCELERATING     0x26    // Active acceleration phase
#define INFO_MSG_HOLD_TOP_SPEED   0x27    // Holding at maximum speed
#define INFO_MSG_WAIT_TORQUE_DROP 0x28    // Monitoring for torque drop (peak)
#define INFO_MSG_DECELERATING     0x29    // Deceleration phase
#define INFO_MSG_FINISHED         0x30    // Test sequence complete
#define INFO_MSG_INESTABLE_SPEED  0x31    // Speed instability detected
#define INFO_MSG_SPEED_GLITCH     0x32    // Sustained encoder outlier rejection (ratio rejector latched)

#endif // MESSAGES_H