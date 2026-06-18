// pins.h - Teensy 4.1 pin assignments for DynoLogic

#ifndef PINS_H
#define PINS_H

// LOAD CELL (HX711 - external 24-bit ADC, optional)
#define HX711_DAT 9   // HX711 data pin (DOUT)
#define HX711_CLK 8   // HX711 clock pin (PD_SCK)

// INTERNAL ADS1220 LOAD CELL ADC
// Shares default SPI bus (SPI0) with the MAX22530 voltage ADC.
// SPI0 pins on Teensy 4.1: MOSI=11, MISO=12, SCK=13.
#define ADS_SPI     SPI    // Default SPI0 instance
#define PIN_DRDY    41     // Data Ready signal (active LOW)
#define PIN_CS      10     // Chip Select for ADS1220

// ACTUATOR CONTROL
#define PWM_PIN 4         // PWM output to eddy current brake (16-bit hardware PWM)

// ENVIRONMENTAL SENSORS
#define BME280_WIRE     Wire1   // I2C1 bus (SCL1=16, SDA1=17)
#define BME280_I2C_ADDR 0x76    // I2C address (SDO tied to GND)
#define ONE_WIRE_BUS    15      // DS18B20 temperature sensor (OneWire bus)

// CURRENT MEASUREMENT
#define HALL_ADC_PIN A10  // Hall effect current sensor (12-bit ADC)

// VOLTAGE MEASUREMENT (MAX22530 SPI ADC)
// UNUSED
#define MAX22530_CS_PIN 0 // Chip select for MAX22530

// SPEED MEASUREMENT (ENCODER)
#define ENC_A_PIN 2       // Encoder channel A (primary quadrature)
#define ENC_B_PIN 3       // Encoder channel B (secondary quadrature)

#endif // PINS_H
