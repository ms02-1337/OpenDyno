# DynoServer

> Flask + Socket.IO web application providing real-time visualization, CAN communication, and test logging for the OpenDyno dynamometer.

Part of the **OpenDyno** motor dynamometer system.

## 1. Server Configuration (`.env`)

For a complete step-by-step assembly and setup guide, please see [../GETTING_STARTED.md](../GETTING_STARTED.md).

Before starting the server, you must copy the `.env.example` file to `.env` and configure your environment variables. The `.env` file controls all networking, security, and hardware interface settings.

### Network Settings
- **`HOST` / `PORT`**: Defines where the Flask server binds. Use `0.0.0.0` and `9000` to make it accessible across your local network.
- **`ALLOWED_ORIGINS`**: Essential for CORS. To allow access from any device on your local network, set this to `*`. In a strict production environment, specify the exact IP addresses allowed to access the server.

### Hardware Interface
- **`CAN_TTY_DEVICE`**: Defines the USB path to your slcan-compatible CAN adapter (e.g., `/dev/ttyACM0` or `/dev/ttyUSB0`). Ensure this matches your physical hardware path.
- **`CAN_INTERFACE`**: Typically `socketcan`.
- **`CAN_CHANNEL`**: Typically `slcan0`.

### Security
- **`SECRET_KEY`**: Ensure you change this to a long, secure, randomly generated string for production deployments.

## 2. Automated Service Deployment (Linux/Raspberry Pi)

DynoServer includes several bash scripts in the root directory to completely automate deployment on a Linux machine (like a Raspberry Pi). 

1. **`setup_can_sudo.sh`**: Grants passwordless execution privileges for `slcan_attach` and `ifconfig` to all users. This allows the Flask backend to dynamically toggle and initialize the CAN bus interface directly from the web UI without prompting for a password.
2. **`init_can.sh`**: Physically brings up the `slcan0` network interface using your configured `CAN_TTY_DEVICE` at 500 kbps.
3. **`install_service.sh`**: The main deployment script. Must be run as root. It creates a dedicated `opendyno` system user, automatically builds the Python virtual environment (`venv`), installs all production dependencies (`requirements/prod.txt`), executes `setup_can_sudo.sh`, and finally installs and starts the `opendyno.service` systemd daemon. *(Note: If you pull new code from GitHub later, you can simply run this script again to automatically update the dependencies and restart the service!)*

To completely deploy the server on a fresh Linux machine, simply run:
```bash
sudo ./install_service.sh
```

## 3. Manual Deployment (No Service) & Development

If you want to run the server manually without setting it up as a background systemd service (e.g., on Windows, Mac, or for local development):

1. **Create a Virtual Environment**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   # Or on Windows: .venv\Scripts\activate
   ```
2. **Install Requirements**:
   ```bash
   pip install -r requirements/dev.txt
   ```
3. **Run the Application**:
   ```bash
   python run.py
   ```
   *(Note: The server will start, but CAN connectivity requires a Linux environment with `socketcan` or a compatible mock interface).*

## 4. Web Interface Configuration

Once the server is running, you can access the responsive web interface to monitor live telemetry, control the dyno, and configure the entire system dynamically. All configuration changes are sent over CAN and instantly validated via checksums.

### Configurable Parameters

| Category | Parameters | Description |
|----------|------------|-------------|
| **Dynamic Test Profile** | `startSpeed`, `rampRate`, `endSpeed`, `holdDelay`, etc. | Configures the automated state machine. Defines the RPM ramp rates, stabilization times, and peak test speeds for automated sweeping. |
| **PID Controllers** | `Kp`, `Ki`, `Kd` | Independent tuning gains for Torque, Speed, and Dynamic (Acceleration) modes. Tunable live to quickly find the perfect loop response. |
| **Load Cell Calibration** | `gain`, `offset` (Tare), `scale`, `distance` | Used to tare the load cell and set the mechanical moment arm distance (meters) to convert raw force into torque. |
| **Hardware Limits** | `minSpeed`, `maxSpeed`, `PWM limit` | Critical safety limits that prevent the eddy current brake from engaging below minimum speeds or exceeding thermal/RPM limits. |
| **Signal Filtering** | `speed_hz`, `torque_hz`, `accel_hz` | Cutoff frequencies for the cascaded low-pass filters running on the Teensy. Allows you to smooth out noisy load cell or encoder data on the fly. |
| **Inertia & Ratios** | `dynoInertia`, `motorPinions`, `dynoPinions` | Physical constants used to calculate acceleration torque and correct for chain/belt gear ratios between the motor and the brake. |
| **Graph Scaling** | `torque_max`, `rpm_max`, `power_max` | Adjusts the Y-axis constraints of the live charts so your specific motor data fits perfectly on the screen. |

## 5. Features & Architecture

- **Flask Backend**: Serves the frontend static files and handles REST API requests for configuring PID parameters and limits.
- **Socket.IO Telemetry**: Provides real-time, low-latency WebSocket streaming. Telemetry data (speed, torque, acceleration, temperatures) is pushed from the DynoLogic firmware to the browser at 100 Hz for perfectly smooth live charting.
- **Config Synchronization**: Any configuration changes made in the web UI (like Load Cell Tare, Max RPM, or PID gains) are instantly validated via CRC16 checksums and transmitted over the CAN bus to update the non-volatile memory of the Teensy 4.1.
- **Test Logging**: Dynamometer runs are automatically saved to the local `data/database.json` file for historical analysis and test comparison overlays.

## License

Licensed under the OpenDyno custom non-commercial license. See root [LICENSE](../LICENSE).
