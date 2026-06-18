#!/bin/bash

# Attach the serial line CAN interface
slcan_attach -f -s6 -o /dev/ttyACM0

# Create the slcan interface
slcand ttyACM0 slcan0

# Set the transmit queue length
ifconfig slcan0 txqueuelen 1000

# Bring the interface up
ifconfig slcan0 up

echo "[+] CAN interface slcan0 is now configured and up!"

