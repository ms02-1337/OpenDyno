from gevent import monkey
monkey.patch_all()

from dotenv import load_dotenv
import logging
import os

# Load environment variables
load_dotenv()

from app import create_app, socketio

# Set werkzeug logs
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# Create app
app = create_app()

if __name__ == '__main__':
    host = app.config.get('HOST', '0.0.0.0') # Public on network
    port = app.config.get('PORT', 9000)
    debug = app.config.get('DEBUG', False)

    # Only show banner in the main process (not in Flask's reloader subprocess)
    if not os.environ.get('WERKZEUG_RUN_MAIN'):
        # ASCII art banner
        print("""
  /$$$$$$                                /$$$$$$$
 /$$__  $$                              | $$__  $$
| $$  \ $$  /$$$$$$   /$$$$$$  /$$$$$$$ | $$  \ $$ /$$   /$$ /$$$$$$$   /$$$$$$
| $$  | $$ /$$__  $$ /$$__  $$| $$__  $$| $$  | $$| $$  | $$| $$__  $$ /$$__  $$
| $$  | $$| $$  \ $$| $$$$$$$$| $$  \ $$| $$  | $$| $$  | $$| $$  \ $$| $$  \ $$
| $$  | $$| $$  | $$| $$_____/| $$  | $$| $$  | $$| $$  | $$| $$  | $$| $$  | $$
|  $$$$$$/| $$$$$$$/|  $$$$$$$| $$  | $$| $$$$$$$/|  $$$$$$$| $$  | $$|  $$$$$$/
 \______/ | $$____/  \_______/|__/  |__/|_______/  \____  $$|__/  |__/ \______/
          | $$                                     /$$  | $$
          | $$                                    |  $$$$$$/
          |__/                                     \______/
        """)

        print(f"[+] Starting OpenDyno application...")
        print(f"[+] Environment: {os.getenv('FLASK_ENV', 'development')}")
        print(f"[+] Server: http://{host}:{port}")

    socketio.run(app, host=host, port=port, debug=debug)