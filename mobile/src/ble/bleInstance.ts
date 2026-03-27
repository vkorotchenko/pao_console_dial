import {BleManager} from 'react-native-ble-plx';

/**
 * Single shared BleManager instance.
 * react-native-ble-plx treats BleManager as a singleton at the native layer —
 * creating two instances causes scan conflicts on both iOS and Android.
 */
export const sharedBleManager = new BleManager();
