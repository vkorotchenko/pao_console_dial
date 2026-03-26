# PAO Console Mobile App

React Native companion app for PAO Console DIY EV telemetry system.

## Overview

This mobile app connects to the PAO Console ESP32-S3 device over Bluetooth Low Energy (BLE) to:
- Display live telemetry (speed, battery %, motor temperature, etc.)
- Control gear selection
- Configure charger parameters

## Tech Stack

- **Framework**: React Native 0.76.6
- **Language**: TypeScript (strict mode)
- **Navigation**: React Navigation v7 (bottom tabs)
- **State Management**: Zustand
- **BLE**: react-native-ble-plx
- **Icons**: react-native-vector-icons (MaterialCommunityIcons)

## Prerequisites

- Node.js 18+
- For iOS: Xcode 14+, CocoaPods
- For Android: Android Studio, Android SDK (API 23+)

## Installation

```bash
cd mobile
npm install

# iOS only
cd ios && pod install && cd ..
```

## Running the App

### iOS
```bash
npm run ios
# or with specific simulator
npm run ios -- --simulator="iPhone 15 Pro"
```

### Android
```bash
npm run android
# Make sure you have an Android emulator running or device connected
```

## Project Structure

```
mobile/
├── src/
│   ├── ble/
│   │   ├── PaoBleManager.ts    # BLE communication manager
│   │   └── packets.ts          # Binary packet encode/decode
│   ├── navigation/
│   │   └── AppNavigator.tsx    # Bottom tab navigation
│   ├── screens/
│   │   ├── DashboardScreen.tsx # Telemetry display
│   │   ├── GearScreen.tsx      # Gear control
│   │   ├── ChargerScreen.tsx   # Charger config
│   │   └── SettingsScreen.tsx  # BLE settings
│   ├── store/
│   │   └── useAppStore.ts      # Zustand state management
│   └── types/
│       └── index.ts            # TypeScript type definitions
├── App.tsx                     # Root component
├── package.json
└── tsconfig.json
```

## BLE Device

**Device Name**: `PAO Console`

The app searches for and connects to devices advertising with this name.

## Current Status

⚠️ **BLE Implementation Pending**

This is a scaffold build. The BLE communication layer is stubbed out with TODO comments. The actual implementation depends on the BLE GATT service design documented in:

📄 `docs/adr-001-ble-gatt-service.md`

Once Homer finalizes the ADR with UUIDs and packet structures, the BLE manager will be implemented.

### What's Ready
- ✅ App structure and navigation
- ✅ All screen stubs with proper types
- ✅ Zustand store for reactive state
- ✅ BLE manager skeleton with method stubs
- ✅ TypeScript interfaces for all data types

### What's TODO
- ⏳ BLE UUIDs (from ADR-001)
- ⏳ Binary packet encoding/decoding
- ⏳ Characteristic read/write/notify logic
- ⏳ Telemetry data parsing
- ⏳ Gear command implementation
- ⏳ Charger config read/write

## Development Notes

### BLE Permissions

#### iOS
Add to `ios/PaoConsole/Info.plist`:
```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>PAO Console needs Bluetooth to connect to your EV telemetry device</string>
```

#### Android
Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

### Testing on Real Devices

Simulators/emulators cannot test BLE functionality. You **must** use a physical device connected via USB or wireless debugging.

#### iOS
```bash
npm run ios -- --device
```

#### Android
```bash
# List devices
adb devices
npm run android
```

## Troubleshooting

### iOS Build Issues
```bash
cd ios
pod deintegrate
pod install
cd ..
```

### Android Build Issues
```bash
cd android
./gradlew clean
cd ..
```

### BLE Not Working
- Ensure Bluetooth is enabled on the device
- Check app has Bluetooth permissions granted
- Verify ESP32-S3 is powered on and advertising
- Check device name matches "PAO Console"

## Coordination with Team

- **Homer (Lead)**: Waiting for ADR-001 with BLE GATT service design
- **Bart (Firmware)**: Will implement ESP32-S3 BLE peripheral matching this app

## License

Part of the PAO Console project. See root LICENSE file.
