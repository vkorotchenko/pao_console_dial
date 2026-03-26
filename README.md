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

A React Native companion app (iOS + Android) provides BLE connectivity to the ESP32-S3 peripheral, enabling:
- Live telemetry dashboard
- Remote gear control
- Charger configuration
- Device management

### BLE GATT Service

**Device Name:** `PAO Console`
**Service UUID:** `c909d45a-0560-4725-85e7-c20a9bbb74c2`

The ESP32-S3 advertises a GATT service with three characteristics:

#### Characteristic 1 — Telemetry (Notify)
**UUID:** `c169df83-5127-46df-a18b-066672243018`
**Size:** 36 bytes (big-endian)
**Frequency:** ~100 ms

| Byte(s) | Field | Type | Scale | Notes |
|---------|-------|------|-------|-------|
| 0 | schemaVersion | uint8 | — | Always `0x01` |
| 1–2 | speedRpm | int16 | 1 RPM | Motor RPM |
| 3–4 | motorTempC | int16 | ÷10 | Motor temperature (°C) |
| 5–6 | inverterTempC | int16 | ÷10 | Inverter temperature (°C) |
| 7–8 | torqueNm | int16 | ÷10 | Signed; negative = regen braking (Nm) |
| 9–10 | dcVoltageV | uint16 | ÷10 | Pack voltage (V) |
| 11–12 | dcCurrentA | int16 | ÷10 | Pack current; signed (A) |
| 13 | motorState | uint8 | — | 0=disabled, 1=standby, 2=enabled, 3=powerdown |
| 14 | statusFlags | uint8 | bitmask | bit0=running, bit1=fault, bit2=warning, bit3=ready, bit4=gpsFix, bit5=preChargeReady, bit6=canConnected |
| 15 | gear | uint8 | — | 0=neutral, 1=drive, 2=reverse, 3=park |
| 16–19 | gpsLat | float32 | — | GPS latitude (degrees) |
| 20–23 | gpsLon | float32 | — | GPS longitude (degrees) |
| 24–27 | gpsSpeedKmh | float32 | — | GPS-derived speed (km/h) |
| 28–31 | gpsAltitudeM | float32 | — | GPS altitude (metres) |
| 32 | gpsSatellites | uint8 | — | Satellite count |
| 33 | chargePercent | uint8 | — | State of charge (%) |
| 34 | chargeErrorState | uint8 | — | Charger error code |
| 35 | chargeState | uint8 | — | 0=not charging, 1=charging, 2=complete |

#### Characteristic 2 — Gear Command (Write)
**UUID:** `b2b08d43-7ec9-40c4-add2-a3a899756607`
**Size:** 1 byte

| Value | Gear |
|-------|------|
| 0 | Neutral |
| 1 | Drive |
| 2 | Reverse |
| 3 | Park |

#### Characteristic 3 — Charger Config (Read/Write/Notify)
**UUID:** `06ad7ea2-24cc-46fe-b791-78167b76693e`

**Read / Notify (12 bytes, big-endian):**

| Byte(s) | Field | Type | Scale | Notes |
|---------|-------|------|-------|-------|
| 0–1 | targetVoltageV | uint16 | ÷10 | Target voltage (V) |
| 2–3 | maxCurrentA | uint16 | ÷10 | Max charge current (A) |
| 4 | targetSocPercent | uint8 | — | Target SOC (%) |
| 5–6 | maxChargeTimeSeconds | uint16 | — | Max charge time (seconds) |
| 7–8 | actualVoltageV | uint16 | ÷10 | Actual voltage (V, read-only) |
| 9–10 | actualCurrentA | uint16 | ÷10 | Actual current (A, read-only) |
| 11 | chargeErrorState | uint8 | — | Charger error code (read-only) |

**Write (7 bytes):**

| Byte(s) | Field |
|---------|-------|
| 0–1 | targetVoltageV |
| 2–3 | maxCurrentA |
| 4 | targetSocPercent |
| 5–6 | maxChargeTimeSeconds |

### Mobile App Setup

```bash
# Install dependencies
make mobile-install

# Start Metro bundler (in one terminal)
make mobile-start

# In another terminal, build and run on Android (requires Metro running)
make mobile-android

# Or for iOS
make mobile-ios
```

See [`mobile/README.md`](mobile/README.md) for detailed setup, tech stack, and troubleshooting.

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
├── charger/             # SAMD21 charger firmware (PlatformIO)
│   └── src/
│       ├── main.cpp
│       ├── charger_handler.cpp/.h
│       └── ...
└── mobile/              # React Native companion app (iOS + Android)
    ├── src/
    │   ├── components/
    │   │   └── FloatingIcons.tsx
    │   ├── config/
    │   │   └── tabs.json
    │   ├── navigation/
    │   │   └── AppNavigator.tsx
    │   ├── screens/
    │   │   ├── DashboardScreen.tsx
    │   │   ├── GearScreen.tsx
    │   │   ├── ChargerScreen.tsx
    │   │   ├── SettingsScreen.tsx
    │   │   └── HUDScreen.tsx
    │   ├── ble/
    │   │   ├── PaoBleManager.ts
    │   │   └── packets.ts
    │   ├── store/
    │   │   ├── useAppStore.ts
    │   │   └── permissions.ts
    │   ├── types/
    │   │   └── index.ts
    │   └── App.tsx
    ├── ios/             # iOS build
    ├── android/         # Android build
    ├── package.json
    └── README.md
```

**Navigation:** Bottom tab navigation via React Navigation with 5 main screens (Dashboard, Gear, Charger, Settings) plus a full-screen HUD modal.

---

## Building & Flashing

Both firmware units use [PlatformIO](https://platformio.org/). Use the Makefile targets to build and flash:

### Make Targets

| Target | Purpose |
|--------|---------|
| `make build` | Build all firmware projects (controller, peripheral, charger) |
| `make build-peripheral` | Build ESP32-S3 peripheral firmware |
| `make build-controller` | Build SAMD21 controller firmware |
| `make build-charger` | Build SAMD21 charger firmware |
| `make upload-peripheral` | Flash peripheral to ESP32-S3 (USB) |
| `make upload-controller` | Flash controller to Feather M0 (USB) |
| `make upload-charger` | Flash charger to SAMD21 (USB) |
| `make monitor-peripheral` | Open serial monitor for peripheral |
| `make monitor-controller` | Open serial monitor for controller |
| `make monitor-charger` | Open serial monitor for charger |
| `make clean` | Clean all build artifacts |

**Example:**
```bash
make build-peripheral
make upload-peripheral
make monitor-peripheral
```

All projects are configured with PlatformIO (`platformio.ini` in each directory).

---

## License

Apache 2.0
