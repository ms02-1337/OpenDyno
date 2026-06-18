// can.cpp - CAN bus communication implementation

#include "can.h"
#include "main.h"
#include "config.h"
#include "messages.h"
#include "datatypes.h"
#include "utilities.h"
#include <cmath>
#include <cstring>
#include <limits>

#define CAN_QUEUE_SIZE 64  // Circular buffer size for TX/RX queues

/**
 * Circular buffer for CAN message queuing
 */
struct CANQueue
{
    CANMessage buffer[CAN_QUEUE_SIZE];  // Message storage
    volatile uint8_t head = 0;          // Write index (producer)
    volatile uint8_t tail = 0;          // Read index (consumer)
    volatile bool overflow = false;     // Sticky flag for queue overflow
    volatile unsigned int enqueued = 0; // Total enqueued (diagnostics)
    volatile unsigned int dequeued = 0; // Total dequeued (diagnostics)

    // Compile-time size validation
    static_assert(CAN_QUEUE_SIZE > 1, "CAN_QUEUE_SIZE must be > 1");
    static_assert(CAN_QUEUE_SIZE <= 255, "Change index type if CAN_QUEUE_SIZE > 255");

    /* Check if queue is empty */
    bool isEmpty() const
    {
        return head == tail;
    }

    /* Check if queue is full (next head would wrap to tail) */
    bool isFull() const
    {
        uint8_t nextHead = (uint8_t)((head + 1) % CAN_QUEUE_SIZE);
        return nextHead == tail;
    }

    /* Get current number of messages in queue */
    uint8_t size() const
    {
        int h = head;
        int t = tail;
        int diff = h - t;
        if (diff < 0)
            diff += CAN_QUEUE_SIZE;
        return (uint8_t)diff;
    }

    /* Add message to queue */
    bool enqueue(const CANMessage &frame)
    {
        uint8_t nextHead = (uint8_t)((head + 1) % CAN_QUEUE_SIZE);

        if (nextHead == tail)
        {
            // Queue full - set sticky flag
            overflow = true;
            return false;
        }

        // Critical section: write buffer and update head atomically
        noInterrupts();
        buffer[head] = frame;
        head = nextHead;
        enqueued++;
        interrupts();

        return true;
    }

    /* Remove message from queue */
    bool dequeue(CANMessage &frame)
    {
        if (isEmpty())
            return false;

        noInterrupts();
        frame = buffer[tail];
        tail = (tail + 1) % CAN_QUEUE_SIZE;
        dequeued++;
        interrupts();

        return true;
    }

    /* Peek at next message without removing */
    bool peek(CANMessage &frame) const
    {
        if (isEmpty())
            return false;
        frame = buffer[tail];
        return true;
    }

    /* Reset queue to empty state */
    void clear()
    {
        noInterrupts();
        head = tail = 0;
        overflow = false;
        interrupts();
    }
};

// QUEUE INSTANCES
CANQueue canQueueRx;  // Received messages
CANQueue canQueueTx;  // Messages to transmit (main loop → hardware)

namespace
{
int16_t round_and_clamp_int16(float value)
{
    const float rounded = static_cast<float>(std::round(value));
    const float int16_min = static_cast<float>(std::numeric_limits<int16_t>::min());
    const float int16_max = static_cast<float>(std::numeric_limits<int16_t>::max());

    if (rounded < int16_min)
    {
        return std::numeric_limits<int16_t>::min();
    }

    if (rounded > int16_max)
    {
        return std::numeric_limits<int16_t>::max();
    }

    return static_cast<int16_t>(rounded);
}

inline void pack_u16_le(uint8_t *dst, uint16_t value)
{
    dst[0] = static_cast<uint8_t>(value & 0xFF);
    dst[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
}

inline void pack_i16_le(uint8_t *dst, int16_t value)
{
    pack_u16_le(dst, static_cast<uint16_t>(value));
}

inline void pack_u32_le(uint8_t *dst, uint32_t value)
{
    dst[0] = static_cast<uint8_t>(value & 0xFF);
    dst[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
    dst[2] = static_cast<uint8_t>((value >> 16) & 0xFF);
    dst[3] = static_cast<uint8_t>((value >> 24) & 0xFF);
}

inline void pack_f32_le(uint8_t *dst, float value)
{
    static_assert(sizeof(float) == 4, "Expect 4-byte float");

    uint32_t raw = 0;
    memcpy(&raw, &value, sizeof(raw));
    pack_u32_le(dst, raw);
}
}

/**
 * Process CAN TX queue
 */
void process_can_tx_queue(void)
{
    // Try up to 3 transmissions per call (balance throughput vs CPU)
    for (int i = 0; i < 3 && !canQueueTx.isEmpty(); ++i)
    {
        CANMessage txFrame;

        // Peek first - don't remove unless send succeeds
        if (!canQueueTx.peek(txFrame))
        {
            DEBUG_PRINTLN("[!] CAN TX queue peek failed unexpectedly");
            break;
        }

        // Attempt transmission via hardware
        if (CAN_INTERFACE.tryToSend(txFrame))
        {
            // Success - remove from queue
            if (!canQueueTx.dequeue(txFrame))
            {
                DEBUG_PRINTLN("[!] Warning: dequeue failed after successful send");
            }
        }
        else
        {
            // Bus busy or timeout - retry later
            DEBUG_PRINTLN("[!] CAN send failed (busy or timeout), will retry later");
            break;
        }
    }
}

// RECEIVE QUEUE FUNCTIONS

/**
 * Poll CAN hardware for incoming messages
 */
void check_new_can_message(void)
{
    CANMessage rxFrame;
    if (CAN_INTERFACE.receive(rxFrame))
    {
        if (!canQueueRx.enqueue(rxFrame))
        {
            // Queue full - overflow flag set by enqueue()
            DEBUG_PRINTLN("[!] CAN RX queue full - message dropped");
        }
    }
}

/**
 * Dequeue next message from RX queue
 */
CANMessage receive_can_message(Status &status)
{
    CANMessage out;
    if (canQueueRx.dequeue(out))
    {
        status.new_can_message = true;
        return out;
    }
    else
    {
        status.new_can_message = false;
        out.id = 0x00;
        out.len = 0;
        return out;
    }
}

/**
 * Send PID debug data
 */
bool send_pid_debug_data(const Configuration &config, const Status &status)
{
    uint16_t setpoint = static_cast<uint16_t>(config.mode.value + 0.5f);

    CANMessage msg;
    msg.id = DEBUG_LIVE_ID;
    msg.len = 8;
    msg.ext = false;
    msg.rtr = false;

    // Setpoint (2 bytes, little-endian)
    pack_u16_le(&msg.data[0], setpoint);

    // PWM value (2 bytes, scaled by 100 for precision)
    uint16_t pwm_scaled = (uint16_t)(status.pwm_value * 100);
    pack_u16_le(&msg.data[2], pwm_scaled);

    // Timestamp (4 bytes, little-endian)
    pack_u32_le(&msg.data[4], status.current_timestamp);

    return canQueueTx.enqueue(msg);
}

/**
 * Send electrical measurements
 */
bool send_electrical_data(const Status &status)
{
    bool success_voltage = false;
    bool success_current = false;

    // Voltage message (4 bytes + 4 byte timestamp)
    {
        CANMessage msg;
        msg.id = ELECTRICAL_ID_VOLTAGE;
        msg.ext = false;
        msg.rtr = false;
        msg.len = 8;

        pack_u32_le(&msg.data[0], static_cast<uint32_t>(status.voltage));
        pack_u32_le(&msg.data[4], status.current_timestamp);

        success_voltage = canQueueTx.enqueue(msg);
    }

    // Current message (float as raw bytes + 4 byte timestamp)
    {
        CANMessage msg;
        msg.id = ELECTRICAL_ID_CURRENT;
        msg.ext = false;
        msg.rtr = false;
        msg.len = 8;

        pack_f32_le(&msg.data[0], status.current);
        pack_u32_le(&msg.data[4], status.current_timestamp);

        success_current = canQueueTx.enqueue(msg);
    }

    return success_voltage && success_current;
}

/**
 * Send environmental data
 */
bool send_env(const Status &status)
{
    CANMessage msg;
    msg.id = ENV_ID;
    msg.len = 8;
    msg.rtr = false;
    msg.ext = false;

    // Temperature (4 bytes)
    uint32_t temp_u = static_cast<uint32_t>(status.temperature);
    pack_u32_le(&msg.data[0], temp_u);

    // Humidity (4 bytes)
    uint32_t hum_u = static_cast<uint32_t>(status.humidity);
    pack_u32_le(&msg.data[4], hum_u);

    return canQueueTx.enqueue(msg);
}

/**
 * Send acceleration data
 */
bool send_acceleration_timestamp(const Status &status)
{
    CANMessage msg;
    msg.id = ACCELERATION_ID;
    msg.len = 6;
    msg.rtr = false;
    msg.ext = false;

    int16_t acc = round_and_clamp_int16(status.current_acc_filtered);
    pack_i16_le(&msg.data[0], acc);
    pack_u32_le(&msg.data[2], status.current_timestamp);

    return canQueueTx.enqueue(msg);
}

/**
 * Send raw acceleration data
 */
bool send_acceleration_debug_timestamp(const Status &status)
{
    CANMessage msg;
    msg.id = ACCELERATION_DEBUG_ID;
    msg.len = 6;
    msg.rtr = false;
    msg.ext = false;

    // Raw acceleration (no filtering)
    int16_t acc = round_and_clamp_int16(status.current_acc);
    pack_i16_le(&msg.data[0], acc);
    pack_u32_le(&msg.data[2], status.current_timestamp);

    return canQueueTx.enqueue(msg);
}

/**
 * Send speed and torque data
 */
bool send_speed_torque_timestamp(const Status &status)
{
    CANMessage msg;
    msg.id = LIVE_SPEED_TORQUE_ID;
    msg.len = 8;
    msg.rtr = false;
    msg.ext = false;

    // Process torque: clamp to [0, 655.35] kg, scale by 100 (0.01 kg resolution)
    // float kilograms = status.current_torque_kg_filtered;
    float kilograms = status.current_torque_kg;
    if (kilograms < 0.0f)
        kilograms = 0.0f;
    if (kilograms > 655.35f)
        kilograms = 655.35f;
    uint16_t kilograms_can = static_cast<uint16_t>(kilograms * 100.0f + 0.5f);

    // Process speed: clamp negative, scale by 10 (0.1 RPM resolution)
    float rpm = status.current_speed_filtered;
    if (rpm < 0.0f)
        rpm = 0.0f;
    uint16_t rpm_can = static_cast<uint16_t>(rpm * 10.0f + 0.5f);

    // Pack message (little-endian)
    pack_u16_le(&msg.data[0], rpm_can);
    pack_u16_le(&msg.data[2], kilograms_can);
    pack_u32_le(&msg.data[4], status.current_timestamp);

    return canQueueTx.enqueue(msg);
}

/**
 * Send raw speed and torque data
 */
bool send_speed_torque_debug_timestamp(const Status &status)
{
    CANMessage msg;
    msg.id = LIVE_SPEED_TORQUE_DEBUG_ID;
    msg.len = 8;
    msg.rtr = false;
    msg.ext = false;

    // Raw torque (unfiltered) - REPLACED BY FILTERED
    // float kilograms = status.current_torque_kg_filtered;
    float kilograms = status.current_torque_kg;

    if (kilograms < 0.0f)
        kilograms = 0.0f;
    if (kilograms > 655.35f)
        kilograms = 655.35f;
    uint16_t kilograms_can = static_cast<uint16_t>(kilograms * 100.0f + 0.5f);

    // Raw speed (unfiltered)
    float rpm = status.current_speed;
    if (rpm < 0.0f)
        rpm = 0.0f;
    uint16_t rpm_can = static_cast<uint16_t>(rpm * 10.0f + 0.5f);

    pack_u16_le(&msg.data[0], rpm_can);
    pack_u16_le(&msg.data[2], kilograms_can);
    pack_u32_le(&msg.data[4], status.current_timestamp);

    return canQueueTx.enqueue(msg);
}

/**
 * Send brake temperature
 */
bool send_brake_temperature(const Status &status)
{
    CANMessage msg;
    msg.id = BRAKE_TEMPERATURE_ID;
    msg.len = 4;
    msg.rtr = false;
    msg.ext = false;

    pack_f32_le(msg.data, status.brake_temperature);

    return canQueueTx.enqueue(msg);
}

/**
 * Send ambient temperature
 */
bool send_ds18b20_temperature(const Status &status)
{
    CANMessage msg;
    msg.id = DS18B20_TEMPERATURE_ID;
    msg.len = 4;
    msg.rtr = false;
    msg.ext = false;

    pack_f32_le(msg.data, status.env_temperature);

    return canQueueTx.enqueue(msg);
}

/**
 * Send system status
 */
bool send_can_status(const Status &status)
{
    CANMessage msg;
    msg.id = STATUS_ID;
    msg.len = 8;
    msg.ext = false;
    msg.rtr = false;

    msg.data[0] = status.connected;
    msg.data[1] = status.status;
    msg.data[2] = status.info;
    msg.data[3] = status.live_mode;

    uint16_t pwm_int = (uint16_t)(status.pwm_value);
    pack_u16_le(&msg.data[4], pwm_int);
    pack_u16_le(&msg.data[6], status.config_checksum);

    return canQueueTx.enqueue(msg);
}

/**
 * Send heartbeat
 */
bool send_heartbeat(void)
{
    CANMessage msg;
    msg.id = MICRO_HEARTBEAT_ID;
    msg.len = 1;
    msg.rtr = false;
    msg.ext = false;
    msg.data[0] = MICRO_HEARTBEAT_VALUE;
    return canQueueTx.enqueue(msg);
}

/**
 * Request configuration from server
 */
bool send_configuration_request(Status &status)
{
    DEBUG_PRINTLN("[+] Config requested!");
    CANMessage msg;
    msg.id = REQUEST_CONFIG_ID;
    msg.len = 1;
    msg.rtr = false;
    msg.ext = false;
    msg.data[0] = CONFIG_REQUEST_BYTE;

    if (canQueueTx.enqueue(msg))
    {
        status.requested_config = true;
        return true;
    }
    else
    {
        DEBUG_PRINTLN("[!] Failed to enqueue config request (TX queue full)");
        return false;
    }
}
