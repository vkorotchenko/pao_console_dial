// ---------------------------------------------------------------------------
// Thin wake-lock wrapper. Used during the OTA flash flow to keep the screen
// from sleeping mid-transfer (a backgrounded app on Android can lose the BLE
// connection; on iOS it can miss notify events).
//
// We try `react-native-keep-awake` first (declared in package.json). If the
// native module isn't linked yet (fresh install before `pod install` /
// rebuild), the wrapper degrades to a no-op so the JS bundle still loads.
// Worst case: the screen may sleep during a flash. Reasonable trade-off vs.
// hard-blocking the app from launching on a half-installed dep.
// ---------------------------------------------------------------------------

let activate: () => void = () => {};
let deactivate: () => void = () => {};

try {
  // Dynamic require so missing native module doesn't blow up the bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ka = require('react-native-keep-awake');
  // The package exposes activateKeepAwake/deactivateKeepAwake (default + named
  // exports vary by version). Probe both.
  const act = ka?.activateKeepAwake ?? ka?.default?.activate;
  const deact = ka?.deactivateKeepAwake ?? ka?.default?.deactivate;
  if (typeof act === 'function') {
    activate = () => {
      try {
        act();
      } catch (e) {
        console.warn('[KeepAwake] activate failed:', e);
      }
    };
  }
  if (typeof deact === 'function') {
    deactivate = () => {
      try {
        deact();
      } catch (e) {
        console.warn('[KeepAwake] deactivate failed:', e);
      }
    };
  }
} catch (e) {
  // Module not installed / not linked — fall through to no-op.
  console.warn('[KeepAwake] react-native-keep-awake unavailable; running without wake lock.', (e as any)?.message);
}

export const activateKeepAwake = (): void => activate();
export const deactivateKeepAwake = (): void => deactivate();
