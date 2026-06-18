# DynoPower

> Isolated power electronics board for eddy current brake control.

Part of the **OpenDyno** motor dynamometer system.

## Contents

- `DynoPower_v2/` – KiCad 7 project for the main brake driver
  - `lib/` – Custom component libraries and 3D STEP models
  - `bom/ibom.html` – Interactive bill of materials
- `IGBT_Power/` – KiCad 7 project for the IGBT Driver Power Supply

## Key Features

- IGBT-based brake driver with isolated gate drive (UCC5304)
- GBJ5010 bridge rectifier + bulk capacitance
- Snubber networks and protection circuitry
- High-current power terminals

## Important Safety & Operation Notes

> [!CAUTION]
> **HIGH VOLTAGE**: This board handles dangerous high voltages. Exercise extreme caution and do not touch the board or its terminals while it is powered on. Always allow time for the bulk capacitance to discharge after powering off before handling the board.

> [!WARNING]
> **POWER-ON SEQUENCE**: You must ALWAYS follow the correct power sequencing to avoid unexpected brake engagement or hardware damage:
> 1. Power on the **DynoLogic** controller first.
> 2. Ensure the DynoServer web interface shows a successful **Connected** status.
> 3. **ONLY THEN** should you connect the DynoPower board to AC mains.
> 4. When shutting down, disconnect DynoPower from AC mains *before* powering off DynoLogic.

> [!IMPORTANT]
> **THERMAL MANAGEMENT**: The IGBT on this board is rated for up to 160A. However, a typical eddy current brake will draw between 15A to 45A. If you are operating the brake under constant load for extended periods, the board **will require active cooling (fans)** and a substantial heatsink to dissipate the generated heat.

## Documentation

See the main [OpenDyno README](../README.md#hardware-specifications) for specifications and the KiCad project for schematics and fabrication files.

## License

Licensed under the OpenDyno custom non-commercial license. See root [LICENSE](../LICENSE).
