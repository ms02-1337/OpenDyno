// =============================================================================
// encoder.cpp - Hardware-based period speed measurement
//
// This file implements the encoder driver entirely in i.MX RT1062 hardware
// peripherals.
//
//   - ENC1 (Quadrature Decoder peripheral) handles edge counting
//     autonomously on pins 2/3. With 4x quadrature decoding and a 50 PPR
//     encoder this gives 200 counts/rev.
//
//   - TMR2 channels 0 and 1 cascaded into a 32-bit free-running counter
//     clocked at IPG_BUS/8 (~18.75 MHz). On every rising edge of phase A
//     the counter value is captured into the CAPT registers without
//     CPU involvement.
//
//   - XBARA1 fans pin 2's signal out to BOTH ENC1_PHASEA and
//     QTIMER2_TIMER0 simultaneously.
//
//   - The main loop reads TMR2's last captured period via
//     encoder_pop_rad_s(). Speed always comes from time between phase-A
//     pulses; ENC1 is used only for hardware quadrature direction.
// =============================================================================

#include "pins.h"
#include "config.h"
#include "encoder.h"

#include <math.h>
#include <Arduino.h>
#include <QuadEncoder.h>

// =============================================================================
// HARDWARE OBJECTS / STATE
// =============================================================================

// QuadEncoder takes (channel, phaseA pin, phaseB pin). Channel 1 maps to
// the ENC1 peripheral. The constructor performs the pad-mux and XBAR1
// routing for both pins automatically (also enables the XBAR1 clock).
static QuadEncoder enc1(1, ENC_A_PIN, ENC_B_PIN, 0);

// TMR2 capture state. All three are written by the qtimer2 ISR and read
// from the main / PID context, so they are volatile and the read side
// must mask interrupts while sampling.
static volatile uint32_t s_last_capture_ticks = 0;  // Most recent absolute timer value (32-bit cascaded)
static volatile uint32_t s_period_ticks       = 0;  // Most recent capture-to-capture delta
static volatile bool     s_period_fresh       = false;
static volatile bool     s_new_measure        = false;


// Cached XBAR output index for QTIMER2_TIMER0's capture input. Verified
// in imxrt.h: XBARA1_OUT_QTIMER2_TIMER0 == 90.
#ifndef XBARA1_OUT_QTIMER2_TIMER0
#define XBARA1_OUT_QTIMER2_TIMER0 90
#endif

// Pin 2 maps to XBAR1_INOUT06 in the Teensy 4.x pin table (see
// QuadEncoder hardware table). The constant matches the index used by
// the QuadEncoder library when it routed the same input to ENC1.
static const unsigned int XBAR_INPUT_PIN2 = 6;

// =============================================================================
// RATIO-BASED OUTLIER REJECTOR (period domain)
// Rejects a new period sample if it is >1.9x or <0.526x the last
// accepted period (mirrors the commercial product's 1.9x/0.526x test).
// After MAX_CONSEC_REJECTS rejections in a row we re-converge on the
// new value and latch a glitch flag for the host to surface.
// =============================================================================
#define RATIO_HIGH         1.9f
#define RATIO_LOW          0.526f
#define MAX_CONSEC_REJECTS 10

static uint32_t last_accepted_period = 0;
static uint8_t  consec_rejects       = 0;
static volatile bool speed_glitch_latched = false;

/**
 * Apply the ratio-based acceptance test to a new period sample.
 *
 * Returns true if the sample was accepted (and updates the running last-
 * accepted reference). Returns false if the sample was rejected; after
 * MAX_CONSEC_REJECTS successive rejects the function force-accepts to
 * re-converge and sets speed_glitch_latched.
 */
static inline bool ratio_accept_period(uint32_t new_period) {
  if (last_accepted_period == 0) {
    last_accepted_period = new_period;
    consec_rejects = 0;
    return true;
  }
  const float r = (float)new_period / (float)last_accepted_period;
  if (r > RATIO_HIGH || r < RATIO_LOW) {
    if (consec_rejects < 255) consec_rejects++;
    if (consec_rejects >= MAX_CONSEC_REJECTS) {
      speed_glitch_latched = true;
      last_accepted_period = new_period;
      consec_rejects = 0;
      return true;
    }
    return false;
  }
  last_accepted_period = new_period;
  consec_rejects = 0;
  return true;
}

bool encoder_consume_glitch_flag() {
  noInterrupts();
  bool v = speed_glitch_latched;
  speed_glitch_latched = false;
  interrupts();
  return v;
}

// =============================================================================
// LOCAL STATE FOR PERIOD-BASED SPEED MEASUREMENT
// =============================================================================
static double   s_last_report_rpm = 0.0;
static uint32_t s_last_capture_seen_us = 0; // Wall-clock of last fresh T-method update (timeout detection)

// =============================================================================
// QTIMER2 INTERRUPT SERVICE ROUTINE
// Fires on every rising-edge capture event from TMR2 ch0. Reads both ch0
// (low 16 bits) and ch1 (high 16 bits via matched CAPT events) to
// reconstruct the 32-bit cascaded counter value at capture time, then
// updates the period delta and freshness flag. Should execute well
// under 1 us.
// =============================================================================
static void qtimer2_isr() {
  // Only act on the input-edge flag; the channel may have other pending
  // status bits we don't care about.
  if (TMR2_SCTRL0 & TMR_SCTRL_IEF) {
    // Coherent read of the cascaded 32-bit counter. Both channels capture
    // on the same phase-A edge: ch0 holds the low 16 bits, ch1 holds the
    // cascaded high 16 bits. Read before clearing IEF; the reference manual
    // says CAPT will not update again until IEF is cleared.
    uint16_t cap_lo = TMR2_CAPT0;
    uint16_t cap_hi = TMR2_CAPT1;

    // Clear capture flags by writing the IEF bit low. Channel 1 has no
    // interrupt enabled, but its capture flag must still be cleared so its
    // CAPT register updates on the next edge.
    TMR2_SCTRL0 &= ~TMR_SCTRL_IEF;
    TMR2_SCTRL1 &= ~TMR_SCTRL_IEF;

    uint32_t cap_now = ((uint32_t)cap_hi << 16) | cap_lo;
    uint32_t prev    = s_last_capture_ticks;
    s_last_capture_ticks = cap_now;

    // Skip the very first capture: prev=0 would yield a bogus huge delta
    // (matches the prev?(now-prev):0 guard in the previous DWT-based ISR).
    if (prev != 0) {
      uint32_t delta = cap_now - prev;
      if (delta != 0) {
        s_period_ticks = delta;
        s_period_fresh = true;
        s_new_measure  = true;
      }
    } else {
      // First edge ever: notify the consumer so the direction state is
      // sampled and the timeout timer can start cleanly.
      s_new_measure = true;
    }
  }
  asm volatile ("dsb");
}

// =============================================================================
// HARDWARE INITIALISATION
// =============================================================================

/**
 * Bring up the ENC1 + TMR2 + XBAR pipeline.
 *
 * Order of operations:
 *   1. Configure ENC1 via the QuadEncoder library (this also enables the
 *      XBAR1 clock and routes pins 2/3 to ENC1_PHASEA/PHASEB).
 *   2. Add a parallel XBAR fan-out from XBAR1_IN06 (pin 2) to
 *      QTIMER2_TIMER0's capture input.
 *   3. Tell the IOMUXC daisy chain that QTIMER2_TIMER0 should listen to
 *      its XBAR source rather than the direct pad input.
 *   4. Enable the QTIMER2 peripheral clock.
 *   5. Configure TMR2 ch1 first (cascade slave) then TMR2 ch0 (master
 *      with capture). Order matters because ch0 starts counting as soon
 *      as it is enabled.
 *   6. Install and enable the QTIMER2 NVIC vector.
 */
void encoder_init_hw() {
  // ---- 1. ENC1 quadrature decoder ----------------------------------------
  // Pull the library's default config and customise: enable a small
  // input filter to reject sub-microsecond glitches in place of the old
  // software min_delta_cycles guard. filterCount=2 -> 5 consecutive
  // samples must agree; filterSamplePeriod=5 -> sampling at one IPBus
  // cycle per increment, so the filter rejects pulses shorter than
  // ~5 * 5 = 25 IPBus ticks (~167 ns at 150 MHz). At 4500 RPM a 50 PPR
  // encoder has ~267 us between phase-A rising edges, so the filter has
  // plenty of headroom.
  enc1.setInitConfig();
#if ENC_REVERSE_DIRECTION
  enc1.EncConfig.enableReverseDirection = true;
#endif
  enc1.EncConfig.filterCount        = 2;
  enc1.EncConfig.filterSamplePeriod = 5;
  enc1.init();

  // ---- 2. Extra XBAR fan-out: pin 2 -> QTIMER2_TIMER0 input --------------
  // The QuadEncoder constructor already routed XBAR1_IN06 -> ENC1_PHASEA
  // (output 66). Adding a second sink for the same input is exactly the
  // crossbar use case -- a single input signal can drive multiple outputs
  // independently.
  enc1.xbar_connect(XBAR_INPUT_PIN2, XBARA1_OUT_QTIMER2_TIMER0);

  // ---- 2b. Force pin 2's pad SION bit ON --------------------------------
  // The QuadEncoder library set the pad mux to ALT3 (XBAR1_INOUT06) but
  // did NOT set the SION (Software Input On) bit. For the pad to drive
  // its signal back into the chip's input mux while configured as an
  // ALT-output-capable function, SION must be 1. PulsePositionInput sets
  // it explicitly (`*(portConfigRegister(rxPin)) = 1 | 0x10;`) and that
  // configuration is the closest known-working analog to ours. ENC1
  // happens to work without SION (it has its own internal path), but
  // TMR2's XBAR-fed capture input does not. Without SION the capture
  // ISR never fires -> period_ticks stays 0 -> reported speed stays 0.
  *(portConfigRegister(ENC_A_PIN)) |= 0x10;

  // ---- 3. QTIMER2 input source ------------------------------------------
  // XBAR1_OUT90 reaches QTIMER2_TIMER0 only when GPR6 selects XBAR for
  // QTIMER2_TRM0_INPUT_SEL. IOMUXC_QTIMER2_TIMER0_SELECT_INPUT is only the
  // daisy selector for direct timer pads (GPIO_EMC_19 or pin 13) and does
  // not select the XBAR path.
  IOMUXC_GPR_GPR6 &= ~IOMUXC_GPR_GPR6_IOMUXC_XBAR_DIR_SEL_6;  // INOUT06 remains an input
  IOMUXC_GPR_GPR6 |= IOMUXC_GPR_GPR6_QTIMER2_TRM0_INPUT_SEL;  // QTIMER2_TIMER0 input from XBAR

  // Force XBAR1_IN06 daisy = pin 2 (this one IS correct -- it picks pin 2
  // as the source for the XBAR1 input bus). The QuadEncoder library
  // already does this in its constructor, but writing it explicitly here
  // makes the routing self-documenting and immune to boot-value drift.
  IOMUXC_XBAR1_IN06_SELECT_INPUT = 0;

  // ---- 4. Enable TMR2 peripheral clock ----------------------------------
  CCM_CCGR6 |= CCM_CCGR6_QTIMER2(CCM_CCGR_ON);

  // ---- 5a. Configure cascade slave (ch1) FIRST --------------------------
  // PCS = 4 selects counter 0 output as the cascade source.
  // CM = 7: true synchronous cascade mode from counter 0 output.
  // PCS = 4: selected source is counter 0 output.
  // SCTRL capture is also armed here so CAPT1 freezes the high word on the
  // same phase-A edge as CAPT0.
  TMR2_CTRL1  = 0;                   // disable while configuring
  TMR2_LOAD1  = 0;
  TMR2_CNTR1  = 0;
  TMR2_SCTRL1 = 0;
  TMR2_CSCTRL1 = 0;
  TMR2_COMP11 = 0;
  TMR2_CMPLD11 = 0;
  TMR2_SCTRL1 = TMR_SCTRL_CAPTURE_MODE(1);
  TMR2_CTRL1  = TMR_CTRL_CM(7) | TMR_CTRL_PCS(4) | TMR_CTRL_SCS(0);

  // ---- 5b. Configure master (ch0) free-running with input capture -------
  // PCS = 8 + 3 = 11: peripheral clock divided by 8 = 150 MHz/8 = 18.75 MHz.
  // SCTRL CAPTURE_MODE = 1: capture on rising edge of secondary input.
  // SCTRL IEFIE: enable input-edge flag interrupt.
  TMR2_CTRL0  = 0;
  TMR2_LOAD0  = 0;
  TMR2_CNTR0  = 0;
  TMR2_SCTRL0 = 0;
  TMR2_CSCTRL0 = 0;
  TMR2_COMP10  = 0xFFFF;
  TMR2_CMPLD10 = 0xFFFF;
  // SCTRL: enable rising-edge input capture into the CAPT register and
  // enable the input-edge flag interrupt (IEFIE).
  // IPS=0 keeps the input non-inverted. Configure SCTRL before CTRL so
  // capture is armed before the timer starts running.
  TMR2_SCTRL0 = TMR_SCTRL_CAPTURE_MODE(1) | TMR_SCTRL_IEFIE;
  // CTRL: CM=1 (count rising edges of primary source), PCS=11 (IP_BUS/8),
  // SCS=0 (secondary source = this counter's own external input pin,
  // which is what feeds the capture), LENGTH=1 (reload on 0xFFFF compare
  // so channel 1 receives an exact cascade tick).
  TMR2_CTRL0  = TMR_CTRL_CM(1) | TMR_CTRL_PCS(8 + 3) | TMR_CTRL_SCS(0) | TMR_CTRL_LENGTH;
  TMR2_ENBL  |= 0x03;  // ensure channels 0 and 1 are enabled

  // ---- 6. NVIC: install vector, raise priority above default, enable ----
  attachInterruptVector(IRQ_QTIMER2, qtimer2_isr);
  NVIC_SET_PRIORITY(IRQ_QTIMER2, 32);
  NVIC_ENABLE_IRQ(IRQ_QTIMER2);
}

/**
 * Non-consuming check for new data.
 *
 * Returns true if either a TMR2 capture is pending consumption or the
 * stop timeout has elapsed since the last capture. The timeout path is
 * needed because a stopped encoder produces no final edge to trigger the
 * normal read path.
 */
bool encoder_new_available() {
  noInterrupts();
  bool v = s_new_measure;
  interrupts();
  if (!v
      && s_last_capture_seen_us != 0
      && fabs(s_last_report_rpm) > 0.001
      && (micros() - s_last_capture_seen_us) >= (uint32_t)STOP_TIMEOUT_MS * 1000U) {
    v = true;
  }
  return v;
}

/**
 * Consume the latest measurement and return shaft speed in rad/s.
 *
 * Returns NAN if no new data was available. Otherwise computes speed from
 * the captured phase-A period in TMR2 ticks, applies the period-domain
 * ratio rejector, and returns the result converted to rad/s.
 */
float encoder_pop_rad_s() {
  // Snapshot ISR-shared state and consume the new-measurement flag.
  uint32_t period_ticks_local;
  bool     period_fresh_local;
  noInterrupts();
  period_ticks_local  = s_period_ticks;
  period_fresh_local  = s_period_fresh;
  s_period_fresh      = false;
  bool had_new        = s_new_measure;
  s_new_measure       = false;
  interrupts();

  uint32_t now_us = micros();
  if (!had_new) {
    if (s_last_capture_seen_us != 0
        && fabs(s_last_report_rpm) > 0.001
        && (now_us - s_last_capture_seen_us) >= (uint32_t)STOP_TIMEOUT_MS * 1000U) {
      // No edge arrived before the timeout, so emit one explicit zero-speed
      // sample. update_speed() resets its filter on this exact zero.
      (void)enc1.getPositionDifference();
      last_accepted_period = 0;
      s_last_report_rpm = 0.0;
      return 0.0f;
    }
    return NAN;
  }

  // ---- Direction via ENC1 position differential -------------------------
  // POSD is a self-clearing 16-bit signed counter of edges since the
  // last read. Speed magnitude comes from the hardware-captured period.
  int32_t pos_diff = (int16_t)enc1.getPositionDifference();

  // ---- Period method: TMR2 ticks at IPG_BUS/8 ---------------------------
  double rpm = 0.0;
  if (period_fresh_local && period_ticks_local > 0) {
    // Apply outlier rejector in the period domain before computing RPM.
    if (ratio_accept_period(period_ticks_local)) {
      const double tmr_hz = (double)F_BUS_ACTUAL / 8.0;
      // RPM = (60 s/min * counter Hz) / (period_ticks * pulses_per_rev).
      // Phase-A alone gives ENC_PPR edges/rev (not 4*ENC_PPR), because
      // we only capture on phase-A rising edges.
      rpm = (60.0 * tmr_hz)
          / ((double)period_ticks_local * (double)ENC_PPR);
      // Take direction sign from ENC1's most-recent quadrature decode.
      if (pos_diff < 0) rpm = -rpm;
    } else if (last_accepted_period > 0) {
      // Sample rejected -- reuse the previous accepted period so we
      // don't introduce a discontinuity at the rejection boundary.
      const double tmr_hz = (double)F_BUS_ACTUAL / 8.0;
      rpm = (60.0 * tmr_hz)
          / ((double)last_accepted_period * (double)ENC_PPR);
      if (pos_diff < 0) rpm = -rpm;
    }
    s_last_capture_seen_us = now_us;
  } else {
    // No fresh period data this tick; check for a stop timeout.
    uint32_t since_capture_us = now_us - s_last_capture_seen_us;
    if (s_last_capture_seen_us == 0
        || since_capture_us >= (uint32_t)STOP_TIMEOUT_MS * 1000U) {
      // Treat as stopped -- both estimates collapse to zero so the PID
      // doesn't latch onto a stale value.
      rpm = 0.0;
      last_accepted_period = 0;  // re-arm the rejector for the next spin-up
      s_last_report_rpm = 0.0;
      return 0.0f;
    }
    // Otherwise keep the previous T value (estimate stale but not yet
    // stopped). Reuse last accepted period for continuity.
    if (last_accepted_period > 0) {
      const double tmr_hz = (double)F_BUS_ACTUAL / 8.0;
      rpm = (60.0 * tmr_hz)
          / ((double)last_accepted_period * (double)ENC_PPR);
      if (pos_diff < 0) rpm = -rpm;
    }
  }

  s_last_report_rpm = rpm;

  // Convert RPM -> rad/s before returning to the PID.
  double rad_s = (rpm * 2.0 * M_PI) / 60.0;
  return (float)rad_s;
}
