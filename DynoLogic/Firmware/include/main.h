// main.h - Main system interface and control functions

#ifndef MAIN_H
#define MAIN_H
#include <cstdint>
#include "datatypes.h"

/**
 * System initialization
 */
void setup();

/**
 * Main control loop
 */
void loop();

/**
 * 1ms timer interrupt handler
 */
void timer_1ms_isr(void);

/**
 * Initialize encoder
 */
void init_encoder(void);

/**
 * Initialize HX711 load cell ADC
 */
void init_hx711(void);

/**
 * Initialize PWM output
 */
void init_pwm(void);

/**
 * Initialize MLX90614 IR temperature sensor
 */
void init_i2c_temp(void);

/**
 * Initialize MAX22530 external ADC
 */
void init_external_adc(void);

/**
 * Initialize CAN bus interface
 */
void init_can(void);

/**
 * Initialize Hall effect current sensor
 */
void init_hall(void);

/**
 * Initialize DS18B20 temperature sensor
 */
void init_ds18b20(void);

/**
 * Initialize BME280 env sensor and start its background polling thread
 */
void init_env_temp(void);

/**
 * Initialize internal ADS1220 load cell ADC.
 */
void init_internal_lcell(void);

/**
 * Initialize PID controllers
 */
void init_pid(void);

/**
 * Initialize data structures
 */
void init_data_structures(void);

/**
 * Initialize interrupt timer
 */
void init_interrupts(void);

/**
 * Read brake voltage
 */
int read_brake_voltage(void);

/**
 * Read brake current
 */
float read_brake_current(void);

/**
 * Read brake temperature
 */
void read_brake_temperature(Status &status);

/**
 * Read ambient temperature (DS18B20)
 */
void read_ds18b20_temperature(Status &status);

/**
 * Internal load cell ADC reading (ADS1220)
 */
bool read_internal_lcell(float &kilograms);

/**
 * Tare internal load cell (ADS1220)
 */
void tare_internal_lcell(uint8_t samples);

/**
 * Update speed measurement
 */
void update_speed(void);

/**
 * Update torque measurement
 */
void update_torque(void);

/**
 * Calculate acceleration
 */
void update_acceleration(float filtered_speed_rads, uint32_t now_us);

/**
 * Main PID dispatcher
 */
void run_pid(void);

/**
 * Dynamic testing state machine
 */
void run_dynamic_pid(void);

/**
 * Speed mode PID control
 */
void run_speed_pid(void);

/**
 * Acceleration mode PID control
 */
void run_acceleration_pid(void);

/**
 * Torque mode PID control
 */
void run_torque_pid(void);

/**
 * Parse incoming CAN messages
 */
void parse_can_message(void);

/**
 * Request configuration from server
 */
void request_can_config(void);

#endif // MAIN_H
