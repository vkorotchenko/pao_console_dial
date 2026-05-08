import {sha256} from 'js-sha256';

// ---------------------------------------------------------------------------
// Phase 4 — pure download + integrity verification.
//
// No file system writes (bytes live in memory only). No BLE writes. The bytes
// returned here are consumed by `otaController.prepareOtaPayload`, which
// stashes them in a module-level variable for Phase 5 to pick up.
//
// Streaming-vs-arrayBuffer decision
// ---------------------------------
// RN's `fetch` runs on Hermes via `react-native/Libraries/Network/fetch.js`.
// In practice the response body is fully buffered before resolving on most
// platform/version combinations — `Response.body.getReader()` is available
// in some toolchains but isn't reliably present in production RN builds
// (Hermes vs. JSC, iOS vs. Android, RN version, polyfills, all vary).
//
// For a ~600 KB charger firmware artifact, the simplicity-vs-progress-fidelity
// tradeoff strongly favours `arrayBuffer()` with synthetic 0 → 1 progress at
// the phase boundary. We feature-detect `getReader` and use it when present
// (fall back to `arrayBuffer` otherwise). Smooth UX > perfect progress
// reporting at this scale.
// ---------------------------------------------------------------------------

const USER_AGENT = 'pao-console/0.1.0';

/**
 * Thrown when the computed SHA256 doesn't match the expected hash. The message
 * embeds both digests for debugging — this isn't an auth boundary, just an
 * integrity check, so leaking the hashes is fine.
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

interface ReleaseRefForBin {
  binAssetUrl: string;
  binAssetSize: number;
}
interface ReleaseRefForSha {
  sha256AssetUrl: string;
}

export interface DownloadFirmwareOpts {
  signal?: AbortSignal;
  onProgress?: (
    frac: number,
    bytesReceived: number,
    totalBytes: number,
  ) => void;
}

/**
 * Fetches the firmware `.bin` asset and returns the raw bytes.
 *
 * Behaviour:
 *  - Sends `User-Agent` + `Accept: application/octet-stream`.
 *  - Honours `opts.signal` for cancellation (passed through to `fetch`).
 *  - Reports progress via `opts.onProgress(frac, bytesReceived, totalBytes)`.
 *    `frac` is in [0, 1]. When streaming isn't available, emits one-shot
 *    `(0, 0, total)` at start and `(1, total, total)` on completion.
 *
 * Total byte count comes from the Content-Length header when present, else
 * `release.binAssetSize` from the release metadata, else 0 (in which case
 * `frac` is reported as 0 throughout the streaming path and 1 at completion).
 */
export async function downloadFirmware(
  release: ReleaseRefForBin,
  opts: DownloadFirmwareOpts = {},
): Promise<Uint8Array> {
  const {signal, onProgress} = opts;

  const response = await fetch(release.binAssetUrl, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/octet-stream',
    },
    signal,
  });

  if (!response.ok) {
    // Caller turns these into user-facing strings — leave the raw shape here.
    const err: any = new Error(
      `Firmware download failed: ${response.status} ${response.statusText}`,
    );
    err.status = response.status;
    throw err;
  }

  // Determine total. Content-Length is preferred (authoritative for *this*
  // response after redirects) but isn't always set on RN; fall back to the
  // release metadata size we already have.
  const contentLengthHeader = response.headers.get('Content-Length');
  const total =
    (contentLengthHeader ? parseInt(contentLengthHeader, 10) : NaN) ||
    release.binAssetSize ||
    0;

  // Best-effort streaming via Response.body.getReader(). Feature-detect at
  // runtime — many RN builds don't expose a usable streaming body.
  const body: any = (response as any).body;
  if (body && typeof body.getReader === 'function') {
    try {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      onProgress?.(0, 0, total);

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const {value, done} = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          // value is a Uint8Array
          chunks.push(value as Uint8Array);
          received += (value as Uint8Array).byteLength;
          if (total > 0) {
            const frac = Math.min(received / total, 1);
            onProgress?.(frac, received, total);
          } else {
            onProgress?.(0, received, 0);
          }
        }
      }

      // Concat into a single Uint8Array.
      const out = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
      }
      onProgress?.(1, received, total || received);
      return out;
    } catch (e) {
      // If the streaming path fails mid-read for a reason other than abort,
      // fall through to the arrayBuffer path (rare in practice). Aborts
      // re-throw — let the caller handle them.
      if ((e as any)?.name === 'AbortError') {
        throw e;
      }
      // Reset progress and retry as a single-shot read.
      onProgress?.(0, 0, total);
    }
  }

  // Fallback path: single-shot arrayBuffer with synthetic 0 → 1 progress.
  onProgress?.(0, 0, total);
  const ab = await response.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const finalTotal = total || bytes.byteLength;
  onProgress?.(1, bytes.byteLength, finalTotal);
  return bytes;
}

/**
 * Fetches the `.sha256` asset and extracts the first 64-char hex digest.
 *
 * Tolerates real-world artifact files: leading BOM, trailing whitespace, CRLF
 * line endings, optional `*` binary indicator before the filename, etc. The
 * filename portion (after the digest) is informational only and is ignored.
 *
 * Returned digest is lowercase hex.
 */
export async function fetchExpectedSha256(
  release: ReleaseRefForSha,
): Promise<string> {
  const response = await fetch(release.sha256AssetUrl, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    const err: any = new Error(
      `Sha256 fetch failed: ${response.status} ${response.statusText}`,
    );
    err.status = response.status;
    throw err;
  }

  const raw = await response.text();
  // Find the first 64-character hex run anywhere in the body. Robust to BOM,
  // CRLF, leading whitespace, `*filename` style, etc.
  const match = /[0-9a-fA-F]{64}/.exec(raw);
  if (!match) {
    throw new Error('Sha256 asset did not contain a 64-char hex digest');
  }
  return match[0].toLowerCase();
}

/**
 * Computes sha256 of `bytes` and compares to `expectedHex` (case-insensitive).
 *
 * Not constant-time — this is integrity, not auth. A simple `===` is fine.
 */
export function verifySha256(bytes: Uint8Array, expectedHex: string): boolean {
  const computed = sha256(bytes).toLowerCase();
  const expected = expectedHex.toLowerCase();
  return computed === expected;
}

/**
 * Convenience wrapper used by the controller: throws IntegrityError on
 * mismatch, returns the lowercase computed hash on success.
 */
export function computeAndVerifySha256(
  bytes: Uint8Array,
  expectedHex: string,
): string {
  const computed = sha256(bytes).toLowerCase();
  const expected = expectedHex.toLowerCase();
  if (computed !== expected) {
    throw new IntegrityError(computed, expected);
  }
  return computed;
}
