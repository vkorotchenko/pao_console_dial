import {useAppStore} from '../store/useAppStore';
import {
  fetchLatestChargerRelease,
  GithubReleasesNetworkError,
  GithubReleasesParseError,
} from './githubReleases';
import {
  downloadFirmware,
  fetchExpectedSha256,
  computeAndVerifySha256,
  IntegrityError,
} from './firmwareDownload';

// ---------------------------------------------------------------------------
// Thin glue layer — calls the service, pushes results into the store, never
// throws. Callsites:
//   - App mount (fire-and-forget, non-forced)
//   - Charger connected effect (fire-and-forget, non-forced)
//   - Settings "Check for updates" button (forced, awaitable for the toast)
//
// `force` skips the 1-hour TTL but still benefits from ETag — a 304 returns
// the cached entry without burning rate limit.
// ---------------------------------------------------------------------------

export interface CheckForUpdatesResult {
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

export async function checkForChargerUpdate(
  opts: {force?: boolean} = {},
): Promise<CheckForUpdatesResult> {
  const store = useAppStore.getState();

  // Snapshot the cached etag/version so we can detect "did the response
  // change anything" after the call returns.
  const prevEtag = store.latestReleaseEtag;
  const prevVersion = store.latestReleaseVersion;

  store.setOtaState('checking');
  store.setOtaError(null);

  try {
    const release = await fetchLatestChargerRelease(opts);
    const checkedAt = Date.now();

    if (release) {
      // Push every field into the store so the banner / UpdateScreen can
      // render without re-fetching. setLatestRelease handles both populated
      // and null cases.
      store.setLatestRelease(
        {
          tag: release.tag,
          version: release.version,
          htmlUrl: release.htmlUrl,
          binAssetUrl: release.binAssetUrl,
          binAssetSize: release.binAssetSize,
          sha256AssetUrl: release.sha256AssetUrl,
          releaseNotes: release.releaseNotes,
          etag: release.etag,
        },
        checkedAt,
      );
    } else {
      // No eligible release found. Don't wipe the cached entry on every miss
      // — only clear if we previously had something (which would mean the
      // release was deleted upstream).
      if (prevVersion !== null) {
        store.setLatestRelease(null, checkedAt);
      } else {
        store.touchLatestReleaseCheckedAt(checkedAt);
      }
    }

    store.setOtaState('idle');
    return {
      ok: true,
      hasRelease: release !== null,
      // Heuristic: if we're forced AND the etag came back identical AND we
      // already had a version, the underlying request was almost certainly
      // a 304. Not perfect but doesn't require leaking transport details.
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
    store.setOtaState('error');
    store.setOtaError(message);
    // Update the timestamp so "Last checked" reflects when we tried, even on
    // failure. Cached release fields are NOT touched — last-known good wins.
    store.touchLatestReleaseCheckedAt(checkedAt);
    return {ok: false, hasRelease: false, errorMessage: message};
  }
}

// ---------------------------------------------------------------------------
// Download + verify orchestration.
// ---------------------------------------------------------------------------

// Module-level stash for the verified bytes. INTENTIONALLY not in Zustand:
// (1) Uint8Array doesn't survive zustand's structural cloning cleanly,
// (2) we never want this to persist (a stale 600 KB blob in AsyncStorage is
// worse than re-downloading), (3) the BLE OTA writer reads this directly via
// `getReadyOtaBytes()` — the only sanctioned consumer. Lifetime is until the
// next `prepareOtaPayload()` call or until the JS context dies.
let readyOtaBytes: Uint8Array | null = null;

// Module-level cache of the verified hash hex string. Used by the UI to show
// "verified sha=<first8>" reassurance when otaState === 'ready'. Not in
// Zustand because it's tied 1:1 to readyOtaBytes which also isn't there.
let readyOtaSha256Hex: string | null = null;

// AbortController for the in-flight download. UI's "Cancel" button calls
// `cancelOtaPreparation()` which signals abort here.
let activeAbortController: AbortController | null = null;

/**
 * Returns the verified firmware bytes if `otaState === 'ready'`, else null.
 * The BLE OTA writer is the only intended consumer. Bytes are NOT persisted
 * anywhere — this is the single source of truth and lives only in the JS heap.
 */
export function getReadyOtaBytes(): Uint8Array | null {
  return readyOtaBytes;
}

/**
 * Hex sha256 of the bytes returned by `getReadyOtaBytes()`, or null when
 * no payload is ready. Useful for UI reassurance ("verified sha=<first8>…").
 */
export function getReadyOtaSha256(): string | null {
  return readyOtaSha256Hex;
}

/**
 * Cancels an in-flight `prepareOtaPayload` if one is active. No-op otherwise.
 * Safe to call from UI handlers.
 */
export function cancelOtaPreparation(): void {
  activeAbortController?.abort();
}

/**
 * Maps a thrown error during download/verify into a human-friendly string.
 * Never leaks raw internals to the UI.
 */
function downloadErrorMessage(e: unknown): string {
  if (e instanceof IntegrityError) {
    return 'Verification failed: hash mismatch';
  }
  // AbortError surfaces from RN fetch as either DOMException-like or generic.
  // The TypeError path covers RN's "Network request failed" plumbing for
  // both no-network AND aborted requests on some RN versions.
  const name = (e as any)?.name;
  const status = (e as any)?.status;
  if (name === 'AbortError') {
    // Caller decides whether this is user-initiated cancel or network drop.
    return 'Cancelled.';
  }
  if (typeof status === 'number') {
    if (status === 404) {
      return 'Asset not found';
    }
    return `Server error: ${status}`;
  }
  // TypeError covers RN's generic network failure surface.
  if (name === 'TypeError' || e instanceof TypeError) {
    return "No network — couldn't reach GitHub.";
  }
  return "No network — couldn't reach GitHub.";
}

/**
 * Downloads the latest charger firmware .bin, fetches its expected SHA256,
 * verifies, and stashes the bytes for the BLE OTA writer to consume via
 * `getReadyOtaBytes()`.
 *
 * State transitions (in order on success):
 *   idle/error → 'downloading' → 'verifying' → 'ready'
 *
 * On failure: → 'error' with `otaError` set to a sanitized message.
 *
 * Throws nothing — all errors land in the store.
 */
export async function prepareOtaPayload(): Promise<void> {
  const store = useAppStore.getState();
  const release = {
    binAssetUrl: store.latestReleaseBinUrl,
    binAssetSize: store.latestReleaseSize,
    sha256AssetUrl: store.latestReleaseSha256Url,
  };

  if (
    !release.binAssetUrl ||
    !release.sha256AssetUrl ||
    release.binAssetSize === null
  ) {
    store.setOtaState('error');
    store.setOtaError('No release information available.');
    return;
  }

  // Cancel any prior run before starting a new one.
  activeAbortController?.abort();
  const abortController = new AbortController();
  activeAbortController = abortController;

  // Drop any previously-ready bytes + their hash. They're stale the moment
  // we kick off a new download.
  readyOtaBytes = null;
  readyOtaSha256Hex = null;

  store.setOtaError(null);
  store.setOtaState('downloading');
  store.setOtaProgress(0, 0, release.binAssetSize);

  let bytes: Uint8Array;
  let expectedHex: string;
  try {
    // Sequential is intentional. The .sha256 file is tiny (~80 bytes); doing
    // it after the .bin keeps the network footprint predictable and the
    // progress UX clean (download happens 0 → 1, then we flip to verifying).
    bytes = await downloadFirmware(
      {
        binAssetUrl: release.binAssetUrl,
        binAssetSize: release.binAssetSize,
      },
      {
        signal: abortController.signal,
        onProgress: (frac, received, total) => {
          // Only update if we're still the active run — guards against a
          // late progress callback from a cancelled run racing with a fresh
          // one. (AbortController already short-circuits fetch, but the
          // streaming reader's chunks may still emit briefly.)
          if (activeAbortController !== abortController) {
            return;
          }
          useAppStore.getState().setOtaProgress(frac, received, total);
        },
      },
    );

    expectedHex = await fetchExpectedSha256({
      sha256AssetUrl: release.sha256AssetUrl,
    });
  } catch (e) {
    // Only mutate state if we're still the active run. A user-initiated
    // cancel from `cancelOtaPreparation()` already reset state to idle, and
    // a fresh prepareOtaPayload() has its own state transitions.
    if (activeAbortController !== abortController) {
      return;
    }
    activeAbortController = null;
    if ((e as any)?.name === 'AbortError') {
      // Cancelled by the user — return to idle, don't surface an error.
      const s = useAppStore.getState();
      s.setOtaState('idle');
      s.setOtaError(null);
      s.resetOtaProgress();
      return;
    }
    const s = useAppStore.getState();
    s.setOtaState('error');
    s.setOtaError(downloadErrorMessage(e));
    s.resetOtaProgress();
    return;
  }

  // Race guard between download finish and a newer prepareOtaPayload call.
  if (activeAbortController !== abortController) {
    return;
  }

  // → verifying
  const verifyStore = useAppStore.getState();
  verifyStore.setOtaState('verifying');
  verifyStore.setOtaProgress(1, bytes.byteLength, bytes.byteLength);

  let computedHex: string;
  try {
    computedHex = computeAndVerifySha256(bytes, expectedHex);
  } catch (e) {
    if (activeAbortController !== abortController) {
      return;
    }
    activeAbortController = null;
    const s = useAppStore.getState();
    s.setOtaState('error');
    s.setOtaError(downloadErrorMessage(e));
    return;
  }

  // → ready
  if (activeAbortController !== abortController) {
    return;
  }
  readyOtaBytes = bytes;
  readyOtaSha256Hex = computedHex;
  activeAbortController = null;
  const readyStore = useAppStore.getState();
  readyStore.setOtaState('ready');
  readyStore.setOtaError(null);
}
