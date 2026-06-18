# DynoLogic

> Real-time embedded dynamometer controller (Teensy 4.1) with multi-mode PID control and CAN bus communication.

Part of the **OpenDyno** motor dynamometer system.

## 1. Firmware Configuration (`config.h`)

For a complete step-by-step assembly and setup guide, please see [../GETTING_STARTED.md](../GETTING_STARTED.md). 

The firmware provides several compile-time parameters that must be set to match your exact hardware setup. These are found in **`Firmware/include/config.h`**.

### Load Cell Type (CRITICAL)
The DynoLogic board supports two different ADCs for the load cell. You **must** define exactly one of them in `config.h` by uncommenting the appropriate line:
```cpp
// LOAD CELL SELECTION
//#define USE_HX711_LOAD_CELL                 // External HX711 amplifier (legacy)
#define USE_ADS1220_LOAD_CELL                 // Internal ADS1220 24-bit ADC (default for DynoLogic v3)
```

### Encoder Resolution
Set the number of pulses per revolution (PPR) of your rotary encoder. The firmware uses hardware quadrature decoding, so the actual counts per revolution will be 4× this value.
```cpp
#define ENC_PPR 50                            // Base resolution of your encoder
#define ENC_REVERSE_DIRECTION 1               // Reverse quadrature sign to ensure positive RPM
```

### Brake Safety Limits
Set hard limits for the PWM duty cycle and operating speeds to prevent thermal runaway or mechanical failure.
```cpp
#define DEFAULT_MAXIMUM_SPEED 4500            // Maximum operating speed [RPM]
#define DEFAULT_MAX_PWM_OUTPUT 330            // Maximum PWM value
```

### Signal Filtering
The system uses cascaded low-pass filters to clean up noisy sensor data. You can tune the aggressiveness of these filters:
```cpp
#define LOW_PASS_FILTER_SPEED_FREQ 20.0       // Speed filter cutoff [Hz]
#define LOW_PASS_FILTER_TORQUE_FREQ 15.0      // Torque filter cutoff [Hz]
```

> [!TIP]
> While these are the default firmware values, parameters like PID gains, minimum/maximum RPM, and filter cutoffs can also be tuned live via the DynoServer web interface!

## 2. Building and Flashing

### Prerequisites
1. Install [PlatformIO](https://platformio.org/install)
2. Clone this repository
3. Connect the Teensy 4.1 via USB

### Build Commands

```bash
# Build the project
pio run

# Upload to Teensy 4.1
pio run --target upload

# Clean build artifacts
pio run --target clean

# Monitor serial output (500000 baud)
pio device monitor

# Upload and monitor in one command
pio run --target upload && pio device monitor
```

## 3. Features & Specifications

- **Multiple Control Modes**
  - Torque control mode with load cell feedback
  - Speed control mode with rotary encoder feedback
  - Acceleration control mode
  - Dynamic testing mode with automated state machine

- **High-Performance Sensors**
  - Rotary encoder with DWT cycle-counter timing for precise speed measurement
  - 24-bit load cell ADC (HX711 or ADS1220 @ 2 kSPS turbo) for torque measurement
  - MLX90614 IR temperature sensor for brake monitoring
  - Hall effect current sensor
  - Environmental sensors (BME280, DS18B20)

- **Real-Time Control**
  - 1ms PID control loop (1000Hz update rate)
  - Multi-rate task scheduling (1ms, 10ms, 100ms, 500ms, 1s, 5s)
  - Configurable cascaded low-pass filtering

- **Safety Features**
  - Configurable speed limits (min/max)
  - PWM output limits
  - Configuration checksum validation
  - Heartbeat monitoring

## 4. Hardware Setup

The DynoLogic control board (`DynoLogic_v3`) is the brains of the operation. It interfaces with the sensors and controls the eddy current brake via the DynoPower board.

- **Schematics & PCB**: The full KiCad 7 project is located in `Hardware/`.
- **Manufacturing**: To manufacture the PCB, use the pre-generated Gerbers found at `Hardware/Gerbers/DynoLogic_v3.zip`.
- **Assembly**: Use the interactive bill of materials at `Hardware/bom/ibom.html` to easily place and solder components.

### Pin Assignments
```
┌─────────────────────────────────────────────────────────────────┐
│                    Teensy 4.1 Pin Assignments                   │
├─────────────────────────────────────────────────────────────────┤
│  PWM Output (Brake)                                             │
│  ├── Pin 4: PWM output (16-bit, 1kHz)                           │
│                                                                 │
│  Encoder (Quadrature)                                           │
│  ├── Pin 2: Phase A (interrupt, rising edge)                    │
│  ├── Pin 3: Phase B (interrupt, rising edge)                    │
│                                                                 │
│  Load Cell (HX711 - Alternative)                                │
│  ├── Pin 8: CLK (clock)                                         │
│  ├── Pin 9: DAT (data)                                          │
│                                                                 │
│  Load Cell (ADS1220 - Default, shares SPI0 with MAX22530)       │
│  ├── Pin 10: CS (chip select)                                   │
│  ├── Pin 41: DRDY (data ready, ISR-driven)                      │
│  └── SPI0: MOSI=11, MISO=12, SCK=13                             │
│                                                                 │
│  Temperature Sensors                                            │
│  ├── Pins 16/17: BME280 on Wire1 (SCL1/SDA1, addr 0x76)         │
│  ├── Pin 15: OneWire bus (DS18B20)                              │
│  └── Wire (I2C0): MLX90614 IR temperature sensor                │
│                                                                 │
│  Current/Voltage Measurement                                    │
│  ├── Pin A10: Hall effect current sensor (12-bit ADC)           │
│  ├── Pin 0:  MAX22530 CS (hardware feature, unused in firmware) │
└─────────────────────────────────────────────────────────────────┘
```

## 5. System Architecture

### CAN Bus Protocol
- **Microcontroller → Server**: `0x01 - 0x13`
- **Server → Microcontroller**: `0x100 - 0x126`

### Multi-Rate Control Loop
```
┌──────────────────────────────────────────────────────────────┐
│  1ms Timer ISR                                               │
│  └── Sets timing flags for multi-rate scheduling            │
├──────────────────────────────────────────────────────────────┤
│  Main Loop                                                   │
│  ├── 1ms:  PID control (1000Hz)                             │
│  ├── 10ms: Real-time data transmission                      │
│  ├── 100ms: CAN TX/RX, electrical data                      │
│  ├── 500ms: System status, LED heartbeat                    │
│  ├── 1s: Temperature readings, config reset                 │
│  └── 5s: Maintenance tasks                                  │
└──────────────────────────────────────────────────────────────┘
```

### Signal Processing Chain
```
Raw Sensor Data
    │
    ▼
Cascaded Low-Pass Filter (configurable cutoff)
    │
    ▼
Control System / CAN Transmission
```

## 6. Directory Structure

- `Firmware/` – PlatformIO C++ firmware (`src/`, `include/`, `platformio.ini`)
- `Hardware/` – KiCad 7 project (`DynoLogic_v3`), libraries, BOM, backups

## 7. Safety Considerations

> [!CAUTION]
> This system controls high-power eddy current brakes. Ensure:
> - Proper mechanical mounting and coupling
> - Emergency stop functionality is tested
> - Load cell is properly calibrated before use
> - Speed limits are configured appropriately for your equipment
> - PWM limits are set conservatively on first use
> - System is monitored during operation

## License

Licensed under the OpenDyno custom non-commercial license. See root [LICENSE](../LICENSE).
