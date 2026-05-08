import AsyncStorage from '@react-native-async-storage/async-storage';
import {compare, parse} from './semver';

// ---------------------------------------------------------------------------
// GitHub Releases lookup for the charger firmware.
//
// Contract from Phase 2 (charger-release.yml):
//   - Tag shape:     charger-vMAJOR.MINOR.PATCH[-(rc|beta|alpha).N]
//   - Repo:          vkorotchenko/pao_console_dial (public)
//   - Asset names:   charger-firmware-<version>.bin
//                    charger-firmware-<version>.bin.sha256
//                    (no `v` prefix on the version inside the filename)
//
// This module only DETECTS the latest release. No download, no flashing.
// Phase 4 will add SHA256 + .bin download; Phase 5 will add OTA push.
// ---------------------------------------------------------------------------

// Strict tag regex — matches Phase 2's release workflow exactly.
//   charger-v0.1.0
//   charger-v0.1.0-rc.1
//   charger-v1.2.3-beta.5
// Anything that doesn't match is ignored (could be peripheral release, manual
// tag, dev push, etc.).
const TAG_REGEX = /^charger-v(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;

const RELEASES_URL =
  'https://api.github.com/repos/vkorotchenko/pao_console_dial/releases?per_page=10';

const STORAGE_KEY = 'pao.gh.releases.charger';
const TTL_MS = 60 * 60 * 1_000; // 1 hour

// User-Agent is REQUIRED by the GitHub API. Without it, requests return 403.
// The version string is hardcoded here to avoid a runtime require() of
// package.json — RN doesn't bundle that file by default and pulling it in
// adds risk for no real benefit.
const USER_AGENT = 'pao-console/0.1.0';

export interface ReleaseInfo {
  tag: string;
  version: string; // tag with `charger-v` stripped, e.g. "0.1.0"
  htmlUrl: string;
  binAssetUrl: string; // browser_download_url for the .bin
  binAssetSize: number; // bytes
  sha256AssetUrl: string; // browser_download_url for the .bin.sha256
  releaseNotes: string; // markdown body, may be empty
  publishedAt: string; // ISO 8601
  etag: string | null;
}

interface CachedEntry {
  fetchedAt: number;
  release: ReleaseInfo | null; // null = "no eligible release exists"
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

// In-memory cache to avoid round-tripping AsyncStorage on every render path.
// AsyncStorage remains the source of truth for cross-launch persistence.
let memCache: CachedEntry | null = null;

async function loadCache(): Promise<CachedEntry | null> {
  if (memCache) {
    return memCache;
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedEntry;
    memCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function saveCache(entry: CachedEntry): Promise<void> {
  memCache = entry;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
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
): {release: GithubRelease; tag: string; version: string} | null {
  // Filter: only `charger-v*` tags that match the strict regex AND are not
  // prereleases (Phase 6 may add a toggle to opt in).
  const candidates: Array<{
    release: GithubRelease;
    tag: string;
    version: string;
  }> = [];

  for (const r of releases) {
    if (r.prerelease) {
      continue;
    }
    const m = TAG_REGEX.exec(r.tag_name);
    if (!m) {
      continue;
    }
    // If the tag itself encodes a prerelease (group 4), exclude it too —
    // GitHub's `prerelease` flag is independent of tag shape, and we should
    // exclude both signals.
    if (m[4]) {
      continue;
    }
    const version = r.tag_name.slice('charger-v'.length);
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
): ReleaseInfo | null {
  const {release, tag, version} = picked;

  // Find .bin and .bin.sha256 in the assets list. Match by suffix so we
  // tolerate small filename drift, but the workflow always uploads the
  // canonical names.
  const bin = release.assets.find(a => a.name.endsWith('.bin'));
  const sha = release.assets.find(a => a.name.endsWith('.bin.sha256'));
  if (!bin || !sha) {
    // The release exists but is missing required assets. Treat as "no
    // eligible release" rather than throwing — this is a content issue,
    // not a network issue.
    return null;
  }

  return {
    tag,
    version,
    htmlUrl: release.html_url,
    binAssetUrl: bin.browser_download_url,
    binAssetSize: bin.size,
    sha256AssetUrl: sha.browser_download_url,
    releaseNotes: release.body ?? '',
    publishedAt: release.published_at,
    etag,
  };
}

/**
 * Fetch the newest non-prerelease `charger-v*` release.
 *
 * Behaviour:
 *  - Honors a 1-hour TTL cache (`force: true` skips it).
 *  - Sends `If-None-Match` from the cached ETag; on 304 returns the cached
 *    entry without consuming rate limit.
 *  - Returns `null` if no eligible release exists.
 *  - Throws `GithubReleasesNetworkError` for non-2xx (other than 304).
 *  - Throws `GithubReleasesParseError` if the JSON is unrecognisable.
 *
 * Errors do NOT clear cached state — a transient outage shouldn't lose your
 * last-known-good banner.
 */
export async function fetchLatestChargerRelease(
  opts: {force?: boolean} = {},
): Promise<ReleaseInfo | null> {
  const cached = await loadCache();
  const now = Date.now();

  if (
    !opts.force &&
    cached &&
    now - cached.fetchedAt < TTL_MS
  ) {
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

  let response: Response;
  try {
    response = await fetch(RELEASES_URL, {method: 'GET', headers});
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
      await saveCache(refreshed);
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

  const picked = pickLatestRelease(json);
  const release = picked ? buildReleaseInfo(picked, etag) : null;

  await saveCache({
    fetchedAt: now,
    release,
    etag,
  });

  return release;
}

/**
 * For tests / future debugging. Clears both the in-memory and AsyncStorage
 * cache. Not currently called from the UI.
 */
export async function _clearReleasesCache(): Promise<void> {
  memCache = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}
