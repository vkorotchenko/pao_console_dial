import {useAppStore} from '../store/useAppStore';
import {
  fetchLatestMobileRelease,
  GithubReleasesNetworkError,
  GithubReleasesParseError,
} from './githubReleases';

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
