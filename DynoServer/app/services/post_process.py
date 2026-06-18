"""
Post-processing utilities for dyno test data.

Provides zero-phase (forward+backward) IIR filtering via scipy.signal.filtfilt,
inertia compensation, and a build_test_log() pipeline that converts a raw sample
buffer into a finalized test log dict suitable for the frontend.
"""

import math
import numpy as np
from scipy.signal import butter, filtfilt
from typing import Dict, Any, List, Optional

GRAVITY = 9.80665


def apply_zero_phase(
    arr: np.ndarray,
    fs: float,
    fc: float,
    order: int = 4,
) -> np.ndarray:
    """Apply a zero-phase (filtfilt) Butterworth low-pass filter.

    Args:
        arr:   1-D input signal.
        fs:    Sample rate [Hz].
        fc:    Cutoff frequency [Hz].
        order: Filter order (applied twice by filtfilt, so effective order = 2×order).

    Returns:
        Filtered array with the same shape, zero phase shift.
    """
    if len(arr) < 2 * order + 1:
        return arr.copy()
    nyq = fs / 2.0
    if fc >= nyq:
        return arr.copy()
    b, a = butter(order, fc / nyq, btype='low')
    return filtfilt(b, a, arr)


def compensate_inertia(
    torque_motor_nm: np.ndarray,
    alpha_rpm_s: np.ndarray,
    J_brake_total: float,
    motor_pinions: float,
    dyno_pinions: float,
) -> np.ndarray:
    """Apply inertia compensation: T_comp = T + J·(2π/60)·α · (Np_m / Np_d).

    Args:
        torque_motor_nm: Motor torque array [Nm] (before compensation).
        alpha_rpm_s:     Brake acceleration array [RPM/s].
        J_brake_total:   Total brake inertia [kg·m²] (dyno + chain).
        motor_pinions:   Motor pinion count.
        dyno_pinions:    Dyno pinion count.

    Returns:
        Compensated motor torque [Nm].
    """
    omega_dot = alpha_rpm_s * (2.0 * math.pi / 60.0)
    inertia_torque_brake = J_brake_total * omega_dot
    ratio = motor_pinions / dyno_pinions
    return torque_motor_nm + inertia_torque_brake * ratio


def build_test_log(
    raw_buffer: List[tuple],
    config: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Convert a raw sample buffer into a finalized, zero-phase-filtered test log.

    Args:
        raw_buffer: List of (timestamp_abs_ms, speed_raw_rpm, torque_raw_kg).
        config:     Current system configuration dict.

    Returns:
        A dict with 'speed', 'torque', 'power' arrays and metadata,
        or None if the buffer is empty or too short for filtering.
    """
    if len(raw_buffer) < 10:
        return None

    raw = np.array(raw_buffer)
    ts_ms    = raw[:, 0]
    speed    = raw[:, 1]
    torque_kg = raw[:, 2]

    # Compute sample rate from median inter-sample interval
    dt = np.median(np.diff(ts_ms))
    if dt <= 0:
        return None
    fs = 1000.0 / dt  # Hz

    # Pinion ratio
    dyno_pinions = float(config['ratio']['dynoPinions'])
    motor_pinions = float(config['ratio']['motorPinions'])
    load_cell_dist = float(config['loadCell']['distance'])

    # Convert to motor units
    motor_speed = speed * dyno_pinions / motor_pinions
    brake_torque_nm = torque_kg * GRAVITY * load_cell_dist
    motor_torque_nm = brake_torque_nm * motor_pinions / dyno_pinions

    # Compute alpha from speed derivative (finite difference, then smooth)
    dt_s = dt / 1000.0
    alpha_rpm_s = np.gradient(motor_speed, dt_s)

    # Zero-phase filter each channel
    # Cutoffs match the firmware TX cascade: 15 Hz shared
    motor_speed_f = apply_zero_phase(motor_speed, fs, fc=15.0, order=4)
    motor_torque_f = apply_zero_phase(motor_torque_nm, fs, fc=15.0, order=4)
    alpha_f = apply_zero_phase(alpha_rpm_s, fs, fc=15.0, order=4)

    # Inertia compensation on zero-phase-filtered signals
    inertia_cfg = config.get('inertiaAndLoads', {})
    try:
        dyno_inertia = float(inertia_cfg.get('dynoInertia', 0.0))
    except (TypeError, ValueError):
        dyno_inertia = 0.0
    try:
        chain_inertia = float(inertia_cfg.get('chainInertia', 0.0))
    except (TypeError, ValueError):
        chain_inertia = 0.0
    J_total = dyno_inertia + chain_inertia

    # Use brake-side alpha (motor_speed derivative × motor_pinions/dyno_pinions gives motor alpha;
    # but we need brake alpha for J·α). Compute brake alpha from brake speed.
    brake_speed_f = apply_zero_phase(speed, fs, fc=15.0, order=4)
    brake_alpha_f = apply_zero_phase(np.gradient(speed, dt_s), fs, fc=15.0, order=4)

    motor_torque_comp = compensate_inertia(
        motor_torque_f, brake_alpha_f, J_total, motor_pinions, dyno_pinions)

    # Power = T × ω = T × RPM × 2π / 60  →  in Watts
    power_w = motor_torque_comp * motor_speed_f * 2.0 * math.pi / 60.0

    return {
        'speed': motor_speed_f.tolist(),
        'torque': motor_torque_comp.tolist(),
        'power': power_w.tolist(),
        'brake_speed': brake_speed_f.tolist(),
        'brake_torque_nm': brake_torque_nm.tolist(),
        'alpha_rpm_s': alpha_f.tolist(),
        'sample_rate': round(fs, 1),
        'num_samples': len(raw_buffer),
    }
