# PAO Console Dial

A custom touchscreen console for real-time EV telemetry and control, built around a MaTouch ESP32-S3 rotary IPS display. The system uses a dual-microcontroller architecture: a **controller** unit aggregates data from CAN bus and GPS, while a **peripheral** unit renders a multi-screen UI on a 2.1" round display.

> **THIS IS IN PROTOTYPE STAGES. Use at own risk.**

---

## Architecture

```
Controller (Adafruit Feather M0)          Peripheral (ESP32-S3)
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ CAN Bus (MCP2515, 500 kbps)  │          │ 2.1" Round IPS Display       │
│  └─ Motor, inverter, battery │  I2C     │   540×540, ST7701 controller │
│ GPS (UART, Adafruit module)  │◄────────►│ Rotary Encoder + Push Button │
│ I2C Slave (address 0x07)     │          │ Capacitive Touchscreen       │
│  └─ Serves 48-byte telemetry │          │ I2C Master                   │
└──────────────────────────────┘          └──────────────────────────────┘
```

The peripheral polls the controller every ~100ms over I2C. Each exchange sends a 48-byte telemetry packet (controller → peripheral) and a 4-byte gear command (peripheral → controller), both with XOR checksums.

---

## Screens

| Screen | Description |
|---|---|
| **Speedometer** | Concentric ring gauges for speed, RPM (0–6000), torque, and battery level |
| **Data Carousel** | Scrollable list of 13 live values (temps, voltage, current, CAN signals) |
| **Gear Selector** | NEUTRAL / DRIVE / REVERSE / PARK selection, sent back to controller via I2C |
| **Charging** | Battery charging status visualization |
| **Settings** | Brightness, units (metric/imperial), timezone, touch calibration, screen timeout |
| **Spotify** | BLE keyboard interface for media control |
| **Loading** | Splash screen shown on boot |

Navigation uses the rotary encoder (scroll) and touchscreen (tap). Carousel transitions are animated with scroll accumulation and debouncing.

---

## Hardware

### Controller
- **MCU**: Adafruit Feather M0 Express (ARM SAMD21)
- **CAN**: MCP2515 via SPI (CS pin 5), 500 kbps
- **GPS**: Adafruit GPS module (UART)
- **Role**: I2C slave at address 0x07

### Peripheral
- **MCU**: ESP32-S3 DevKit (16 MB flash, PSRAM)
- **Display**: MaTouch 2.1" round IPS, 540×540, RGB parallel bus
- **Input**: 24-position rotary encoder, push button, CST816 capacitive touch
- **Brightness**: PWM on pin 38
- **Role**: I2C master

---

## CAN Messages Handled

| ID | Data |
|---|---|
| `0x607` | Pre-charge contactor status |
| `0x609` | Motor state, running/fault/ready flags |
| `0x650` | Motor speed, torque |
| `0x651` | Motor temperature, inverter temperature |
| `0x23A–0x236` | DC voltage, DC current, additional signals |

Stale detection: CAN data resets after 5 seconds of silence; GPS resets after 10 seconds.

---

## I2C Packet Format

**Controller → Peripheral (48 bytes)**

| Bytes | Content |
|---|---|
| 0–1 | Protocol version (`0x01`), message type (`0x01`) |
| 2–13 | Speed, motor temp, inverter temp, torque, DC voltage, DC current (int16, big-endian) |
| 14 | Motor state |
| 15 | Status flags: `0x01` running, `0x02` faulted, `0x04` warning, `0x08` ready, `0x10` GPS fix, `0x20` pre-charge ready |
| 16–31 | GPS lat, lon, speed, altitude (float, 4 bytes each) |
| 32–38 | GPS satellites, hour, minute, second, day, month, year |
| 47 | XOR checksum (bytes 0–46) |

**Peripheral → Controller (4 bytes)**

| Bytes | Content |
|---|---|
| 0–1 | Protocol version (`0x01`), message type (`0x02`) |
| 2 | Gear: `0` neutral, `1` drive, `2` reverse, `3` park |
| 3 | XOR checksum |

---

## CAN Database

`pao.dbc` at the repo root is a DBC file documenting all CAN messages used by this project, including GEVCU/DMOC motor controller signals (electrical status, temperatures, torque, speed, gear commands) and charger messages (ELCON status, pao_charger config broadcasts and commands). Load it in any DBC-compatible tool (e.g. SavvyCAN, BUSMASTER, Vector CANdb++) to decode live bus traffic.

---

## Mobile App

A React Native companion app (iOS + Android) provides BLE connectivity to the ESP32-S3, enabling:
- Live telemetry dashboard
- Remote gear control
- Charger configuration
- Device management

See [`mobile/README.md`](mobile/README.md) for setup and build instructions.

---

## Project Structure

```
pao_console_dial/
├── controller/          # Feather M0 firmware (PlatformIO)
│   └── src/
│       ├── main.cpp
│       ├── can_handler.cpp/.h
│       ├── gps_handler.cpp/.h
│       ├── i2c_handler.cpp/.h
│       └── global_state.cpp/.h
├── peripheral/          # ESP32-S3 firmware (PlatformIO)
│   └── src/
│       ├── main.cpp
│       ├── i2c_handler.cpp/.h
│       ├── global_state.cpp/.h
│       ├── carousel.cpp/.h
│       ├── speedo_screen.cpp/.h
│       ├── data_screen.cpp/.h
│       ├── gear_screen.cpp/.h
│       ├── charge_screen.cpp/.h
│       ├── settings_screen.cpp/.h
│       ├── spotify_screen.cpp/.h
│       └── loading_screen.cpp/.h
└── mobile/              # React Native companion app
    ├── src/
    │   ├── ble/         # BLE communication layer
    │   ├── screens/     # Dashboard, Gear, Charger, Settings
    │   ├── store/       # Zustand state management
    │   └── navigation/  # React Navigation setup
    └── README.md
```

---

## Building & Flashing

Both units use [PlatformIO](https://platformio.org/).

```bash
# Flash the controller
cd controller
pio run --target upload

# Flash the peripheral
cd peripheral
pio run --target upload
```

---

## License

Apache 2.0
