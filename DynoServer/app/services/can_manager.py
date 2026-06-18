import can
import math
import struct
import threading
import subprocess
from time import sleep, time
from flask import current_app
from can import Message, Bus
from app.services.can_ids import *
from typing import Dict, Any, List
from app.services.can_commands import CANCommands, CANCommand

# Physical constants
GRAVITY = 9.80665

# System status text mappings
status_texts = {
    0: "Stopped",
    1: "Running",
    2: "Debug",
    3: "Error"
}

# Info code text mappings (from microcontroller)
info_msg = {
    0x01 : "Initializing",
    0x02 : "Load Cell Error",
    0x03 : "Load Cell Ok",
    0x04 : "Updating Configuration",
    0x05 : "Emergency Stop",
    0x06 : "Updated Configration",
    0x07 : "Invalid Checksum",
    0x08 : "Checksum Correct",
    0x09 : "Checksum Error",
    0x10 : "Wrong Direction",
    0x11 : "Low Speed",
    0x12 : "Running",
    0x13 : "Stopped",
    0x14 : "Speed Mode",
    0x15 : "Torque Mode",
    0x16 : "Dynamic Mode",
    0x17 : "Can't Update Running!",
    0x18 : "Invalid Instruction",
    0x19 : "Invalid PWM",
    0x20 : "Invalid Live ID",
    0x21 : "Invalid CAN Message",
    0x22 : "Invalid Mode",
    0x23 : "IDLE",
    0x24 : "Waiting Start Speed",
    0x25 : "Waiting Stable Speed",
    0x26 : "Running Test",
    0x27 : "Holding Limit Speed",
    0x28 : "Waiting Torque Drop",
    0x29 : "Stopping Dyno",
    0x30 : "Test Finished",
    0x31 : "Inestable Speed",
    0x32 : "Speed Glitch"
}

# CAN Manager
class CANManager:

    def __init__(self, socketio, system_manager, config):
        try:
            # Lock for serializing CAN sends (prevents bus corruption)
            self._send_lock = threading.Lock()

            # Service references
            self.system_manager = system_manager
            self._config = config

            # SocketIO instance for WebSocket emissions (must be set before CAN init)
            self.socketio = socketio

            # Initialize CAN network interface (if needed)
            self._initialize_can_interface()

            # Initialize CAN bus interface
            can_config = self._config.get('canInterface', {})
            mode = can_config.get('mode', 'slcan')
            if mode == 'slcan':
                interface = 'socketcan'
                channel = 'slcan0'
            else:
                interface = 'socketcan'
                channel = can_config.get('channel', 'can0')

            self.bus = can.Bus(
                interface=interface,
                channel=channel,
                receive_own_messages=False
            )

            # Thread control flags
            self._running = False
            self._periodic = False
            self._connected = False

            # Thread: Receive CAN messages from microcontroller
            self._listener_thread = threading.Thread(
                target=self._can_listener,
                daemon=True
            )

            # Thread: Send periodic messages (heartbeat, checksum)
            self._periodic_thread = threading.Thread(
                target=self._periodic_sender,
                daemon=True
            )

            # Thread: Monitor connection health via heartbeat timeout
            self._watchdog_thread = threading.Thread(
                target=self._connection_watchdog,
                daemon=True
            )

            # Commands sent at regular intervals
            self._periodic_commands: List[CANCommand] = []
            self._periodic_commands.append(CANCommands.APP_HEARTBEAT)
            self._periodic_commands.append(CANCommands.CHECKSUM)

            # Acceleration values [RPM/s] from CAN handlers.
            # Keep filtered and raw separated so inertia compensation
            # always uses the filtered channel.
            self.current_acc_filtered = 0.0
            self.current_acc_raw = 0.0
            # Backward-compatible alias.
            self.current_acc = 0.0

            # Timestamp of last received heartbeat (for watchdog)
            self._last_connection = time()
            
        except Exception as e:
            raise RuntimeError(f"CAN initialization failed: {e}")

    def _initialize_can_interface(self) -> bool:
        """
        Initialize CAN network interface based on configuration
        """
        can_config = self._config.get('canInterface', {})
        mode = can_config.get('mode', 'slcan')
        channel = can_config.get('channel', '/dev/ttyACM0')
        bitrate = int(can_config.get('bitrate', 500000))

        if mode == 'slcan':
            if_name = 'slcan0'
        else:
            if_name = channel

        # Check if interface is already UP
        try:
            result = subprocess.run(
                ['ip', 'link', 'show', if_name],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and 'UP' in result.stdout:
                print(f"[+] CAN interface {if_name} is already up")
                self.send_socketio('status', {
                    'status': 'Stopped',
                    'info': f'CAN interface {if_name} ready',
                    'live_mode': 0
                })
                return True
        except Exception as e:
            print(f"[!] Failed to check interface status: {e}")

        # Interface not up - need to initialize
        print(f"[*] Initializing CAN interface {if_name} in {mode} mode...")

        commands = []
        if mode == 'slcan':
            # Map bitrate to slcan speed code
            # s0=10k, s1=20k, s2=50k, s3=100k, s4=125k, s5=250k, s6=500k, s7=800k, s8=1M
            speed_map = {
                10000: '-s0', 20000: '-s1', 50000: '-s2', 100000: '-s3',
                125000: '-s4', 250000: '-s5', 500000: '-s6', 800000: '-s7', 1000000: '-s8'
            }
            speed_code = speed_map.get(bitrate, '-s6')
            
            commands = [
                ['sudo', 'slcan_attach', '-f', speed_code, '-o', channel],
                ['sudo', 'slcand', channel.replace('/dev/', ''), if_name],
                ['sudo', 'ifconfig', if_name, 'txqueuelen', '1000'],
                ['sudo', 'ifconfig', if_name, 'up']
            ]
        else:
            commands = [
                ['sudo', 'ip', 'link', 'set', if_name, 'type', 'can', 'bitrate', str(bitrate)],
                ['sudo', 'ifconfig', if_name, 'txqueuelen', '1000'],
                ['sudo', 'ip', 'link', 'set', 'up', if_name]
            ]

        for i, cmd in enumerate(commands, 1):
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                if result.returncode != 0:
                    error_msg = f"Command {i}/4 failed: {' '.join(cmd)}"
                    print(f"[!] {error_msg}")
                    if result.stderr:
                        print(f"[!] stderr: {result.stderr.strip()}")

                    # Emit error to UI
                    self.send_socketio('status', {
                        'status': 'Stopped',
                        'info': f'CAN init failed: {cmd[1]}',
                        'live_mode': 0
                    })
                    return False

            except subprocess.TimeoutExpired:
                error_msg = f"Command {i}/4 timed out: {' '.join(cmd)}"
                print(f"[!] {error_msg}")
                self.send_socketio('status', {
                    'status': 'Stopped',
                    'info': f'CAN init timeout: {cmd[1]}',
                    'live_mode': 0
                })
                return False
            except Exception as e:
                error_msg = f"Command {i}/4 exception: {str(e)}"
                print(f"[!] {error_msg}")
                self.send_socketio('status', {
                    'status': 'Stopped',
                    'info': f'CAN init error: {str(e)}',
                    'live_mode': 0
                })
                return False

        # Verify interface came up
        try:
            result = subprocess.run(
                ['ip', 'link', 'show', if_name],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and 'UP' in result.stdout:
                print(f"[+] CAN interface {if_name} initialized successfully")
                self.send_socketio('status', {
                    'status': 'Stopped',
                    'info': f'CAN interface {if_name} initialized',
                    'live_mode': 0
                })
                return True
            else:
                print(f"[!] Interface {if_name} did not come up")
                return False
        except Exception as e:
            print(f"[!] Failed to verify interface: {e}")
            return False

    # Send configuration parameters to CAN bus
    def send_can_config(self, config_data: Dict[str, Any]) -> None:
        try:
            for param, value in config_data.items():
                if param in CANCommands.PARAM_MAPPING:
                    cmd = CANCommands.get_param_command(param, value)
                    self._send_command(cmd)
        except Exception as e:
            print(f"Error sending CAN config: {e}")

    # Send START command to microcontroller
    def send_start(self) -> None:
        self._send_command(CANCommands.START)

    # Send STOP command to microcontroller
    def send_stop(self) -> None:
        self._send_command(CANCommands.STOP)

    # Enable or disable live data streaming
    def set_live(self, mode):
        CANCommands.SET_LIVE.data = struct.pack('<B', int(mode))
        self._send_command(CANCommands.SET_LIVE)

    # Zero the load cell sensor
    def tare_load_cell(self):
        self._send_command(CANCommands.TARE_LOAD_CELL)

    # Set manual PWM duty cycle value
    def set_pwm_value(self, value):
        CANCommands.SET_PWM_VALUE.data = struct.pack('<h', int(value))
        self._send_command(CANCommands.SET_PWM_VALUE)

    # Generic method to send any CAN command (serialized)
    def _send_command(self, command: CANCommand) -> None:
        try:
            msg = can.Message(
                arbitration_id=command.id,
                data=command.data,
                is_extended_id=False
            )
            # serialize access to the underlying socket
            with self._send_lock:
                # optional: self.bus.flush_tx_buffer()
                self.bus.send(msg)
        except Exception as e:
            print(f"Error sending CAN command: {e}")
            try:
                print(msg.arbitration_id)
                print(msg.data)
            except Exception:
                pass

    # Start CAN listener thread
    def start_listener(self) -> None:
                self._running = True
                self._periodic = True
                self._listener_thread.start()
                self._periodic_thread.start()
                self._watchdog_thread.start()

    # Stop CAN listener thread
    def stop_listener(self) -> None:
            self._running = False
            self._periodic = False
            if self._listener_thread.is_alive():
                self._listener_thread.join(timeout=1.0)
                print("[+] Stopped listener thread!")
            if self._periodic_thread.is_alive():
                self._periodic_thread.join(timeout=1.0)
                print("[+] Stopped periodic thread!")
            if self._watchdog_thread.is_alive():
                self._watchdog_thread.join(timeout=1.0)
                print("[+] Stopped watchdog")
            try:
                self.bus.shutdown()
                print("[+] CAN bus shutdown complete")
            except Exception as e:
                print(f"[!] Error shutting down CAN bus: {e}")

    def reconnect(self) -> bool:
        print("[*] Reconnecting CAN interface...")
        try:
            self.stop_listener()
        except Exception as e:
            print(f"[!] Error stopping listener: {e}")
        
        try:
            self._initialize_can_interface()
            
            can_config = self._config.get('canInterface', {})
            mode = can_config.get('mode', 'slcan')
            if mode == 'slcan':
                interface = 'socketcan'
                channel = 'slcan0'
            else:
                interface = 'socketcan'
                channel = can_config.get('channel', 'can0')

            self.bus = can.Bus(
                interface=interface,
                channel=channel,
                receive_own_messages=False
            )
            
            # Restart listener thread, periodic thread, and watchdog
            self._listener_thread = threading.Thread(target=self._can_listener, daemon=True)
            self._periodic_thread = threading.Thread(target=self._periodic_sender, daemon=True)
            self._watchdog_thread = threading.Thread(target=self._connection_watchdog, daemon=True)
            self.start_listener()
            return True
        except Exception as e:
            print(f"[!] Error reconnecting: {e}")
            return False

    # CAN listener thread
    def _can_listener(self) -> None:
        while self._running:
            try:
                msg = self.bus.recv(timeout=1.0)
                if msg:
                    self._process_message(msg)
            except Exception as e:
                print(f"[!] Error receiving CAN message: {e}")
                
    # Periodic sender thread
    def _periodic_sender(self) -> None:
        while self._periodic:
            try:
                for command in self._periodic_commands:
                    if command.interval_ms > 0:
                        # For CHECKSUM, always recalculate fresh before sending
                        # This prevents race conditions with config updates
                        if command.id == CANCommands.CHECKSUM.id:
                            config_manager = self.system_manager.get_config_manager()
                            fresh_checksum = config_manager.calculate_crc16(config_manager.get_config())
                            CANCommands.CHECKSUM.data = fresh_checksum.to_bytes(2, byteorder='little')
                        
                        self._send_command(command)
                        # Sleep for the remaining interval time
                        sleep(command.interval_ms / 1000)
            except Exception as e:
                print(f"[!] Periodic sender error: {e}")
                sleep(1)  # Prevent tight loop on errors

    # Send torque PID configuration
    def send_torque_pid_config(self, config_data):
        pid = config_data.get('torquePID', {})
        CANCommands.TORQUE_KP.data = struct.pack('<f', float(pid.get('kp', 0)))
        self._send_command(CANCommands.TORQUE_KP)
        CANCommands.TORQUE_KI.data = struct.pack('<f', float(pid.get('ki', 0)))
        self._send_command(CANCommands.TORQUE_KI)
        CANCommands.TORQUE_KD.data = struct.pack('<f', float(pid.get('kd', 0)))
        self._send_command(CANCommands.TORQUE_KD)

    # Send speed PID configuration
    def send_speed_pid_config(self, config_data):
        pid = config_data.get('speedPID', {})
        CANCommands.SPEED_KP.data = struct.pack('<f', float(pid.get('kp', 0)))
        self._send_command(CANCommands.SPEED_KP)
        CANCommands.SPEED_KI.data = struct.pack('<f', float(pid.get('ki', 0)))
        self._send_command(CANCommands.SPEED_KI)
        CANCommands.SPEED_KD.data = struct.pack('<f', float(pid.get('kd', 0)))
        self._send_command(CANCommands.SPEED_KD)

    # Send dynamic PID configuration
    def send_dynamic_pid_config(self, config_data):
        pid = config_data.get('dynamicPID', {})
        CANCommands.DYNAMIC_KP.data = struct.pack('<f', float(pid.get('kp', 0)))
        self._send_command(CANCommands.DYNAMIC_KP)
        CANCommands.DYNAMIC_KI.data = struct.pack('<f', float(pid.get('ki', 0)))
        self._send_command(CANCommands.DYNAMIC_KI)
        CANCommands.DYNAMIC_KD.data = struct.pack('<f', float(pid.get('kd', 0)))
        self._send_command(CANCommands.DYNAMIC_KD)

    # Send PWM configuration
    def send_pwm_config(self, config_data):
        CANCommands.PWM_CONFIG.data = struct.pack("<HHH",
        int(config_data['pwm']['start']),
        int(config_data['pwm']['limit']),
        int(config_data['pwm']['frequency']))
        self._send_command(CANCommands.PWM_CONFIG)

    # Send low-pass filter coefficients
    def send_low_pass_filters(self, config_data):
        CANCommands.LOW_PASS_FILTERS.data = struct.pack("<HHHH",
        int(config_data['low_pass_filters']['speed']),
        int(config_data['low_pass_filters']['torque']),
        int(config_data['low_pass_filters']['acceleration']),
        int(config_data['low_pass_filters']['output']))
        self._send_command(CANCommands.LOW_PASS_FILTERS)

    # Send speed limit thresholds
    def send_speed_limits(self, config_data):
        CANCommands.SPEED_LIMITS.data = struct.pack("<HH",
        int(config_data['speedLimits']['minSpeed']),
        int(config_data['speedLimits']['maxSpeed']))
        self._send_command(CANCommands.SPEED_LIMITS)

    # Send dynamic test configuration parameters
    def send_dynamic_config(self, config_data):
        CANCommands.DYNAMIC_CONFIG_1.data = struct.pack("<ff",
        float(config_data['launch']['startSpeed']),
        float(config_data['launch']['stableTime']))
        self._send_command(CANCommands.DYNAMIC_CONFIG_1)
        CANCommands.DYNAMIC_CONFIG_2.data = struct.pack("<ff",
        float(config_data['launch']['rampRate']),
        float(config_data['launch']['endSpeed']))
        self._send_command(CANCommands.DYNAMIC_CONFIG_2)
        CANCommands.DYNAMIC_CONFIG_3.data = struct.pack("<ff",
        float(config_data['launch']['endHoldDelay']),
        float(config_data['launch']['rampDownRate']))
        self._send_command(CANCommands.DYNAMIC_CONFIG_3)
        CANCommands.DYNAMIC_CONFIG_4.data = struct.pack("<f",
        float(config_data['launch']['finalSpeed']))
        self._send_command(CANCommands.DYNAMIC_CONFIG_4)

    # Send load cell calibration parameters
    def send_load_cell_config(self, config_data):
        CANCommands.LOAD_CELL_DATA_1.data = struct.pack('<H2xf',
        int(config_data['loadCell']['gain']),
        float(config_data['loadCell']['offset']))
        self._send_command(CANCommands.LOAD_CELL_DATA_1)
        CANCommands.LOAD_CELL_DATA_2.data = struct.pack('<ff',
        float(config_data['loadCell']['scale']),
        float(config_data['loadCell']['distance']))
        self._send_command(CANCommands.LOAD_CELL_DATA_2)

    # Send run mode configuration
    def send_run_config(self, config_data):
        run_mode = config_data.get('runMode', {})
        mode = run_mode.get('mode', 0)
        value = run_mode.get('value', 0)
        
        # Guard against None
        if mode is None: mode = 0
        if value is None: value = 0
        
        CANCommands.RUN_CONFIG.data = struct.pack('<BH', int(mode), int(value))
        self._send_command(CANCommands.RUN_CONFIG)

    # Send debug mode toggle
    def send_debug_config(self, config_data):
        CANCommands.DEBUG_DATA.data = struct.pack('<B',
        int(config_data['debug']['enabled']))
        print("Sending debug")
        self._send_command(CANCommands.DEBUG_DATA)

    # Send data to WebSocket clients
    def send_socketio(self, data_name, payload):
        if self.socketio:
            self.socketio.emit(data_name, payload)

    # Process incoming CAN messages
    def _process_message(self, msg: Message) -> None:
        # Filter out our own outgoing messages (server to microcontroller)
        # These IDs are >= 0x100 and are messages we send, not receive
        outgoing_ids = {
            RUN_MODE_ID, INSTRUCTION_ID, APP_HEARTBEAT_ID, CHECKSUM_ID,
            DEBUG_CONFIG_ID, ENABLE_LIVE_ID, SET_PWM_VALUE, TARE_LOAD_CELL_ID,
            TORQUE_KP_CONFIG_ID, TORQUE_KI_CONFIG_ID, TORQUE_KD_CONFIG_ID,
            SPEED_KP_CONFIG_ID, SPEED_KI_CONFIG_ID, SPEED_KD_CONFIG_ID, DYNAMIC_KP_CONFIG_ID,
            DYNAMIC_KI_CONFIG_ID, DYNAMIC_KD_CONFIG_ID, LOAD_CELL_CONFIG_1_ID,
            PWM_CONFIG_ID, LOW_PASS_FILTERS_ID, SPEED_LIMITS_ID,
            DYNAMIC_CONFIG_1_ID, DYNAMIC_CONFIG_2_ID, DYNAMIC_CONFIG_3_ID,
            DYNAMIC_CONFIG_4_ID, LOAD_CELL_CONFIG_2_ID
        }
        
        # Ignore outgoing messages that are echoed back
        if msg.arbitration_id in outgoing_ids:
            return
        
        handlers = {
            CAN_STATUS_ID : self._handle_status,
            CAN_LIVE_SPEED_ID : self._handle_live_data,
            CAN_ENV_ID : self._handle_env,
            CAN_MICRO_HEARTBEAT_ID : self._handle_heartbeat,
            CAN_DEBUG_LIVE_ID : self._handle_debug,
            CAN_ELECTRICAL_CURRENT_ID : self._handle_electrical_current,
            CAN_ELECTRICAL_VOLTAGE_ID : self._handle_electrical_voltage,
            CAN_REQUEST_CONFIG_ID : self._handle_configuration_request,
            CAN_ACC_ID : self._handle_acceleration_data,
            CAN_BRAKE_TEMPERATURE : self._handle_brake_temperature,
            CAN_DS18B20_TEMP_ID : self._handle_ds18b20_temperature,
            CAN_ACC_DEBUG_ID : self._handle_acceleration_debug_data,
            CAN_LIVE_SPEED_TORQUE_DEBUG_ID : self._handle_live_debug_data
        }
        
        handler = handlers.get(msg.arbitration_id)
        if handler:
            handler(msg)
        else:
            print(f"[!] Unhandled CAN ID: {hex(msg.arbitration_id)}")

    # Handle system status message
    def _handle_status(self, msg):
        connected = "Connected" if msg.data[0] == 1 else "Disconnected"
        status = status_texts.get(msg.data[1], "Unknown")
        info = info_msg.get(msg.data[2], "Unknown")
        live_mode = msg.data[3]
        payload = bytes(msg.data)
        pwm_value, micro_checksum = struct.unpack_from('<HH', payload, 4)
        config_manager = self.system_manager.get_config_manager()
        config_manager.pwm_value = pwm_value
        self.send_socketio('status', {'status' : status, 'info' : info, 'live_mode' : live_mode})
    
    # Handle brake temperature message
    def _handle_brake_temperature(self, msg):
        brake_temp = struct.unpack('<f', bytes(msg.data))[0]
        self.send_socketio('brake_temperature', {'temperature': round(brake_temp, 1)})

    # Handle DS18B20 environmental temperature message
    def _handle_ds18b20_temperature(self, msg):
        # Extract temperature from CAN message data (little-endian float)
        temp = struct.unpack('<f', bytes(msg.data))[0]

        # Emit WebSocket event with formatted temperature
        self.send_socketio('elec_temp', {'temperature': round(temp, 1)})

    # Parse common fields from live data messages
    def _parse_live_data(self, msg, config_data):
        payload = bytes(msg.data)

        # Speed: bytes 0-1 in rpm (1 decimal)
        brake_speed_rpm = struct.unpack_from('<H', payload, 0)[0] / 10
        
        # Torque (0.01 kg resolution): bytes 2-3
        current_torque_kg = struct.unpack_from('<H', payload, 2)[0]
        current_torque_kg = current_torque_kg / 100.0  # Convert to float kg
        
        load_cell_dist = float(config_data['loadCell']['distance'])
        brake_torque_nm = current_torque_kg * GRAVITY * load_cell_dist

        # Timestamp: bytes 4-7 (little-endian uint32)
        timestamp_ms = struct.unpack_from('<I', payload, 4)[0]

        # Ratios
        dyno_pinions = int(config_data['ratio']['dynoPinions'])
        motor_pinions = int(config_data['ratio']['motorPinions'])

        # Convert dyno speed/torque to motor side using pinion ratio
        motor_speed = brake_speed_rpm * dyno_pinions / motor_pinions
        motor_torque_nm = brake_torque_nm * motor_pinions / dyno_pinions

        # Inertia compensation: use dyno + chain inertia configured on dyno side.
        alpha_brake = (self.current_acc_filtered * 2 * math.pi) / 60.0
        inertia_cfg = config_data.get('inertiaAndLoads', {})
        try:
            dyno_inertia = float(inertia_cfg.get('dynoInertia', 0.0))
        except (TypeError, ValueError):
            dyno_inertia = 0.0
        try:
            chain_inertia = float(inertia_cfg.get('chainInertia', 0.0))
        except (TypeError, ValueError):
            chain_inertia = 0.0

        # Calculate total brake inertia
        total_brake_inertia = dyno_inertia + chain_inertia
        inertia_torque_brake = total_brake_inertia * alpha_brake
        inertia_torque_motor_nm = inertia_torque_brake * (motor_pinions / dyno_pinions)
        motor_torque_comp_nm = motor_torque_nm + inertia_torque_motor_nm
        
        return {
            'brake_speed_rpm': brake_speed_rpm,
            'motor_speed': motor_speed,
            'current_torque_kg': current_torque_kg,
            'brake_torque_nm': brake_torque_nm,
            'motor_torque_nm': motor_torque_nm,
            'inertia_torque_motor_nm': inertia_torque_motor_nm,
            'motor_torque_comp_nm': motor_torque_comp_nm,
            'current_torque_nm': brake_torque_nm,
            'real_motor_torque': motor_torque_comp_nm,
            'timestamp_ms': timestamp_ms
        }

    # Handle live debug data message
    def _handle_live_debug_data(self, msg):
        config_manager = self.system_manager.get_config_manager()
        config_data = config_manager.get_config()
        
        parsed = self._parse_live_data(msg, config_data)

        # If debug enabled
        if bool(config_data.get('debug', {}).get('enabled', False)):
            self.send_socketio('debug_data', {
                'speed': parsed['brake_speed_rpm'],
                'motor_speed': parsed['motor_speed'],
                'torque_kg': parsed['current_torque_kg'],
                'brake_torque': parsed['brake_torque_nm'],
                'motor_torque': parsed['motor_torque_nm'],
                'timestamp': parsed['timestamp_ms']
            })
            

    # Torque and speed      
    def _handle_live_data(self, msg):
        config_manager = self.system_manager.get_config_manager()
        config_data = config_manager.get_config()

        parsed = self._parse_live_data(msg, config_data)

        # Emit real-time data
        self.send_socketio('live_data', {
            'speed': parsed['brake_speed_rpm'],
            'motor_speed': parsed['motor_speed'],
            # Index torque must include inertia compensation.
            'torque': parsed['motor_torque_comp_nm'],
            'brake_torque': parsed['brake_torque_nm'],
            'motor_torque': parsed['motor_torque_nm'],
            'inertia_torque': parsed['inertia_torque_motor_nm'],
            'timestamp': parsed['timestamp_ms']
        })
            

    # Handle acceleration debug data message
    def _handle_acceleration_debug_data(self, msg):
        payload = bytes(msg.data)
        self.current_acc_raw = struct.unpack_from('<h', payload, 0)[0]
        config_data = self.system_manager.get_config_manager().get_config()

        motor_acc = self.current_acc_raw * (int(config_data['ratio']['dynoPinions']) / int(config_data['ratio']['motorPinions']))
        # Timestamp: bytes 2-5 (little-endian uint32)
        timestamp_ms = struct.unpack_from('<I', payload, 2)[0]
        
        self.send_socketio('acc_data', {
            'brake_acceleration': self.current_acc_raw,
            'motor_acceleration': motor_acc,
            'timestamp': timestamp_ms
        })

    # Filtered acceleration
    def _handle_acceleration_data(self, msg):
        self.current_acc_filtered = struct.unpack_from('<h', bytes(msg.data), 0)[0]
        self.current_acc = self.current_acc_filtered
    
    # Handle env data message
    def _handle_env(self, msg):
        payload = bytes(msg.data)
        current_temperature, current_humidity = struct.unpack_from('<II', payload, 0)
        self.send_socketio('env', {'temperature' : current_temperature, 'humidity' : current_humidity})

    # Handle heartbeat message
    def _handle_heartbeat(self, msg):
        if (msg.data[0] == 0x20):
                self._last_connection = time()
                if not self._connected:
                    self._connected = True
                    print("[+] CAN connection established")
                    self.send_socketio(data_name='heartbeat', payload={'connected': True})

    # Handle debug data message
    def _handle_debug(self, msg):
        payload = bytes(msg.data)
        setpoint, pwm_value = struct.unpack_from('<HH', payload, 0)
        timestamp_ms = struct.unpack_from('<I', payload, 4)[0]
        config_data = self.system_manager.get_config_manager().get_config()
        
        # Get current mode from config
        current_mode = int(config_data['runMode']['mode'])
        dyno_pinions = int(config_data['ratio']['dynoPinions'])
        motor_pinions = int(config_data['ratio']['motorPinions'])
        
        # Use rawValue from config for precise conversion instead of integer from CAN
        raw_setpoint = config_data['runMode'].get('rawValue', setpoint)
        
        # Apply correct conversion based on mode
        if current_mode == 1:  # Speed mode
            motor_setpoint = round(raw_setpoint * dyno_pinions / motor_pinions)
        elif current_mode == 0:  # Torque mode
            motor_setpoint = round(raw_setpoint * motor_pinions / dyno_pinions)
        elif current_mode == 2 or current_mode == 3:  # Dynamic modes
            motor_setpoint = round(raw_setpoint * dyno_pinions / motor_pinions)
        else:
            motor_setpoint = setpoint
        
        self.send_socketio('debug_data', {'setpoint' : motor_setpoint, 'brake_setpoint' : setpoint, 'pwm' : pwm_value/100, 'timestamp' : timestamp_ms})
        
    # Handle electrical current message
    def _handle_electrical_current(self, msg):
        payload = bytes(msg.data)
        current = struct.unpack_from('<f', payload, 0)[0]
        timestamp_ms = struct.unpack_from('<I', payload, 4)[0]
        self.send_socketio('electrical', {'current' : current, 'timestamp' : timestamp_ms})
    
    # Handle electrical voltage message
    def _handle_electrical_voltage(self, msg):
        payload = bytes(msg.data)
        voltage = struct.unpack_from('<I', payload, 0)[0]
        timestamp_ms = struct.unpack_from('<I', payload, 4)[0]
        self.send_socketio('electrical', {'voltage' : voltage, 'timestamp' : timestamp_ms})
    
    # Handle configuration request message
    def _handle_configuration_request(self, msg):
        if (msg.data[0] == 0x01):
            # Send configuration
            print("[+] Configuration request received!")
            # Debug
            config_data = self.system_manager.get_config_manager().get_config()
            self.send_debug_config(config_data)
            # Torque PID
            self.send_torque_pid_config(config_data)
            # Speed PID
            self.send_speed_pid_config(config_data) 
            # Dynamic PID
            self.send_dynamic_pid_config(config_data)
            # Load cell data
            self.send_load_cell_config(config_data)
            # Run mode
            self.send_run_config(config_data)
            # PWM config
            self.send_pwm_config(config_data)
            # Low pass filters
            self.send_low_pass_filters(config_data)
            # Speed limits
            self.send_speed_limits(config_data)
            # Dynamic configuration
            self.send_dynamic_config(config_data)
            print("Sent configuration!")
        
    # Watchdog for heartbeat
    def _connection_watchdog(self):
        """Watchdog to check connection timeout (no messages in 2 seconds)"""
        while self._running:
            if self._connected and (time() - self._last_connection > 2):
                self._connected = False
                print("[!] Lost CAN connection (timeout)")
                self.send_socketio('heartbeat', {'connected': False})
            sleep(0.5)
