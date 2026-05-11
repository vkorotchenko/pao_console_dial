import {BleError, Device, Subscription} from 'react-native-ble-plx';
import {sharedBleManager} from '../ble/bleInstance';
import {
  chargerBleManager,
  CHARGER_SERVICE_UUID,
  CMD_OTA_VERIFY,
} from '../ble/ChargerBleManager';
import {useAppStore} from '../store/useAppStore';
import {getReadyOtaBytes, getReadyOtaSha256} from './otaController';
import {
  transferFirmware,
  OtaAbortedError,
  OtaProtocolError,
  OTA_STATUS,
  statusCodeToMessage,
  isExpectedRebootError,
} from './firmwareTransfer';

// ---------------------------------------------------------------------------
// Orchestrator that owns the full charger-flash pipeline.
//
// Pipeline:
//   1. preflight — readyOtaBytes + sha must be present
//   2. transfer — transferFirmware() pushes bytes via 0xFF26 + 0xFF05 (cmd=10/11)
//   3. wait for disconnect — charger reboots
//   4. reconnect — scan-by-service-UUID, reconnect, re-discover
//   5. version check — read 0xFF25, compare to expected
//   6. verify — write cmd=13, await VERIFIED (or NOT_PENDING)
//   7. done
//
// State transitions in `useAppStore.otaState`:
//   ready → transferring → rebooting → reconnecting → finalizing → done
//
// On error: → 'error' with `otaError` set. `done` auto-clears to idle in the
// caller (UI) after a brief success display.
// ---------------------------------------------------------------------------

const RECONNECT_SCAN_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 15_000;
const POST_REBOOT_GRACE_MS = 2_000; // wait this long after disconnect before scanning

export type OrchestratorPhase =
  | 'preparing'
  | 'transferring'
  | 'rebooting'
  | 'reconnecting'
  | 'verifying'
  | 'done';

export interface FlashOpts {
  signal: AbortSignal;
  onProgress?: (bytesSent: number, total: number) => void;
  onPhase?: (phase: OrchestratorPhase) => void;
}

export class OtaPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtaPreflightError';
  }
}

/**
 * Orchestrate the full charger flash. The UI is responsible for showing the
 * "stay foreground / charger off" pre-flight modal BEFORE calling this; we
 * trust the caller and proceed straight into the transfer.
 */
export async function flashChargerFirmware(opts: FlashOpts): Promise<void> {
  const {signal, onProgress, onPhase} = opts;
  const store = useAppStore.getState;

  // Tiny helper: forward to setOtaState while emitting a diagnostic log so a
  // post-crash logcat dump pinpoints exactly which transition we were on when
  // things went sideways. Stays in flashChargerFirmware so it captures every
  // state change driven by the orchestrator without scattering logs.
  const setState = (newState: Parameters<ReturnType<typeof store>['setOtaState']>[0]) => {
    console.log('[OTA] state →', newState);
    store().setOtaState(newState);
  };

  // 1. Preflight ────────────────────────────────────────────────────────────
  const bytes = getReadyOtaBytes();
  const expectedSha = getReadyOtaSha256();
  const expectedVersion = store().latestReleaseVersion;

  if (!bytes || !expectedSha) {
    throw new OtaPreflightError('No verified firmware payload — run download first.');
  }
  if (!expectedVersion) {
    throw new OtaPreflightError('No release version available.');
  }
  if (!chargerBleManager.isConnected()) {
    throw new OtaPreflightError('Charger not connected.');
  }
  // Capture the device id BEFORE the transfer — we need it post-reboot if the
  // disconnect listener clears the store's chargerDeviceId.
  const initialDeviceId = store().chargerDeviceId;

  store().setOtaError(null);

  try {
    // 2. Transfer ──────────────────────────────────────────────────────────
    onPhase?.('transferring');
    setState('transferring');
    store().setOtaProgress(0, 0, bytes.byteLength);

    await transferFirmware(bytes, expectedSha, {
      signal,
      onProgress: (sent, total) => {
        // Push to store so the UI can render from a single source of truth,
        // and also forward to the caller in case it wants its own progress.
        const frac = total > 0 ? sent / total : 0;
        useAppStore.getState().setOtaProgress(frac, sent, total);
        onProgress?.(sent, total);
      },
      onPhase: () => {
        // Sub-phases of transfer (requesting_mtu / sending_begin / etc) are
        // not surfaced to the UI — they all collapse to 'transferring'. The
        // user just sees "Sending firmware…" with a progress bar.
      },
    });

    // 3. Wait for disconnect ──────────────────────────────────────────────
    // The charger reboots ~immediately after REBOOTING is emitted. We wait
    // for the BLE disconnect signal as the actual transition cue (reading
    // the status pipe is unreliable post-reboot — the GATT connection is
    // already torn down).
    onPhase?.('rebooting');
    setState('rebooting');

    await waitForDisconnect(initialDeviceId, signal);

    // Brief grace so the charger's BLE stack can come back up clean before
    // we start scanning again. iOS in particular is allergic to scanning
    // immediately after a disconnect.
    await delay(POST_REBOOT_GRACE_MS);

    // 4. Reconnect ────────────────────────────────────────────────────────
    onPhase?.('reconnecting');
    setState('reconnecting');

    // Pass the pre-reboot device id so scanAndReconnect can prefer matching
    // by id (most reliable on Android — survives the reboot since the BT
    // MAC stays the same). The store's chargerDeviceId is already cleared
    // by the disconnect handler at this point, so we have to source it from
    // the snapshot we took before the transfer began.
    const reconnectedId = await scanAndReconnect(signal, initialDeviceId);

    // 5. Version check + re-init connection ───────────────────────────────
    // The chargerBleManager.connect() above set the connectedDevice
    // internally. We can read 0xFF25 directly via readFirmwareVersion().
    const newVersion = await chargerBleManager.readFirmwareVersion();
    if (newVersion) {
      store().setChargerFirmwareVersion(newVersion);
    }

    // Compare bare semvers. If mismatch, surface a soft warning but proceed
    // to verify — the bootloader will roll back on next boot if validation
    // didn't fire.
    if (
      newVersion &&
      expectedVersion &&
      stripBuildSuffix(newVersion) !== stripBuildSuffix(expectedVersion)
    ) {
      console.warn(
        `[OTA] post-reconnect version mismatch: read=${newVersion} expected=${expectedVersion}`,
      );
    }

    // 6. Verify ────────────────────────────────────────────────────────────
    onPhase?.('verifying');
    setState('finalizing');

    await sendVerifyAndAwait(signal);

    // 7. Done ──────────────────────────────────────────────────────────────
    onPhase?.('done');
    setState('done');
    store().setOtaError(null);

    // Re-set the firmware version one more time using whatever the device
    // last reported — this catches the case where the version characteristic
    // notify-fired between read and verify.
    if (newVersion) {
      store().setChargerFirmwareVersion(newVersion);
    }

    // Note about reconnectedId: ChargerBleManager already updated the store
    // with it via connect(). We log for traceability.
    console.log(`[OTA] flash complete; reconnected device id=${reconnectedId}`);
  } catch (e) {
    // BLE errors thrown during 'rebooting' or 'reconnecting' states are the
    // EXPECTED side-effect of the charger restarting after cmd=11. Don't
    // surface those to the UI as flash failures.
    const phase = store().otaState;
    if ((phase === 'rebooting' || phase === 'reconnecting') && isExpectedRebootError(e)) {
      // Stay in current phase; let downstream logic (scan + reconnect) keep
      // driving forward. A real failure here would have come from the verify
      // step or the 30s reconnect timeout, both handled below.
      console.log(`[OTA] swallowed expected disconnect during ${phase} phase`);
      // Re-throw NOTHING here — but we need to bail out cleanly because the
      // pipeline above is now broken. Convert to an abort-like soft fail
      // and let the user retry. Power-cycle hint via dedicated message.
      const message = 'Charger restarted but did not come back online — power-cycle and reconnect to check version.';
      // Critical: clear manager state so AppNavigator's auto-reconnect loop
      // can take over without competing with stale orchestrator references.
      // Without this the manager's connectedDevice may still point at the
      // pre-reboot Device object, and chargerBleStatus may be stuck in a
      // half-state that the auto-reconnect effect doesn't act on.
      handOffToAppNavigatorReconnect();
      setState('error');
      store().setOtaError(message);
      throw new Error(message);
    }
    const message = mapErrorToMessage(e);
    console.error('[OTA] flash error:', e);
    // Same hand-off on a generic error during/after reconnect — leaves the
    // user with the error message visible but the manager state clean so a
    // background reconnect can succeed silently.
    if (phase === 'reconnecting' || phase === 'rebooting' || phase === 'finalizing') {
      handOffToAppNavigatorReconnect();
    }
    setState('error');
    store().setOtaError(message);
    throw e;
  }
}

/**
 * Tear down whatever in-session BLE state the orchestrator was managing so
 * the regular AppNavigator auto-reconnect loop can take over with a clean
 * slate. Safe to call from any phase — chargerBleManager.disconnect() is
 * idempotent against a null connectedDevice.
 */
function handOffToAppNavigatorReconnect(): void {
  console.log('[OTA] reconnect: handing back to chargerBleManager');
  try {
    chargerBleManager.disconnect();
  } catch (e) {
    console.warn('[OTA] disconnect during hand-off failed (non-fatal):', e);
  }
  // disconnect() already sets chargerBleStatus='disconnected'. Bumping the
  // scan trigger ensures AppNavigator's unified scan effect re-runs even if
  // it was already in 'disconnected' (Zustand swallows no-op sets).
  useAppStore.getState().incrementScanTrigger();
}

/**
 * Wait for the ble manager to report the device disconnected. We register a
 * one-shot listener via `onDeviceDisconnected` and resolve the promise on
 * the first event. If the device is already disconnected (rare race — the
 * transfer's REBOOTING handler may have raced ahead), resolve immediately.
 */
function waitForDisconnect(
  deviceId: string | null,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new OtaAbortedError());
    }

    // Already disconnected → immediate resolve.
    if (!chargerBleManager.isConnected() || !deviceId) {
      return resolve();
    }

    let sub: Subscription | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    const cleanup = () => {
      sub?.remove();
      sub = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new OtaAbortedError());
    };
    signal.addEventListener('abort', onAbort);

    sub = sharedBleManager.onDeviceDisconnected(
      deviceId,
      (_error: BleError | null, _device: Device | null) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      },
    );

    // Generous safety net — if we never hear about a disconnect within
    // 15s of REBOOTING, something's wrong. Don't hang forever.
    timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      // Synthetic resolve: maybe the disconnect notification was lost. The
      // reconnect step will fail loudly if the charger really is still up.
      resolve();
    }, 15_000);
  });
}

/**
 * Scan for the charger after a reboot and connect to it. Resolves with the
 * new device id. Times out after RECONNECT_SCAN_TIMEOUT_MS.
 *
 * Why no UUID filter:
 *   Android scan filters only match the primary advertisement payload, and
 *   even with our NimBLE charger setting `setScanResponse(true)` the name +
 *   sometimes the UUID lands in the scan response. Historical Bluefruit
 *   builds had the same quirk (charger UUID lived in scan response only).
 *   AppNavigator already discovered this and switched to a null filter
 *   (see the comment near the unified scan effect). We mirror that here so
 *   the orchestrator's reconnect doesn't time out on Android.
 *
 * Match priority in the callback (highest first):
 *   1. previously-saved chargerDeviceId (same physical hardware, same id post-reboot)
 *   2. advertised service UUID matches CHARGER_SERVICE_UUID
 *   3. device.name === "Pao Charger" (case-insensitive)
 */
function scanAndReconnect(
  signal: AbortSignal,
  preferredDeviceId: string | null,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new OtaAbortedError());
    }

    // Prefer the id passed in by the caller (snapshotted before transfer);
    // fall back to whatever's currently in the store. The disconnect handler
    // clears chargerDeviceId synchronously when the reboot disconnect fires,
    // so the store value is often null by the time we get here.
    const savedChargerId =
      preferredDeviceId ?? useAppStore.getState().chargerDeviceId ?? null;

    console.log(
      `[OTA] reconnect: scan started for service UUID=${CHARGER_SERVICE_UUID} (null filter, savedId=${savedChargerId ?? 'none'})`,
    );

    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (
      result: {ok: true; id: string} | {ok: false; err: Error},
    ) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      sharedBleManager.stopDeviceScan();
      if (result.ok) resolve(result.id);
      else reject(result.err);
    };

    const onAbort = () => finish({ok: false, err: new OtaAbortedError()});
    signal.addEventListener('abort', onAbort);

    sharedBleManager.startDeviceScan(
      null,
      null,
      (error: BleError | null, device: Device | null) => {
        if (error) {
          // Some scan errors are transient (BLE state churn during reboot);
          // log but don't immediately fail — the timeout is the real bound.
          console.warn('[OTA] reconnect scan error:', error.message);
          return;
        }
        if (!device) return;

        // Reject obviously-wrong devices fast (PAO Console is the other BLE
        // peer in this product — never reconnect to it as the charger).
        if (device.name === 'PAO Console') return;

        const advertised = (device.serviceUUIDs ?? []).map(u =>
          u.toLowerCase(),
        );
        const isCharger =
          (savedChargerId != null && device.id === savedChargerId) ||
          advertised.includes(CHARGER_SERVICE_UUID.toLowerCase()) ||
          device.name?.toLowerCase() === 'pao charger';

        if (!isCharger) return;

        console.log(
          `[OTA] reconnect: device found id=${device.id} name=${device.name}`,
        );
        sharedBleManager.stopDeviceScan();

        // Connect via the manager so the store + disconnect handler stay in
        // sync. We then wire telemetry subscriptions so post-OTA the UI sees
        // the same data flow it would after a normal AppNavigator connect —
        // this is the critical fix: without subscriptions the connection
        // looks healthy but no notifications reach the store.
        chargerBleManager
          .connect(device.id)
          .then(() => {
            console.log(`[OTA] reconnect: connect success id=${device.id}`);
            chargerBleManager.wirePostConnectSubscriptions();
            finish({ok: true, id: device.id});
          })
          .catch(e => {
            console.log(`[OTA] reconnect: connect failed: ${(e as any)?.message ?? e}`);
            finish({ok: false, err: e});
          });
      },
    );

    timer = setTimeout(() => {
      console.log('[OTA] reconnect: scan timed out — handing back to chargerBleManager');
      finish({
        ok: false,
        err: new Error(
          'Charger did not come back online within 30 seconds.',
        ),
      });
    }, RECONNECT_SCAN_TIMEOUT_MS);
  });
}

/**
 * Send CMD_OTA_VERIFY and await the VERIFIED notify (or NOT_PENDING — both
 * count as success). Subscribes a one-shot listener on 0xFF27. Errors map to
 * OtaProtocolError.
 */
function sendVerifyAndAwait(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new OtaAbortedError());
    }

    let resolved = false;
    let sub: Subscription | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      sub?.remove();
      sub = null;
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new OtaAbortedError());
    };
    signal.addEventListener('abort', onAbort);

    try {
      sub = chargerBleManager.subscribeOtaStatus((code, _bytesReceived) => {
        if (resolved) return;
        if (code === OTA_STATUS.VERIFIED || code === OTA_STATUS.NOT_PENDING) {
          resolved = true;
          cleanup();
          resolve();
          return;
        }
        if (code >= 0x10 && code <= 0x15) {
          resolved = true;
          cleanup();
          reject(new OtaProtocolError(statusCodeToMessage(code), code));
          return;
        }
        // Other codes (IDLE, ACK, etc.) are stragglers from the transfer or
        // benign — keep waiting.
      });
    } catch (e) {
      cleanup();
      return reject(e);
    }

    chargerBleManager.writeOtaCommand(CMD_OTA_VERIFY).catch(e => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(e);
    });

    timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(
        new Error(
          'Update transferred but verify did not respond. Power-cycle the charger and reconnect — if it reports the new version, all good; if it reports the old version, the rollback fired and the update was undone safely.',
        ),
      );
    }, VERIFY_TIMEOUT_MS);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise<void>(r => setTimeout(() => r(), ms));
}

/**
 * Strip the "+build" suffix from a semver so post-reboot version comparison
 * is robust to firmware that may not echo the build number identically.
 */
function stripBuildSuffix(v: string): string {
  const idx = v.indexOf('+');
  return idx >= 0 ? v.substring(0, idx) : v;
}

function mapErrorToMessage(e: unknown): string {
  if (e instanceof OtaAbortedError) return 'Update cancelled.';
  if (e instanceof OtaPreflightError) return e.message;
  if (e instanceof OtaProtocolError) return e.message;
  const msg = (e as any)?.message;
  if (typeof msg === 'string' && msg.length > 0) return msg;
  return 'Update failed.';
}
