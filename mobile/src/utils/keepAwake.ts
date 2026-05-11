import {NativeModules, Platform} from 'react-native';

const {KeepAwake} = NativeModules;

export function activateKeepAwake(): void {
  if (Platform.OS !== 'android' || !KeepAwake?.activate) return;
  try {
    KeepAwake.activate();
  } catch (err) {
    console.warn('[KeepAwake] activate failed:', err);
  }
}

export function deactivateKeepAwake(): void {
  if (Platform.OS !== 'android' || !KeepAwake?.deactivate) return;
  try {
    KeepAwake.deactivate();
  } catch (err) {
    console.warn('[KeepAwake] deactivate failed:', err);
  }
}
