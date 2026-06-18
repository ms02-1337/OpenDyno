// =============================================================================
// encoder.h - Hardware-based encoder speed measurement
// The implementation uses the Teensy 4.1's ENC1 (Quadrature Decoder) and Quad 
// Timer 2 (TMR2) for hardware input-capture time-stamping. Both are fed from 
// pins 2/3 via the XBARA1 crossbar fan-out.
// Speed is derived from the hardware-captured time between phase-A pulses.
// =============================================================================

#ifndef ENCODER_H
#define ENCODER_H

#include <Arduino.h>

// IRAM_ATTR is unused on Teensy 4.x (ISR code is already in fast RAM by
// default) but kept defined as a no-op so any user-side annotations don't
// break the build.
#ifndef IRAM_ATTR
  #define IRAM_ATTR
#endif

/**
 * Initialize the hardware encoder pipeline.
 *
 * Brings up:
 *   - ENC1 quadrature decoder on pins 2/3 via the QuadEncoder library
 *     (handles IOMUXC pad mux + XBARA1 routing for ENC1_PHASEA/PHASEB).
 *   - TMR2 channels 0 and 1 cascaded into a 32-bit free-running counter
 *     clocked at IPG/8, with channel 0 input-capture rising-edge.
 *   - An additional XBARA1 fan-out from pin 2's IN06 input to the
 *     QTIMER2_TIMER0 capture input.
 *   - The QTIMER2 NVIC interrupt for capture-event handling.
 *
 * Must be called once at startup.
 */
void encoder_init_hw();

/**
 * Non-consuming check for new encoder data.
 *
 * Returns true if a fresh capture event has occurred since the last call
 * to encoder_pop_rad_s(). Use to gate the PID sample so it only runs on
 * new measurements.
 */
bool encoder_new_available();

/**
 * Consume the most recent measurement and return shaft speed in rad/s.
 *
 * Reads the TMR2 capture period, applies the existing ratio-based outlier
 * rejector, and returns the resulting speed. Returns NAN if no fresh data
 * was available.
 *
 * Intended to be called once per 1 ms PID tick after
 * encoder_new_available() reports true.
 */
float encoder_pop_rad_s();

/**
 * Consume the latched "speed glitch" flag.
 *
 * Returns true once if the period-domain ratio rejector has rejected
 * MAX_CONSEC_REJECTS samples in a row since the last call. The flag
 * self-clears on read.
 */
bool encoder_consume_glitch_flag();


#endif // ENCODER_H
