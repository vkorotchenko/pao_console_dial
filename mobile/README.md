# PAO Console Mobile App

React Native companion app for the PAO Console DIY EV telemetry system. Connects to the ESP32-S3 peripheral over Bluetooth Low Energy (BLE) to display live telemetry, control gear selection, and configure charger parameters.

## Overview

The mobile app provides a user-friendly interface to interact with your EV's telemetry and charging system:
- **Dashboard** — Real-time speed, battery %, motor temperature, and live data
- **Gear Control** — Select neutral, drive, reverse, or park (optional, toggleable in settings)
- **Charger Config** — Set voltage, current, and SOC targets for battery charging
- **Settings** — Configure BLE connection, speed units (km/h or mph), and UI options
- **HUD** — Full-screen landscape mirror display for at-a-glance data while driving

## Tech Stack

| Component | Version |
|-----------|---------|
| React Native | 0.84.1 |
| React | 19.2.3 |
| TypeScript | 5.3.3 |
| React Navigation | 7.x |
| Zustand | 5.x |
| react-native-ble-plx | Latest |
| react-native-paper | 5.x |
| react-native-vector-icons | MaterialCommunityIcons |

## Prerequisites

- **Node.js** 18+ and npm/yarn
- **For iOS:** Xcode 14+, CocoaPods, iOS deployment target 13.0+
- **For Android:** Android Studio, JDK 17, Android SDK API 23+
- **BLE Hardware:** ESP32-S3 PAO Console device powered on and advertising

## Installation

```bash
# Install dependencies
make mobile-install

# Or manually
cd mobile
npm install

# iOS only (install pods)
cd ios && pod install && cd ..
```

## Running the App

### Android

```bash
# Start Metro bundler in foreground (one terminal)
make mobile-start

# In another terminal, build and run on device or emulator
make mobile-android
```

**Note:** The Android build requires Metro to be running. You can use `make mobile-android-fresh` to start Metro and build in one command, or run both manually in separate terminals.

```bash
# Alternative: Complete workflow in one command
make mobile-android-fresh

# Clean Android build cache if you encounter build issues
make reset-android-cache
```

### iOS

```bash
# Start Metro bundler (one terminal)
make mobile-start

# In another terminal
make mobile-ios
```

## BLE GATT Service

The app connects to the PAO Console ESP32-S3 device via BLE.

**Device Name:** `PAO Console`
**Service UUID:** `c909d45a-0560-4725-85e7-c20a9bbb74c2`

### Characteristic 1 — Telemetry (Notify)

**UUID:** `c169df83-5127-46df-a18b-066672243018`
**Size:** 36 bytes (big-endian)
**Update Frequency:** ~100 ms

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

### Characteristic 2 — Gear Command (Write)

**UUID:** `b2b08d43-7ec9-40c4-add2-a3a899756607`
**Size:** 1 byte

| Value | Gear |
|-------|------|
| 0 | Neutral |
| 1 | Drive |
| 2 | Reverse |
| 3 | Park |

### Characteristic 3 — Charger Config (Read/Write/Notify)

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

**Write (7 bytes — settable fields only):**

| Byte(s) | Field |
|---------|-------|
| 0–1 | targetVoltageV |
| 2–3 | maxCurrentA |
| 4 | targetSocPercent |
| 5–6 | maxChargeTimeSeconds |

## Screens

### Dashboard
Displays live telemetry: speed, RPM, battery %, motor and inverter temperatures, torque, voltage, current, and GPS data. Updates in real-time as the BLE characteristic notifies.

### Gear Control (Optional)
Send gear commands (neutral, drive, reverse, park) to the vehicle. Toggle visibility in Settings.

### Charger
Read and configure charger parameters:
- Target voltage and current
- Target SOC (state of charge)
- Max charge time
- View actual voltage, current, and charger error state

### Settings
- BLE device selection and connection status
- Speed unit preference (km/h or mph) — persists via AsyncStorage
- Gear tab visibility toggle — persists via AsyncStorage
- Permissions status

### HUD (Full-Screen Mode)
Launch a full-screen landscape display for at-a-glance telemetry while driving.

## Persistent Settings

User preferences are saved to device storage via AsyncStorage:
- **Speed Unit:** km/h or mph (used on Dashboard and HUD)
- **Gear Tab Visibility:** Show or hide the Gear Control screen

## BLE Permissions

The app automatically requests Bluetooth permissions on first launch.

### iOS (`ios/PaoConsole/Info.plist`)

Already configured with:
```xml
<key>NSBluetoothPeripheralUsageDescription</key>
<string>PAO Console needs Bluetooth to connect to your EV telemetry device</string>
<key>NSBluetoothAlwaysAndWhenInUseUsageDescription</key>
<string>PAO Console needs Bluetooth to connect to your EV telemetry device</string>
```

### Android (`android/app/src/main/AndroidManifest.xml`)

Already configured with:
```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

Runtime permissions are requested automatically by the app.

## Project Structure

```
mobile/
├── src/
│   ├── components/
│   │   └── FloatingIcons.tsx       # UI component
│   ├── config/
│   │   └── tabs.json               # Navigation tab config
│   ├── navigation/
│   │   └── AppNavigator.tsx        # React Navigation setup
│   ├── screens/
│   │   ├── DashboardScreen.tsx     # Main telemetry display
│   │   ├── GearScreen.tsx          # Gear command control
│   │   ├── ChargerScreen.tsx       # Charger config
│   │   ├── SettingsScreen.tsx      # App settings
│   │   └── HUDScreen.tsx           # Full-screen landscape display
│   ├── ble/
│   │   ├── PaoBleManager.ts        # BLE communication manager
│   │   └── packets.ts              # Binary packet encoding/decoding
│   ├── store/
│   │   ├── useAppStore.ts          # Zustand state management
│   │   └── permissions.ts          # Permissions handling
│   ├── types/
│   │   └── index.ts                # TypeScript definitions
│   └── App.tsx                     # Root component
├── ios/
│   ├── PaoConsole/                 # iOS app code
│   ├── Podfile
│   └── PaoConsole.xcodeproj
├── android/
│   ├── app/                        # Android app code
│   └── build.gradle
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### BLE Connection Issues

1. **Verify Bluetooth is enabled** on your device
2. **Check app has Bluetooth permissions granted** in system settings
3. **Ensure ESP32-S3 is powered on** and advertising
4. **Confirm device name is "PAO Console"** (case-sensitive)
5. **Check serial monitor** on the device for BLE activity

### Android Build Issues

Clean the Gradle cache:
```bash
make reset-android-cache
```

Or manually:
```bash
cd android
./gradlew clean
cd ..
```

Then try `make mobile-android` again.

### iOS Build Issues

Clean CocoaPods cache:
```bash
cd ios
pod deintegrate
pod install
cd ..
```

### Metro Bundler Issues

If Metro is stuck or experiencing errors:
```bash
# Kill any existing Metro processes
pkill -f "react-native start"

# Restart Metro
make mobile-start
```

### Slow Performance on Android

Try resetting the Metro cache:
```bash
npm start -- --reset-cache
```

## Development

### Type Checking

```bash
npx tsc --noEmit
```

### Code Structure

- **BLE Manager (`src/ble/`):** Handles device scanning, connection, reading/writing characteristics, and parsing incoming telemetry
- **Store (`src/store/`):** Zustand store maintains connected device state, telemetry data, and user settings
- **Screens (`src/screens/`):** React Native components render UI and dispatch store actions
- **Navigation (`src/navigation/`):** React Navigation bottom-tab structure with optional conditional tabs

## License

Part of the PAO Console project. See root LICENSE file.
