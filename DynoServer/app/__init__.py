import atexit
import os
from flask import Flask
from flask_socketio import SocketIO
from dotenv import load_dotenv

from config import get_config
from app.api.routes import api
from app.web.views import web_app
from app.services.system_manager import SystemManager
from app.services.config_manager import ConfigManager
from app.services.can_manager import CANManager
from app.services.can_commands import CANCommands

# Load environment variables from .env file
load_dotenv()

# Initialize SocketIO for WebSocket support (must be module-level for gunicorn)
socketio = SocketIO(async_mode='gevent')

# Global system manager singleton for service coordination
system_manager = SystemManager()

# Flask app
def create_app(config_name=None):

    # Create Flask app with template and static folders
    base_dir = os.path.abspath(os.path.dirname(__file__))
    app = Flask(
        __name__,
        template_folder=os.path.join(base_dir, '..', 'templates'),
        static_folder=os.path.join(base_dir, '..', 'static')
    )

    # Load environment configuration
    config_obj = get_config(config_name)
    app.config.from_object(config_obj)

    # Initialize SocketIO with CORS
    socketio.init_app(
        app,
        cors_allowed_origins=app.config['ALLOWED_ORIGINS']
    )

    # Register route blueprints
    app.register_blueprint(web_app)
    app.register_blueprint(api)

    # Initialize core services
    config_manager = ConfigManager(app.config['CONFIG_PATH'], system_manager)
    can_manager = CANManager(socketio, system_manager, app.config)

    # Wire up system manager dependencies
    system_manager.set_config_manager(config_manager)
    system_manager.set_can_manager(can_manager)
    app.config['system_manager'] = system_manager

    # Start CAN bus listener thread
    can_manager.start_listener()

    # Recalculate config checksum to prevent stale data on startup
    fresh_checksum = config_manager.calculate_crc16(config_manager.get_config())
    CANCommands.CHECKSUM.data = fresh_checksum.to_bytes(2, byteorder='little')
    print(f"[+] Initialized checksum: {hex(fresh_checksum)}")

    # Register event handlers
    register_socketio_handlers(app)
    register_shutdown_handler()

    return app

# SocketIO handlers
def register_socketio_handlers(app):

    @socketio.on('connect')
    # Send CAN connection status to newly connected client
    def handle_connect():
        print("[+] New client connected")
        can_manager = system_manager.get_can_manager()
        if can_manager._connected:
            socketio.emit('heartbeat', {'connected': True})
        else:
            socketio.emit('heartbeat', {'connected': False})

# Shutdown handler
def register_shutdown_handler():
    @atexit.register
    # Stop CAN listener thread
    def shutdown():
        print("[+] Shutting down CAN manager...")
        system_manager.get_can_manager().stop_listener()
