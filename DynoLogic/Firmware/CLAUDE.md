# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⚠️ IMPORTANT: Repository Scope

**When initialized in this directory (DynoLogic), you must work exclusively on the DynoLogic repository.**

- **DO NOT** work on the parent `OpenDyno` directory
- **DO NOT** work on sibling projects like `DynoServer`
- **DO NOT** navigate to or modify files outside this repository
- **ONLY** work on files within `C:\Users\Adrian\Documents\GitHub\OpenDyno\DynoLogic\`

The parent `OpenDyno` directory contains multiple projects:
- **DynoLogic** (this repository) - Embedded firmware for Teensy 4.1
- **DynoServer** - Separate server application (DO NOT work on this)

Each project has its own CLAUDE.md. When in DynoLogic, focus only on the embedded firmware.

---

## Project Overview

**DynoLogic** is an embedded dynamometer control system running on Teensy 4.1 microcontroller. It provides precise control of eddy current brakes for engine/motor testing through multiple control modes (torque, speed, acceleration, dynamic testing). The system communicates via CAN bus with an external server application for configuration and monitoring.

## Build and Development Commands

### PlatformIO Commands
```bash
# Build the project
pio run

# Upload to Teensy 4.1
pio run --target upload

# Clean build files
pio run --target clean

# Monitor serial output (500000 baud)
pio device monitor

# Upload and monitor in one command
pio run --target upload && pio device monitor
```

### Serial Monitor Configuration
- Serial baud rate: 500000
- Serial port: `Serial` (USB)
- Debug output can be enabled/disabled via `ENABLE_DEBUG_OUTPUT` in `include/config.h`

## Architecture Overview

### Multi-Rate Control Loop Architecture
The system uses a 1ms timer ISR to generate timing flags for multi-rate task scheduling:
- **1ms tasks**: PID control execution (1000Hz)
- **10ms tasks**: Real-time data transmission (speed, torque, acceleration)
- **100ms tasks**: CAN transmission, electrical data
- **500ms tasks**: System status, LED heartbeat
- **1s tasks**: Temperature readings, config request reset
- **5s tasks**: Maintenance tasks

### Core Control Modes
1. **TORQUE_MODE** (0): Constant torque control via load cell feedback
2. **SPEED_MODE** (1): Constant speed control via encoder feedback
3. **DYNAMIC_MODE** (2): State machine for dynamic testing sequences
4. **ACCELERATION_MODE** (3): Acceleration rate control

### Dynamic Testing State Machine
Located in `src/main.cpp:run_dynamic_pid()`. States:
- `IDLE`: Initial state
- `SPINUP_TO_START_SPEED`: Accelerate to initial test speed
- `WAIT_STABLE`: Hold speed within tolerance for stabilization
- `ACCELERATING`: Apply controlled acceleration
- `HOLD_TOP_SPEED`: Maintain peak speed
- `WAIT_TORQUE_DROP`: Monitor for engine power drop (test completion)
- `DECELERATING`: Controlled deceleration phase
- `FINISHED`: Test complete

## Key Source Files

| File | Purpose |
|------|---------|
| `src/main.cpp` | Main control loop, PID dispatchers, sensor initialization, dynamic testing state machine |
| `src/can.cpp` | CAN message queuing, transmission/reception, protocol handling |
| `src/encoder.cpp` | Rotary encoder reading using DWT cycle counter for precise speed measurement |
| `src/utilities.cpp` | Signal filtering, CRC16 checksums, PWM control, validation functions |
| `include/datatypes.h` | All data structures (Configuration, Status, PID, CAN messages) |
| `include/config.h` | System constants, pin definitions, compile-time configuration |
| `include/pins.h` | Hardware pin assignments for Teensy 4.1 |
| `include/messages.h` | System status/info message codes |
| `include/can.h` | CAN protocol message IDs and function prototypes |

## Data Structures

### Configuration Structure (`include/datatypes.h`)
Transmitted via CAN and stored in non-volatile memory. Contains:
- PID tuning parameters (kp, ki, kd) for torque/speed/dynamic controllers
- Load cell calibration (gain, offset, scale, distance)
- PWM limits and frequency
- Low-pass filter cutoff frequencies
- Speed limits (min/max)
- Dynamic testing parameters

### Status Structure (`include/datatypes.h`)
Real-time system monitoring data:
- Sensor readings (speed, torque, acceleration) - volatile for ISR access
- PWM output value
- System state (STOPPED/RUNNING), operational mode, info codes
- Configuration checksums for validation
- CAN communication flags

## Hardware Configuration

### Load Cell Selection (compile-time in `include/config.h`)
Two load cell ADC options - select one:
- `USE_HX711_LOAD_CELL`: External HX711 24-bit ADC (alternative)
- `USE_ADS1220_LOAD_CELL`: Internal ADS1220 24-bit ADC (default)

Comment/uncomment the appropriate `#define` in `config.h`

### Key Hardware Connections
- Encoder A/B: Pins 2/3 (interrupt-driven, quadrature)
- HX711 DAT/CLK: Pins 9/8
- PWM output: Pin 4 (hardware PWM, 16-bit, 1kHz)
- Hall sensor ADC: A10 (12-bit)
- BME280 (T + RH) on Wire1: SCL1=16, SDA1=17, addr 0x76
- ADS1220 on default SPI (MOSI=11, MISO=12, SCK=13): CS=10, DRDY=41
- MAX22530 on default SPI: CS=0
- OneWire (DS18B20): Pin 15

### Encoder Configuration
- Pulses per revolution: 50 (configurable via `ENC_PPR`)
- Quadrature multiplier: 4x
- Uses ARM DWT cycle counter for CPU-cycle-accurate timing
- ISRs: `isr_phaseA()`, `isr_phaseB()` in `src/encoder.cpp`

## CAN Bus Protocol

### Message ID Ranges
- **Microcontroller → Server**: 0x01-0x12
- **Server → Microcontroller**: 0x100-0x126

### Key CAN IDs (defined in `include/can.h`)
- `0x01`: Real-time speed/torque data
- `0x02`: System status
- `0x03`: Configuration request
- `0x06`: Microcontroller heartbeat
- `0x100`: Run mode selection
- `0x101`: Start/Stop commands
- `0x103`: Checksum validation
- `0x109-0x117`: PID gain configuration
- `0x118-0x126`: Load cell, PWM, filter, speed limits, dynamic config

### CAN Queue Implementation
- Circular buffer with 64-message capacity (`CAN_QUEUE_SIZE`)
- Thread-safe with interrupt-protected enqueue/dequeue
- Overflow detection with sticky flag
- Located in `src/can.cpp` (CANQueue struct)

## Signal Processing

### Filtering Chain
1. **Low-pass filters** (`utilities.cpp:lowPassFilter()`): First-order IIR filters
   - Configurable cutoff frequencies via CAN
   - State maintained in `LowPassFilter` structures
2. **Cascaded low-pass filters** (`CascadedLowPassFilter`): Multi-stage variable-rate filtering for speed, torque, and acceleration

### Calculations
- **Speed**: RPM = (rad/s) × 60 / (2π)
- **Torque**: Nm = kg × 9.80665 × lever_arm_distance
- **Acceleration**: Computed via finite difference of filtered speed

## Important Implementation Notes

### Interrupt Safety
- Encoder data is volatile and modified by ISRs - use `noInterrupts()/interrupts()` when reading
- Timing flags in `TimeControl` structure are modified by 1ms ISR
- Always disable interrupts around multi-byte volatile reads

### Load Cell Taring
- HX711: `hx711.tare(samples)` - zeros the offset
- ADS1220: `tare_internal_lcell(samples)` - averages voltage samples for offset

### CRC16 Checksum
- IBM polynomial (0xA001)
- Used for configuration validation between server and microcontroller
- Computed over entire `Configuration` structure

### PID Controllers
- Uses QuickPID library
- Five controllers: torquePID, speedPID, speedLimitPID, dynamicPID, brakeDynamicPID
- Output limits set from PWM configuration
- Sample time: 1ms (1000Hz)

### Dynamic Testing Configuration
Important parameters in `Dynamic_config`:
- `start_speed`: Initial RPM before acceleration
- `stable_time_ms`: Time to hold for speed stabilization
- `accel_rate`: Target acceleration rate (RPM/s)
- `end_speed`: Maximum test speed
- `hold_ms`: Time to hold at peak speed
- `accel_down`: Deceleration rate (RPM/s)
- `final_speed`: Target RPM after deceleration

## Debugging

### Enabling Debug Output
Uncomment `#define ENABLE_DEBUG_OUTPUT` in `include/config.h`

### Debug CAN Messages
- `0x08`: PID debug data (setpoint, PWM, timestamp)
- `0x11`: Acceleration debug (unfiltered)
- `0x12`: Speed/torque debug (unfiltered)

### Common Issues
- **Checksum mismatch**: System will request config via CAN until valid checksum received
- **Low speed warning**: Speed below `config.speed_limits.min_speed` disables PID control
- **CAN queue overflow**: Check `canQueueRx.overflow` / `canQueueTx.overflow` flags
