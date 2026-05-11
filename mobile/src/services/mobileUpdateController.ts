import {useAppStore} from '../store/useAppStore';
import {
  fetchLatestMobileRelease,
  GithubReleasesNetworkError,
  GithubReleasesParseError,
  type AppReleaseInfo,
} from './githubReleases';
import {
  downloadAppApk,
  fetchAppExpectedSha256,
  computeAndVerifyAppSha256,
  cleanupOldApks,
  IntegrityError,
} from './mobileAppDownload';

// ---------------------------------------------------------------------------
// Phase 3 of mobile self-update — detection-only controller.
//
// Mirrors otaController.checkForChargerUpdate but for the running app itself.
// Thin glue layer over fetchLatestMobileRelease: pushes results into the store
// and never throws. Callsites:
//   - App mount (App.tsx) — fire-and-forget, non-forced
//   - Settings "Check for updates" button — forced, awaitable
//
// `force` skips the 1-hour TTL but still benefits from ETag — a 304 returns
// the cached entry without burning rate limit.
//
// What this DOES NOT do (deliberately): no download, no install, no progress
// reporting. Phase 4 will add APK download + SHA256 verification; Phase 5
// will hand off the verified APK to PackageManager.
// ---------------------------------------------------------------------------

export interface CheckForAppUpdateResult {
  ok: boolean;
  /** Whether a release was returned at all (cached or fresh). */
  hasRelease: boolean;
  /** Set when `ok === false`. Suitable for showing in an Alert. */
  errorMessage?: string;
  /** True if `force` was set and the response was a 304 — useful for callers
   *  that want to differentiate "we didn't actually hit GitHub" from a real
   *  fresh fetch. Currently unused by the UI but cheap to expose. */
  notModified?: boolean;
}

export async function checkForMobileUpdate(
  opts: {force?: boolean} = {},
): Promise<CheckForAppUpdateResult> {
  const store = useAppStore.getState();

  // Snapshot the cached etag/version so we can detect "did the response
  // change anything" after the call returns.
  const prevEtag = store.latestAppReleaseEtag;
  const prevVersion = store.latestAppReleaseVersion;

  store.setAppUpdateState('checking');
  store.setAppUpdateError(null);

  try {
    const release = await fetchLatestMobileRelease(opts);
    const checkedAt = Date.now();

    if (release) {
      store.setLatestAppRelease(
        {
          tag: release.tag,
          version: release.version,
          htmlUrl: release.htmlUrl,
          apkAssetUrl: release.apkAssetUrl,
          apkAssetSize: release.apkAssetSize,
          sha256AssetUrl: release.sha256AssetUrl,
          etag: release.etag,
        },
        checkedAt,
      );
    } else {
      // No eligible release found. Don't wipe the cached entry on every miss
      // — only clear if we previously had something (which would mean the
      // release was deleted upstream).
      if (prevVersion !== null) {
        store.setLatestAppRelease(null, checkedAt);
      } else {
        store.touchLatestAppReleaseCheckedAt(checkedAt);
      }
    }

    store.setAppUpdateState('idle');
    return {
      ok: true,
      hasRelease: release !== null,
      notModified:
        opts.force === true &&
        prevEtag !== null &&
        release !== null &&
        release.etag === prevEtag,
    };
  } catch (e: any) {
    const checkedAt = Date.now();
    let message: string;
    if (e instanceof GithubReleasesNetworkError) {
      message =
        e.status === 0
          ? 'No network — could not reach GitHub.'
          : `GitHub error ${e.status}.`;
    } else if (e instanceof GithubReleasesParseError) {
      message = 'Could not read GitHub response.';
    } else {
      message = e?.message ?? 'Update check failed.';
    }
    store.setAppUpdateState('error');
    store.setAppUpdateError(message);
    // Update the timestamp so "Last checked" reflects when we tried, even on
    // failure. Cached release fields are NOT touched — last-known good wins.
    store.touchLatestAppReleaseCheckedAt(checkedAt);
    return {ok: false, hasRelease: false, errorMessage: message};
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — download + verify orchestration for the mobile self-update.
//
// Mirrors `otaController.prepareOtaPayload` shape but for the APK:
//   1. Sets appUpdateState = 'downloading', resets progress
//   2. Downloads APK to CacheDir + fetches sha256 sibling asset
//   3. Sets appUpdateState = 'verifying'
//   4. Streams the APK through SHA256, compares to expected
//   5. On match: stores the local path in a module-level slot, sets 'ready'
//      On mismatch (IntegrityError): sets 'error' with a human message
//      On user-cancel: returns to 'idle' silently
//      On any other failure: 'error' with a mapped message
//
// The verified APK path is exposed via `getReadyAppApkPath()` — Phase 5's
// `installApk()` is the only intended consumer.
// ---------------------------------------------------------------------------

// Module-level slot for the verified APK's on-disk path. Unlike the charger
// flow (which stashes Uint8Array bytes), here we keep a string. The file
// remains in CacheDir until install completes, the app is killed, or
// `cleanupOldApks` runs at next launch.
let readyAppApkPath: string | null = null;

// Verified sha256 hex of the ready APK. UI may show first 8 chars as
// reassurance ("verified sha=ab12cd34"). Cleared in lockstep with the path.
let readyAppApkSha256Hex: string | null = null;

// AbortController for the in-flight prepare run. `cancelAppUpdatePreparation`
// signals abort here; both `downloadAppApk` and `verifyAppApkSha256` honor it
// at chunk boundaries.
let activeAppAbortController: AbortController | null = null;

/**
 * Returns the verified APK path if `appUpdateState === 'ready'`, else null.
 * Phase 5's `installApk()` is the only intended consumer.
 */
export function getReadyAppApkPath(): string | null {
  return readyAppApkPath;
}

/**
 * Hex SHA256 of the APK currently in 'ready' state, or null when no payload
 * has been prepared yet. Useful for UI reassurance lines.
 */
export function getReadyAppApkSha256(): string | null {
  return readyAppApkSha256Hex;
}

/**
 * Cancels an in-flight `prepareAppPayload` if one is active. No-op otherwise.
 * Safe to call from UI handlers — the controller will return state to 'idle'
 * if it was mid-download/verify.
 */
export function cancelAppUpdatePreparation(): void {
  activeAppAbortController?.abort();
}

/**
 * Maps a thrown error during APK download/verify into a human-readable string.
 * Mirrors `otaController.downloadErrorMessage` so the UI can use the same
 * language for both flows.
 */
function appDownloadErrorMessage(e: unknown): string {
  if (e instanceof IntegrityError) {
    return 'Verification failed: hash mismatch';
  }
  const name = (e as any)?.name;
  const status = (e as any)?.status;
  if (name === 'AbortError') {
    return 'Cancelled.';
  }
  if (typeof status === 'number') {
    if (status === 404) {
      return 'Release asset not found';
    }
    return `Server error: ${status}`;
  }
  if (name === 'TypeError' || e instanceof TypeError) {
    return "No network — couldn't reach GitHub.";
  }
  return "No network — couldn't reach GitHub.";
}

/**
 * Downloads the latest mobile-v* release APK, fetches its expected SHA256,
 * verifies (streamed — never loads the whole APK into JS memory), and stashes
 * the on-disk path for Phase 5 to consume via `getReadyAppApkPath()`.
 *
 * State transitions (in order on success):
 *   idle/error → 'downloading' → 'verifying' → 'ready'
 *
 * On failure: → 'error' with `appUpdateError` set to a sanitized message.
 *
 * Throws nothing — all errors land in the store.
 */
export async function prepareAppPayload(): Promise<void> {
  const store = useAppStore.getState();

  // Build a minimal release ref from the store. The store doesn't keep a
  // typed `AppReleaseInfo`; reconstruct one with just the fields the
  // downloader needs.
  if (
    !store.latestAppReleaseAssetUrl ||
    !store.latestAppReleaseSha256Url ||
    !store.latestAppReleaseVersion ||
    store.latestAppReleaseSize === null
  ) {
    store.setAppUpdateState('error');
    store.setAppUpdateError('No release information available.');
    return;
  }
  const release: AppReleaseInfo = {
    tag: store.latestAppReleaseTag ?? '',
    version: store.latestAppReleaseVersion,
    htmlUrl: store.latestAppReleaseUrl ?? '',
    apkAssetUrl: store.latestAppReleaseAssetUrl,
    apkAssetSize: store.latestAppReleaseSize,
    sha256AssetUrl: store.latestAppReleaseSha256Url,
    releaseNotes: '',
    publishedAt: '',
    etag: store.latestAppReleaseEtag,
  };

  // Cancel any prior run before starting a new one.
  activeAppAbortController?.abort();
  const abortController = new AbortController();
  activeAppAbortController = abortController;

  // Drop any previously-ready path. The file itself will be cleaned up either
  // by the cleanup pass at next launch OR by being overwritten if the same
  // version is re-downloaded (blob-util.config({overwrite: true})).
  readyAppApkPath = null;
  readyAppApkSha256Hex = null;

  store.setAppUpdateError(null);
  store.setAppUpdateState('downloading');
  store.setAppUpdateProgress(0, 0, release.apkAssetSize);

  let localPath: string;
  let expectedHex: string;
  try {
    // Sequential: APK first (the long part), then the small .sha256 sidecar.
    localPath = await downloadAppApk(release, {
      signal: abortController.signal,
      onProgress: (received, total) => {
        if (activeAppAbortController !== abortController) {
          return;
        }
        const s = useAppStore.getState();
        // If `total` is 0/unknown, leave it null so the UI suppresses the
        // bytes line and shows only the indeterminate phase label.
        s.setAppUpdateProgress(
          total > 0 ? Math.min(received / total, 1) : 0,
          received,
          total > 0 ? total : null,
        );
      },
    });

    expectedHex = await fetchAppExpectedSha256(release);
  } catch (e) {
    if (activeAppAbortController !== abortController) {
      return;
    }
    activeAppAbortController = null;
    if ((e as any)?.name === 'AbortError') {
      const s = useAppStore.getState();
      s.setAppUpdateState('idle');
      s.setAppUpdateError(null);
      s.resetAppUpdateProgress();
      return;
    }
    const s = useAppStore.getState();
    s.setAppUpdateState('error');
    s.setAppUpdateError(appDownloadErrorMessage(e));
    s.resetAppUpdateProgress();
    return;
  }

  // Race guard between download finish and a newer prepareAppPayload call.
  if (activeAppAbortController !== abortController) {
    return;
  }

  // → verifying
  const verifyStore = useAppStore.getState();
  verifyStore.setAppUpdateState('verifying');
  // Verify is fast enough on a phone CPU that we don't bother streaming
  // intermediate progress — flip the bar to 100% so the user sees the
  // "Verifying…" label without a separate progress source.
  verifyStore.setAppUpdateProgress(1, null, null);

  let computedHex: string;
  try {
    computedHex = await computeAndVerifyAppSha256(localPath, expectedHex, {
      signal: abortController.signal,
    });
  } catch (e) {
    if (activeAppAbortController !== abortController) {
      return;
    }
    activeAppAbortController = null;
    if ((e as any)?.name === 'AbortError') {
      const s = useAppStore.getState();
      s.setAppUpdateState('idle');
      s.setAppUpdateError(null);
      s.resetAppUpdateProgress();
      return;
    }
    const s = useAppStore.getState();
    s.setAppUpdateState('error');
    s.setAppUpdateError(appDownloadErrorMessage(e));
    s.resetAppUpdateProgress();
    return;
  }

  if (activeAppAbortController !== abortController) {
    return;
  }
  readyAppApkPath = localPath;
  readyAppApkSha256Hex = computedHex;
  activeAppAbortController = null;
  const readyStore = useAppStore.getState();
  readyStore.setAppUpdateState('ready');
  readyStore.setAppUpdateError(null);
  // Clean up any older APKs that happen to be lingering — but keep the one
  // we just prepared. Fire-and-forget; failures only log.
  cleanupOldApks(localPath).catch(() => {});
}
