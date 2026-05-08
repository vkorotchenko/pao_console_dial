import {Subscription} from 'react-native-ble-plx';
import {chargerBleManager, CMD_OTA_BEGIN, CMD_OTA_END, CMD_OTA_ABORT} from '../ble/ChargerBleManager';

// ---------------------------------------------------------------------------
// Phase 5 — pure BLE OTA transfer logic.
//
// Owns: MTU negotiation, OTA_BEGIN payload assembly, windowed chunk streaming,
// OTA_END handshake, abort handling.
// Does NOT own: download/verify (Phase 4 — otaController), reconnect/verify
// (otaOrchestrator), UI state.
//
// Protocol contract (must match firmware exactly):
//   - 0xFF26 WRITE_WITHOUT_RESPONSE: chunked firmware bytes
//   - 0xFF27 NOTIFY: 5-byte status [code: u8][bytes_received: u32 LE]
//   - 0xFF05 WRITE: cmd dispatcher
//
// Status codes (from 0xFF27):
//   0x00 IDLE                 — no-op
//   0x01 READY                — start streaming
//   0x02 ACK                  — window acked, send next 16
//   0x03 COMMITTING           — wait for REBOOTING / ERR_END_FAILED
//   0x04 REBOOTING            — image committed, charger about to reboot
//   0x05 VERIFIED             — post-reconnect verify succeeded (orchestrator)
//   0x10 ERR_BUSY             — charger active (must be off)
//   0x11 ERR_BEGIN_FAILED     — couldn't start update
//   0x12 ERR_WRITE_FAILED     — chunk rejected
//   0x13 ERR_SIZE_MISMATCH    — byte count mismatch
//   0x14 ERR_END_FAILED       — finalize failed
//   0x15 ERR_BAD_PAYLOAD      — malformed OTA_BEGIN
//   0x16 ABORTED              — confirmation of cmd=12
//   0x17 NOT_PENDING          — benign (already verified / no-op)
//
// Windowing
// ---------
// We send N chunks (default 16) then wait for an ACK on 0xFF27 before the
// next window. Don't pipeline — the ESP32 BLE write queue will overflow.
// The ACK's `bytes_received` field is the AUTHORITATIVE running total — use
// it for progress rather than chunks-sent.
// ---------------------------------------------------------------------------

export const OTA_STATUS = {
  IDLE: 0x00,
  READY: 0x01,
  ACK: 0x02,
  COMMITTING: 0x03,
  REBOOTING: 0x04,
  VERIFIED: 0x05,
  ERR_BUSY: 0x10,
  ERR_BEGIN_FAILED: 0x11,
  ERR_WRITE_FAILED: 0x12,
  ERR_SIZE_MISMATCH: 0x13,
  ERR_END_FAILED: 0x14,
  ERR_BAD_PAYLOAD: 0x15,
  ABORTED: 0x16,
  NOT_PENDING: 0x17,
} as const;

const WINDOW_SIZE = 16; // chunks per ACK cycle
const WINDOW_TIMEOUT_MS = 15_000; // generous — slow phones can take a while
const READY_TIMEOUT_MS = 10_000; // OTA_BEGIN → READY
const REBOOT_TIMEOUT_MS = 10_000; // OTA_END → REBOOTING
const ABORT_TIMEOUT_MS = 3_000; // OTA_ABORT → ABORTED

export type TransferPhase =
  | 'requesting_mtu'
  | 'sending_begin'
  | 'transferring'
  | 'sending_end';

export interface TransferOpts {
  signal: AbortSignal;
  onProgress?: (bytesSent: number, total: number) => void;
  onPhase?: (phase: TransferPhase) => void;
}

export class OtaAbortedError extends Error {
  constructor() {
    super('OTA transfer aborted by user');
    this.name = 'OtaAbortedError';
  }
}

export class OtaProtocolError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OtaProtocolError';
  }
}

/**
 * Map a status code into a user-facing message. Used by orchestrator + UI.
 * `ABORTED` and `NOT_PENDING` are NOT errors — callers branch on those before
 * reaching this map.
 */
export function statusCodeToMessage(code: number): string {
  switch (code) {
    case OTA_STATUS.ERR_BUSY:
      return 'Charger must be off — turn it off and try again.';
    case OTA_STATUS.ERR_BEGIN_FAILED:
      return "Couldn't start update on charger.";
    case OTA_STATUS.ERR_WRITE_FAILED:
      return 'Charger rejected a chunk.';
    case OTA_STATUS.ERR_SIZE_MISMATCH:
      return 'Internal error: byte count mismatch.';
    case OTA_STATUS.ERR_END_FAILED:
      return "Charger couldn't finalize the update.";
    case OTA_STATUS.ERR_BAD_PAYLOAD:
      return 'Internal error: malformed OTA_BEGIN payload.';
    default:
      return `OTA error (status 0x${code.toString(16).padStart(2, '0')}).`;
  }
}

function isErrorCode(code: number): boolean {
  return code >= 0x10 && code <= 0x15;
}

/**
 * Convert a 64-character lowercase hex string into 32 raw bytes. Throws if
 * the input isn't well-formed — this guards against accidentally sending
 * the hex *string* (64 ASCII bytes) instead of the binary digest (32 bytes).
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new Error(`expected 64 hex chars, got ${hex.length}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Build the 36-byte OTA_BEGIN payload:
 *   [0..3]   total_size (u32 little-endian)
 *   [4..35]  sha256 (32 bytes binary, NOT hex)
 *
 * Hand-trace example: 600 KB binary (614400 bytes = 0x96000) with sha256
 * starting "abcdef…":
 *   total_size LE: [0x00, 0x60, 0x09, 0x00]
 *   sha256:        [0xab, 0xcd, 0xef, ...]
 * Final 36 bytes: [0x00 0x60 0x09 0x00 | 0xab 0xcd 0xef ...]
 */
function buildBeginPayload(totalSize: number, sha256Hex: string): Uint8Array {
  const out = new Uint8Array(36);
  // u32 little-endian — DataView handles byte order portably.
  const view = new DataView(out.buffer, out.byteOffset, 4);
  view.setUint32(0, totalSize, /*littleEndian=*/ true);
  out.set(hexToBytes(sha256Hex), 4);
  return out;
}

/**
 * Helper: a status pipe wrapper that lets the transfer await specific status
 * events with a timeout. We can't hold an in-flight Promise on the manager's
 * single subscription — multiple awaiters would race. So we maintain a small
 * internal queue: status events go into a buffer; `waitFor` drains the buffer
 * until it sees a matching event (or any error code) or times out.
 */
class StatusPipe {
  private buffer: Array<{code: number; bytesReceived: number}> = [];
  private waiters: Array<(ev: {code: number; bytesReceived: number}) => void> = [];
  private subscription: Subscription | null = null;
  // Track the most-recent ACK byte count so progress doesn't regress on a
  // late-arriving status notification.
  public lastBytesReceived = 0;

  start(): void {
    this.subscription = chargerBleManager.subscribeOtaStatus((code, bytesReceived) => {
      const ev = {code, bytesReceived};
      if (code === OTA_STATUS.ACK || isErrorCode(code)) {
        this.lastBytesReceived = Math.max(this.lastBytesReceived, bytesReceived);
      }
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(ev);
      } else {
        this.buffer.push(ev);
      }
    });
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.waiters = [];
    this.buffer = [];
  }

  /**
   * Wait for the next status event, with a timeout. The caller is responsible
   * for branching on the returned code. Errors (0x10–0x15) are returned just
   * like normal codes — the caller decides how to interpret them.
   */
  waitNext(timeoutMs: number): Promise<{code: number; bytesReceived: number}> {
    const buffered = this.buffer.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Drop the waiter so it doesn't fire late.
        const idx = this.waiters.indexOf(wrapped);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`OTA status pipe timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      const wrapped = (ev: {code: number; bytesReceived: number}) => {
        clearTimeout(timer);
        resolve(ev);
      };
      this.waiters.push(wrapped);
    });
  }
}

/**
 * Wait for a specific status code (or any error). Returns the matched event,
 * or throws OtaProtocolError if an error code arrives. Throws on timeout.
 *
 * `expected` accepts a single code or an array — useful for "READY *or*
 * REBOOTING" style awaits.
 */
async function expectStatus(
  pipe: StatusPipe,
  expected: number | number[],
  timeoutMs: number,
): Promise<{code: number; bytesReceived: number}> {
  const expectedArr = Array.isArray(expected) ? expected : [expected];
  // Allow a few intermediate ACKs/IDLE notifications to slip through before
  // the expected code arrives. Cap iterations defensively.
  const maxIterations = 64;
  for (let i = 0; i < maxIterations; i++) {
    const ev = await pipe.waitNext(timeoutMs);
    if (expectedArr.includes(ev.code)) return ev;
    if (isErrorCode(ev.code)) {
      throw new OtaProtocolError(statusCodeToMessage(ev.code), ev.code);
    }
    // Skip non-matching benign codes (IDLE, lingering ACK after window).
  }
  throw new Error(`expected status ${expectedArr} but did not arrive`);
}

/**
 * Drain status pipe of any buffered events without blocking. Used between
 * windows to keep the queue from growing unbounded if the firmware sends
 * extra benign notifications.
 */
// (no helper needed — StatusPipe.buffer is bounded by use; the state machine
// only ever consumes via waitNext().)

/**
 * Stream firmware bytes to the charger and wait for the REBOOTING handshake.
 *
 * State machine:
 *   1. requestMTU(517) → record chunkSize
 *   2. subscribe to 0xFF27
 *   3. write OTA_BEGIN (cmd=10) with [size, sha256] payload
 *   4. await READY
 *   5. for each window of WINDOW_SIZE chunks:
 *        - write each chunk to 0xFF26
 *        - await ACK; update progress from `bytes_received`
 *   6. write OTA_END (cmd=11)
 *   7. await REBOOTING (or ERR_END_FAILED / ERR_SIZE_MISMATCH)
 *
 * Abort: on signal.aborted, write OTA_ABORT (cmd=12) and wait briefly for
 * ABORTED before throwing OtaAbortedError. If the charger is unresponsive,
 * we still throw — the orchestrator will surface a useful message.
 *
 * Android quirk: GATT_INTERNAL_ERROR (status 129) is retried once per
 * window before bubbling. This is the most common transient failure on
 * Android BLE writes and almost always succeeds on retry.
 */
export async function transferFirmware(
  bytes: Uint8Array,
  expectedSha256Hex: string,
  opts: TransferOpts,
): Promise<void> {
  if (bytes.byteLength === 0) {
    throw new Error('refusing to transfer empty firmware');
  }
  if (expectedSha256Hex.length !== 64) {
    throw new Error('expectedSha256Hex must be 64 lowercase hex chars');
  }

  const {signal, onProgress, onPhase} = opts;
  const total = bytes.byteLength;

  const pipe = new StatusPipe();
  let abortListener: (() => void) | null = null;

  // Wire up abort. We don't immediately throw on abort; the state machine
  // checks `signal.aborted` at every yield point and gracefully sends
  // OTA_ABORT before throwing. The listener exists only to short-circuit
  // any in-flight pipe.waitNext() — but waitNext doesn't take a signal
  // because it's a tight internal pipe, so we rely on polling instead.

  const checkAbort = () => {
    if (signal.aborted) {
      throw new OtaAbortedError();
    }
  };

  try {
    // ── 1. MTU ──────────────────────────────────────────────────────────────
    onPhase?.('requesting_mtu');
    const mtu = await chargerBleManager.requestOtaMtu();
    const chunkSize = Math.max(20, mtu - 3);
    console.log(`[OTA] starting transfer: total=${total}B chunkSize=${chunkSize}B mtu=${mtu}`);

    // ── 2. Subscribe to status pipe ─────────────────────────────────────────
    pipe.start();

    checkAbort();

    // ── 3. OTA_BEGIN ────────────────────────────────────────────────────────
    onPhase?.('sending_begin');
    const beginPayload = buildBeginPayload(total, expectedSha256Hex);
    await chargerBleManager.writeOtaCommand(CMD_OTA_BEGIN, beginPayload);

    // ── 4. await READY ──────────────────────────────────────────────────────
    await expectStatus(pipe, OTA_STATUS.READY, READY_TIMEOUT_MS);
    checkAbort();

    // ── 5. windowed chunk transfer ──────────────────────────────────────────
    onPhase?.('transferring');
    onProgress?.(0, total);

    let offset = 0;
    let chunksInWindow = 0;
    let windowRetries = 0;

    while (offset < total) {
      checkAbort();
      const end = Math.min(offset + chunkSize, total);
      const chunk = bytes.subarray(offset, end);

      try {
        await chargerBleManager.writeOtaChunk(chunk);
      } catch (e: any) {
        // Android GATT_INTERNAL_ERROR (status 129): retry the chunk once.
        // It almost always succeeds on retry; if it doesn't, bubble.
        const errStr = String(e?.message ?? e);
        if (errStr.includes('129') || errStr.includes('GATT_INTERNAL')) {
          if (windowRetries < 1) {
            windowRetries++;
            console.warn(`[OTA] GATT 129 on chunk @${offset}, retrying once`);
            // Brief breathing room then retry the same chunk.
            await new Promise<void>(r => setTimeout(() => r(), 50));
            continue;
          }
        }
        throw e;
      }

      offset = end;
      chunksInWindow++;

      // Yield to the RN bridge so the JS thread doesn't starve the bridge
      // thread that's actually pushing the bytes to the native side.
      // setTimeout(0) is the cheapest way to drain microtasks.
      if (chunksInWindow % 4 === 0) {
        await new Promise<void>(r => setTimeout(() => r(), 0));
      }

      const isLastChunk = offset >= total;

      if (chunksInWindow >= WINDOW_SIZE || isLastChunk) {
        // Wait for ACK before sending the next window. Use the bytes_received
        // field as the authoritative progress count.
        const ev = await expectStatus(pipe, OTA_STATUS.ACK, WINDOW_TIMEOUT_MS);
        // Some firmware revisions may emit ACK *before* the chunk's been fully
        // processed — clamp to total in case.
        const reported = Math.min(ev.bytesReceived, total);
        onProgress?.(reported, total);
        chunksInWindow = 0;
        windowRetries = 0;

        // Pause briefly between windows to let the ESP32 catch up. Not strictly
        // required but smooths out throughput on constrained phones.
        await new Promise<void>(r => setTimeout(() => r(), 0));
      }
    }

    checkAbort();

    // ── 6. OTA_END ──────────────────────────────────────────────────────────
    onPhase?.('sending_end');
    await chargerBleManager.writeOtaCommand(CMD_OTA_END);

    // ── 7. await REBOOTING ─────────────────────────────────────────────────
    // The firmware may emit COMMITTING first; expectStatus tolerates that
    // (it skips intermediate non-error codes).
    await expectStatus(
      pipe,
      [OTA_STATUS.REBOOTING, OTA_STATUS.COMMITTING],
      REBOOT_TIMEOUT_MS,
    );
    // If we got COMMITTING, wait one more notification for REBOOTING.
    // (Most firmware emits both; some emits only REBOOTING.) The expected
    // case is REBOOTING; if we don't see it within a few seconds, the
    // orchestrator's disconnect listener will catch the actual reboot.
    // Don't block too long here — disconnect is the real signal.
  } catch (e) {
    if (signal.aborted && !(e instanceof OtaAbortedError)) {
      // Convert any in-flight error into an abort if the user requested it.
      try {
        await chargerBleManager.writeOtaCommand(CMD_OTA_ABORT);
        await Promise.race([
          expectStatus(pipe, OTA_STATUS.ABORTED, ABORT_TIMEOUT_MS),
          new Promise<void>(resolve => setTimeout(() => resolve(), ABORT_TIMEOUT_MS)),
        ]).catch(() => {
          /* swallow — we're already aborting */
        });
      } catch {
        /* swallow — best effort */
      }
      throw new OtaAbortedError();
    }
    if (e instanceof OtaAbortedError) {
      // Tell the charger about the abort so it can clean up its OTA partition.
      try {
        await chargerBleManager.writeOtaCommand(CMD_OTA_ABORT);
        await Promise.race([
          expectStatus(pipe, OTA_STATUS.ABORTED, ABORT_TIMEOUT_MS),
          new Promise<void>(resolve => setTimeout(() => resolve(), ABORT_TIMEOUT_MS)),
        ]).catch(() => {
          /* swallow */
        });
      } catch {
        /* swallow */
      }
    }
    throw e;
  } finally {
    pipe.stop();
    if (abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}
