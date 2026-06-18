from dataclasses import dataclass
from typing import Dict, Tuple
from app.services.can_ids import *


@dataclass
# CAN command structure
class CANCommand:
    id: int
    data: bytes
    is_extended_id: bool = False
    description: str = ""
    interval_ms: int = 0

# CAN command definitions
class CANCommands:

    START = CANCommand(
        id=INSTRUCTION_ID,
        data=bytes([0x01]),
        description="Start system operation"
    )

    STOP = CANCommand(
        id=INSTRUCTION_ID,
        data=bytes([0x00]),
        description="Stop system operation"
    )

    APP_HEARTBEAT = CANCommand(
        id=APP_HEARTBEAT_ID,
        data=bytes([0x10]),
        description="Heartbeat signal",
        interval_ms=500
    )

    CHECKSUM = CANCommand(
        id=CHECKSUM_ID,
        data=bytes(),
        description="Configuration checksum",
        interval_ms=1000
    )

    # PID GAIN COMMANDS

    TORQUE_KP = CANCommand(
        id=TORQUE_KP_CONFIG_ID,
        data=bytes(),
        description="Torque PID proportional gain"
    )

    TORQUE_KI = CANCommand(
        id=TORQUE_KI_CONFIG_ID,
        data=bytes(),
        description="Torque PID integral gain"
    )

    TORQUE_KD = CANCommand(
        id=TORQUE_KD_CONFIG_ID,
        data=bytes(),
        description="Torque PID derivative gain"
    )

    SPEED_KP = CANCommand(
        id=SPEED_KP_CONFIG_ID,
        data=bytes(),
        description="Speed PID proportional gain"
    )

    SPEED_KI = CANCommand(
        id=SPEED_KI_CONFIG_ID,
        data=bytes(),
        description="Speed PID integral gain"
    )

    SPEED_KD = CANCommand(
        id=SPEED_KD_CONFIG_ID,
        data=bytes(),
        description="Speed PID derivative gain"
    )

    DYNAMIC_KP = CANCommand(
        id=DYNAMIC_KP_CONFIG_ID,
        data=bytes(),
        description="Dynamic PID proportional gain"
    )

    DYNAMIC_KI = CANCommand(
        id=DYNAMIC_KI_CONFIG_ID,
        data=bytes(),
        description="Dynamic PID integral gain"
    )

    DYNAMIC_KD = CANCommand(
        id=DYNAMIC_KD_CONFIG_ID,
        data=bytes(),
        description="Dynamic PID derivative gain"
    )

    # CONFIGURATION COMMANDS

    DEBUG_DATA = CANCommand(
        id=DEBUG_CONFIG_ID,
        data=bytes(),
        description="Debug mode toggle"
    )

    RUN_CONFIG = CANCommand(
        id=RUN_MODE_ID,
        data=bytes(),
        description="Run mode configuration"
    )

    LOAD_CELL_DATA_1 = CANCommand(
        id=LOAD_CELL_CONFIG_1_ID,
        data=bytes(),
        description="Load cell calibration 1"
    )

    LOAD_CELL_DATA_2 = CANCommand(
        id=LOAD_CELL_CONFIG_2_ID,
        data=bytes(),
        description="Load cell calibration 2"
    )

    SET_LIVE = CANCommand(
        id=ENABLE_LIVE_ID,
        data=bytes(),
        description="Live data streaming toggle"
    )

    PWM_CONFIG = CANCommand(
        id=PWM_CONFIG_ID,
        data=bytes(),
        description="PWM configuration"
    )

    LOW_PASS_FILTERS = CANCommand(
        id=LOW_PASS_FILTERS_ID,
        data=bytes(),
        description="Low-pass filter coefficients"
    )

    SPEED_LIMITS = CANCommand(
        id=SPEED_LIMITS_ID,
        data=bytes(),
        description="Speed limit thresholds"
    )

    DYNAMIC_CONFIG_1 = CANCommand(
        id=DYNAMIC_CONFIG_1_ID,
        data=bytes(),
        description="Dynamic test config 1"
    )

    DYNAMIC_CONFIG_2 = CANCommand(
        id=DYNAMIC_CONFIG_2_ID,
        data=bytes(),
        description="Dynamic test config 2"
    )

    DYNAMIC_CONFIG_3 = CANCommand(
        id=DYNAMIC_CONFIG_3_ID,
        data=bytes(),
        description="Dynamic test config 3"
    )

    DYNAMIC_CONFIG_4 = CANCommand(
        id=DYNAMIC_CONFIG_4_ID,
        data=bytes(),
        description="Dynamic test config 4"
    )

    SET_PWM_VALUE = CANCommand(
        id=SET_PWM_VALUE,
        data=bytes(),
        description="Manual PWM value"
    )

    TARE_LOAD_CELL = CANCommand(
        id=TARE_LOAD_CELL_ID,
        data=bytes([0x00]),
        description="Zero load cell sensor"
    )
