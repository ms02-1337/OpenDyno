#!/bin/bash

# OpenDyno CAN Interface Sudoers Setup Script
# This script configures passwordless sudo for the commands required
# to initialize the CAN interface from the OpenDyno web backend.

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./setup_can_sudo.sh)"
  exit 1
fi

SUDOERS_FILE="/etc/sudoers.d/opendyno_can"

echo "Creating sudoers rule in $SUDOERS_FILE..."

# We grant ALL users passwordless access to these specific networking commands
# If you prefer to restrict it to a specific user, replace ALL with the username.
cat <<EOF > "$SUDOERS_FILE"
# OpenDyno CAN Interface Configuration Rules
ALL ALL=(ALL) NOPASSWD: /usr/sbin/slcan_attach, /usr/sbin/slcand, /sbin/ip, /sbin/ifconfig, /usr/bin/slcan_attach, /usr/bin/slcand, /usr/bin/ip, /usr/bin/ifconfig, /bin/ip, /bin/ifconfig
EOF

chmod 0440 "$SUDOERS_FILE"

echo "Done! The OpenDyno backend can now configure the CAN interface automatically."
