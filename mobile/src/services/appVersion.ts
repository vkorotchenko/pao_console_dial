/**
 * appVersion.ts — read the running app's versionName / versionCode from native.
 *
 * Background. On Android these values come from android/app/build.gradle's
 * versionName / versionCode. On iOS they come from CFBundleShortVersionString /
 * CFBundleVersion. react-native-device-info's getVersion() / getBuildNumber()
 * normalize both platforms.
 *
 * DeviceInfo's API is mixed: on Android the calls are synchronous, on iOS the
 * async variant is the only safe one to call from JS. To keep the UI sync and
 * avoid a brief "—" flash on cold start, we read both at app boot via
 * `initAppVersion()` and cache the result in module scope. Components then read
 * synchronously through `getCachedAppVersion()` / `getCachedAppBuildNumber()`.
 */
import DeviceInfo from 'react-native-device-info';

let cachedVersion: string | null = null;
let cachedBuildNumber: string | null = null;
let initialized = false;

/**
 * Read the app's versionName and versionCode from native and cache the result.
 *
 * Safe to call multiple times — subsequent calls are no-ops after the first
 * successful read. Errors are swallowed; if native ever returns rubbish the
 * cached values stay null and the UI renders "—".
 */
export async function initAppVersion(): Promise<void> {
  if (initialized) {
    return;
  }
  try {
    // getVersion(): sync on Android, async on iOS — use the async API on both
    // to keep this path consistent. getBuildNumber() has the same shape.
    const [version, build] = await Promise.all([
      Promise.resolve(DeviceInfo.getVersion()),
      Promise.resolve(DeviceInfo.getBuildNumber()),
    ]);
    if (typeof version === 'string' && version.length > 0) {
      cachedVersion = version;
    }
    if (typeof build === 'string' && build.length > 0) {
      cachedBuildNumber = build;
    }
    initialized = true;
  } catch (e) {
    // Non-fatal: leave cache null, UI renders an em-dash for unknown.
    console.warn('[appVersion] init failed:', e);
  }
}

/** Synchronous read of cached versionName (e.g. "0.3.3"). null until init. */
export function getCachedAppVersion(): string | null {
  return cachedVersion;
}

/** Synchronous read of cached versionCode (e.g. "30300"). null until init. */
export function getCachedAppBuildNumber(): string | null {
  return cachedBuildNumber;
}
