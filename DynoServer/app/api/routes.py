"""API routes for dyno system control and configuration."""
from flask import jsonify, request, Blueprint, current_app
from app.services.data_manager import DataManager
from app.services.input_validation import (
    ValidationError,
    validate_live_update_payload,
    validate_pwm_update_payload,
    validate_log_payload,
)
from config import get_config

# Load configuration and initialize data manager
config_obj = get_config()
manager = DataManager(config_obj.DATABASE_PATH)

# API blueprint with /api prefix
api = Blueprint("api", __name__, url_prefix='/api')

# Standard API response messages
success_response = {'message': 'success'}
error_response = {'message': 'error'}
not_found_response = {'message': 'not found'}


def get_system_manager():
    """Get the system manager from Flask app context."""
    return current_app.config['system_manager']


def json_error(message: str, status_code: int = 400):
    """Build a standardized JSON error response."""
    return jsonify({'message': 'error', 'error': message}), status_code

# Start test
@api.route('/run', methods=['GET'])
def run():
    can_manager = get_system_manager().get_can_manager()
    can_manager.send_start()

    config_manager = get_system_manager().get_config_manager()
    config_manager.status = "Running"
    return jsonify(success_response)

# Stop test
@api.route('/stop', methods=['GET'])
def stop():
    can_manager = get_system_manager().get_can_manager()
    can_manager.send_stop()

    config_manager = get_system_manager().get_config_manager()
    config_manager.status = "Stopped"

    return jsonify(success_response)

# Enable / Disable live data stream
@api.route('/update_live', methods=['POST'])
def update_live():
    config_data = request.get_json(silent=True)
    try:
        mode = validate_live_update_payload(config_data)
    except ValidationError as exc:
        return json_error(str(exc), 400)

    config_manager = get_system_manager().get_config_manager()
    config_manager.set_live_mode(mode)

    can_manager = get_system_manager().get_can_manager()
    can_manager.set_live(mode)

    return jsonify(success_response)

# Taree load cell
@api.route('/tare', methods=['GET'])
def tare_load_cell():
    can_manager = get_system_manager().get_can_manager()
    can_manager.tare_load_cell()
    return jsonify(success_response)

# Update PWM Configuration
@api.route('/update_pwm', methods=['POST'])
def update_pwm():
    config_manager = get_system_manager().get_config_manager()
    config_data = request.get_json(silent=True)

    current_config = config_manager.get_config()
    pwm_cfg = current_config.get('pwm', {})
    try:
        pwm_start = int(pwm_cfg.get('start', 0))
        pwm_limit = int(pwm_cfg.get('limit', 65535))
    except (TypeError, ValueError):
        return json_error("Server PWM limits are invalid.", 500)
    try:
        value = validate_pwm_update_payload(
            config_data,
            min_pwm=pwm_start,
            max_pwm=pwm_limit,
        )
    except ValidationError as exc:
        return json_error(str(exc), 400)

    config_manager.set_pwm_value(value)

    can_manager = get_system_manager().get_can_manager()
    can_manager.set_pwm_value(value)

    return jsonify(success_response)

# Get configuration
@api.route('/config', methods=['GET'])
def get_configuration():
    config_manager = get_system_manager().get_config_manager()
    config = config_manager.get_config()
    return jsonify(config)

# Get sytem status
@api.route('/status', methods=['GET'])
def get_debug_config():
    config_manager = get_system_manager().get_config_manager()
    status = config_manager.to_dict()
    return status

# Set configuration
@api.route('/config', methods=['POST'])
def set_configuration():
    config_data = request.get_json(silent=True)
    config_manager = get_system_manager().get_config_manager()

    if config_manager.set_config(config_data):
        return jsonify(success_response)
    else:
        status_code = 400 if config_manager.last_error_is_validation else 500
        error_message = config_manager.last_error or 'error'
        return json_error(error_message, status_code)

# Get reduced configuration
@api.route('/fastConfig', methods=['GET'])
def get_fast_configuration():
    config_manager = get_system_manager().get_config_manager()
    config = config_manager.get_fast_config()
    return jsonify(config)

import os
import glob

# Get available CAN interfaces
@api.route('/can/interfaces', methods=['GET'])
def get_can_interfaces():
    native_interfaces = []
    if os.path.exists('/sys/class/net/'):
        for interface in os.listdir('/sys/class/net/'):
            if interface.startswith('can') or interface.startswith('vcan') or interface.startswith('slcan'):
                native_interfaces.append(interface)
    
    serial_interfaces = []
    serial_interfaces.extend(glob.glob('/dev/ttyACM*'))
    serial_interfaces.extend(glob.glob('/dev/ttyUSB*'))
    
    return jsonify({
        'native': sorted(native_interfaces),
        'serial': sorted(serial_interfaces)
    })

# Reconnect CAN interface
@api.route('/can/reconnect', methods=['POST'])
def reconnect_can():
    can_manager = get_system_manager().get_can_manager()
    if can_manager.reconnect():
        return jsonify(success_response)
    else:
        return json_error("Failed to reconnect CAN interface", 500)

# Set reduced configuration
@api.route('/fastConfig', methods=['POST'])
def set_fast_config():
    config_data = request.get_json(silent=True)
    config_manager = get_system_manager().get_config_manager()

    if config_manager.set_fast_configuration(config_data):
        return jsonify(success_response)
    else:
        status_code = 400 if config_manager.last_error_is_validation else 500
        error_message = config_manager.last_error or 'error'
        return json_error(error_message, status_code)

# Get list of tests
@api.route('/logs', methods=['GET'])
def get_logs():
    logs = manager.list_logs()
    return jsonify(logs)

# Get specific test based on ID
@api.route('/logs/<int:id>', methods=['GET'])
def get_log(id):
    log = manager.get_log(id)
    if log:
        return jsonify(log)
    else:
        return jsonify(not_found_response)

# Delete test
@api.route('/logs/<int:id>', methods=['DELETE'])
def delete_log(id):
    log = manager.delete_log(id)
    if log:
        return jsonify(success_response)
    else:
        return jsonify(error_response)

# Save test
@api.route('/logs', methods=['POST'])
def post_log():
    json_log = request.get_json(silent=True)
    try:
        json_log = validate_log_payload(json_log)
    except ValidationError as exc:
        return json_error(str(exc), 400)

    log = manager.add_log(json_log)

    if log:
        return jsonify(success_response)
    else:
        return jsonify(error_response)
