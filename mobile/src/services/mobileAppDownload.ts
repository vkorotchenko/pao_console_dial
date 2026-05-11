import {sha256} from 'js-sha256';
import {Buffer} from 'buffer';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type {AppReleaseInfo} from './githubReleases';

// ---------------------------------------------------------------------------
// Phase 4 — mobile self-update: download + verify the APK.
//
// Differs from the charger flow (`firmwareDownload.ts`) in three places:
//
//  1. We write to DISK, not memory. The charger .bin is ~700 KB and could live
//     in a Uint8Array. The APK is ~30–50 MB; a midrange phone with low free
//     heap will OOM trying to hold that in JS. `react-native-blob-util.config`
//     streams response bytes directly to a file in CacheDir.
//
//  2. SHA256 is also computed in a STREAM (chunked reads via `fs.readStream`
//     in base64) using `sha256.create()`/`update()`/`hex()`. Reading the whole
//     file in one shot would defeat the point of writing to disk.
//
//  3. The returned value is a file PATH, not a byte buffer. Phase 5's install
//     intent (`installApk(path)`) consumes that path verbatim — it gets wrapped
//     in a FileProvider URI on the Kotlin side.
//
// File naming: `pao-console-mobile-<version>.apk` in CacheDir. The version is
// embedded so old leftover APKs can be deleted on next launch without us
// needing a separate marker file (see `cleanupOldApks` below).
// ---------------------------------------------------------------------------

const USER_AGENT = 'pao-console/0.1.0';

// 64 KB base64 chunks. After base64 decode this is ~48 KB of raw bytes — well
// under what Hermes can churn through per frame without UI hitching. Don't
// bump this much higher; the cost of each `Buffer.from(b64, 'base64')` call
// scales linearly with the chunk size.
const HASH_CHUNK_BUFFER_SIZE = 64 * 1024;

/**
 * Thrown when the streamed SHA256 doesn't match the expected hash. Mirrors
 * the charger flow's IntegrityError so callers can branch the same way.
 */
export class IntegrityError extends Error {
  constructor(
    public readonly computed: string,
    public readonly expected: string,
  ) {
    super(
      `Integrity check failed: computed sha256=${computed} did not match expected sha256=${expected}`,
    );
    this.name = 'IntegrityError';
  }
}

export interface AppDownloadOpts {
  /** Optional cancel signal. Honored at chunk boundaries during download
   *  (via the blob-util task's `.cancel()`) and during verify (we check
   *  `signal.aborted` between read chunks). */
  signal?: AbortSignal;
  /** Progress callback during the download. `total` may be 0 if the server
   *  didn't send Content-Length and we don't have a release size hint. */
  onProgress?: (received: number, total: number) => void;
}

/** Returns the APK filename for a given release version. Stable so the
 *  cleanup pass below can identify the most-recently-prepared file. */
function apkFileName(version: string): string {
  return `pao-console-mobile-${version}.apk`;
}

/** Resolves the cache-relative path where we stage the APK. The directory is
 *  guaranteed to be the app's private cache (visible to the FileProvider's
 *  `<cache-path>` mapping). */
function apkCachePath(version: string): string {
  return `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${apkFileName(version)}`;
}

/**
 * Downloads the APK to local cache and returns the on-disk path. Streams
 * directly to disk via blob-util's `config({path}).fetch(...)` — never holds
 * the full APK in JS memory.
 *
 * Throws on:
 *  - non-2xx HTTP status (the error carries `.status`)
 *  - network failure (TypeError-like)
 *  - user abort (AbortError-like — surfaces as the task being cancelled)
 *  - file write failure
 */
export async function downloadAppApk(
  release: AppReleaseInfo,
  opts: AppDownloadOpts = {},
): Promise<string> {
  const {signal, onProgress} = opts;
  const path = apkCachePath(release.version);

  // If a stale copy exists from a previous (potentially failed) run, remove
  // it. `overwrite: true` on the config below does the same thing, but being
  // explicit makes the failure modes easier to reason about.
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      await ReactNativeBlobUtil.fs.unlink(path);
    }
  } catch {
    // Non-fatal — fetch will overwrite anyway.
  }

  const task = ReactNativeBlobUtil.config({
    path,
    fileCache: true,
    overwrite: true,
    // Generous timeout. A slow LTE connection can take a couple minutes to
    // pull 30+ MB. The user can cancel via AbortSignal if they want sooner.
    timeout: 5 * 60_000,
  }).fetch('GET', release.apkAssetUrl, {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.android.package-archive',
  });

  // Wire abort → task.cancel(). blob-util's task is a StatefulPromise with
  // `.cancel()`; calling it surfaces as a rejected promise the caller catches.
  let abortListener: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) {
      task.cancel();
      // Throw a recognizable error so the upstream maps it to "cancelled".
      const err = new Error('Aborted');
      (err as any).name = 'AbortError';
      throw err;
    }
    abortListener = () => {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
    };
    signal.addEventListener('abort', abortListener);
  }

  // Progress callback. blob-util emits `(received, total)` as strings —
  // parse to ints and pass through. `count: 100` caps emission at ~1% steps.
  if (onProgress) {
    task.progress(
      {count: 100},
      (received: string | number, total: string | number) => {
        const r =
          typeof received === 'string' ? parseInt(received, 10) : received;
        const t = typeof total === 'string' ? parseInt(total, 10) : total;
        onProgress(
          Number.isFinite(r) ? r : 0,
          Number.isFinite(t) && t > 0 ? t : release.apkAssetSize ?? 0,
        );
      },
    );
  }

  let response;
  try {
    response = await task;
  } catch (e: any) {
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
    // blob-util surfaces cancellations as an Error with no consistent name;
    // promote to AbortError when our signal triggered.
    if (signal?.aborted) {
      const err = new Error('Aborted');
      (err as any).name = 'AbortError';
      throw err;
    }
    throw e;
  } finally {
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  }

  const status = response.info().status;
  if (status < 200 || status >= 300) {
    // Match the charger's shape: bare Error with `.status` attached.
    const err: any = new Error(`APK download failed: HTTP ${status}`);
    err.status = status;
    // Clean up the partial file — we don't want it lingering in the cache.
    try {
      await ReactNativeBlobUtil.fs.unlink(path);
    } catch {
      /* ignore */
    }
    throw err;
  }

  return response.path();
}

/**
 * Fetches the .apk.sha256 sidecar and extracts the 64-char hex digest.
 *
 * Same parsing tolerance as the charger flow's `fetchExpectedSha256`: any
 * 64-char hex run anywhere in the body wins. Lowercased on the way out so
 * the streaming-verify comparison is a straight string equality check.
 */
export async function fetchAppExpectedSha256(
  release: AppReleaseInfo,
): Promise<string> {
  const response = await fetch(release.sha256AssetUrl, {
    method: 'GET',
    headers: {'User-Agent': USER_AGENT},
  });

  if (!response.ok) {
    const err: any = new Error(
      `Sha256 fetch failed: ${response.status} ${response.statusText}`,
    );
    err.status = response.status;
    throw err;
  }

  const raw = await response.text();
  const match = /[0-9a-fA-F]{64}/.exec(raw);
  if (!match) {
    throw new Error('Sha256 asset did not contain a 64-char hex digest');
  }
  return match[0].toLowerCase();
}

/**
 * Streams the APK at `localPath` through a SHA256 hasher and compares the
 * result to `expectedHex`. Returns `true` on match, `false` on mismatch.
 *
 * Uses `fs.readStream(..., 'base64', BUFFER)`. Each chunk arrives as a base64
 * string; we decode through `Buffer.from(..., 'base64')` (already in the
 * project) and feed the resulting `Uint8Array` into `sha256.create().update()`.
 * The hasher's internal state is the only thing that scales with file size —
 * we never hold more than one chunk's worth of decoded bytes at a time.
 *
 * Honors `opts.signal` between chunks. On abort, the underlying stream is
 * closed by `closed = true` after the wrapping `await` resolves; we still
 * stop hashing immediately and throw an `AbortError`.
 */
export async function verifyAppApkSha256(
  localPath: string,
  expectedHex: string,
  opts: {signal?: AbortSignal} = {},
): Promise<boolean> {
  const expected = expectedHex.toLowerCase();
  const hasher = sha256.create();

  const stream = await ReactNativeBlobUtil.fs.readStream(
    localPath,
    'base64',
    HASH_CHUNK_BUFFER_SIZE,
  );

  // The stream's API is event-driven. Wrap in a Promise so the function shape
  // stays Promise<boolean>.
  return new Promise<boolean>((resolve, reject) => {
    let aborted = false;

    const abortListener = () => {
      aborted = true;
      try {
        // No public close() on the stream; setting `closed` short-circuits
        // emit loops in the native shim. Belt-and-suspenders — we'll also
        // ignore further onData callbacks via the `aborted` flag.
        (stream as any).closed = true;
      } catch {
        /* ignore */
      }
      const err = new Error('Aborted');
      (err as any).name = 'AbortError';
      reject(err);
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        return abortListener();
      }
      opts.signal.addEventListener('abort', abortListener);
    }

    stream.onData((chunk: string | number[]) => {
      if (aborted) return;
      // blob-util types `chunk` as `string | number[]`. For 'base64' encoding
      // it's always a string in practice, but defend against the array form
      // anyway — feeding Buffer.from() the wrong type would corrupt the hash.
      const b64 = typeof chunk === 'string' ? chunk : '';
      if (!b64) return;
      const bytes = Buffer.from(b64, 'base64');
      // sha256.update accepts Uint8Array / Buffer / array. Buffer is a
      // Uint8Array subclass in RN's polyfill so this is safe.
      hasher.update(bytes);
    });

    stream.onError((err: unknown) => {
      if (aborted) return;
      if (opts.signal) opts.signal.removeEventListener('abort', abortListener);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    stream.onEnd(() => {
      if (aborted) return;
      if (opts.signal) opts.signal.removeEventListener('abort', abortListener);
      const computed = hasher.hex().toLowerCase();
      resolve(computed === expected);
    });

    // Kick off emission. Required by the blob-util stream contract.
    stream.open();
  });
}

/**
 * Convenience wrapper used by the controller. Streams the file through the
 * hasher and throws `IntegrityError` on mismatch. Returns the lowercase
 * computed hash on success.
 */
export async function computeAndVerifyAppSha256(
  localPath: string,
  expectedHex: string,
  opts: {signal?: AbortSignal} = {},
): Promise<string> {
  const expected = expectedHex.toLowerCase();
  // Reuse the streaming hasher but capture the digest as we go. Easiest way
  // is to re-stream and let `verifyAppApkSha256` do the heavy lifting; the
  // file is already on disk so a re-read is cheap (single linear scan).
  //
  // Slight duplication of effort vs. computing once-and-comparing, but the
  // gain in shared-code-paths between `verify` and `computeAndVerify` is
  // worth it. If profiling ever shows this dominating, fold the two into a
  // single internal helper.
  const matched = await verifyAppApkSha256(localPath, expected, opts);
  if (!matched) {
    // The match check throws away the computed value, so re-run quickly to
    // surface it in the error. This path is rare (only on actual mismatch)
    // so the second pass is acceptable.
    const second = sha256.create();
    const stream = await ReactNativeBlobUtil.fs.readStream(
      localPath,
      'base64',
      HASH_CHUNK_BUFFER_SIZE,
    );
    const computed = await new Promise<string>((resolve, reject) => {
      stream.onData((chunk: string | number[]) => {
        const b64 = typeof chunk === 'string' ? chunk : '';
        if (b64) second.update(Buffer.from(b64, 'base64'));
      });
      stream.onError((err: unknown) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      );
      stream.onEnd(() => resolve(second.hex().toLowerCase()));
      stream.open();
    });
    throw new IntegrityError(computed, expected);
  }
  return expected;
}

/**
 * Deletes stale `pao-console-mobile-*.apk` files in the cache directory,
 * keeping the one at `keepPath` (if provided). Safe to call on launch — it
 * never throws, just logs warnings on individual failures. The cache dir is
 * eligible for system-driven eviction anyway; this is housekeeping, not a
 * correctness measure.
 */
export async function cleanupOldApks(keepPath: string | null = null): Promise<void> {
  try {
    const dir = ReactNativeBlobUtil.fs.dirs.CacheDir;
    const entries = await ReactNativeBlobUtil.fs.ls(dir);
    for (const name of entries) {
      if (!name.startsWith('pao-console-mobile-') || !name.endsWith('.apk')) {
        continue;
      }
      const full = `${dir}/${name}`;
      if (keepPath && full === keepPath) {
        continue;
      }
      try {
        await ReactNativeBlobUtil.fs.unlink(full);
      } catch (e) {
        console.warn('[mobileAppDownload] failed to unlink stale APK', full, e);
      }
    }
  } catch (e) {
    // Directory listing failed (permissions, etc) — non-fatal.
    console.warn('[mobileAppDownload] cleanup pass failed:', e);
  }
}
