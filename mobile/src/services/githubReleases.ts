import AsyncStorage from '@react-native-async-storage/async-storage';
import {compare, parse} from './semver';

// ---------------------------------------------------------------------------
// Generic GitHub Releases lookup.
//
// Phase 3 of mobile self-update generalized what used to be a charger-only
// fetcher into a parametric one. Each target (charger / mobile / peripheral
// /  controller) provides its own config — repo, tag-prefix regex, asset name
// pattern, cache key — and the shared machinery handles HTTP, ETag conditional
// GETs, AsyncStorage TTL caching, semver-sorted release selection, and asset
// resolution.
//
// Original charger contract (Phase 2 charger-release.yml):
//   - Tag shape:     charger-vMAJOR.MINOR.PATCH[-(rc|beta|alpha).N]
//   - Repo:          vkorotchenko/pao_charger
//   - Assets:        charger-firmware-<version>.bin
//                    charger-firmware-<version>.bin.sha256
//
// Mobile contract (Phase 2 mobile-release.yml):
//   - Tag shape:     mobile-vMAJOR.MINOR.PATCH[-(rc|beta|alpha).N]
//   - Repo:          vkorotchenko/pao_console_dial  (outer repo — not a submodule)
//   - Assets:        pao-console-mobile-<version>.apk
//                    pao-console-mobile-<version>.apk.sha256
//
// This module only DETECTS the latest release. No download, no flashing/install
// — those live in firmwareDownload / firmwareTransfer (charger) and Phase 4 / 5
// of the mobile self-update plan.
// ---------------------------------------------------------------------------

// User-Agent is REQUIRED by the GitHub API. Without it, requests return 403.
// The version string is hardcoded here to avoid a runtime require() of
// package.json — RN doesn't bundle that file by default and pulling it in
// adds risk for no real benefit.
const USER_AGENT = 'pao-console/0.1.0';

const TTL_MS = 60 * 60 * 1_000; // 1 hour

/**
 * Per-target fetch configuration. One instance per release source.
 *
 * `tagRegex` MUST capture: 1=major, 2=minor, 3=patch, 4=prerelease label
 * (optional), 5=prerelease number (optional). Group 4 is consulted to filter
 * out prerelease tags even when the GitHub `prerelease` flag is unset.
 *
 * `tagPrefix` is the literal string stripped off the tag to produce the bare
 * version string (e.g. "charger-v" → "0.1.0"). It must match the prefix the
 * regex enforces.
 *
 * `assetPattern` describes the two assets we expect in every release: a
 * primary payload (`.bin` for firmware, `.apk` for mobile) and a checksum
 * sidecar (`.bin.sha256` / `.apk.sha256`). Both are matched by suffix so we
 * tolerate small filename drift; the release workflows always upload the
 * canonical names.
 */
export interface ReleaseFetchConfig {
  /** GitHub repo in `owner/name` form. */
  repo: string;
  /** Strict semver regex matched against `tag_name`. */
  tagRegex: RegExp;
  /** Literal tag prefix to strip when producing the bare version. */
  tagPrefix: string;
  /** Asset filename suffixes to look for in the release. */
  assetPattern: {
    /** Primary payload suffix, e.g. ".bin" or ".apk". */
    primarySuffix: string;
    /** Checksum sidecar suffix, e.g. ".bin.sha256" or ".apk.sha256". */
    secondarySuffix: string;
  };
  /** AsyncStorage key for the cache entry. Bumping it invalidates old caches. */
  storageKey: string;
}

/**
 * Generic release info returned by `fetchLatestRelease`. Asset URLs are
 * neutral (primary / secondary) so callers can use this shape for charger
 * .bin/.sha256 or mobile .apk/.sha256 without renaming fields.
 *
 * The charger wrapper (`fetchLatestChargerRelease`) maps this back to its
 * legacy `binAssetUrl` / `sha256AssetUrl` field names to keep existing call
 * sites untouched.
 */
export interface GenericReleaseInfo {
  tag: string; // full tag including prefix, e.g. "charger-v0.1.0"
  version: string; // bare version with prefix stripped, e.g. "0.1.0"
  htmlUrl: string;
  primaryAssetUrl: string; // browser_download_url for .bin / .apk
  primaryAssetSize: number; // bytes
  secondaryAssetUrl: string; // browser_download_url for .bin.sha256 / .apk.sha256
  releaseNotes: string; // markdown body, may be empty
  publishedAt: string; // ISO 8601
  etag: string | null;
}

interface CachedEntry {
  fetchedAt: number;
  release: GenericReleaseInfo | null; // null = "no eligible release exists"
  etag: string | null;
}

// Typed errors so callers (e.g. SettingsScreen "Check for updates") can react
// differently to "GitHub is unreachable" vs "GitHub is fine, no release matches".
export class GithubReleasesNetworkError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GithubReleasesNetworkError';
  }
}
export class GithubReleasesParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubReleasesParseError';
  }
}

// Per-storage-key in-memory cache to avoid AsyncStorage round-trips on every
// render path. AsyncStorage remains the source of truth for cross-launch
// persistence. Keyed by `config.storageKey` so the charger and mobile fetchers
// don't trample each other's in-memory state.
const memCache: Map<string, CachedEntry | null> = new Map();

async function loadCache(storageKey: string): Promise<CachedEntry | null> {
  if (memCache.has(storageKey)) {
    return memCache.get(storageKey) ?? null;
  }
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedEntry;
    memCache.set(storageKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function saveCache(
  storageKey: string,
  entry: CachedEntry,
): Promise<void> {
  memCache.set(storageKey, entry);
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(entry));
  } catch {
    // Non-fatal — in-memory cache still works for this session.
  }
}

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string;
  prerelease: boolean;
  assets: GithubAsset[];
}

function pickLatestRelease(
  releases: GithubRelease[],
  config: ReleaseFetchConfig,
): {release: GithubRelease; tag: string; version: string} | null {
  // Filter: only tags matching the config's strict regex AND not flagged as
  // prereleases. Tag-encoded prerelease suffix (group 4) is also excluded —
  // GitHub's `prerelease` flag is independent of tag shape and we want both
  // signals to gate.
  const candidates: Array<{
    release: GithubRelease;
    tag: string;
    version: string;
  }> = [];

  for (const r of releases) {
    if (r.prerelease) {
      continue;
    }
    const m = config.tagRegex.exec(r.tag_name);
    if (!m) {
      continue;
    }
    if (m[4]) {
      continue;
    }
    const version = r.tag_name.slice(config.tagPrefix.length);
    if (!parse(version)) {
      // Belt-and-suspenders: if the strict regex matched but our parser
      // doesn't, skip it rather than crashing later.
      continue;
    }
    candidates.push({release: r, tag: r.tag_name, version});
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort descending by parsed semver. compare(a,b) === 1 means a > b.
  candidates.sort((a, b) => -compare(a.version, b.version));
  return candidates[0];
}

function buildReleaseInfo(
  picked: {release: GithubRelease; tag: string; version: string},
  etag: string | null,
  config: ReleaseFetchConfig,
): GenericReleaseInfo | null {
  const {release, tag, version} = picked;

  // Suffix match for both assets. The release workflows always upload the
  // canonical names, but matching by suffix tolerates incidental rename or
  // additional metadata in the filename.
  //
  // Order matters here: the sha256 sidecar name (".apk.sha256") ALSO ends with
  // ".apk"-something, so finding the primary by `endsWith(primarySuffix)`
  // alone would also match the sidecar on `.apk` vs `.apk.sha256`. Exclude
  // anything that matches the secondary suffix first, then match the primary.
  const secondary = release.assets.find(a =>
    a.name.endsWith(config.assetPattern.secondarySuffix),
  );
  const primary = release.assets.find(
    a =>
      a.name.endsWith(config.assetPattern.primarySuffix) &&
      !a.name.endsWith(config.assetPattern.secondarySuffix),
  );
  if (!primary || !secondary) {
    // The release exists but is missing required assets. Treat as "no
    // eligible release" rather than throwing — this is a content issue,
    // not a network issue.
    return null;
  }

  return {
    tag,
    version,
    htmlUrl: release.html_url,
    primaryAssetUrl: primary.browser_download_url,
    primaryAssetSize: primary.size,
    secondaryAssetUrl: secondary.browser_download_url,
    releaseNotes: release.body ?? '',
    publishedAt: release.published_at,
    etag,
  };
}

/**
 * Generic release fetcher. Honors a 1-hour TTL cache (per storageKey),
 * sends `If-None-Match` from the cached ETag, returns `null` when no eligible
 * release exists, and throws typed errors for transport / parse failures.
 *
 * Errors do NOT clear cached state — a transient outage shouldn't lose your
 * last-known-good banner.
 */
export async function fetchLatestRelease(
  config: ReleaseFetchConfig,
  opts: {force?: boolean} = {},
): Promise<GenericReleaseInfo | null> {
  const cached = await loadCache(config.storageKey);
  const now = Date.now();

  if (!opts.force && cached && now - cached.fetchedAt < TTL_MS) {
    return cached.release;
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const url = `https://api.github.com/repos/${config.repo}/releases?per_page=10`;

  let response: Response;
  try {
    response = await fetch(url, {method: 'GET', headers});
  } catch (e: any) {
    throw new GithubReleasesNetworkError(
      0,
      e?.message ?? 'Network request failed',
    );
  }

  if (response.status === 304) {
    // Body unchanged. Refresh fetchedAt so we don't keep hammering on 304s.
    if (cached) {
      const refreshed: CachedEntry = {
        ...cached,
        fetchedAt: now,
      };
      await saveCache(config.storageKey, refreshed);
      return refreshed.release;
    }
    // 304 without a cached body should be impossible — fall through and treat
    // it as "no eligible release" rather than crashing.
    return null;
  }

  if (!response.ok) {
    throw new GithubReleasesNetworkError(
      response.status,
      `GitHub releases fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const etag = response.headers.get('ETag');

  let json: GithubRelease[];
  try {
    json = (await response.json()) as GithubRelease[];
  } catch (e: any) {
    throw new GithubReleasesParseError(
      `GitHub releases JSON parse failed: ${e?.message ?? 'unknown'}`,
    );
  }
  if (!Array.isArray(json)) {
    throw new GithubReleasesParseError(
      'GitHub releases response was not an array',
    );
  }

  const picked = pickLatestRelease(json, config);
  const release = picked ? buildReleaseInfo(picked, etag, config) : null;

  await saveCache(config.storageKey, {
    fetchedAt: now,
    release,
    etag,
  });

  return release;
}

// ---------------------------------------------------------------------------
// Charger-specific wrapper. Preserved with the legacy `ReleaseInfo` shape
// (binAssetUrl / sha256AssetUrl) so existing callers in otaController.ts,
// otaOrchestrator.ts, useAppStore.ts etc. don't change.
// ---------------------------------------------------------------------------

// Strict tag regex — matches Phase 2's charger-release.yml workflow exactly.
//   charger-v0.1.0
//   charger-v0.1.0-rc.1
//   charger-v1.2.3-beta.5
const CHARGER_TAG_REGEX = /^charger-v(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;

// Charger releases live in the pao_charger submodule repo (relocated from
// pao_console_dial on 2026-05-11).
const CHARGER_RELEASES_REPO = 'vkorotchenko/pao_charger';

// Cache key was bumped to `...v2` when the release source moved to
// pao_charger. Old cache entries (v1 key) hold asset URLs that point at
// pao_console_dial and must not be served. Bumping the key forces a clean
// miss; the old key is left to age out.
const CHARGER_STORAGE_KEY = 'pao.gh.releases.charger.v2';

const CHARGER_CONFIG: ReleaseFetchConfig = {
  repo: CHARGER_RELEASES_REPO,
  tagRegex: CHARGER_TAG_REGEX,
  tagPrefix: 'charger-v',
  assetPattern: {
    primarySuffix: '.bin',
    secondarySuffix: '.bin.sha256',
  },
  storageKey: CHARGER_STORAGE_KEY,
};

/**
 * Legacy-shape ReleaseInfo for charger callers. Mirrors the pre-refactor
 * interface — binAssetUrl / sha256AssetUrl named as the charger code expects.
 */
export interface ReleaseInfo {
  tag: string;
  version: string;
  htmlUrl: string;
  binAssetUrl: string;
  binAssetSize: number;
  sha256AssetUrl: string;
  releaseNotes: string;
  publishedAt: string;
  etag: string | null;
}

/**
 * Fetch the newest non-prerelease `charger-v*` release. Thin wrapper over the
 * generic fetcher. Returns the legacy `ReleaseInfo` shape unchanged.
 */
export async function fetchLatestChargerRelease(
  opts: {force?: boolean} = {},
): Promise<ReleaseInfo | null> {
  const r = await fetchLatestRelease(CHARGER_CONFIG, opts);
  if (!r) {
    return null;
  }
  return {
    tag: r.tag,
    version: r.version,
    htmlUrl: r.htmlUrl,
    binAssetUrl: r.primaryAssetUrl,
    binAssetSize: r.primaryAssetSize,
    sha256AssetUrl: r.secondaryAssetUrl,
    releaseNotes: r.releaseNotes,
    publishedAt: r.publishedAt,
    etag: r.etag,
  };
}

// ---------------------------------------------------------------------------
// Mobile-specific wrapper. Used by Phase 3 of the mobile self-update plan to
// detect when a newer `mobile-v*` release exists. No download / install yet
// — Phase 4 will add APK download + verification, Phase 5 the actual install.
// ---------------------------------------------------------------------------

// Strict tag regex — matches Phase 2's mobile-release.yml workflow exactly.
//   mobile-v0.3.4
//   mobile-v1.0.0-rc.1
const MOBILE_TAG_REGEX = /^mobile-v(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;

// Mobile releases live in the OUTER pao_console_dial repo — the mobile app
// itself is not a submodule. Same workflow runs there.
const MOBILE_RELEASES_REPO = 'vkorotchenko/pao_console_dial';

const MOBILE_STORAGE_KEY = 'pao.gh.releases.mobile.v1';

const MOBILE_CONFIG: ReleaseFetchConfig = {
  repo: MOBILE_RELEASES_REPO,
  tagRegex: MOBILE_TAG_REGEX,
  tagPrefix: 'mobile-v',
  assetPattern: {
    // mobile-release.yml uploads `pao-console-mobile-X.Y.Z.apk` and
    // `pao-console-mobile-X.Y.Z.apk.sha256`. We only need the suffix match.
    primarySuffix: '.apk',
    secondarySuffix: '.apk.sha256',
  },
  storageKey: MOBILE_STORAGE_KEY,
};

/**
 * Mobile-shape AppReleaseInfo. Named after the mobile target so call sites
 * stay readable when both fetchers are imported together.
 */
export interface AppReleaseInfo {
  tag: string;
  version: string;
  htmlUrl: string;
  apkAssetUrl: string;
  apkAssetSize: number;
  sha256AssetUrl: string;
  releaseNotes: string;
  publishedAt: string;
  etag: string | null;
}

/**
 * Fetch the newest non-prerelease `mobile-v*` release.
 *
 * Detection-only. No download, no install — those land in Phase 4 / 5.
 */
export async function fetchLatestMobileRelease(
  opts: {force?: boolean} = {},
): Promise<AppReleaseInfo | null> {
  const r = await fetchLatestRelease(MOBILE_CONFIG, opts);
  if (!r) {
    return null;
  }
  return {
    tag: r.tag,
    version: r.version,
    htmlUrl: r.htmlUrl,
    apkAssetUrl: r.primaryAssetUrl,
    apkAssetSize: r.primaryAssetSize,
    sha256AssetUrl: r.secondaryAssetUrl,
    releaseNotes: r.releaseNotes,
    publishedAt: r.publishedAt,
    etag: r.etag,
  };
}

/**
 * For tests / future debugging. Clears both the in-memory and AsyncStorage
 * cache for ALL targets. Not currently called from the UI.
 */
export async function _clearReleasesCache(): Promise<void> {
  memCache.clear();
  try {
    await AsyncStorage.removeItem(CHARGER_STORAGE_KEY);
    await AsyncStorage.removeItem(MOBILE_STORAGE_KEY);
  } catch {}
}
