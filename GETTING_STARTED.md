# Getting Started with OpenDyno

This guide walks you through the step-by-step process of manufacturing, assembling, wiring, and configuring the OpenDyno system.

---

## 1. Hardware Acquisition & Manufacturing

### PCB Manufacturing
The system requires three custom PCBs to be manufactured. You can use services like JLCPCB. Small PCB designs have been made to be cheap to produce. For convenience, pre-generated Gerber ZIP files are available to send directly to the manufacturer:
1. **DynoPower Board**: A ready-to-send ZIP is available at [DynoPower_v2.zip](DynoPower/DynoPower_v2/Gerbers/DynoPower_v2.zip).
2. **DynoLogic Board**: A ready-to-send ZIP is available at [DynoLogic_v3.zip](DynoLogic/Hardware/Gerbers/DynoLogic_v3.zip).
3. **IGBT Power Board**: A ready-to-send ZIP is available at [IGBT_Power.zip](DynoPower/IGBT_Power/Gerbers/IGBT_Power.zip).

### Component Sourcing
Components for the PCBs must be purchased from suppliers like LCSC, Mouser, or others, and then soldered onto the boards. 

**Buy List:**
- **Standard Components**: Refer to the interactive BOMs (`ibom.html`) for the exact resistors, ICs, etc., sourced from LCSC or Mouser.
- **Teensy 4.1**: Required for the DynoLogic board (can be purchased from PJRC or Aliexpress).
- **Connectors**: [Signal and power connectors](https://es.aliexpress.com/item/1005001677869988.html) for DynoLogic and DynoPower (excluding high-current terminals).
- **Capacitors**: [High-voltage capacitors](https://es.aliexpress.com/item/1005008575894112.html) for the DynoPower board.
- **Heatsink & Thermals**: [Large heatsink](https://es.aliexpress.com/item/33021705659.html) and [thermal pads](https://es.aliexpress.com/item/32880831473.html) for the IGBT on the DynoPower board.
- **CAN Adapter**: [CANable adapter](https://es.aliexpress.com/item/1005006842262016.html) to connect DynoLogic to DynoServer.

**External Hardware (To be purchased separately):**
- **IR Temp Sensor**: [IR Temperature sensor](https://es.aliexpress.com/item/1005005964068723.html)
- **Encoder**: [Rotary encoder](https://es.aliexpress.com/item/1005005071771659.html)
- **Load Cell**: [Load cell](https://es.aliexpress.com/item/1005005915852645.html)
- **Load Cell Amp**: [HX711 module](https://es.aliexpress.com/item/1005006293368575.html)

### Compute & Communication
- **Server Hardware**: A Raspberry Pi, OrangePi, or any standard computer is needed to run the DynoServer software.
- **CAN Adapter**: The CANable (or compatible) adapter mentioned above is required to connect the DynoLogic board to the DynoServer.

### Eddy Current Brake
> [!WARNING]
> You must carefully check the specifications of your eddy current brake. It is highly recommended to wire it for **192V** operation. Ensure your wiring and the brake's insulation can safely handle this voltage.

---

## 2. Assembly & Connections

Once all boards are populated and external sensors are acquired, wire the system together following the diagram below:

![Wiring Diagram](_assets/Wiring%20Diagram.png)

---

## 3. Firmware Setup (DynoLogic)

Once the hardware is connected, you need to configure and flash the control firmware.

1. **Configure Firmware**: Open the `DynoLogic/Firmware` project in PlatformIO. Adjust any necessary compile-time parameters for your specific hardware setup. For a deep dive into available configuration parameters, consult `DynoLogic/README.md`.
2. **Flash to Teensy**: Burn the compiled firmware into the Teensy 4.1 via USB.

---

## 4. Server Setup (DynoServer)

With the firmware running, set up the web interface and control server.

1. **Configuration Files**: Navigate to `DynoServer/`. Copy the `.env.example` file to `.env` and configure your environment variables. For a deep dive into available configuration parameters and deployment scripts, consult `DynoServer/README.md`.
2. **Deploy Service**: Install the necessary dependencies and deploy the service (e.g., using the provided `install_service.sh` for Linux). 
3. **Start Service**: Start the DynoServer application and ensure it successfully connects to the CANable adapter.

---

## 5. Calibration & Interface Setup

After launching the DynoServer and accessing the web interface:

1. **Interface Configuration**: Set your maximum and minimum speeds, load cell parameters, and other safety limits in the web interface.
2. **Tare Load Cell**: Ensure the load cell is unloaded and tare it through the UI to zero the torque reading.
3. **PID Tuning**: Finally, carefully tune the PID parameters for your specific eddy current brake and motor dynamics. It is recommended to start tuning with low power limits to ensure safety.

Once these steps are completed, your OpenDyno system is fully operational and ready for testing!
