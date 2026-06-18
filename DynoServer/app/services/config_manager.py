import json
import struct
from time import time
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Any
from app.services.can_commands import CANCommands
from app.services.input_validation import (
    ValidationError,
    validate_full_config_payload,
    validate_fast_config_payload,
)

# Manages system configuration persistence and CRC16 checksum calculation
class ConfigManager:

    def __init__(self, path: str, system_manager):

        self.system_manager = system_manager
        self.file_path = Path(path)
        self._validate_config_file()

        self.config_data = self._load_config()
        self.status = "Stopped"
        self.live_mode = 1
        self.pwm_value = 0
        self.debug = self.config_data.get("debug", {}).get("enabled", False)
        self.info = "Stopped"
        self.connected = False
        self.run_mode_value =self.config_data.get("runMode", {}).get("value", 0)
        self.run_mode = self.config_data.get("runMode", {}).get("mode", 10)

        # Track last time struct size was logged (for throttling)
        self._last_struct_log_time = 0
        self.last_error = ""
        self.last_error_is_validation = False

    # Validate config file
    def _validate_config_file(self) -> None:
        if not self.file_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.file_path}")
        if not self.file_path.is_file():
            raise ValueError(f"Path is not a file: {self.file_path}")

    # Load config from file
    def _load_config(self) -> Dict[str, Any]:
        with open(self.file_path, 'r') as f:
            return json.load(f)

    # Convert config to dict
    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "debug": self.debug,
            "info": self.info,
            "live_mode" : self.live_mode,
            "connected": self.connected,
            "pwm_value" : self.pwm_value,
            "mode" : self.run_mode,
            "value" : self.run_mode_value
        }

    # Get fast config
    def get_fast_config(self) -> Dict[str, Any]:
        config_data = self._load_config()
        keys = ['launch', 'ratio', 'runMode', 'live_graph', 'debug_graph', 'torque_graph', 'speed_graph', 'dynamic_graph', 'display_filter']
        return {key: config_data[key] for key in keys if key in config_data}

    # Get config
    def get_config(self) -> Dict[str, Any]:
        return self._load_config()
    
    # Get checksum
    def get_checksum(self):
        return self.config_data['checksum']

    # Set error
    def _set_error(self, message: str, is_validation: bool) -> None:
        self.last_error = message
        self.last_error_is_validation = is_validation

    # Set config
    def set_config(self, data: Dict[str, Any]) -> bool:
        try:
            current_config = self._load_config()
            normalized_config = validate_full_config_payload(data, current_config)
            self.debug = normalized_config.get("debug", {}).get("enabled", False)
            self._save_config(normalized_config)
            self._set_error("", False)
            return True
        except ValidationError as e:
            self._set_error(str(e), True)
            print(f"Config validation error: {e}")
            return False
        except Exception as e:
            self._set_error("Failed to save configuration.", False)
            print(f"Error setting config: {e}")
            return False

    # Set fast config
    def set_fast_configuration(self, data: Dict[str, Any]) -> bool:
        try:
            config_data = self._load_config()
            normalized_patch = validate_fast_config_payload(data, config_data)
            for section, content in normalized_patch.items():
                if section in config_data:
                    config_data[section].update(content)
            
            # Send CAN message with the config
            can_manager = self.system_manager.get_can_manager()
            if normalized_patch.get('torquePID'):
                can_manager.send_torque_pid_config(normalized_patch)
            elif normalized_patch.get('speedPID'):
                can_manager.send_speed_pid_config(normalized_patch)
            elif normalized_patch.get('dynamicPID'):
                can_manager.send_dynamic_pid_config(normalized_patch)
            elif normalized_patch.get('loadCell'):
                can_manager.send_load_cell_config(normalized_patch)
            elif normalized_patch.get('runMode'):
                can_manager.send_run_config(normalized_patch)
            self._save_config(config_data)
            self._set_error("", False)
            return True
        except ValidationError as e:
            self._set_error(str(e), True)
            print(f"Fast config validation error: {e}")
            return False
        except Exception as e:
            self._set_error("Failed to save fast configuration.", False)
            print(f"Error setting fast config: {e}")
            return False

    # Save config to file
    def _save_config(self, config_data: Dict[str, Any]) -> None:
        
        # Calculate checksum
        config_data['checksum'] = hex(self.calculate_crc16(config_data))
        print("[+] Checksum: " + config_data['checksum'])
        CANCommands.CHECKSUM.data = int(config_data['checksum'], 16).to_bytes(2, byteorder='little')   # Convert hex string to integer (24532)
        
        self.system_manager.get_can_manager()._send_command(CANCommands.CHECKSUM)
        
        with open(self.file_path, 'w') as f:
            json.dump(config_data, f, indent=4)

    # Calculate CRC16 checksum
    def crc16(self, data: bytes) -> int:
        crc = 0xFFFF
        for b in data:
            crc ^= b
            for _ in range(8):
                if crc & 1:
                    crc = (crc >> 1) ^ 0xA001
                else:
                    crc >>= 1
        return crc

    # Calculate CRC16 checksum of configuration dict
    def calculate_crc16(self, config_dict: Dict[str, Any]) -> int:
        def safe_float(v, default=0.0):
            try: return float(v) if v is not None else default
            except (ValueError, TypeError): return default
            
        def safe_int(v, default=0):
            try: return int(v) if v is not None else default
            except (ValueError, TypeError): return default

        expected_size = 112  # sizeof(Configuration) on typical 32-bit target
        data = bytearray(expected_size)
        offset = 0

        # debug_mode (uint8_t) + 3 padding -> occupies bytes 0..3
        struct.pack_into('<B', data, offset, 1 if config_dict.get("debug", {}).get("enabled") else 0)
        offset += 4

        # torque_pid (3 floats) -> bytes 4..15
        torque = config_dict.get("torquePID", {})
        struct.pack_into('<fff', data, offset,
                        safe_float(torque.get("kp")),
                        safe_float(torque.get("ki")),
                        safe_float(torque.get("kd")))
        offset += 12  # now offset == 16

        # speed_pid -> bytes 16..27
        speed = config_dict.get("speedPID", {})
        struct.pack_into('<fff', data, offset,
                        safe_float(speed.get("kp")),
                        safe_float(speed.get("ki")),
                        safe_float(speed.get("kd")))
        offset += 12  # now offset == 28

        # dynamic_pid -> bytes 28..39
        dynamic = config_dict.get("dynamicPID", {})
        struct.pack_into('<fff', data, offset,
                        safe_float(dynamic.get("kp")),
                        safe_float(dynamic.get("ki")),
                        safe_float(dynamic.get("kd")))
        offset += 12  # now offset == 40

        # Run_mode: mode (uint8_t) + 3 padding -> mode at 40, value at 44
        run_mode = config_dict.get("runMode", {})
        struct.pack_into('<B', data, offset, safe_int(run_mode.get("mode")))
        offset += 4
        struct.pack_into('<f', data, offset, safe_float(run_mode.get("value")))
        offset += 4  # now offset == 48

        # Load_cell: gain (uint16), offset (float), scale (float), distance (float)
        load_cell = config_dict.get('loadCell', {})
        struct.pack_into('<H2xfff', data, offset,
                        safe_int(load_cell.get('gain')),
                        safe_float(load_cell.get('offset')),
                        safe_float(load_cell.get('scale')),
                        safe_float(load_cell.get('distance')))
        offset += 16  # now offset == 64

        # Pwm_config: three uint16_t -> 6 bytes, **no extra 2 bytes** here
        pwm = config_dict.get('pwm', {})
        struct.pack_into('<HHH', data, offset,
                        safe_int(pwm.get('start')),
                        safe_int(pwm.get('limit')),
                        safe_int(pwm.get('frequency')))
        offset += 6  # now offset == 66

        # Low_pass_filters: 4 uint16_t -> bytes 66..73
        lpf = config_dict.get('low_pass_filters', {})
        struct.pack_into('<HHHH', data, offset,
                        safe_int(lpf.get('speed')),
                        safe_int(lpf.get('torque')),
                        safe_int(lpf.get('acceleration')),
                        safe_int(lpf.get('output')))
        offset += 8  # now offset == 74

        # Speed_limits in C is (max_speed, min_speed)
        # pack in that same order (uint16, uint16)
        limits = config_dict.get('speedLimits', {})
        struct.pack_into('<HH', data, offset,
                        safe_int(limits.get('minSpeed')),
                        safe_int(limits.get('maxSpeed')))
        offset += 4  # now offset == 78

        # Align to 4 bytes before dynamic_config
        if offset % 4 != 0:
            offset += (4 - (offset % 4))
            
        # Dynamic_config: 7 floats -> bytes 80..107
        launch = config_dict.get('launch', {})
        struct.pack_into('<fffffff', data, offset,
                        safe_float(launch.get('startSpeed')),
                        safe_float(launch.get('stableTime')),
                        safe_float(launch.get('rampRate')),
                        safe_float(launch.get('endSpeed')),
                        safe_float(launch.get('endHoldDelay')),
                        safe_float(launch.get('rampDownRate')),
                        safe_float(launch.get('finalSpeed')))
        offset += 28  # now offset == 108

        # Only log struct size every 30 seconds
        current_time = time()
        if current_time - self._last_struct_log_time >= 30:
            print(f"Python struct size: {len(data)} bytes")
            print(f"Expected C struct size: {expected_size} bytes")
            if offset != expected_size:
                print(f"WARNING: Offset {offset} doesn't match expected size {expected_size}")
            self._last_struct_log_time = current_time

        return self.crc16(data)

    # Set live mode
    def set_live_mode(self, mode):
        self.live_mode = mode
        
    # Set pwm value
    def set_pwm_value(self, value):
        self.pwm_value = value
