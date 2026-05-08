import {BleManager} from 'react-native-ble-plx';

/**
 * Single shared BleManager instance.
 * react-native-ble-plx treats BleManager as a singleton at the native layer —
 * creating two instances causes scan conflicts on both iOS and Android.
 *
 * `restoreStateIdentifier` enables iOS Core Bluetooth state preservation /
 * restoration. Required for the OTA flow: a BLE transfer can be ~1-2 minutes
 * and the app may be backgrounded mid-stream. With this identifier set + the
 * `bluetooth-central` UIBackgroundMode in Info.plist, iOS keeps the central
 * manager alive across short suspensions instead of tearing down the GATT
 * connection. No-op on Android (option is iOS-only at the native layer).
 */
export const sharedBleManager = new BleManager({
  restoreStateIdentifier: 'pao-ble-restore',
});
