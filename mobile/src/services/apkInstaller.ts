import {NativeModules, Platform} from 'react-native';

// ---------------------------------------------------------------------------
// Thin JS wrapper around the Android `ApkInstaller` native module
// (see android/app/src/main/java/com/paoconsole/ApkInstallerModule.kt).
//
// Three operations:
//   - canRequestInstalls()           — gate: has the user granted per-source
//                                       install consent? On Android 8+ this
//                                       is required before ACTION_VIEW will
//                                       reach the installer at all.
//   - openInstallPermissionSettings()— deeplink to the consent toggle so the
//                                       user can grant it without hunting.
//   - installApk(filePath)           — dispatch the install intent. Once
//                                       the user taps "Install", this RN
//                                       process is killed.
//
// All three are no-ops / throw on iOS. APK install simply doesn't apply
// outside Android — the surrounding UI should check `Platform.OS` before
// even showing the "Update to vX.Y.Z" button.
// ---------------------------------------------------------------------------

const {ApkInstaller} = NativeModules;

/**
 * Dispatch an install intent for the APK at `filePath`. Returns once the
 * intent has been started; cannot tell whether the user actually completes
 * the install (we get killed when they do).
 *
 * The caller MUST have already verified `canRequestInstalls()` returns true.
 */
export async function installApk(filePath: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('APK install is Android-only');
  }
  if (!ApkInstaller?.installApk) {
    throw new Error('ApkInstaller native module not linked');
  }
  await ApkInstaller.installApk(filePath);
}

/**
 * Returns true if this app is allowed to request package installs. On API < 26
 * this is always true (no per-source consent existed pre-Oreo). On API 26+ it
 * reflects the per-app toggle under Settings → Special access → Install
 * unknown apps. Returns false on non-Android.
 */
export async function canRequestInstalls(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!ApkInstaller?.canRequestInstalls) return false;
  return ApkInstaller.canRequestInstalls();
}

/**
 * Deeplinks to the per-app "Install unknown apps" Settings page so the user
 * can grant install consent without manually navigating. The user returns to
 * the app (typically via back) once they've toggled the switch.
 *
 * Returns immediately after the intent is dispatched. The app does NOT learn
 * whether the user toggled the setting — the caller should re-check
 * `canRequestInstalls()` on next interaction.
 */
export async function openInstallPermissionSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!ApkInstaller?.openInstallPermissionSettings) return;
  await ApkInstaller.openInstallPermissionSettings();
}
