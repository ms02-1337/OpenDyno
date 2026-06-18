// main.cpp - Main control loop and system initialization

#include <HX711.h>
#include <imxrt.h>
#include <Wire.h>
#include <Arduino.h>
#include <ACAN_T4.h>
#include <OneWire.h>
#include <Adafruit_BME280.h>
#include <Protocentral_ADS1220.h>
#undef MODE_NORMAL   // clashes with Adafruit_BME280::MODE_NORMAL enum value
#undef START         // clashes with can.h START symbol
#include "QuickPID.h"
#include <MAX22530.h>
#include <Adafruit_MLX90614.h>
#include <DallasTemperature.h>
#include <NonBlockingDallas.h>
#include <TeensyThreads.h>   // Background thread for DS18B20 OneWire polling and BME280 I2C polling

// Local headers
#include "can.h"
#include "main.h"
#include "pins.h"
#include "config.h"
#include "encoder.h"
#include "messages.h"
#include "utilities.h"

// GLOBAL SYSTEM STATE
Status status;                       // Real-time measurements and system state
Configuration config;                // Active configuration parameters
Dynamic_config_static static_config; // Fixed dynamic testing parameters
volatile TimeControl time_control;   // Multi-rate timing flags

volatile uint32_t counter_1ms = 0;
volatile uint32_t counter_10ms = 0;
volatile uint32_t counter_100ms = 0;
volatile uint32_t counter_500ms = 0;
volatile uint32_t counter_1s = 0;

// DS18B20 BACKGROUND THREAD
static int ds18b20_thread_id = -1;          // Thread handle (-1 = not started)
static Threads::Mutex ds18b20_mutex;         // Guards status.env_temperature

// BME280 BACKGROUND THREAD
static int bme280_thread_id = -1;            // Thread handle (-1 = not started)
static Threads::Mutex bme280_mutex;          // Guards status.temperature/humidity

// SIGNAL FILTERING
CascadedLowPassFilter torqueFilter;   // Cascaded variable-rate torque filter (commercial-style)
CascadedLowPassFilter speedFilter;    // Cascaded variable-rate speed filter (commercial-style)
CascadedLowPassFilter accFilter;      // Cascaded variable-rate acceleration filter (commercial-style)
LowPassFilter outputFilter;           // Control output smoothing filter

// DATA CONVERSION
Float_converter float_converter; // Float/byte union for CAN protocol

// ADS1220 DRDY INTERRUPT FLAG
#if defined(USE_ADS1220_LOAD_CELL)
volatile bool ads_drdy_ready = false;

/**
 * ADS1220 DRDY interrupt handler
 */
void ads_drdy_isr()
{
    ads_drdy_ready = true;
}
#endif

// HALL SENSOR OVERSAMPLING
HallSensorAverager hallAverager;  // Global instance

// HARDWARE PERIPHERAL INSTANCES
Adafruit_BME280 bme;                                     // BME280 environmental sensor (Wire1)
MAX22530 adc(MAX22530_CS_PIN, MAX22530_SPI);             // Voltage ADC (SPI)
OneWire oneWire(ONE_WIRE_BUS);                           // DS18B20 OneWire bus
DallasTemperature dallasTemp(&oneWire);                  // DS18B20 temperature
NonBlockingDallas temperatureSensors(&dallasTemp);       // DS18B20 non-blocking
ACAN_T4_Settings can_settings(CAN_SPEED);                // 500kbps CAN config
Adafruit_MLX90614 mlx = Adafruit_MLX90614();             // IR brake temperature

// Load cell ADC (compile-time selection)
#if defined(USE_HX711_LOAD_CELL)
HX711 hx711;                                             // External HX711 ADC
#elif defined(USE_ADS1220_LOAD_CELL)
Protocentral_ADS1220 ads_chip;                           // Internal ADS1220 (uses default SPI)
#else
#define USE_HX711_LOAD_CELL
HX711 hx711;
#endif

// DYNAMIC TESTING STATE VARIABLES
float limit_speed, dynamic_brake, dyno_baseline_load;     // Dynamic mode setpoints
volatile uint32_t dyno_stable_enter_ms = 0;               // Stability timer entry
volatile uint32_t dyno_hold_start_ms = 0;                 // Hold phase timer
bool dyno_baseline_valid = false;                         // Baseline torque captured

// PID CONTROLLERS
// Torque PID - Maintains constant torque (Nm) via load cell feedback
QuickPID torquePID((float *)&status.current_torque,
                   &status.pid_output,
                   &config.mode.value,
                   config.torque_pid.kp,
                   config.torque_pid.ki,
                   config.torque_pid.kd,
                   QuickPID::pMode::pOnErrorMeas,
                   QuickPID::dMode::dOnMeas,
                   QuickPID::iAwMode::iAwClamp,
                   QuickPID::Action::direct);

// Speed PID - Maintains constant RPM via encoder feedback
QuickPID speedPID((float *)&status.current_speed,
                  &status.pid_output,
                  &config.mode.value,
                  config.speed_pid.kp,
                  config.speed_pid.ki,
                  config.speed_pid.kd,
                  QuickPID::pMode::pOnErrorMeas,
                  QuickPID::dMode::dOnMeas,
                  QuickPID::iAwMode::iAwClamp,
                  QuickPID::Action::reverse);

// Speed Limit PID - Safety override to prevent overspeed
QuickPID speedLimitPID((float *)&status.current_speed,
                       &status.pid_output,
                       &limit_speed,
                       config.speed_pid.kp,
                       config.speed_pid.ki,
                       config.speed_pid.kd,
                       QuickPID::pMode::pOnErrorMeas,
                       QuickPID::dMode::dOnMeas,
                       QuickPID::iAwMode::iAwClamp,
                       QuickPID::Action::reverse);

// Dynamic PID - Controls acceleration rate (RPM/s)
QuickPID dynamicPID((float *)&status.current_acc,
                    &status.pid_output,
                    &config.mode.value,
                    config.dynamic_pid.kp,
                    config.dynamic_pid.ki,
                    config.dynamic_pid.kd,
                    QuickPID::pMode::pOnErrorMeas,
                    QuickPID::dMode::dOnMeas,
                    QuickPID::iAwMode::iAwClamp,
                    QuickPID::Action::reverse);

// Brake Dynamic PID - Controls deceleration rate
QuickPID brakeDynamicPID((float *)&status.current_acc,
                         &status.pid_output,
                         &dynamic_brake,
                         config.dynamic_pid.kp,
                         config.dynamic_pid.ki,
                         config.dynamic_pid.kd,
                         QuickPID::pMode::pOnMeas,
                         QuickPID::dMode::dOnMeas,
                         QuickPID::iAwMode::iAwClamp,
                         QuickPID::Action::reverse);

// TIMING VARIABLES
unsigned long last_security_time_check = 0;  // Connection watchdog timer

/**
 * DS18B20 background thread
 */
void ds18b20_thread_fn()
{
    while (true)
    {
        temperatureSensors.update();
        threads.delay(5);
    }
}

/**
 * BME280 background thread
 */
void bme280_thread_fn()
{
    while (true)
    {
        const float temp_c = bme.readTemperature(); // I2C read, blocks this thread only
        const float hum_pct = bme.readHumidity();

        if (!isnan(temp_c) && !isnan(hum_pct))
        {
            Threads::Scope lock(bme280_mutex);
            status.temperature = temp_c;
            status.humidity = hum_pct;
        }

        threads.delay(1000);
    }
}

static void enforce_disconnect_failsafe(void)
{
    if (status.connected)
    {
        return;
    }

    // Force safe state immediately when CAN link is lost.
    status.status = STOPPED;
    status.info = INFO_MSG_STOPPED;
    status.manual_pwm_enabled = false;
    status.pid_output = 0.0f;
    status.pwm_value = 0.0f;

    torquePID.SetMode(QuickPID::Control::manual);
    speedPID.SetMode(QuickPID::Control::manual);
    dynamicPID.SetMode(QuickPID::Control::manual);
    brakeDynamicPID.SetMode(QuickPID::Control::manual);
    speedLimitPID.SetMode(QuickPID::Control::manual);

    // Bypass set_pwm() clamp path so output is truly off.
    outputFilter.y_prev = 0.0f;
    outputFilter.timestamp_prev = 0;
    setDutyPercent(0.0f);
}

// INTERRUPT SERVICE ROUTINES

/**
 * 1ms timer interrupt handler
 *
 * Generates multi-rate timing flags for task scheduling:
 * - 1ms: PID control (1000Hz)
 * - 10ms: Real-time data transmission (100Hz)
 * - 100ms: CAN heartbeat, electrical data (10Hz)
 * - 500ms: System status broadcast (2Hz)
 * - 1s: Temperature sensors, config timeout (1Hz)
 * - 5s: Maintenance tasks (0.2Hz)
 */
void timer_1ms_isr(void)
{
    // Queue 1ms work for the main loop
    if (time_control.pending_1ms < 255) time_control.pending_1ms++;
    counter_1ms++;

    // 10ms flag - every 10 × 1ms
    if (counter_1ms >= 10)
    {
        if (time_control.pending_10ms < 255) time_control.pending_10ms++;
        counter_1ms = 0;
        counter_10ms++;
    }

    // 100ms flag - every 10 × 10ms
    if (counter_10ms >= 10)
    {
        if (time_control.pending_100ms < 255) time_control.pending_100ms++;
        counter_10ms = 0;
        counter_100ms++;
    }

    // 500ms flag - every 5 × 100ms
    if (counter_100ms >= 5)
    {
        if (time_control.pending_500ms < 255) time_control.pending_500ms++;
        counter_100ms = 0;
        counter_500ms++;
    }

    // 1s flag - every 2 × 500ms
    if (counter_500ms >= 2)
    {
        if (time_control.pending_1s < 255) time_control.pending_1s++;
        counter_500ms = 0;
        counter_1s++;
    }

    // 5s flag - every 5 × 1s
    if (counter_1s >= 5)
    {
        if (time_control.pending_5s < 255) time_control.pending_5s++;
        counter_1s = 0;
    }
}

// 1ms interval timer (Teensy 4.1 hardware timer)
IntervalTimer timer1ms;

// FLEXPWM INTERRUPT (HALL SENSOR ADC SYNCHRONIZATION)

/**
 * FlexPWM Hardware Interrupt
 */
FASTRUN void flexpwm2_0_isr(void)
{
    // Clear the reload flag to acknowledge the interrupt
    IMXRT_FLEXPWM2.SM[0].STS = FLEXPWM_SMSTS_RF;

    // Call our synchronously-timed sampling function
    sample_hall_sensor_sync(hallAverager);
    
    asm("dsb"); // memory barrier
}

// INIT FUNCTION

/**
 * System initialization
 *
 * Called once at startup. Initializes all hardware in sequence:
 * 1. Serial communication (debug output)
 * 2. PWM output for brake control
 * 3. Data structures (default values)
 * 4. PID controllers (limits and timing)
 * 5. Interrupt timer (1ms for multi-rate scheduling)
 * 6. CAN communication
 * 7. Encoder (speed measurement)
 * 8. Load cell (torque sensor)
 * 9. External ADC (voltage measurement)
 * 10. IR temperature sensor (brake monitoring)
 * 11. DS18B20 ambient temperature
 * 12. Hall sensor (current measurement)
 * 13. Environmental sensor (BME280)
 */
void setup(void)
{
// Serial communication
#ifdef ENABLE_DEBUG_OUTPUT
    SERIAL_PORT.begin(SERIAL_SPEED); // 500kbps for fast debug output
#endif
    delay(5000); // Startup delay for debugging

    DEBUG_PRINT("[+] Expected C++ struct size: ");
    DEBUG_PRINTLN(sizeof(Configuration));

    // Core system initialization
    init_pwm();             // Eddy current brake PWM

    // Configure FlexPWM hardware trigger for ADC synchronization
    // Attach to FlexPWM2 Submodule 0 (controls Pin 4)
    attachInterruptVector(IRQ_FLEXPWM2_0, flexpwm2_0_isr);
    NVIC_ENABLE_IRQ(IRQ_FLEXPWM2_0);
    IMXRT_FLEXPWM2.SM[0].INTEN |= FLEXPWM_SMINTEN_RIE; // Enable Reload Interrupt

    init_data_structures(); // System state and configuration
    init_pid();             // PID controllers
    init_interrupts();      // 1ms multi-rate timer

    // Hardware peripherals
    init_can();          // CAN bus (500kbps)
    init_encoder();      // Rotary encoder (quadrature)

    // Load cell (compile-time selection)
    #if defined(USE_HX711_LOAD_CELL)
    init_hx711();                               // HX711 external ADC
    #elif defined(USE_ADS1220_LOAD_CELL)
    init_internal_lcell();                      // ADS1220 internal ADC
    #endif

    // init_external_adc(); // MAX22530 SPI ADC (voltage) — UNUSED
    init_i2c_temp();     // MLX90614 IR sensor (brake temp)
    init_ds18b20();      // DS18B20 ambient temp
    init_hall();         // Hall sensor (current)
    init_env_temp();     // BME280 environmental (T + RH on Wire1)

    // Start DS18B20 background thread
    ds18b20_thread_id = threads.addThread(ds18b20_thread_fn, 0, 2048);
    // Restrict the thread to 1 tick (1ms) so it doesn't starve the main loop
    threads.setTimeSlice(ds18b20_thread_id, 1);
    DEBUG_PRINT("[+] DS18B20 background thread started, id=");
    DEBUG_PRINTLN(ds18b20_thread_id);

    // Start BME280 background thread - init_env_temp() has already configured
    bme280_thread_id = threads.addThread(bme280_thread_fn, 0, 2048);
    threads.setTimeSlice(bme280_thread_id, 1);
    DEBUG_PRINT("[+] BME280 background thread started, id=");
    DEBUG_PRINTLN(bme280_thread_id);
    DEBUG_PRINTLN("[+] setup() complete");
}

/**
 * Main control loop
 *
 * Executes continuously with multi-rate task scheduling based on
 * flags set by 1ms timer ISR. Task priorities:
 *
 * Continuous (every iteration):
 * - Update speed and torque measurements
 * - DS18B20 state machine
 * - CAN RX/TX processing
 * - Connection watchdog check
 *
 * 1ms tasks (1000Hz):
 * - PID control execution
 *
 * 10ms tasks (100Hz):
 * - Real-time data streaming (speed, torque, acceleration)
 * - Debug data transmission
 *
 * 100ms tasks (10Hz):
 * - CAN heartbeat
 * - Current and voltage measurement
 *
 * 500ms tasks (2Hz):
 * - System status broadcast
 *
 * 1s tasks (1Hz):
 * - Brake temperature measurement and transmission
 * - DS18B20 temperature transmission
 * - Ongoing config sync service
 *
 * 5s tasks (0.2Hz):
 * - Environmental sensor (BME280)
 */
void loop(void)
{
    uint8_t pending_1ms = 0;
    uint8_t pending_10ms = 0;
    uint8_t pending_100ms = 0;
    uint8_t pending_500ms = 0;
    uint8_t pending_1s = 0;
    uint8_t pending_5s = 0;

    // Continuous tasks (every iteration)
    update_speed();              // Read encoder, calculate RPM
    update_torque();             // Read load cell, calculate torque

    check_new_can_message();       // Check hardware for RX messages
    process_can_tx_queue();       // Send queued CAN messages
    parse_can_message();          // Process received CAN messages
    request_can_config();         // Non-blocking config sync service

    // Connection watchdog (reset by heartbeat, checked every loop)
    if (millis() - last_security_time_check > SECURITY_CHECK_INTERVAL)
    {
        status.connected = false; // Timeout - no heartbeat
    }
    enforce_disconnect_failsafe();

    // Atomically consume pending scheduler ticks and count skipped cycles.
    __disable_irq();
    pending_1ms = time_control.pending_1ms;
    pending_10ms = time_control.pending_10ms;
    pending_100ms = time_control.pending_100ms;
    pending_500ms = time_control.pending_500ms;
    pending_1s = time_control.pending_1s;
    pending_5s = time_control.pending_5s;
    time_control.pending_1ms = 0;
    time_control.pending_10ms = 0;
    time_control.pending_100ms = 0;
    time_control.pending_500ms = 0;
    time_control.pending_1s = 0;
    time_control.pending_5s = 0;
    if (pending_1ms > 1) time_control.missed_1ms += (pending_1ms - 1);
    if (pending_10ms > 1) time_control.missed_10ms += (pending_10ms - 1);
    if (pending_100ms > 1) time_control.missed_100ms += (pending_100ms - 1);
    if (pending_500ms > 1) time_control.missed_500ms += (pending_500ms - 1);
    if (pending_1s > 1) time_control.missed_1s += (pending_1s - 1);
    if (pending_5s > 1) time_control.missed_5s += (pending_5s - 1);
    __enable_irq();

    // === 1ms tasks (1000Hz nominal) === //
    if (pending_1ms > 0)
    {
        run_pid(); // Execute PID control
    }

    // === 10ms tasks (100Hz nominal) === //
    if (pending_10ms > 0)
    {
        status.current_timestamp = millis();

        if (status.live_mode == TRUE || status.status == RUNNING)
        {
            // Primary telemetry: filtered speed and torque
            send_speed_torque_timestamp(status);

            // Debug data (raw values for diagnostics)
            if (config.debug_mode == TRUE)
            {
                send_pid_debug_data(config, status);
                send_speed_torque_debug_timestamp(status);
                send_acceleration_debug_timestamp(status);
            }

            // Acceleration data
            send_acceleration_timestamp(status);
        }
    }

    // === 100ms tasks (10Hz) === //
    if (pending_100ms > 0)
    {
        send_heartbeat();           // Microcontroller heartbeat
        status.current = read_brake_current(); // Hall sensor current
        send_electrical_data(status); // Voltage + current
    }

    // === 500ms tasks (2Hz) === //
    if (pending_500ms > 0)
    {
        send_can_status(status); // System status broadcast
    }

    // === 1s tasks (1Hz) === //
    if (pending_1s > 0)
    {
        read_brake_temperature(status);    // MLX90614 IR sensor
        send_brake_temperature(status);    // Transmit brake temp
        send_ds18b20_temperature(status);  // DS18B20 ambient temp
    }

    // === 5s tasks (0.2Hz) === //
    if (pending_5s > 0)
    {
        send_env(status);  // Send temp and humidity
    }

    threads.yield();
}

// PID CONTROL DISPATCHERS

/**
 * Main PID dispatcher
 */
void run_pid(void)
{
    /* Dynamic Mode - Acceleration test state machine */
    if (config.mode.mode == DYNAMIC_MODE && status.status == RUNNING && status.valid_checksum)
    {
        run_dynamic_pid();
    }
    /* Acceleration Mode - Controls acceleration rate */
    else if (config.mode.mode == ACCELERATION_MODE && status.status == RUNNING && status.valid_checksum)
    {
        run_acceleration_pid();
    }
    /* Torque Mode - Constant torque control */
    else if (config.mode.mode == TORQUE_MODE && status.status == RUNNING && status.valid_checksum)
    {
        run_torque_pid();
    }
    /* Speed Mode - Constant RPM control */
    else if (config.mode.mode == SPEED_MODE && status.status == RUNNING && status.valid_checksum)
    {
        run_speed_pid();
    }
    /* Stopped and not manual mode - Safety: PWM off */
    else if (status.status == STOPPED && !status.manual_pwm_enabled)
    {
        set_pwm(0, config, outputFilter, status);
    }
}

// DYNAMIC TESTING STATE MACHINE

/**
 * Transition to new dynamic test state
 */
static void dyno_enter_state(dynamic_dyno_state s)
{
    dyno_state = s;

    // Update status info message for each state
    switch (s)
    {
    case IDLE:
        status.info = INFO_MSG_IDLE;
        break;
    case SPINUP_TO_START_SPEED:
        status.info = INFO_MSG_SPINUP;
        break;
    case WAIT_STABLE:
        status.info = INFO_MSG_WAIT_STABLE;
        break;
    case ACCELERATING:
        status.info = INFO_MSG_ACCELERATING;
        break;
    case HOLD_TOP_SPEED:
        status.info = INFO_MSG_HOLD_TOP_SPEED;
        break;
    case WAIT_TORQUE_DROP:
        status.info = INFO_MSG_WAIT_TORQUE_DROP;
        break;
    case DECELERATING:
        status.info = INFO_MSG_DECELERATING;
        break;
    case FINISHED:
        status.info = INFO_MSG_FINISHED;
        break;
    default:
        break;
    }
    send_can_status(status); // Notify server of state change
}

/**
 * Dynamic testing state machine
 *
 * Implements 8-state acceleration test sequence:
 * 1. IDLE: Initial state, brake off
 * 2. SPINUP_TO_START_SPEED: Accelerate to test start speed
 * 3. WAIT_STABLE: Hold speed until stable (within tolerance)
 * 4. ACCELERATING: Apply controlled acceleration rate
 * 5. HOLD_TOP_SPEED: Maintain peak speed
 * 6. WAIT_TORQUE_DROP: Monitor for torque drop (engine power peak)
 * 7. DECELERATING: Controlled ramp down
 * 8. FINISHED: Test complete
 */
void run_dynamic_pid(void)
{
    uint32_t now = millis();

    switch (dyno_state)
    {
    case IDLE:
        set_pwm(0, config, outputFilter, status); // Brake off
        speedLimitPID.SetMode(QuickPID::Control::automatic);
        dynamicPID.SetMode(QuickPID::Control::manual);
        dyno_baseline_valid = false;
        dyno_enter_state(SPINUP_TO_START_SPEED);
        break;

    case SPINUP_TO_START_SPEED:
        // Accelerate to start_speed using speed limit PID
        limit_speed = config.dynamic_config.start_speed;
        speedLimitPID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);

        // Transition when target reached
        if (status.current_speed >= config.dynamic_config.start_speed)
        {
            dyno_stable_enter_ms = 0;
            dyno_enter_state(WAIT_STABLE);
        }
        break;

    case WAIT_STABLE:
        // Hold start speed and check stability
        limit_speed = config.dynamic_config.start_speed;
        speedLimitPID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);

        // Check if speed is within tolerance
        if (speed_within_tol(status.current_speed,
                             config.dynamic_config.start_speed,
                             static_config.stable_speed_tolerance))
        {
            // Start stability timer on first entry
            if (dyno_stable_enter_ms == 0)
            {
                dyno_stable_enter_ms = now;
            }
            else if (now - dyno_stable_enter_ms >= config.dynamic_config.stable_time_ms)
            {
                // Stable long enough - proceed to acceleration
                dyno_stable_enter_ms = 0;
                dyno_enter_state(ACCELERATING);
                speedLimitPID.SetMode(QuickPID::Control::manual);
                dynamicPID.SetMode(QuickPID::Control::automatic);
            }
        }
        else
        {
            // Not stable - reset timer and indicate instability
            status.info = INFO_MSG_INESTABLE_SPEED;
            dyno_stable_enter_ms = 0;
        }
        break;

    case ACCELERATING:
        // Apply controlled acceleration
        dynamicPID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);

        // Capture baseline torque on first positive reading
        if (!dyno_baseline_valid && status.current_torque > 0.0f)
        {
            dyno_baseline_load = status.current_torque;
            dyno_baseline_valid = true;
        }

        // Transition when end speed reached
        if (status.current_speed >= config.dynamic_config.end_speed)
        {
            dynamicPID.SetMode(QuickPID::Control::manual);
            speedLimitPID.SetMode(QuickPID::Control::automatic);
            dyno_enter_state(HOLD_TOP_SPEED);
            dyno_hold_start_ms = now;
        }
        break;

    case HOLD_TOP_SPEED:
        // Maintain peak speed
        limit_speed = config.dynamic_config.end_speed;
        speedLimitPID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);

        // Capture baseline if not already done
        if (!dyno_baseline_valid)
        {
            dyno_baseline_load = status.current_torque;
            dyno_baseline_valid = true;
        }

        // Hold for configured duration, then monitor for torque drop
        if (now - dyno_hold_start_ms >= config.dynamic_config.hold_ms)
        {
            dyno_enter_state(WAIT_TORQUE_DROP);
        }
        break;

    case WAIT_TORQUE_DROP:
        {
            static float last_load = 0.0f;
            static uint32_t drop_detected_ms = 0;
            float load_now = status.current_torque;

            // Smooth torque reading (30% new, 70% old)
            last_load = (last_load * 0.7f) + (load_now * 0.3f);

            // Avoid division by zero
            if (dyno_baseline_load <= 0.0f)
            {
                dyno_baseline_load = last_load;
            }

            // Calculate relative torque drop
            float rel_drop = 0.0f;
            if (dyno_baseline_load > 0.0f)
            {
                rel_drop = (dyno_baseline_load - last_load) / dyno_baseline_load;
            }

            // Require drop to persist for 200ms (avoid false triggers)
            if (rel_drop >= static_config.torque_drop_threshold)
            {
                if (drop_detected_ms == 0)
                    drop_detected_ms = now;
                else if (now - drop_detected_ms >= 200)
                {
                    // Torque drop confirmed - engine peaked, start deceleration
                    drop_detected_ms = 0;
                    dyno_enter_state(DECELERATING);
                }
            }
            else
            {
                drop_detected_ms = 0; // Reset - not enough drop
            }
        }
        break;

    case DECELERATING:
        // Controlled deceleration to final speed
        dynamic_brake = -fabsf(config.dynamic_config.accel_down); // Negative setpoint
        brakeDynamicPID.SetMode(QuickPID::Control::automatic);
        brakeDynamicPID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);

        // Stop when final speed reached
        if (status.current_speed <= config.dynamic_config.final_speed)
        {
            brakeDynamicPID.SetMode(QuickPID::Control::manual);
            set_pwm(0, config, outputFilter, status); // Brake off
            status.status = STOPPED;
            dyno_enter_state(FINISHED);
        }
        break;

    case FINISHED:
        dyno_enter_state(IDLE);
        set_pwm(0, config, outputFilter, status);
        break;

    default:
        break;
    }
}

// MODE-SPECIFIC PID CONTROLLERS

/**
 * Speed mode PID control
 */
void run_speed_pid(void)
{
    if (status.current_speed < config.speed_limits.min_speed)
    {
        status.info = INFO_MSG_LOW_SPEED;
        set_pwm(0, config, outputFilter, status);
    }
    else
    {
        speedPID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);
        status.info = INFO_MSG_SPEED;
    }
}

/**
 * Acceleration mode PID control
 */
void run_acceleration_pid(void)
{
    if (status.current_speed < config.speed_limits.min_speed)
    {
        status.info = INFO_MSG_LOW_SPEED;
        set_pwm(0, config, outputFilter, status);
    }
    else
    {
        dynamicPID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);
        status.info = INFO_MSG_DYNAMIC;
    }
}

/**
 * Torque mode PID control
 */
void run_torque_pid(void)
{
    if (status.current_speed < config.speed_limits.min_speed)
    {
        status.info = INFO_MSG_LOW_SPEED;
        set_pwm(0, config, outputFilter, status);
    }
    else
    {
        torquePID.Compute();
        set_pwm(status.pid_output, config, outputFilter, status);
        status.info = INFO_MSG_TORQUE;
    }
}

// HARDWARE INITIALIZATION FUNCTIONS

/**
 * Initialize BME280 environmental sensor on Wire1
 */
void init_env_temp(void)
{
    BME280_WIRE.begin();

    if (!bme.begin(BME280_I2C_ADDR, &BME280_WIRE))
    {
        DEBUG_PRINTLN("[!] BME280 not detected on Wire1 @ 0x76");
        status.temperature = NAN;
        status.humidity = NAN;
        return;
    }

    bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                    Adafruit_BME280::SAMPLING_X1,   // Temperature
                    Adafruit_BME280::SAMPLING_X1,   // Pressure (unused but enabled)
                    Adafruit_BME280::SAMPLING_X1,   // Humidity
                    Adafruit_BME280::FILTER_OFF,
                    Adafruit_BME280::STANDBY_MS_1000);

    DEBUG_PRINTLN("[+] BME280 environmental sensor ready");
}

/**
 * Initialize CAN bus interface
 */
void init_can(void)
{
    can_settings.mListenOnlyMode = false;
    can_settings.mSelfReceptionMode = false;

    const uint32_t error_code = CAN_INTERFACE.begin(can_settings);
    if (error_code == 0)
    {
        DEBUG_PRINTLN("[+] CAN Initialized!");
    }
    else
    {
        DEBUG_PRINT("[!] Error initializing CAN: ");
        DEBUG_PRINTLN(error_code, HEX);
    }
}

/**
 * Initialize rotary encoder
 *
 * Brings up the hardware encoder pipeline: ENC1 quadrature decoder on
 * pins 2/3 plus TMR2 input-capture timestamping, both fed via XBARA1.
 */
void init_encoder(void)
{
    DEBUG_PRINTLN("[+] Setting encoder configuration");
    encoder_init_hw();          // ENC1 + TMR2 + XBAR fan-out
    status.current_speed = 0.0f;
    cascaded_lpf_reset(speedFilter, SPEED_LPF_STAGES);
}

/**
 * Initialize HX711 load cell ADC
 */
#if defined(USE_HX711_LOAD_CELL)
void init_hx711(void)
{
    uint8_t counter = 0;

    hx711.begin(HX711_DAT, HX711_CLK);

    // Wait for HX711 ready (max 1 second)
    while (!hx711.is_ready() && counter < 100)
    {
        counter++;
        delay(10);
    }

    if (hx711.is_ready())
    {
        hx711.tare(20); // Zero the load cell (20 samples)
        cascaded_lpf_reset(torqueFilter, TORQUE_LPF_STAGES); // Re-seed cascade after DC shift
        DEBUG_PRINTLN("[+] Load cell tared and initialized!");
        status.info = INFO_MSG_LCELL_OK;
    }
    else
    {
        DEBUG_PRINTLN("[!] Error initializing load cell!");
        status.info = INFO_MSG_LCELL_ERROR;
    }
}
#endif

/**
 * Initialize PWM output
 */
void init_pwm(void)
{
    DEBUG_PRINTLN("[+] Initializing PWM");

    pinMode(PWM_PIN, OUTPUT);
    analogWriteFrequency(PWM_PIN, PWM_FREQUENCY);   // 1kHz frequency on pin 4
    analogWriteResolution(16);                      // 16-bit resolution (0-65535)
    setDutyPercent(0);                              // Start at 0% duty cycle
}

/**
 * Initialize MLX90614 IR temperature sensor
 */
void init_i2c_temp(void)
{
    if (!mlx.begin())
    {
        DEBUG_PRINTLN("[!] Error initializing IR Temperature Sensor.");
    }
    else
    {
        DEBUG_PRINTLN("[+] Initialized IR Temp Sensor");
    }
}

/**
 * Initialize MAX22530 external ADC
 *
 * UNUSED
 */
void init_external_adc(void)
{
    if (!adc.begin(MAX22530_SPI_SPEED))
    {
        DEBUG_PRINTLN("[!] Error initializing MAX22530.");
    }
    else
    {
        DEBUG_PRINTLN("[+] Initialized External ADC");
    }
}

/**
 * Initialize Hall effect current sensor with oversampling
 */
void init_hall(void)
{
    analogReadResolution(12);     // 12-bit ADC resolution
    analogReadAveraging(0);       // Disable hardware averaging (using software)
    hallAverager.reset();         // Initialize oversampling accumulator

    DEBUG_PRINTLN("[+] Hall sensor initialized with 1kHz oversampling");
}

/**
 * Initialize DS18B20 temperature sensors
 */
void init_ds18b20(void)
{
    // 10-bit resolution (0.5°C), measure every 5 seconds
    temperatureSensors.begin(NonBlockingDallas::resolution_10, 5000);

    // Callback fires when new reading available.
    temperatureSensors.onIntervalElapsed([](int index, int32_t raw) {
        Threads::Scope lock(ds18b20_mutex);
        status.env_temperature = temperatureSensors.rawToCelsius(raw);
    });

    DEBUG_PRINTLN("[+] DS18B20 temperature sensor initialized");
}

/**
 * Initialize internal ADS1220 load cell ADC
 *
 * Configures ADS1220 with PGA=128, differential channels AIN0-AIN1, external
 * 5 V Vref on REFP0/REFN0, turbo mode at DR=1000 SPS
 */
#if defined(USE_ADS1220_LOAD_CELL)
void init_internal_lcell(void)
{
    pinMode(PIN_DRDY, INPUT);
    pinMode(PIN_CS, OUTPUT);
    digitalWrite(PIN_CS, HIGH);

    ads_chip.begin(PIN_CS, PIN_DRDY);

    ads_chip.set_pga_gain(PGA_GAIN_128);
    ads_chip.PGA_ON();
    ads_chip.select_mux_channels(MUX_AIN0_AIN1);
    ads_chip.set_data_rate(DR_1000SPS);           // 1000 SPS x turbo = 2 kSPS
    ads_chip.set_OperationMode(MODE_TURBO);
    ads_chip.set_VREF(VREF_REFP0);                // External Vref on REFP0/REFN0 (5 V LDO)
    ads_chip.set_FIR_Filter(FIR_OFF);
    ads_chip.set_conv_mode_continuous();

    delay(10);
    ads_chip.Start_Conv();
    delay(5);

    tare_internal_lcell(20);
    cascaded_lpf_reset(torqueFilter, TORQUE_LPF_STAGES);

    attachInterrupt(digitalPinToInterrupt(PIN_DRDY), ads_drdy_isr, FALLING);
    DEBUG_PRINTLN("[+] ADS1220 DRDY interrupt attached.");

    DEBUG_PRINTLN("[+] Internal load cell (ADS1220) initialized and tared!");
    status.info = INFO_MSG_LCELL_OK;
}
#else
void init_internal_lcell(void)
{
    DEBUG_PRINTLN("[!] ADS1220 not selected, init_internal_lcell() not available");
}
#endif

/**
 * Initialize PID controllers
 */
void init_pid(void)
{
    // Set output limits for all PIDs
    speedPID.SetOutputLimits((float)DEFAULT_MIN_PWM_OUTPUT, (float)DEFAULT_MAX_PWM_OUTPUT);
    speedLimitPID.SetOutputLimits((float)DEFAULT_MIN_PWM_OUTPUT, (float)DEFAULT_MAX_PWM_OUTPUT);
    torquePID.SetOutputLimits((float)DEFAULT_MIN_PWM_OUTPUT, (float)DEFAULT_MAX_PWM_OUTPUT);
    dynamicPID.SetOutputLimits((float)DEFAULT_MIN_PWM_OUTPUT, (float)DEFAULT_MAX_PWM_OUTPUT);
    brakeDynamicPID.SetOutputLimits((float)DEFAULT_MIN_PWM_OUTPUT, (float)DEFAULT_MAX_PWM_OUTPUT);

    // Set sample time for all PIDs (1ms = 1000Hz control loop)
    speedPID.SetSampleTimeUs(PID_FREQUENCY);
    speedLimitPID.SetSampleTimeUs(PID_FREQUENCY);
    torquePID.SetSampleTimeUs(PID_FREQUENCY);
    dynamicPID.SetSampleTimeUs(PID_FREQUENCY);
    brakeDynamicPID.SetSampleTimeUs(PID_FREQUENCY);
}

/**
 * Initialize data structures
 */
void init_data_structures(void)
{
    memset(&config, 0, sizeof(config));

    // System status
    status.status = STOPPED;      // Safe state
    status.live_mode = 1;         // Enable data streaming
    status.info = INFO_MSG_INIT;  // Initialization message
    status.voltage = 0;
    status.current = 0;
    status.manual_pwm_enabled = false;
    status.config_checksum = 0;

    config.debug_mode = TRUE; // Debug output enabled

    // PID gains (start at zero - configured via CAN)
    config.torque_pid.kp = 0;
    config.torque_pid.ki = 0;
    config.torque_pid.kd = 0;

    config.speed_pid.kp = 0;
    config.speed_pid.ki = 0;
    config.speed_pid.kd = 0;

    config.dynamic_pid.kp = 0;
    config.dynamic_pid.ki = 0;
    config.dynamic_pid.kd = 0;

    // Default to speed mode
    config.mode.mode = SPEED_MODE;
    config.mode.value = 0;

    // Load cell calibration
    config.load_cell.distance = 0.5; // 0.5m lever arm
    config.load_cell.gain = 128;     // HX711 gain
    config.load_cell.offset = 0;
    config.load_cell.scale = 1.0f;

    // PWM limits
    config.pwm_config.pwm_start = DEFAULT_MIN_PWM_OUTPUT;
    config.pwm_config.pwm_limit = DEFAULT_MAX_PWM_OUTPUT;
    config.pwm_config.pwm_frequency = DEFAULT_PWM_FREQUENCY;

    // Low-pass filter cutoffs
    config.low_pass_filters.acceleration = LOW_PASS_FILTER_ACC_FREQ;
    config.low_pass_filters.pid_output = LOW_PASS_FILTER_OUTPUT_FREQ;
    config.low_pass_filters.speed = LOW_PASS_FILTER_SPEED_FREQ;
    config.low_pass_filters.torque = LOW_PASS_FILTER_TORQUE_FREQ;

    // Speed limits
    config.speed_limits.max_speed = DEFAULT_MAXIMUM_SPEED;
    config.speed_limits.min_speed = DEFAULT_MINIMUM_SPEED;

    // Dynamic test parameters
    config.dynamic_config.start_speed = 500;
    config.dynamic_config.accel_rate = 150;
    config.dynamic_config.end_speed = 6500;
    config.dynamic_config.hold_ms = 1000;
    config.dynamic_config.accel_down = 500;
    config.dynamic_config.final_speed = 500;
    config.dynamic_config.stable_time_ms = 2000;

    static_config.torque_drop_threshold = 0.15f;    // 15% drop = engine peaked
    static_config.stable_speed_tolerance = 5.0f;    // +-5 RPM tolerance

    DEBUG_PRINT("[+] Size of configuration: ");
    DEBUG_PRINTLN(sizeof(config)); // Monitor config size (must be 112 bytes)
}

/**
 * Initialize interrupt timer
 *
 * Configures IntervalTimer to trigger timer_1ms_isr() every 1ms for
 * multi-rate task scheduling.
 */
void init_interrupts(void)
{
    timer1ms.begin(timer_1ms_isr, 1000);
    timer1ms.priority(16);     // higher than default; lower number = higher priority
}

// SENSOR READING FUNCTIONS

/**
 * Read brake voltage from MAX22530 ADC
 * UNUSED
 */
int read_brake_voltage(void)
{
    return adc.readADC(0); // Channel 0
}

/**
 * Read brake current from Hall sensor (oversampled and averaged)
 *
 * Returns the block-averaged current from 100 ADC samples collected at 1kHz.
 * Converts ACS781LLRTR-050U-T output to Amperes.
 *
 * Transfer function at 3.3V supply:
 *   - Range: 0-50A unidirectional
 *   - V_OFFSET: 0.1 x Vcc = 0.33V (zero current)
 *   - Sensitivity: 60mV/A x (3.3/5) = 0.0396 V/A
 *   - Check datasheet for more information
 *
 * Averaging: 100 samples @ 1kHz = 100ms window
 *
 */
float read_brake_current(void)
{
    // Get averaged voltage from oversampling buffer
    float vout_avg = hallAverager.compute_average();

    // Convert to current
    float current_amps = (vout_avg - V_OFFSET) / SENSITIVITY;

    if (current_amps < 0.0f)
        current_amps = 0.0f; // Clamp negative values

    return current_amps;
}

// Dedicated high-precision hardware offset for the ADS1220 (volts, un-hashed)
float ads1220_voltage_offset = 0.0f;

#if defined(USE_ADS1220_LOAD_CELL)
// External Vref from a 5 V LDO on REFP0/REFN0; PGA = 128.
static constexpr float ADS1220_VREF_V = 5.0f;
static constexpr float ADS1220_PGA    = 128.0f;
static constexpr float ADS1220_LSB_V  = ADS1220_VREF_V / (ADS1220_PGA * 8388608.0f);

static inline float ads1220_counts_to_volts(int32_t counts)
{
    return counts * ADS1220_LSB_V;
}

/**
 * Tare internal load cell (ADS1220)
 */
void tare_internal_lcell(uint8_t samples)
{
    float sum = 0.0f;
    uint8_t valid_samples = 0;

    DEBUG_PRINTLN("[+] Taring internal load cell, please wait...");

    for (uint8_t i = 0; i < samples; i++) {
        // Wait for DRDY to go LOW (new data available)
        uint32_t timeout = millis();
        while (digitalRead(PIN_DRDY) == HIGH && (millis() - timeout < 500)) {
            // Wait for new data or 500ms timeout
        }

        if (digitalRead(PIN_DRDY) == LOW) {
            ads_chip.Read_Data();
            int32_t counts = ads_chip.DataToInt();
            sum += ads1220_counts_to_volts(counts);
            valid_samples++;

            // Wait for DRDY to go high again so we do not read the same sample
            while (digitalRead(PIN_DRDY) == LOW) {}
        }
    }

    if (valid_samples > 0) {
        ads1220_voltage_offset = sum / valid_samples;
        DEBUG_PRINT("[+] Internal load cell tared. Hardware offset voltage: ");
        DEBUG_PRINTLN(ads1220_voltage_offset, 9);
    } else {
        DEBUG_PRINTLN("[!] Error: Could not read ADS1220 for tare (Timeout)");
    }
}

/**
 * Internal load cell ADC reading (ADS1220)
 */
bool read_internal_lcell(float &kilograms)
{


    // Interrupt-driven: ads_drdy_isr() fires on DRDY falling edge and sets this flag.
    noInterrupts();
    bool ready = ads_drdy_ready;
    if (ready) ads_drdy_ready = false;
    interrupts();

    if (!ready) {
        return false;
    }

    ads_chip.Read_Data();
    int32_t counts = ads_chip.DataToInt();
    float voltage = ads1220_counts_to_volts(counts);

    // Apply calibration: kg = (voltage - hardware_tare - web_offset) x scale
    float total_offset = ads1220_voltage_offset + config.load_cell.offset;
    kilograms = (voltage - total_offset) * config.load_cell.scale;

    return true;
}

#else
void tare_internal_lcell(uint8_t samples)
{
    DEBUG_PRINTLN("[!] ADS1220 not selected, tare_internal_lcell() not available");
}

bool read_internal_lcell(float &kilograms)
{
    DEBUG_PRINTLN("[!] ADS1220 not selected, read_internal_lcell() not available");
    return false;
}
#endif

/**
 * Read brake temperature from MLX90614 IR sensor
 */
void read_brake_temperature(Status &status)
{
    status.brake_temperature = mlx.readObjectTempC();
}

/**
 * DS18B20 non-blocking state machine
 */
void read_ds18b20_temperature(Status &status)
{
    temperatureSensors.update(); // Non-blocking state machine
}

/**
 * Calculate acceleration from speed derivative
 */
void update_acceleration(float filtered_speed_rads, uint32_t now_us)
{
    static float last_speed_rads = 0.0f;
    static uint32_t last_update_us = 0;
    static float last_acc_rads2 = 0.0f;

    // Initialize on first call
    if (last_update_us == 0)
    {
        last_update_us = now_us;
        last_speed_rads = filtered_speed_rads;
        last_acc_rads2 = 0.0f;
        status.current_acc = 0.0f;
        status.current_acc_filtered = 0.0f;
        cascaded_lpf_reset(accFilter, ACCEL_LPF_STAGES);
        return;
    }

    uint32_t dt_us = now_us - last_update_us;
    if (dt_us == 0)
        return;

    // Calculate acceleration: α = dω/dt
    float delta_speed_rads = filtered_speed_rads - last_speed_rads;
    float dt_seconds = dt_us * 1e-6f;
    float acc_rads2 = delta_speed_rads / dt_seconds;

    // Reject implausible one-sample spikes from scheduler/encoder jitter.
    constexpr float MAX_ACCEL_RPM_S = 20000.0f;
    constexpr float MAX_ACCEL_RADS2 = MAX_ACCEL_RPM_S * (2.0f * M_PI / 60.0f);
    if (fabsf(acc_rads2) > MAX_ACCEL_RADS2)
    {
        acc_rads2 = last_acc_rads2;
    }

    // Cascaded variable-rate IIR on the derivative
    float filtered_acc_rads = cascadedLowPassFilter(
        acc_rads2,
        (float)config.low_pass_filters.acceleration,
        accFilter);
    status.current_acc = filtered_acc_rads * (60.0f / (2.0f * M_PI)); // Convert to RPM/s
    status.current_acc_filtered = status.current_acc;

    last_speed_rads = filtered_speed_rads;
    last_update_us = now_us;
    last_acc_rads2 = acc_rads2;
}

/**
 * Update speed measurement from encoder
 *
 * Reads encoder (rad/s), converts to RPM, applies filtering
 */
void update_speed(void)
{
    if (encoder_new_available())
    {
        float rads = encoder_pop_rad_s(); // Consumes measurement
        if (!isnan(rads))
        {
            // Cascaded variable-rate IIR
            float filtered_rad = 0.0f;
            if (rads == 0.0f)
            {
                cascaded_lpf_reset(speedFilter, SPEED_LPF_STAGES);
            }
            else
            {
                filtered_rad = cascadedLowPassFilter(rads, (float)config.low_pass_filters.speed, speedFilter);
            }

            // Interrupt-safe access to status (volatile)
            noInterrupts();
            float current_speed_rpm = filtered_rad * (60.0 / (2.0 * M_PI));
            status.current_speed = current_speed_rpm;
            interrupts();

            if (encoder_consume_glitch_flag()) {
                status.info = INFO_MSG_SPEED_GLITCH;
            }

            // Cascade output is already smoothed; feed telemetry directly.
            status.current_speed_filtered = current_speed_rpm;

            // Calculate acceleration from speed derivative
            update_acceleration(filtered_rad, micros());
        }
    }
}

/**
 * Update torque measurement from load cell
 *
 * Reads load cell (kg), applies filtering, calculates torque (Nm).
 */
void update_torque(void)
{
    float kilograms = 0.0f;
    bool has_reading = false;

    #if defined(USE_HX711_LOAD_CELL)
    // Read from HX711 external ADC
    if (hx711.is_ready())
    {
        float grams = hx711.get_units(1);
        kilograms = grams / 1000;
        has_reading = true;
    }
    #elif defined(USE_ADS1220_LOAD_CELL)
    // Read from ADS1220 internal ADC
    has_reading = read_internal_lcell(kilograms);
    #endif

    if (has_reading)
    {
        // Cascaded variable-rate IIR
        float filtered_kg = cascadedLowPassFilter(
            kilograms,
            (float)config.low_pass_filters.torque,
            torqueFilter);

        // Clamp AFTER filtering to preserve signal integrity (removes rectification bias)
        if (filtered_kg < 0.0f)
        {
            filtered_kg = 0.0f;
        }

        // Calculate torque: τ = F × d × g
        float torque = filtered_kg * (float)GRAVITY * config.load_cell.distance;

        // Raw torque for PID (absolute value)
        status.current_torque = fabsf(torque);

        // Raw torque for CAN transmission (kg)
        status.current_torque_kg = filtered_kg;
        // TODO: Clean
        status.current_torque_kg_filtered = filtered_kg;
    }
}

// CAN COMMUNICATION FUNCTIONS

/**
 * Request configuration from server
 */
void request_can_config(void)
{
    static uint32_t last_request_ms = 0;
    constexpr uint32_t REQUEST_RETRY_MS = 250;

    if (status.valid_checksum)
    {
        return;
    }

    uint32_t now_ms = millis();
    if (status.requested_config && (uint32_t)(now_ms - last_request_ms) < REQUEST_RETRY_MS)
    {
        return;
    }

    if (send_configuration_request(status))
    {
        last_request_ms = now_ms;
    }
}

/**
 * Parse incoming CAN messages
 *
 * Routes based on message ID to handle:
 * - Configuration updates (PID gains, load cell, PWM, filters, etc.)
 * - Control commands (START/STOP, mode selection)
 * - Heartbeat monitoring
 * - Manual PWM control
 * - Debug mode
 * - Live data enable
 * - Load cell tare
 */
void parse_can_message(void)
{
    CANMessage incoming = receive_can_message(status);

    if (!status.new_can_message)
    {
        return; // No message to process
    }

    switch (incoming.id)
    {
    /* === CHECKSUM VALIDATION === */
    case CHECKSUM_ID:
        // Extract 16-bit checksum from CAN data (little-endian)
        status.server_checksum = (incoming.data[1] << 8) | incoming.data[0];

        // Calculate local checksum for comparison
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));

        // Checksum mismatch detection
        if (status.config_checksum != status.server_checksum)
        {
            DEBUG_PRINTLN("[!] Obsolete checksum detected. Requesting configuration.");
            status.requested_config = false;
            status.info = INFO_MSG_INVALID_CHECKSUM;
            status.updated_config = false;
            status.valid_checksum = false;
        }
        else if (status.config_checksum == status.server_checksum)
        {
            DEBUG_PRINTLN("[+] Same checksum on server and client!");
            // Set CHECKSUM_OK only on transition from invalid to valid
            if (!status.valid_checksum) {
                status.info = INFO_MSG_CHECKSUM_OK;
            }
            status.updated_config = true;
            status.valid_checksum = true; // Enable PID control
        }
        break;

    /* === TORQUE PID CONFIGURATION === */
    case TORQUE_KP_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.torque_pid.kp = float_converter.value;
        torquePID.SetTunings(config.torque_pid.kp, config.torque_pid.ki, config.torque_pid.kd);
        DEBUG_PRINT("[+] Received kp value of torque PID: ");
        DEBUG_PRINTLN(config.torque_pid.kp);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    case TORQUE_KI_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.torque_pid.ki = float_converter.value;
        torquePID.SetTunings(config.torque_pid.kp, config.torque_pid.ki, config.torque_pid.kd);
        DEBUG_PRINT("[+] Received ki value of torque PID: ");
        DEBUG_PRINTLN(config.torque_pid.ki);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    case TORQUE_KD_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.torque_pid.kd = float_converter.value;
        torquePID.SetTunings(config.torque_pid.kp, config.torque_pid.ki, config.torque_pid.kd);
        DEBUG_PRINT("[+] Received kd value of torque PID: ");
        DEBUG_PRINTLN(config.torque_pid.kd);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    /* === SPEED PID CONFIGURATION === */
    case SPEED_KP_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.speed_pid.kp = float_converter.value;
        speedPID.SetTunings(config.speed_pid.kp, config.speed_pid.ki, config.speed_pid.kd);
        speedLimitPID.SetTunings(config.speed_pid.kp, config.speed_pid.ki, config.speed_pid.kd);
        DEBUG_PRINT("[+] Received kp value of speed PID: ");
        DEBUG_PRINTLN(config.speed_pid.kp);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    case SPEED_KI_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.speed_pid.ki = float_converter.value;
        speedPID.SetTunings(config.speed_pid.kp, config.speed_pid.ki, config.speed_pid.kd);
        speedLimitPID.SetTunings(config.speed_pid.kp, config.speed_pid.ki, config.speed_pid.kd);
        DEBUG_PRINT("[+] Received ki value of speed PID: ");
        DEBUG_PRINTLN(config.speed_pid.ki);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    case SPEED_KD_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.speed_pid.kd = float_converter.value;
        speedPID.SetTunings(config.speed_pid.kp, config.speed_pid.ki, config.speed_pid.kd);
        speedLimitPID.SetTunings(config.speed_pid.kp, config.speed_pid.ki, config.speed_pid.kd);
        DEBUG_PRINT("[+] Received kd value of speed PID: ");
        DEBUG_PRINTLN(config.speed_pid.kd);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    /* === DYNAMIC PID CONFIGURATION === */
    case DYNAMIC_KP_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.dynamic_pid.kp = float_converter.value;
        dynamicPID.SetTunings(config.dynamic_pid.kp, config.dynamic_pid.ki, config.dynamic_pid.kd);
        brakeDynamicPID.SetTunings(config.dynamic_pid.kp, config.dynamic_pid.ki, config.dynamic_pid.kd);
        DEBUG_PRINT("[+] Received kp value of dynamic PID: ");
        DEBUG_PRINTLN(config.dynamic_pid.kp);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    case DYNAMIC_KI_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.dynamic_pid.ki = float_converter.value;
        dynamicPID.SetTunings(config.dynamic_pid.kp, config.dynamic_pid.ki, config.dynamic_pid.kd);
        brakeDynamicPID.SetTunings(config.dynamic_pid.kp, config.dynamic_pid.ki, config.dynamic_pid.kd);
        DEBUG_PRINT("[+] Received ki value of dynamic PID: ");
        DEBUG_PRINTLN(config.dynamic_pid.ki);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    case DYNAMIC_KD_CONFIG_ID:
        memcpy(float_converter.bytes, incoming.data, 4);
        config.dynamic_pid.kd = float_converter.value;
        dynamicPID.SetTunings(config.dynamic_pid.kp, config.dynamic_pid.ki, config.dynamic_pid.kd);
        brakeDynamicPID.SetTunings(config.dynamic_pid.kp, config.dynamic_pid.ki, config.dynamic_pid.kd);
        DEBUG_PRINT("[+] Received kd value of dynamic PID: ");
        DEBUG_PRINTLN(config.dynamic_pid.kd);
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    /* === LOAD CELL CONFIGURATION === */
    case LOAD_CELL_CONFIG_1_ID:
        config.load_cell.gain = (incoming.data[1] << 8) | incoming.data[0];
        
        memcpy(float_converter.bytes, &incoming.data[4], 4);
        
        // Directly apply the web UI's target offset (the hardware offset acts independently)
        config.load_cell.offset = float_converter.value;

        DEBUG_PRINT("[+] Received load cell data (gain): ");
        DEBUG_PRINTLN(config.load_cell.gain);
        DEBUG_PRINT("[+] Received load cell data (offset): ");
        DEBUG_PRINTLN(config.load_cell.offset, 6);
        
        #if defined(USE_HX711_LOAD_CELL)
        hx711.set_gain(config.load_cell.gain);
        #endif
        break;
    /* === LOAD CELL EXTENDED CONFIGURATION === */
    case LOAD_CELL_CONFIG_2_ID:
        memcpy(float_converter.bytes, &incoming.data[0], 4);
        config.load_cell.scale = float_converter.value;
        memcpy(float_converter.bytes, &incoming.data[4], 4);
        config.load_cell.distance = float_converter.value;
        DEBUG_PRINT("[+] Received load cell data: ");
        DEBUG_PRINTLN(config.load_cell.scale);
        #if defined(USE_HX711_LOAD_CELL)
        hx711.set_scale(config.load_cell.scale);
        #endif
        DEBUG_PRINT("[+] Received load cell data: ");
        DEBUG_PRINTLN(config.load_cell.distance);
        break;

    /* === SPEED LIMITS CONFIGURATION === */
    case SPEED_LIMITS_ID:
        config.speed_limits.min_speed = (incoming.data[1] << 8) | incoming.data[0];
        config.speed_limits.max_speed = (incoming.data[3] << 8) | incoming.data[2];
        DEBUG_PRINT("[+] Received min speed limit: ");
        DEBUG_PRINTLN(config.speed_limits.min_speed);
        DEBUG_PRINT("[+] Received max speed limit: ");
        DEBUG_PRINTLN(config.speed_limits.max_speed);
        break;

    /* === DYNAMIC TEST CONFIGURATION === */
    case DYNAMIC_CONFIG_1_ID:
        memcpy(float_converter.bytes, &incoming.data[0], 4);
        config.dynamic_config.start_speed = float_converter.value;
        memcpy(float_converter.bytes, &incoming.data[4], 4);
        config.dynamic_config.stable_time_ms = float_converter.value;
        DEBUG_PRINT("[+] Received dynamic config: ");
        DEBUG_PRINTLN(config.dynamic_config.start_speed);
        DEBUG_PRINT("[+] Received dynamic config: ");
        DEBUG_PRINTLN(config.dynamic_config.stable_time_ms);
        break;

    case DYNAMIC_CONFIG_2_ID:
        memcpy(float_converter.bytes, &incoming.data[0], 4);
        config.dynamic_config.accel_rate = float_converter.value;
        memcpy(float_converter.bytes, &incoming.data[4], 4);
        config.dynamic_config.end_speed = float_converter.value;
        DEBUG_PRINT("[+] Received dynamic config: ");
        DEBUG_PRINTLN(config.dynamic_config.accel_rate);
        DEBUG_PRINT("[+] Received dynamic config: ");
        DEBUG_PRINTLN(config.dynamic_config.end_speed);
        break;

    case DYNAMIC_CONFIG_3_ID:
        memcpy(float_converter.bytes, &incoming.data[0], 4);
        config.dynamic_config.hold_ms = float_converter.value;
        memcpy(float_converter.bytes, &incoming.data[4], 4);
        config.dynamic_config.accel_down = float_converter.value;
        DEBUG_PRINT("[+] Received dynamic config: ");
        DEBUG_PRINTLN(config.dynamic_config.hold_ms);
        DEBUG_PRINT("[+] Received dynamic config: ");
        DEBUG_PRINTLN(config.dynamic_config.accel_down);
        break;

    case DYNAMIC_CONFIG_4_ID:
        memcpy(float_converter.bytes, &incoming.data[0], 4);
        config.dynamic_config.final_speed = float_converter.value;
        DEBUG_PRINT("[+] Received dynamic config: ");
        DEBUG_PRINTLN(config.dynamic_config.final_speed);
        break;

    /* === SYSTEM CONFIGURATION === */
    case DEBUG_CONFIG_ID:
        DEBUG_PRINT("[+] Received debug config: ");
        config.debug_mode = incoming.data[0];
        DEBUG_PRINTLN(config.debug_mode);
        break;

    case RUN_MODE_ID:
        // Safety: Prevent mode change while running
        if (status.status == RUNNING && config.mode.mode != incoming.data[0])
        {
            DEBUG_PRINTLN("[!] Can't change mode while running!");
            status.info = INFO_MSG_RUN_MODE_RUNNING;
        }
        else
        {
            // Parse mode selection
            if (incoming.data[0] == TORQUE_MODE)
            {
                config.mode.mode = TORQUE_MODE;
                config.mode.value = (float)((incoming.data[2] << 8) | incoming.data[1]);
                DEBUG_PRINTLN("[+] Received torque mode");
                DEBUG_PRINTLN(config.mode.value);
            }
            else if (incoming.data[0] == SPEED_MODE)
            {
                config.mode.mode = SPEED_MODE;
                config.mode.value = (float)((incoming.data[2] << 8) | incoming.data[1]);
                DEBUG_PRINTLN("[+] Received speed mode");
                DEBUG_PRINTLN(config.mode.value);
            }
            else if (incoming.data[0] == DYNAMIC_MODE)
            {
                config.mode.mode = DYNAMIC_MODE;
                config.mode.value = (float)((incoming.data[2] << 8) | incoming.data[1]);
                DEBUG_PRINTLN("[+] Received dynamic mode");
                DEBUG_PRINTLN(config.mode.value);
            }
            else if (incoming.data[0] == ACCELERATION_MODE)
            {
                config.mode.mode = ACCELERATION_MODE;
                config.mode.value = (float)((incoming.data[2] << 8) | incoming.data[1]);
                DEBUG_PRINTLN("[+] Received acceleration mode");
                DEBUG_PRINTLN(config.mode.value);
            }
            else
            {
                status.error = INVALID_RUN_MODE_ERROR;
                DEBUG_PRINTLN("[!] Error setting run mode!");
                DEBUG_PRINTLN(incoming.data[0]);
            }
        }
        break;

    /* === CONTROL COMMANDS === */
    case INSTRUCTION_ID:
        if (incoming.data[0] == START)
        {
            status.manual_pwm_enabled = false;
            set_pwm(0, config, outputFilter, status); // Reset before starting

            // Enable appropriate PID controller based on mode
            if (config.mode.mode == TORQUE_MODE)
            {
                status.status = RUNNING;
                status.info = INFO_MSG_RUNNING;
                torquePID.SetMode(QuickPID::Control::automatic);
                DEBUG_PRINTLN("[+] Started torquePID");
            }
            else if (config.mode.mode == SPEED_MODE)
            {
                status.status = RUNNING;
                status.info = INFO_MSG_RUNNING;
                speedPID.SetMode(QuickPID::Control::automatic);
                DEBUG_PRINTLN("[+] Started speedPID");
            }
            else if (config.mode.mode == DYNAMIC_MODE)
            {
                status.status = RUNNING;
                status.info = INFO_MSG_RUNNING;
                dynamicPID.SetMode(QuickPID::Control::automatic);
                dyno_enter_state(IDLE); // Reset state machine
                DEBUG_PRINTLN("[+] Started dynamicPID");
            }
            else if (config.mode.mode == ACCELERATION_MODE)
            {
                status.status = RUNNING;
                status.info = INFO_MSG_RUNNING;
                dynamicPID.SetMode(QuickPID::Control::automatic);
                DEBUG_PRINTLN("[+] Started dynamicPID for acceleration mode");
            }
            else
            {
                status.info = INFO_MSG_INVALID_MODE;
            }
        }
        else if (incoming.data[0] == STOP)
        {
            // Disable all PID controllers
            status.status = STOPPED;
            status.info = INFO_MSG_STOPPED;
            torquePID.SetMode(QuickPID::Control::manual);
            speedPID.SetMode(QuickPID::Control::manual);
            dynamicPID.SetMode(QuickPID::Control::manual);
            brakeDynamicPID.SetMode(QuickPID::Control::manual);
            speedLimitPID.SetMode(QuickPID::Control::manual);
            DEBUG_PRINTLN("[+] Stopped PID");
            set_pwm(0, config, outputFilter, status); // Safety: PWM off
        }
        else
        {
            status.error = INVALID_INSTRUCTION;
            status.info = INFO_MSG_INVALID_INSTRUCTION;
        }
        status.config_checksum = crc16((uint8_t *)&config, sizeof(Configuration));
        break;

    /* === MANUAL PWM CONTROL === */
    case SET_PWM_VALUE:
        if (status.status == STOPPED)
        {
            status.manual_pwm_enabled = true;
            uint16_t received_pwm = (incoming.data[1] << 8) | incoming.data[0];
            set_pwm(received_pwm, config, outputFilter, status);
        }
        else
        {
            DEBUG_PRINTLN("[!] PID running! Can't set PWM value");
            status.info = INFO_MSG_PWM_INVALID;
        }
        break;

    /* === PWM CONFIGURATION === */
    case PWM_CONFIG_ID:
        config.pwm_config.pwm_start = (incoming.data[1] << 8) | incoming.data[0];
        config.pwm_config.pwm_limit = (incoming.data[3] << 8) | incoming.data[2];
        config.pwm_config.pwm_frequency = (incoming.data[5] << 8) | incoming.data[4];
        DEBUG_PRINT("[+] Received PWM config: ");
        DEBUG_PRINTLN(config.pwm_config.pwm_start);
        DEBUG_PRINT("[+] Received PWM config: ");
        DEBUG_PRINTLN(config.pwm_config.pwm_limit);
        DEBUG_PRINT("[+] Received PWM config: ");
        DEBUG_PRINTLN(config.pwm_config.pwm_frequency);

        set_pwm_frequency(config.pwm_config.pwm_frequency);

        // Update all PID output limits
        torquePID.SetOutputLimits((float)config.pwm_config.pwm_start, (float)config.pwm_config.pwm_limit);
        speedPID.SetOutputLimits((float)config.pwm_config.pwm_start, (float)config.pwm_config.pwm_limit);
        speedLimitPID.SetOutputLimits((float)config.pwm_config.pwm_start, (float)config.pwm_config.pwm_limit);
        dynamicPID.SetOutputLimits((float)config.pwm_config.pwm_start, (float)config.pwm_config.pwm_limit);
        brakeDynamicPID.SetOutputLimits((float)config.pwm_config.pwm_start, (float)config.pwm_config.pwm_limit);
        break;

    /* === LOW-PASS FILTER CONFIGURATION === */
    case LOW_PASS_FILTERS_ID:
        config.low_pass_filters.speed = (incoming.data[1] << 8) | incoming.data[0];
        config.low_pass_filters.torque = (incoming.data[3] << 8) | incoming.data[2];
        config.low_pass_filters.acceleration = (incoming.data[5] << 8) | incoming.data[4];
        config.low_pass_filters.pid_output = (incoming.data[7] << 8) | incoming.data[6];

        cascaded_lpf_reset(speedFilter,  SPEED_LPF_STAGES);
        cascaded_lpf_reset(torqueFilter, TORQUE_LPF_STAGES);
        cascaded_lpf_reset(accFilter,    ACCEL_LPF_STAGES);

        DEBUG_PRINT("[+] Received low pass config: ");
        DEBUG_PRINTLN(config.low_pass_filters.speed);
        DEBUG_PRINT("[+] Received low pass config: ");
        DEBUG_PRINTLN(config.low_pass_filters.torque);
        DEBUG_PRINT("[+] Received low pass config: ");
        DEBUG_PRINTLN(config.low_pass_filters.acceleration);
        DEBUG_PRINT("[+] Received low pass config: ");
        DEBUG_PRINTLN(config.low_pass_filters.pid_output);
        break;

    /* === LIVE DATA STREAMING CONTROL === */
    case ENABLE_LIVE_ID:
        if (incoming.data[0] == 0)
        {
            status.live_mode = 0;
            DEBUG_PRINTLN("[+] Disabled live mode");
        }
        else if (incoming.data[0] == 1)
        {
            status.live_mode = 1;
            DEBUG_PRINTLN("[+] Enabled live mode");
        }
        else
        {
            status.error = INVALID_INSTRUCTION;
            status.info = INFO_MSG_INVALID_LIVE_ID;
        }
        break;

    /* === CONNECTION MONITORING === */
    case APP_HEARTBEAT_ID:
        if (incoming.data[0] == APP_HEARTBEAT_VALUE)
        {
            status.connected = true;
            last_security_time_check = millis(); // Reset watchdog
            DEBUG_PRINTLN("[+] Received heartbeat!");
        }
        else
        {
            DEBUG_PRINTLN("[!] Detected invalid heartbeat value from server.");
            status.connected = false;
        }
        break;

    /* === LOAD CELL TARE COMMAND === */
    case TARE_LOAD_CELL_ID:
        DEBUG_PRINTLN("[+] Tare command received");
        if (incoming.data[0] == 0)
        {
            #if defined(USE_HX711_LOAD_CELL)
            hx711.tare(20);
            cascaded_lpf_reset(torqueFilter, TORQUE_LPF_STAGES);
            DEBUG_PRINTLN("[+] HX711 tared!");
            #elif defined(USE_ADS1220_LOAD_CELL)
            tare_internal_lcell(20);
            cascaded_lpf_reset(torqueFilter, TORQUE_LPF_STAGES);
            DEBUG_PRINTLN("[+] ADS1220 tared!");
            #endif
        }
        break;

    /* === UNRECOGNIZED MESSAGE === */
    default:
        DEBUG_PRINTLN("[!] Unidentified ID on CAN frame.");
        DEBUG_PRINTLN(incoming.id, HEX);
        status.info = INFO_MSG_INVALID_CAN_MESSAGE;
        break;
    }
}
