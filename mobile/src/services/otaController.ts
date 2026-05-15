import {useAppStore, OtaTarget} from '../store/useAppStore';
import {
  fetchLatestChargerRelease,
  fetchLatestDialRelease,
  fetchLatestControllerRelease,
  GithubReleasesNetworkError,
  GithubReleasesParseError,
  ReleaseInfo,
} from './githubReleases';
import {
  downloadFirmware,
  fetchExpectedSha256,
  computeAndVerifySha256,
  IntegrityError,
} from './firmwareDownload';

// ---------------------------------------------------------------------------
// Thin glue layer — calls the per-target release fetcher, pushes results
// into the store, never throws. Callsites:
//   - App mount (fire-and-forget, non-forced)
//   - Charger connected effect (fire-and-forget, non-forced)
//   - Settings "Check for updates" button (forced, awaitable for the toast)
//
// `force` skips the 1-hour TTL but still benefits from ETag — a 304 returns
// the cached entry without burning rate limit.
//
// Stream 4 refactor (2026-05-12):
// Every entry point now takes an `OtaTarget`. `checkForChargerUpdate` /
// `prepareOtaPayload` / etc. become thin wrappers around the parameterised
// functions so existing call sites keep working with no behavioural change.
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

/** Dispatch the right fetcher per target. */
function fetchReleaseForTarget(
  target: OtaTarget,
  opts: {force?: boolean},
): Promise<ReleaseInfo | null> {
  switch (target) {
    case 'charger':
      return fetchLatestChargerRelease(opts);
    case 'dial':
      return fetchLatestDialRelease(opts);
    case 'controller':
      return fetchLatestControllerRelease(opts);
  }
}

export async function checkForUpdate(
  target: OtaTarget,
  opts: {force?: boolean} = {},
): Promise<CheckForUpdatesResult> {
  const store = useAppStore.getState();

  // Snapshot the cached etag/version so we can detect "did the response
  // change anything" after the call returns.
  const prevEtag = store.ota[target].latestRelease.etag;
  const prevVersion = store.ota[target].latestRelease.version;

  store.setOtaState(target, 'checking');
  store.setOtaError(target, null);

  try {
    const release = await fetchReleaseForTarget(target, opts);
    const checkedAt = Date.now();

    if (release) {
      // Push every field into the store so the banner / UpdateScreen can
      // render without re-fetching. setLatestRelease handles both populated
      // and null cases.
      store.setLatestRelease(
        target,
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
        store.setLatestRelease(target, null, checkedAt);
      } else {
        store.touchLatestReleaseCheckedAt(target, checkedAt);
      }
    }

    store.setOtaState(target, 'idle');
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
    store.setOtaState(target, 'error');
    store.setOtaError(target, message);
    // Update the timestamp so "Last checked" reflects when we tried, even on
    // failure. Cached release fields are NOT touched — last-known good wins.
    store.touchLatestReleaseCheckedAt(target, checkedAt);
    return {ok: false, hasRelease: false, errorMessage: message};
  }
}

/**
 * Backwards-compat wrapper — every existing call site (AppNavigator,
 * SettingsScreen, …) still says `checkForChargerUpdate()` rather than
 * `checkForUpdate('charger')`. Behaviour is byte-identical.
 */
export function checkForChargerUpdate(
  opts: {force?: boolean} = {},
): Promise<CheckForUpdatesResult> {
  return checkForUpdate('charger', opts);
}

// ---------------------------------------------------------------------------
// Download + verify orchestration — per-target.
// ---------------------------------------------------------------------------

// Per-target module-level stash. INTENTIONALLY not in Zustand:
// (1) Uint8Array doesn't survive zustand's structural cloning cleanly,
// (2) we never want this to persist (a stale 600 KB blob in AsyncStorage is
// worse than re-downloading), (3) the BLE OTA writer reads this directly via
// `getReadyOtaBytes(target)` — the only sanctioned consumer. Lifetime is
// until the next `prepareOtaPayload(target)` call or until the JS context
// dies.
//
// Keyed by target so charger / dial / controller can each have their own
// verified blob in memory without trampling each other.
const readyOtaBytes: Record<OtaTarget, Uint8Array | null> = {
  charger: null,
  dial: null,
  controller: null,
};

// Per-target hex of the verified hash, used by the UI to show
// "verified sha=<first8>" reassurance when ota[target].state === 'ready'.
const readyOtaSha256Hex: Record<OtaTarget, string | null> = {
  charger: null,
  dial: null,
  controller: null,
};

// Per-target AbortController for the in-flight download. UI's "Cancel"
// button calls `cancelOtaPreparation(target)` which signals abort here.
const activeAbortControllers: Record<OtaTarget, AbortController | null> = {
  charger: null,
  dial: null,
  controller: null,
};

/**
 * Returns the verified firmware bytes if `ota[target].state === 'ready'`,
 * else null. The BLE OTA writer is the only intended consumer. Bytes are
 * NOT persisted anywhere — this is the single source of truth and lives
 * only in the JS heap.
 */
export function getReadyOtaBytes(target: OtaTarget = 'charger'): Uint8Array | null {
  return readyOtaBytes[target];
}

/**
 * Hex sha256 of the bytes returned by `getReadyOtaBytes(target)`, or null
 * when no payload is ready. Useful for UI reassurance ("verified
 * sha=<first8>…").
 */
export function getReadyOtaSha256(target: OtaTarget = 'charger'): string | null {
  return readyOtaSha256Hex[target];
}

/**
 * Cancels an in-flight `prepareOtaPayload(target)` if one is active. No-op
 * otherwise. Safe to call from UI handlers.
 */
export function cancelOtaPreparation(target: OtaTarget = 'charger'): void {
  activeAbortControllers[target]?.abort();
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
 * Downloads the latest firmware .bin for `target`, fetches its expected
 * SHA256, verifies, and stashes the bytes for the BLE OTA writer to
 * consume via `getReadyOtaBytes(target)`.
 *
 * State transitions (in order on success):
 *   idle/error → 'downloading' → 'verifying' → 'ready'
 *
 * On failure: → 'error' with `ota[target].error` set to a sanitized message.
 *
 * Throws nothing — all errors land in the store.
 */
export async function prepareOtaPayload(target: OtaTarget = 'charger'): Promise<void> {
  const store = useAppStore.getState();
  const cachedRelease = store.ota[target].latestRelease;
  const release = {
    binAssetUrl: cachedRelease.binAssetUrl,
    binAssetSize: cachedRelease.binAssetSize,
    sha256AssetUrl: cachedRelease.sha256AssetUrl,
  };

  if (
    !release.binAssetUrl ||
    !release.sha256AssetUrl ||
    release.binAssetSize === null
  ) {
    store.setOtaState(target, 'error');
    store.setOtaError(target, 'No release information available.');
    return;
  }

  // Cancel any prior run for THIS target before starting a new one.
  activeAbortControllers[target]?.abort();
  const abortController = new AbortController();
  activeAbortControllers[target] = abortController;

  // Drop any previously-ready bytes + their hash for THIS target. They're
  // stale the moment we kick off a new download.
  readyOtaBytes[target] = null;
  readyOtaSha256Hex[target] = null;

  store.setOtaError(target, null);
  store.setOtaState(target, 'downloading');
  store.setOtaProgress(target, 0, 0, release.binAssetSize);

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
          // Only update if we're still the active run for this target —
          // guards against a late progress callback from a cancelled run
          // racing with a fresh one. (AbortController already short-circuits
          // fetch, but the streaming reader's chunks may still emit briefly.)
          if (activeAbortControllers[target] !== abortController) {
            return;
          }
          useAppStore.getState().setOtaProgress(target, frac, received, total);
        },
      },
    );

    expectedHex = await fetchExpectedSha256({
      sha256AssetUrl: release.sha256AssetUrl,
    });
  } catch (e) {
    // Only mutate state if we're still the active run for this target. A
    // user-initiated cancel from `cancelOtaPreparation(target)` already
    // reset state to idle, and a fresh prepareOtaPayload(target) has its
    // own state transitions.
    if (activeAbortControllers[target] !== abortController) {
      return;
    }
    activeAbortControllers[target] = null;
    if ((e as any)?.name === 'AbortError') {
      // Cancelled by the user — return to idle, don't surface an error.
      const s = useAppStore.getState();
      s.setOtaState(target, 'idle');
      s.setOtaError(target, null);
      s.resetOtaProgress(target);
      return;
    }
    const s = useAppStore.getState();
    s.setOtaState(target, 'error');
    s.setOtaError(target, downloadErrorMessage(e));
    s.resetOtaProgress(target);
    return;
  }

  // Race guard between download finish and a newer prepareOtaPayload call.
  if (activeAbortControllers[target] !== abortController) {
    return;
  }

  // → verifying
  const verifyStore = useAppStore.getState();
  verifyStore.setOtaState(target, 'verifying');
  verifyStore.setOtaProgress(target, 1, bytes.byteLength, bytes.byteLength);

  let computedHex: string;
  try {
    computedHex = computeAndVerifySha256(bytes, expectedHex);
  } catch (e) {
    if (activeAbortControllers[target] !== abortController) {
      return;
    }
    activeAbortControllers[target] = null;
    const s = useAppStore.getState();
    s.setOtaState(target, 'error');
    s.setOtaError(target, downloadErrorMessage(e));
    return;
  }

  // → ready
  if (activeAbortControllers[target] !== abortController) {
    return;
  }
  readyOtaBytes[target] = bytes;
  readyOtaSha256Hex[target] = computedHex;
  activeAbortControllers[target] = null;
  const readyStore = useAppStore.getState();
  readyStore.setOtaState(target, 'ready');
  readyStore.setOtaError(target, null);
}
