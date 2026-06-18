"""
Configuration for DynoServer
"""
import os
from pathlib import Path

class Config:

    # Base directory - resolves to DynoServer/ root
    BASE_DIR = Path(__file__).parent.parent

    # Flask core settings
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    DEBUG = False  # Enable Flask debugger and auto-reload
    TESTING = False  # Enable test mode for assertions

    # Server network configuration
    HOST = os.getenv('HOST', '0.0.0.0')  # Bind to all interfaces
    PORT = int(os.getenv('PORT', 9000))  # Default HTTP port

    # CAN bus communication settings
    CAN_CHANNEL = os.getenv('CAN_CHANNEL', 'slcan0')  # Network interface name
    CAN_BUSTYPE = os.getenv('CAN_BUSTYPE', 'socketcan')  # python-can interface type
    CAN_TTY_DEVICE = os.getenv('CAN_TTY_DEVICE', '/dev/ttyACM0')  # Serial device for slcan

    # Filesystem paths for data persistence
    DATABASE_PATH = os.getenv('DATABASE_PATH', str(BASE_DIR / 'data' / 'database.json'))
    CONFIG_PATH = os.getenv('CONFIG_PATH', str(BASE_DIR / 'data' / 'config.json'))

    # CORS settings
    ALLOWED_ORIGINS = os.getenv('ALLOWED_ORIGINS', 'http://localhost:9000').split(',')

    # Application logging configuration
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    LOG_FILE = os.getenv('LOG_FILE', str(BASE_DIR / 'logs' / 'dyno.log'))

    # Flask-SocketIO async configuration
    SOCKETIO_ASYNC_MODE = 'gevent'
    SOCKETIO_CORS_ALLOWED_ORIGINS = ALLOWED_ORIGINS


class DevelopmentConfig(Config):
    DEBUG = True  # Enable Flask debugger and auto-reload
    LOG_LEVEL = 'DEBUG'  # Verbose logging for development


class ProductionConfig(Config):
    DEBUG = False  # Disable for security (prevents code execution exposure)
    LOG_LEVEL = 'WARNING'  # Reduce log volume in production


class TestingConfig(Config):
    TESTING = True  # Enables Flask test helpers
    DEBUG = True  # Show full tracebacks in test output
    DATABASE_PATH = ':memory:'  # Use in-memory SQLite for tests
    

# Configuration registry mapping environment names to config classes
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig  # Fallback if no environment specified
}


def get_config(config_name=None):
    
    if config_name is None:
        # Read from FLASK_ENV environment variable, default to development
        config_name = os.getenv('FLASK_ENV', 'development')
    return config[config_name]
