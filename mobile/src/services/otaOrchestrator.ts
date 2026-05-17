import {BleError, Device, Subscription} from 'react-native-ble-plx';
import {sharedBleManager} from '../ble/bleInstance';
import {
  chargerBleManager,
  CHARGER_SERVICE_UUID,
  CMD_OTA_VERIFY,
} from '../ble/ChargerBleManager';
import {
  paoBleManager,
  PAO_SERVICE_UUID,
  PAO_CMD_OTA_VERIFY,
} from '../ble/PaoBleManager';
import {
  controllerBleManager,
  CONTROLLER_SERVICE_UUID,
  CTRL_CMD_OTA_VERIFY,
} from '../ble/ControllerBleManager';
import {OtaTarget, useAppStore} from '../store/useAppStore';
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
// Orchestrator that owns the full target-flash pipeline.
//
// Pipeline (same shape for every target — only the BLE plumbing differs):
//   1. preflight — readyOtaBytes(target) + sha must be present
//   2. transfer — transferFirmware(target) pushes bytes via target's chunk +
//                 dispatcher chars (cmd=10/11)
//   3. wait for disconnect — device reboots
//   4. reconnect — scan-by-service-UUID, reconnect, re-discover
//   5. version check — read the target's firmware-version char, compare to
//                      expected
//   6. verify — write cmd=13, await VERIFIED (or NOT_PENDING)
//   7. done
//
// State transitions in `useAppStore.ota[target].state`:
//   ready → transferring → rebooting → reconnecting → finalizing → done
//
// On error: → 'error' with `error` set. `done` auto-clears to idle in the
// caller (UI) after a brief success display.
// ---------------------------------------------------------------------------

const RECONNECT_SCAN_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 15_000;
const POST_REBOOT_GRACE_MS = 2_000; // wait this long after disconnect before scanning

// Target-specific BLE wiring + post-reconnect version setter. The shape
// mirrors firmwareTransfer.ts's OtaProfile but adds orchestration-only
// fields (service UUID for scan-by-UUID, device-name fingerprint, verify
// cmd code, store version setter).
interface OrchestrationProfile {
  target: OtaTarget;
  manager: {
    isConnected(): boolean;
    disconnect(): void | Promise<void>;
    getConnectedDevice(): Device | null;
    connect(deviceId: string): Promise<void>;
    wirePostConnectSubscriptions?(): void;
    subscribeOtaStatus(
      handler: (code: number, bytesReceived: number) => void,
    ): Subscription;
    writeOtaCommand(cmd: number, payload?: Uint8Array): Promise<void>;
    readFirmwareVersion(): Promise<string | null>;
  };
  serviceUuid: string;
  verifyCmd: number;
  // Device-name fingerprints used in the reconnect scan to disambiguate the
  // target from other BLE peers in the same product.
  selfDeviceName: string; // expected device name (case-insensitive match)
  excludeDeviceName: string; // other peer's name we must NEVER reconnect as this target
  // Setter for the running firmware version after reconnect. Charger uses
  // `setChargerFirmwareVersion`, dial uses `setDialFirmwareVersion`.
  setFirmwareVersion: (v: string | null) => void;
  // Selector that reads the running version from store post-reconnect (used
  // for the soft mismatch warn-log).
  readFirmwareVersionFromStore: () => string | null;
  // Per-target store-tracked device id snapshot for reconnect matching.
  readDeviceIdFromStore: () => string | null;
}

function getOrchestrationProfile(target: OtaTarget): OrchestrationProfile {
  switch (target) {
    case 'charger':
      return {
        target,
        manager: chargerBleManager,
        serviceUuid: CHARGER_SERVICE_UUID,
        verifyCmd: CMD_OTA_VERIFY,
        selfDeviceName: 'pao charger',
        excludeDeviceName: 'PAO Console',
        setFirmwareVersion: v =>
          useAppStore.getState().setChargerFirmwareVersion(v),
        readFirmwareVersionFromStore: () =>
          useAppStore.getState().chargerFirmwareVersion,
        readDeviceIdFromStore: () => useAppStore.getState().chargerDeviceId,
      };
    case 'dial':
      return {
        target,
        manager: paoBleManager,
        serviceUuid: PAO_SERVICE_UUID,
        verifyCmd: PAO_CMD_OTA_VERIFY,
        selfDeviceName: 'pao console',
        excludeDeviceName: 'Pao Charger',
        setFirmwareVersion: v =>
          useAppStore.getState().setDialFirmwareVersion(v),
        readFirmwareVersionFromStore: () =>
          useAppStore.getState().dialFirmwareVersion,
        readDeviceIdFromStore: () => useAppStore.getState().deviceId,
      };
    case 'controller':
      return {
        target,
        manager: controllerBleManager,
        serviceUuid: CONTROLLER_SERVICE_UUID,
        verifyCmd: CTRL_CMD_OTA_VERIFY,
        // The controller advertises as "Pao Controller" (Bart's firmware).
        // Exclude "Pao Charger" to avoid mis-routing during a reconnect scan.
        selfDeviceName: 'pao controller',
        excludeDeviceName: 'Pao Charger',
        setFirmwareVersion: v =>
          useAppStore.getState().setControllerFirmwareVersion(v),
        readFirmwareVersionFromStore: () =>
          useAppStore.getState().controllerFirmwareVersion,
        readDeviceIdFromStore: () =>
          // Controller does not have a dedicated `controllerDeviceId` in the
          // store; the device object itself carries the ID. Retrieve from
          // the connected device if available, else fall back to null so
          // the reconnect scan always starts clean.
          useAppStore.getState().controllerDevice?.id ?? null,
      };
    default: {
      const _exhaustive: never = target;
      throw new Error(`otaOrchestrator: unknown target ${_exhaustive}`);
    }
  }
}

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
 * Generalised flash entry-point. Drives the full pipeline for any target
 * (charger | dial). The UI is responsible for showing any pre-flight modal
 * BEFORE calling this; we trust the caller and proceed straight into the
 * transfer.
 */
export async function flashFirmware(
  target: OtaTarget,
  opts: FlashOpts,
): Promise<void> {
  const profile = getOrchestrationProfile(target);
  const {signal, onProgress, onPhase} = opts;
  const store = useAppStore.getState;

  // Tiny helper: forward to setOtaState while emitting a diagnostic log so a
  // post-crash logcat dump pinpoints exactly which transition we were on when
  // things went sideways.
  const setState = (
    newState: Parameters<ReturnType<typeof store>['setOtaState']>[1],
  ) => {
    console.log(`[OTA:${target}] state →`, newState);
    store().setOtaState(target, newState);
  };

  // 1. Preflight ────────────────────────────────────────────────────────────
  const bytes = getReadyOtaBytes(target);
  const expectedSha = getReadyOtaSha256(target);
  const expectedVersion = store().ota[target].latestRelease.version;

  if (!bytes || !expectedSha) {
    throw new OtaPreflightError('No verified firmware payload — run download first.');
  }
  if (!expectedVersion) {
    throw new OtaPreflightError('No release version available.');
  }
  if (!profile.manager.isConnected()) {
    throw new OtaPreflightError(`${humanTargetName(target)} not connected.`);
  }
  // Capture the device id BEFORE the transfer — we need it post-reboot if the
  // disconnect listener clears the store's id field.
  const initialDeviceId = profile.readDeviceIdFromStore();

  store().setOtaError(target, null);

  try {
    // 2. Transfer ──────────────────────────────────────────────────────────
    onPhase?.('transferring');
    setState('transferring');
    store().setOtaProgress(target, 0, 0, bytes.byteLength);

    await transferFirmware(target, bytes, expectedSha, {
      signal,
      onProgress: (sent, total) => {
        // Push to store so the UI can render from a single source of truth,
        // and also forward to the caller in case it wants its own progress.
        const frac = total > 0 ? sent / total : 0;
        useAppStore.getState().setOtaProgress(target, frac, sent, total);
        onProgress?.(sent, total);
      },
      onPhase: () => {
        // Sub-phases of transfer (requesting_mtu / sending_begin / etc) are
        // not surfaced to the UI — they all collapse to 'transferring'.
      },
    });

    // 3. Wait for disconnect ──────────────────────────────────────────────
    // The device reboots ~immediately after REBOOTING is emitted. We wait
    // for the BLE disconnect signal as the actual transition cue (reading
    // the status pipe is unreliable post-reboot — the GATT connection is
    // already torn down).
    onPhase?.('rebooting');
    setState('rebooting');

    await waitForDisconnect(profile, initialDeviceId, signal);

    // Brief grace so the device's BLE stack can come back up clean before
    // we start scanning again. iOS in particular is allergic to scanning
    // immediately after a disconnect.
    await delay(POST_REBOOT_GRACE_MS);

    // 4. Reconnect ────────────────────────────────────────────────────────
    onPhase?.('reconnecting');
    setState('reconnecting');

    // Pass the pre-reboot device id so scanAndReconnect can prefer matching
    // by id (most reliable on Android — survives the reboot since the BT
    // MAC stays the same).
    const reconnectedId = await scanAndReconnect(profile, signal, initialDeviceId);

    // 5. Version check + re-init connection ───────────────────────────────
    // The manager.connect() above set the connectedDevice internally. We
    // can read the firmware version char directly.
    const newVersion = await profile.manager.readFirmwareVersion();
    if (newVersion) {
      profile.setFirmwareVersion(newVersion);
    }

    // Compare bare semvers. A positive mismatch (newVersion is non-null AND
    // doesn't match expectedVersion) means the device rebooted back to the old
    // image — OTA_END fired before all bytes were received (Bug 1), the image
    // was incomplete, the bootloader rolled back. This is a hard failure: do
    // NOT proceed to VERIFY, which would stamp the old image as "done".
    // If newVersion is null (read failed), we cannot confirm failure — leave
    // the VERIFY to catch any protocol inconsistency rather than a false abort.
    if (
      newVersion &&
      expectedVersion &&
      stripBuildSuffix(newVersion) !== stripBuildSuffix(expectedVersion)
    ) {
      throw new Error(
        `Update did not take effect. Device is still running ${newVersion} (expected ${expectedVersion}). The device may need a USB reflash or another attempt.`,
      );
    }

    // 6. Verify ────────────────────────────────────────────────────────────
    // Only reached when version matches (or could not be read). cmd=13 is the
    // firmware's final integrity check — intentionally gated behind the version
    // comparison above so a rollback doesn't get a spurious VERIFIED signal.
    onPhase?.('verifying');
    setState('finalizing');

    await sendVerifyAndAwait(profile, signal);

    // 7. Done ──────────────────────────────────────────────────────────────
    onPhase?.('done');
    setState('done');
    store().setOtaError(target, null);

    // Re-set the firmware version one more time using whatever the device
    // last reported — this catches the case where the version characteristic
    // notify-fired between read and verify.
    if (newVersion) {
      profile.setFirmwareVersion(newVersion);
    }

    console.log(`[OTA:${target}] flash complete; reconnected device id=${reconnectedId}`);
  } catch (e) {
    // BLE errors thrown during 'rebooting' or 'reconnecting' states are the
    // EXPECTED side-effect of the device restarting after cmd=11. Don't
    // surface those to the UI as flash failures.
    const phase = store().ota[target].state;
    if ((phase === 'rebooting' || phase === 'reconnecting') && isExpectedRebootError(e)) {
      console.log(`[OTA:${target}] swallowed expected disconnect during ${phase} phase`);
      const message = `${humanTargetName(target)} restarted but did not come back online — power-cycle and reconnect to check version.`;
      // Critical: clear manager state so AppNavigator's auto-reconnect loop
      // can take over without competing with stale orchestrator references.
      handOffToAppNavigatorReconnect(profile);
      setState('error');
      store().setOtaError(target, message);
      throw new Error(message);
    }
    const message = mapErrorToMessage(e);
    console.error(`[OTA:${target}] flash error:`, e);
    // Same hand-off on a generic error during/after reconnect — leaves the
    // user with the error message visible but the manager state clean so a
    // background reconnect can succeed silently.
    if (phase === 'reconnecting' || phase === 'rebooting' || phase === 'finalizing') {
      handOffToAppNavigatorReconnect(profile);
    }
    setState('error');
    store().setOtaError(target, message);
    throw e;
  }
}

/**
 * Backwards-compatible wrapper. Pre-Stream-2 callers (SettingsScreen) only
 * knew about the charger; this signature stays identical so the existing
 * `flashChargerFirmware({signal, …})` call site keeps working unchanged.
 */
export function flashChargerFirmware(opts: FlashOpts): Promise<void> {
  return flashFirmware('charger', opts);
}

/**
 * Tear down whatever in-session BLE state the orchestrator was managing so
 * the regular AppNavigator auto-reconnect loop can take over with a clean
 * slate. Safe to call from any phase — `manager.disconnect()` is idempotent
 * against a null connectedDevice.
 */
function handOffToAppNavigatorReconnect(profile: OrchestrationProfile): void {
  console.log(`[OTA:${profile.target}] reconnect: handing back to manager`);
  try {
    profile.manager.disconnect();
  } catch (e) {
    console.warn('[OTA] disconnect during hand-off failed (non-fatal):', e);
  }
  // Bumping the scan trigger ensures AppNavigator's unified scan effect
  // re-runs even if status is already 'disconnected' (Zustand swallows
  // no-op sets).
  useAppStore.getState().incrementScanTrigger();
}

function humanTargetName(target: OtaTarget): string {
  switch (target) {
    case 'charger':
      return 'Charger';
    case 'dial':
      return 'Dial';
    case 'controller':
      return 'Controller';
  }
}

/**
 * Wait for the ble manager to report the device disconnected. We register a
 * one-shot listener via `onDeviceDisconnected` and resolve the promise on
 * the first event. If the device is already disconnected (rare race — the
 * transfer's REBOOTING handler may have raced ahead), resolve immediately.
 */
function waitForDisconnect(
  profile: OrchestrationProfile,
  deviceId: string | null,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new OtaAbortedError());
    }

    // Already disconnected → immediate resolve.
    if (!profile.manager.isConnected() || !deviceId) {
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
 * Scan for the target device after a reboot and connect to it. Resolves
 * with the new device id. Times out after RECONNECT_SCAN_TIMEOUT_MS.
 *
 * Why no UUID filter:
 *   Android scan filters only match the primary advertisement payload, and
 *   even with our NimBLE peripheral setting `setScanResponse(true)` the
 *   name + sometimes the UUID lands in the scan response. AppNavigator
 *   already discovered this and switched to a null filter (see the comment
 *   near the unified scan effect). We mirror that here so the orchestrator's
 *   reconnect doesn't time out on Android.
 *
 * Match priority in the callback (highest first):
 *   1. previously-saved device id (same physical hardware, same id post-reboot)
 *   2. advertised service UUID matches profile.serviceUuid
 *   3. device.name matches profile.selfDeviceName (case-insensitive)
 */
function scanAndReconnect(
  profile: OrchestrationProfile,
  signal: AbortSignal,
  preferredDeviceId: string | null,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new OtaAbortedError());
    }

    // Prefer the id passed in by the caller (snapshotted before transfer);
    // fall back to whatever's currently in the store. The disconnect handler
    // clears the device id synchronously when the reboot disconnect fires,
    // so the store value is often null by the time we get here.
    const savedId =
      preferredDeviceId ?? profile.readDeviceIdFromStore() ?? null;

    console.log(
      `[OTA:${profile.target}] reconnect: scan started for service UUID=${profile.serviceUuid} (null filter, savedId=${savedId ?? 'none'})`,
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
          console.warn(`[OTA:${profile.target}] reconnect scan error:`, error.message);
          return;
        }
        if (!device) return;

        // Reject obviously-wrong devices fast (the other peer in this
        // product — never reconnect to that as this target).
        if (device.name === profile.excludeDeviceName) return;

        const advertised = (device.serviceUUIDs ?? []).map(u =>
          u.toLowerCase(),
        );
        const isMatch =
          (savedId != null && device.id === savedId) ||
          advertised.includes(profile.serviceUuid.toLowerCase()) ||
          device.name?.toLowerCase() === profile.selfDeviceName;

        if (!isMatch) return;

        console.log(
          `[OTA:${profile.target}] reconnect: device found id=${device.id} name=${device.name}`,
        );
        sharedBleManager.stopDeviceScan();

        // Connect via the manager so the store + disconnect handler stay in
        // sync. We then wire post-connect subscriptions so post-OTA the UI
        // sees the same data flow it would after a normal AppNavigator
        // connect — without this the connection looks healthy but no
        // notifications reach the store.
        profile.manager
          .connect(device.id)
          .then(() => {
            console.log(`[OTA:${profile.target}] reconnect: connect success id=${device.id}`);
            profile.manager.wirePostConnectSubscriptions?.();
            finish({ok: true, id: device.id});
          })
          .catch(e => {
            console.log(`[OTA:${profile.target}] reconnect: connect failed: ${(e as any)?.message ?? e}`);
            finish({ok: false, err: e});
          });
      },
    );

    timer = setTimeout(() => {
      console.log(`[OTA:${profile.target}] reconnect: scan timed out — handing back to manager`);
      finish({
        ok: false,
        err: new Error(
          `${humanTargetName(profile.target)} did not come back online within 30 seconds.`,
        ),
      });
    }, RECONNECT_SCAN_TIMEOUT_MS);
  });
}

/**
 * Send the target's verify cmd and await the VERIFIED notify (or NOT_PENDING
 * — both count as success). Subscribes a one-shot listener on the target's
 * status char. Errors map to OtaProtocolError.
 */
function sendVerifyAndAwait(
  profile: OrchestrationProfile,
  signal: AbortSignal,
): Promise<void> {
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
      sub = profile.manager.subscribeOtaStatus((code, _bytesReceived) => {
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

    profile.manager.writeOtaCommand(profile.verifyCmd).catch(e => {
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
          `Update transferred but verify did not respond. Power-cycle the ${humanTargetName(profile.target).toLowerCase()} and reconnect — if it reports the new version, all good; if it reports the old version, the rollback fired and the update was undone safely.`,
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
