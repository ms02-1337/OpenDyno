#!/bin/bash

# OpenDyno Service Installer Script
# This script sets up the OpenDyno service, creates the necessary user,
# configures the Python virtual environment, and starts the systemd service.

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run this installer as root (e.g., sudo ./install_service.sh)"
  exit 1
fi

APP_DIR="/opt/OpenDyno"
SERVER_DIR="$APP_DIR/DynoServer"
VENV_DIR="$APP_DIR/venv"
USER_NAME="opendyno"

echo "=== OpenDyno Deployment Installer ==="

# 1. Create dedicated user
if id "$USER_NAME" &>/dev/null; then
    echo "[+] User '$USER_NAME' already exists."
else
    echo "[+] Creating dedicated system user '$USER_NAME'..."
    useradd -r -s /bin/false "$USER_NAME"
fi

# 2. Ensure application directory exists and has correct permissions
if [ ! -d "$APP_DIR" ]; then
    echo "[-] Error: Application directory $APP_DIR does not exist."
    echo "    Please move or clone the OpenDyno repository to $APP_DIR before running this script."
    exit 1
fi

echo "[+] Setting permissions for $APP_DIR..."
chown -R "$USER_NAME:$USER_NAME" "$APP_DIR"

# 3. Setup Python Virtual Environment
echo "[+] Setting up Python Virtual Environment in $VENV_DIR..."
if [ ! -d "$VENV_DIR" ]; then
    # Use python3 or python depending on availability
    if command -v python3 &>/dev/null; then
        python3 -m venv "$VENV_DIR"
    else
        python -m venv "$VENV_DIR"
    fi
fi

# 4. Install dependencies
echo "[+] Installing Python dependencies..."
# Temporarily chown venv to root to install, or we can just install as root and chown later
"$VENV_DIR/bin/pip" install --upgrade pip
if [ -f "$SERVER_DIR/requirements/prod.txt" ]; then
    "$VENV_DIR/bin/pip" install -r "$SERVER_DIR/requirements/prod.txt"
else
    "$VENV_DIR/bin/pip" install -r "$SERVER_DIR/requirements/base.txt"
fi

# Re-apply permissions after venv modification
chown -R "$USER_NAME:$USER_NAME" "$VENV_DIR"

# 5. Configure CAN sudo privileges
echo "[+] Configuring sudo privileges for CAN interfaces..."
if [ -f "$SERVER_DIR/setup_can_sudo.sh" ]; then
    bash "$SERVER_DIR/setup_can_sudo.sh"
else
    echo "[-] Warning: setup_can_sudo.sh not found. CAN interfaces might not be configurable from the web UI."
fi

# 6. Install systemd service
echo "[+] Installing systemd service..."
cp "$SERVER_DIR/opendyno.service" /etc/systemd/system/
chmod 644 /etc/systemd/system/opendyno.service

echo "[+] Reloading systemd daemon..."
systemctl daemon-reload

echo "[+] Enabling OpenDyno service to start on boot..."
systemctl enable opendyno.service

echo "[+] Starting/Restarting OpenDyno service..."
systemctl restart opendyno.service

echo "=== Installation Complete! ==="
echo "You can check the service status by running: systemctl status opendyno.service"
echo "You can view the logs by running: journalctl -u opendyno.service -f"
