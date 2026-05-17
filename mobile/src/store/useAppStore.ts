import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Device} from 'react-native-ble-plx';
import {BleStatus, Telemetry, ChargerConfig, ChargerDirectData} from '../types';

// ---------------------------------------------------------------------------
// Multi-target OTA store shape (Stream 4 refactor, 2026-05-12)
//
// Three firmware/app targets share the same per-target lifecycle:
//   - 'charger'     — Adafruit Feather ESP32 V2 charger (active)
//   - 'dial'        — ESP32-S3 PAO Console peripheral (UUIDs pending Bart)
//   - 'controller'  — ESP32 V2 controller (OTA pending)
//
// Each target gets its own `OtaSlice`. Top-level helpers that used to be
// charger-specific (`setLatestRelease`, `setOtaState`, …) now take `target`
// as their first argument so the same machinery drives all three. Existing
// charger callers pass `'charger'` explicitly — behaviour is byte-identical.
// ---------------------------------------------------------------------------

export type OtaTarget = 'charger' | 'dial' | 'controller';

/**
 * OTA state machine, shared across targets. The names come from the
 * charger pipeline (the most complex of the three); dial / controller may
 * never visit some of the post-`transferring` phases, but the same union is
 * fine — unused values are simply never set for those targets.
 */
export type OtaState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'transferring'
  | 'rebooting'
  | 'reconnecting'
  | 'finalizing'
  | 'done'
  | 'error';

/**
 * The release-metadata block populated by `services/githubReleases.ts` when
 * a fresh `<target>-v*` release is found. Asset URLs are NEUTRAL across
 * targets (charger uses .bin, controller will use .bin, dial uses .bin) so
 * we use `binAssetUrl` for the primary payload everywhere. The sha256
 * sidecar URL stays in `sha256AssetUrl`.
 *
 * Mobile (the app self-update) keeps its own parallel store fields and is
 * NOT part of this slice — its asset is an .apk, not a firmware binary,
 * and the install path is system-level (Android installer) rather than a
 * BLE OTA transfer.
 */
export interface LatestRelease {
  tag: string | null;        // e.g. "charger-v0.1.0"
  version: string | null;    // bare version, e.g. "0.1.0"
  htmlUrl: string | null;    // GitHub HTML URL
  binAssetUrl: string | null; // browser_download_url for primary firmware
  binAssetSize: number | null; // bytes
  sha256AssetUrl: string | null; // browser_download_url for .sha256 sidecar
  releaseNotes: string | null; // markdown body, may be empty
  publishedAt: string | null; // ISO 8601 publish date from GitHub; null in legacy persisted state
  etag: string | null;       // last ETag for conditional GET
}

/**
 * Ephemeral progress fields. Set during `'downloading'` (network) and
 * `'transferring'` (BLE) from each phase's progress callback. Reset to
 * baseline at every state boundary that isn't actively progressing.
 * NOT persisted — these describe an in-flight transfer and are
 * meaningless across launches.
 */
export interface OtaProgress {
  frac: number; // 0..1, set explicitly at state boundaries
  received: number | null;
  total: number | null;
}

/**
 * Full per-target OTA slice. One instance per target lives in `store.ota`.
 */
export interface OtaSlice {
  latestRelease: LatestRelease;
  latestReleaseCheckedAt: number | null; // Date.now() of last check (success OR 304)
  state: OtaState;
  progress: OtaProgress;
  error: string | null;
}

/** Empty defaults used to initialise every target's slice. */
const EMPTY_RELEASE: LatestRelease = {
  tag: null,
  version: null,
  htmlUrl: null,
  binAssetUrl: null,
  binAssetSize: null,
  sha256AssetUrl: null,
  releaseNotes: null,
  publishedAt: null,
  etag: null,
};

const EMPTY_PROGRESS: OtaProgress = {
  frac: 0,
  received: null,
  total: null,
};

const EMPTY_SLICE: OtaSlice = {
  latestRelease: EMPTY_RELEASE,
  latestReleaseCheckedAt: null,
  state: 'idle',
  progress: EMPTY_PROGRESS,
  error: null,
};

interface AppState {
  // BLE connection state (peripheral)
  bleStatus: BleStatus;
  deviceId: string | null;
  error: string | null;

  // BLE connection state (charger direct)
  chargerBleStatus: BleStatus;
  chargerDeviceId: string | null;
  chargerError: string | null;

  // Data from BLE
  telemetry: Telemetry | null;
  chargerConfig: ChargerConfig | null;
  chargerData: ChargerDirectData | null;

  // Charger firmware version — display string like "v1.2.3" or "v1.2.3+12".
  // Persisted so the last-known version survives app restarts and is visible
  // before/after disconnect. Updated only when a fresh read or notification
  // returns a valid decoded value — never cleared on transient disconnects
  // (that would cause the Settings row to flicker to "—" on every drop).
  // Cleared explicitly only by store.reset().
  chargerFirmwareVersion: string | null;

  // Dial (peripheral, ESP32-S3) firmware version. Same shape and contract as
  // `chargerFirmwareVersion` — top-level for parity with the existing charger
  // pattern (Decision #44) rather than nested under `ota.dial`. Both targets
  // surface their CURRENTLY-RUNNING firmware version separately from the
  // GitHub-known LATEST release (which lives in `ota[target].latestRelease`).
  //
  // Persisted so the Settings "Dial" row doesn't flicker to "—" on transient
  // disconnects. Updated only when a fresh read or notification returns a
  // valid decoded value (mirrors the charger pattern — see disconnect handler
  // in PaoBleManager / ChargerBleManager: deliberately NOT cleared on
  // transient drops). Cleared explicitly only by store.reset().
  //
  // Note: a future consolidation pass could move both `chargerFirmwareVersion`
  // and `dialFirmwareVersion` under `ota[target].currentFirmwareVersion` for
  // a single uniform shape. Doing it now would touch the entire charger
  // codepath (selectors in SettingsScreen / FirmwareInfoScreen / ChargerBleManager)
  // for zero behavioural benefit — defer until a third consumer arrives that
  // forces the refactor, then migrate both together.
  dialFirmwareVersion: string | null;

  // ── Controller BLE connection state ─────────────────────────────────────
  // Controller (ESP32 V2) runs an OTA-only BLE service (0x27B1). Telemetry
  // still flows via I²C → dial → mobile; BLE is only for OTA + version.
  // Mirrors the charger's top-level BLE state fields (not chargerData — the
  // controller has no charger-equivalent data model on BLE).
  controllerBleStatus: BleStatus;
  // Last-known controller device ID. Mirrors `chargerDeviceId` so the
  // Settings Bluetooth row can render a stable identifier hint underneath
  // the "Controller" label. Populated when the unified scan effect
  // auto-connects (AppNavigator) or when `ControllerBleManager.connect`
  // persists the ID. Cleared on explicit Disconnect from Settings.
  controllerDeviceId: string | null;
  // Device reference — needed by otaOrchestrator for the post-OTA reconnect
  // flow. Same pattern as the charger's implicit device tracking inside
  // ChargerBleManager; exposed here so AppNavigator can read it when needed.
  controllerDevice: Device | null;
  // Controller firmware version — same shape and persistence contract as
  // `chargerFirmwareVersion` and `dialFirmwareVersion`. Persisted so the
  // Settings "Controller" row shows the last-known version immediately on
  // launch before BLE reconnect. Never cleared on transient disconnects;
  // only reset by store.reset().
  controllerFirmwareVersion: string | null;
  controllerError: string | null;

  // ── OTA: per-target release + flow state ────────────────────────────────
  // One slice per firmware target. Each slice is populated by
  // services/githubReleases.ts (release metadata) and services/otaController.ts
  // (state + progress + error). Mutators take `target` as their first arg
  // so the same setter drives all three targets.
  //
  // Persistence (see partialize below):
  //   - `latestRelease` and `latestReleaseCheckedAt` PERSIST per target so
  //     the banner / settings can render immediately at next launch.
  //   - `state`, `progress`, `error` do NOT persist — they reset to baseline
  //     on every launch.
  ota: Record<OtaTarget, OtaSlice>;

  // Scan trigger — incrementing forces the unified scan effect to re-run
  // even when bleStatus / chargerBleStatus haven't changed value.
  scanTrigger: number;

  // App's own versionName / versionCode (read once at boot from native via
  // services/appVersion.ts). Persisted so the Settings "App" row doesn't flash
  // an em-dash on cold start before init resolves — the value rarely changes
  // and we'll overwrite it on the next boot anyway.
  appVersion: string | null;
  appBuildNumber: string | null;

  // ── Mobile self-update: latest GitHub release (detection only) ──────────
  // Populated by services/githubReleases.ts (mobile config) when a fresh
  // `mobile-v*` release is found. Persisted via partialize so the red dot can
  // render immediately at next launch. Only overwritten when a fresh fetch
  // returns a different shape, never reset on launch. Cleared explicitly only
  // by store.reset().
  //
  // `latestAppReleaseAssetUrl` / `latestAppReleaseSha256Url` are consumed by
  // `prepareAppPayload` (download + verify) and the verified APK is handed
  // off to `apkInstaller.installApk`.
  //
  // Kept as top-level fields (not folded into `ota`) because the mobile
  // self-update asset is an .apk, not a firmware .bin, and the install path
  // is system-level rather than BLE OTA — different shape, different
  // controller, different state machine semantics post-handoff.
  latestAppReleaseTag: string | null; // e.g. "mobile-v0.3.4"
  latestAppReleaseVersion: string | null; // e.g. "0.3.4"
  latestAppReleaseUrl: string | null; // GitHub HTML URL (changelog target)
  latestAppReleaseAssetUrl: string | null; // browser_download_url for .apk
  latestAppReleaseSha256Url: string | null; // browser_download_url for .apk.sha256
  latestAppReleaseSize: number | null; // bytes
  latestAppReleaseCheckedAt: number | null; // Date.now() of last check (success OR 304)
  latestAppReleaseEtag: string | null; // last ETag for conditional GET

  // App-update flow state — NOT persisted (resets on every launch).
  appUpdateState:
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'installing'
    | 'error';
  appUpdateError: string | null;
  // Ephemeral progress (mirrors the charger pattern, but kept in its own
  // fields so the two state machines can run independently without one
  // accidentally clearing the other's display). Reset at every state boundary
  // that isn't actively downloading. NOT persisted.
  appUpdateProgress: number; // 0..1
  appUpdateBytesReceived: number | null;
  appUpdateBytesTotal: number | null;

  // Persisted settings
  showGearTab: boolean;
  speedUnit: 'kmh' | 'mph';
  hudAutoBrighten: boolean;
  hudBrightenOnlyWhenCharging: boolean;
  debugBt: boolean;
  chargeTimeExtendMinutes: number;
  notificationsEnabled: boolean;
  notificationMode: 'time' | 'soc';
  chargeTimeWarnMinutes: number;
  socWarnThresholdPct: number;
  // Optional peripheral toggles — both default ON so existing users see no
  // change on first launch after upgrading. When disabled, all UI surface
  // area for the peripheral hides and the auto-connect path skips it.
  // BLE plumbing (managers, store slices) is intentionally NOT torn down —
  // re-enabling should be cheap.
  dialEnabled: boolean;
  chargerEnabled: boolean;

  // Actions (peripheral)
  setBleStatus: (status: BleStatus) => void;
  setDeviceId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setTelemetry: (data: Telemetry | null) => void;
  setChargerConfig: (config: ChargerConfig | null) => void;

  // Actions (charger direct)
  setChargerBleStatus: (s: BleStatus) => void;
  setChargerDeviceId: (id: string | null) => void;
  setChargerError: (e: string | null) => void;
  setChargerData: (d: ChargerDirectData | null) => void;
  setChargerFirmwareVersion: (v: string | null) => void;
  setDialFirmwareVersion: (v: string | null) => void;

  // Actions (controller BLE)
  setControllerBleStatus: (s: BleStatus) => void;
  setControllerDeviceId: (id: string | null) => void;
  setControllerDevice: (d: Device | null) => void;
  setControllerFirmwareVersion: (v: string | null) => void;
  setControllerError: (e: string | null) => void;

  // ── Actions (per-target OTA) ────────────────────────────────────────────
  // Every mutator takes `target` first; the rest mirrors the pre-refactor
  // single-target signatures.
  setLatestRelease: (
    target: OtaTarget,
    info: {
      tag: string;
      version: string;
      htmlUrl: string;
      binAssetUrl: string;
      binAssetSize: number;
      sha256AssetUrl: string;
      releaseNotes: string;
      publishedAt: string | null;
      etag: string | null;
    } | null,
    checkedAt: number,
  ) => void;
  setOtaState: (target: OtaTarget, s: OtaState) => void;
  setOtaError: (target: OtaTarget, e: string | null) => void;
  // Explicit progress setters. `setOtaProgress` accepts both the 0..1
  // fraction and the optional received/total byte counts. Pass nulls to
  // clear bytes display (e.g. when entering 'verifying' or 'ready').
  setOtaProgress: (
    target: OtaTarget,
    frac: number,
    received?: number | null,
    total?: number | null,
  ) => void;
  resetOtaProgress: (target: OtaTarget) => void;
  // Bumps `latestReleaseCheckedAt` only — used after a 304 response so the
  // "Last checked" timestamp updates without disturbing the cached fields.
  touchLatestReleaseCheckedAt: (target: OtaTarget, checkedAt: number) => void;

  // Actions (scan trigger)
  incrementScanTrigger: () => void;

  // Actions (app version)
  setAppVersion: (version: string, build: string) => void;

  // Actions (mobile self-update)
  // Mirrors setLatestRelease for the charger. Pass `null` to clear, a
  // populated object to overwrite. `checkedAt` is ALWAYS updated; the rest
  // only when info is non-null.
  setLatestAppRelease: (
    info: {
      tag: string;
      version: string;
      htmlUrl: string;
      apkAssetUrl: string;
      apkAssetSize: number;
      sha256AssetUrl: string;
      etag: string | null;
    } | null,
    checkedAt: number,
  ) => void;
  setAppUpdateState: (
    s:
      | 'idle'
      | 'checking'
      | 'downloading'
      | 'verifying'
      | 'ready'
      | 'installing'
      | 'error',
  ) => void;
  setAppUpdateError: (e: string | null) => void;
  // Explicit progress setters mirroring setOtaProgress / reset.
  setAppUpdateProgress: (
    frac: number,
    received?: number | null,
    total?: number | null,
  ) => void;
  resetAppUpdateProgress: () => void;
  // Used after a 304 response so the "Last checked" timestamp updates without
  // disturbing the cached fields. Mirrors the charger's touch fn.
  touchLatestAppReleaseCheckedAt: (checkedAt: number) => void;

  // Actions (settings)
  setShowGearTab: (show: boolean) => void;
  setSpeedUnit: (unit: 'kmh' | 'mph') => void;
  setHudAutoBrighten: (v: boolean) => void;
  setHudBrightenOnlyWhenCharging: (v: boolean) => void;
  setDebugBt: (v: boolean) => void;
  setChargeTimeExtendMinutes: (v: number) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setNotificationMode: (v: 'time' | 'soc') => void;
  setChargeTimeWarnMinutes: (v: number) => void;
  setSocWarnThresholdPct: (v: number) => void;
  setDialEnabled: (v: boolean) => void;
  setChargerEnabled: (v: boolean) => void;
  reset: () => void;
}

/**
 * Helper: merge a partial slice into the existing target slice without
 * touching any other target. Centralised here so every setter has the same
 * shape and we never accidentally clobber sibling targets.
 */
function patchTarget(
  state: AppState,
  target: OtaTarget,
  patch: Partial<OtaSlice>,
): Pick<AppState, 'ota'> {
  return {
    ota: {
      ...state.ota,
      [target]: {
        ...state.ota[target],
        ...patch,
      },
    },
  };
}

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      // Initial state — peripheral
      bleStatus: 'disconnected',
      deviceId: null,
      error: null,
      telemetry: null,
      chargerConfig: null,

      // Initial state — charger direct
      chargerBleStatus: 'disconnected',
      chargerDeviceId: null,
      chargerError: null,
      chargerData: null,
      chargerFirmwareVersion: null,
      dialFirmwareVersion: null,

      // Initial state — controller BLE
      controllerBleStatus: 'disconnected',
      controllerDeviceId: null,
      controllerDevice: null,
      controllerFirmwareVersion: null,
      controllerError: null,

      // Initial state — OTA (per-target). Persisted slices (latestRelease +
      // latestReleaseCheckedAt) hydrate via partialize on top of these
      // defaults; volatile fields (state/progress/error) stay at the
      // baseline values defined here on every launch.
      ota: {
        charger: {...EMPTY_SLICE, latestRelease: {...EMPTY_RELEASE}, progress: {...EMPTY_PROGRESS}},
        dial: {...EMPTY_SLICE, latestRelease: {...EMPTY_RELEASE}, progress: {...EMPTY_PROGRESS}},
        controller: {...EMPTY_SLICE, latestRelease: {...EMPTY_RELEASE}, progress: {...EMPTY_PROGRESS}},
      },

      // Initial state — scan trigger
      scanTrigger: 0,

      // Initial state — app version (overwritten at boot by services/appVersion.ts)
      appVersion: null,
      appBuildNumber: null,

      // Initial state — mobile self-update. Persisted fields are hydrated by
      // zustand-persist; this initializer only runs on first launch / after
      // store.reset().
      latestAppReleaseTag: null,
      latestAppReleaseVersion: null,
      latestAppReleaseUrl: null,
      latestAppReleaseAssetUrl: null,
      latestAppReleaseSha256Url: null,
      latestAppReleaseSize: null,
      latestAppReleaseCheckedAt: null,
      latestAppReleaseEtag: null,
      appUpdateState: 'idle',
      appUpdateError: null,
      appUpdateProgress: 0,
      appUpdateBytesReceived: null,
      appUpdateBytesTotal: null,

      // Initial state — settings
      showGearTab: false,
      speedUnit: 'kmh',
      hudAutoBrighten: true,
      hudBrightenOnlyWhenCharging: true,
      debugBt: false,
      chargeTimeExtendMinutes: 15,
      notificationsEnabled: true,
      notificationMode: 'time',
      chargeTimeWarnMinutes: 30,
      socWarnThresholdPct: 90,
      // Optional peripherals — default ON so existing installs behave as
      // before. Users explicitly turn these off in Settings → General.
      dialEnabled: true,
      chargerEnabled: true,

      // Actions — peripheral
      setBleStatus: status => set({bleStatus: status}),
      setDeviceId: id => set({deviceId: id}),
      setError: error => set({error}),
      setTelemetry: data => set({telemetry: data}),
      setChargerConfig: config => set({chargerConfig: config}),

      // Actions — charger direct
      setChargerBleStatus: s => set({chargerBleStatus: s}),
      setChargerDeviceId: id => set({chargerDeviceId: id}),
      setChargerError: e => set({chargerError: e}),
      setChargerData: d => set({chargerData: d}),
      setChargerFirmwareVersion: v => set({chargerFirmwareVersion: v}),
      setDialFirmwareVersion: v => set({dialFirmwareVersion: v}),

      // Actions — controller BLE
      setControllerBleStatus: s => set({controllerBleStatus: s}),
      setControllerDeviceId: id => set({controllerDeviceId: id}),
      setControllerDevice: d => set({controllerDevice: d}),
      setControllerFirmwareVersion: v => set({controllerFirmwareVersion: v}),
      setControllerError: e => set({controllerError: e}),

      // Actions — per-target OTA
      // Pass `null` info to clear all release fields (e.g. when GitHub returned
      // an empty list). Pass a populated object to overwrite. `checkedAt` is
      // always updated; the rest only when info is non-null.
      setLatestRelease: (target, info, checkedAt) =>
        set(state =>
          patchTarget(state, target, {
            latestRelease: info
              ? {
                  tag: info.tag,
                  version: info.version,
                  htmlUrl: info.htmlUrl,
                  binAssetUrl: info.binAssetUrl,
                  binAssetSize: info.binAssetSize,
                  sha256AssetUrl: info.sha256AssetUrl,
                  releaseNotes: info.releaseNotes,
                  publishedAt: info.publishedAt ?? null,
                  etag: info.etag,
                }
              : {...EMPTY_RELEASE},
            latestReleaseCheckedAt: checkedAt,
          }),
        ),
      setOtaState: (target, s) =>
        set(state => patchTarget(state, target, {state: s})),
      setOtaError: (target, e) =>
        set(state => patchTarget(state, target, {error: e})),
      setOtaProgress: (target, frac, received = null, total = null) =>
        set(state =>
          patchTarget(state, target, {
            progress: {
              frac: Math.max(0, Math.min(1, frac)),
              received,
              total,
            },
          }),
        ),
      resetOtaProgress: target =>
        set(state =>
          patchTarget(state, target, {progress: {...EMPTY_PROGRESS}}),
        ),
      touchLatestReleaseCheckedAt: (target, checkedAt) =>
        set(state =>
          patchTarget(state, target, {latestReleaseCheckedAt: checkedAt}),
        ),

      // Actions — scan trigger
      incrementScanTrigger: () => set(state => ({scanTrigger: state.scanTrigger + 1})),

      // Actions — app version
      setAppVersion: (version, build) =>
        set({appVersion: version, appBuildNumber: build}),

      // Actions — mobile self-update
      setLatestAppRelease: (info, checkedAt) =>
        set(
          info
            ? {
                latestAppReleaseTag: info.tag,
                latestAppReleaseVersion: info.version,
                latestAppReleaseUrl: info.htmlUrl,
                latestAppReleaseAssetUrl: info.apkAssetUrl,
                latestAppReleaseSha256Url: info.sha256AssetUrl,
                latestAppReleaseSize: info.apkAssetSize,
                latestAppReleaseCheckedAt: checkedAt,
                latestAppReleaseEtag: info.etag,
              }
            : {
                latestAppReleaseTag: null,
                latestAppReleaseVersion: null,
                latestAppReleaseUrl: null,
                latestAppReleaseAssetUrl: null,
                latestAppReleaseSha256Url: null,
                latestAppReleaseSize: null,
                latestAppReleaseCheckedAt: checkedAt,
                latestAppReleaseEtag: null,
              },
        ),
      setAppUpdateState: s => set({appUpdateState: s}),
      setAppUpdateError: e => set({appUpdateError: e}),
      setAppUpdateProgress: (frac, received = null, total = null) =>
        set({
          appUpdateProgress: Math.max(0, Math.min(1, frac)),
          appUpdateBytesReceived: received,
          appUpdateBytesTotal: total,
        }),
      resetAppUpdateProgress: () =>
        set({
          appUpdateProgress: 0,
          appUpdateBytesReceived: null,
          appUpdateBytesTotal: null,
        }),
      touchLatestAppReleaseCheckedAt: checkedAt =>
        set({latestAppReleaseCheckedAt: checkedAt}),

      // Actions — settings
      setShowGearTab: show => set({showGearTab: show}),
      setSpeedUnit: unit => set({speedUnit: unit}),
      setHudAutoBrighten: v => set({hudAutoBrighten: v}),
      setHudBrightenOnlyWhenCharging: v => set({hudBrightenOnlyWhenCharging: v}),
      setDebugBt: v => set({debugBt: v}),
      setChargeTimeExtendMinutes: v => set({chargeTimeExtendMinutes: v}),
      setNotificationsEnabled: v => set({notificationsEnabled: v}),
      setNotificationMode: v => set({notificationMode: v}),
      setChargeTimeWarnMinutes: v => set({chargeTimeWarnMinutes: v}),
      setSocWarnThresholdPct: v => set({socWarnThresholdPct: v}),
      setDialEnabled: v => set({dialEnabled: v}),
      setChargerEnabled: v => set({chargerEnabled: v}),
      reset: () =>
        set({
          bleStatus: 'disconnected',
          deviceId: null,
          error: null,
          telemetry: null,
          chargerConfig: null,
          chargerBleStatus: 'disconnected',
          chargerDeviceId: null,
          chargerError: null,
          chargerData: null,
          chargerFirmwareVersion: null,
          dialFirmwareVersion: null,
          controllerBleStatus: 'disconnected',
          controllerDeviceId: null,
          controllerDevice: null,
          controllerFirmwareVersion: null,
          controllerError: null,
          ota: {
            charger: {...EMPTY_SLICE, latestRelease: {...EMPTY_RELEASE}, progress: {...EMPTY_PROGRESS}},
            dial: {...EMPTY_SLICE, latestRelease: {...EMPTY_RELEASE}, progress: {...EMPTY_PROGRESS}},
            controller: {...EMPTY_SLICE, latestRelease: {...EMPTY_RELEASE}, progress: {...EMPTY_PROGRESS}},
          },
          latestAppReleaseTag: null,
          latestAppReleaseVersion: null,
          latestAppReleaseUrl: null,
          latestAppReleaseAssetUrl: null,
          latestAppReleaseSha256Url: null,
          latestAppReleaseSize: null,
          latestAppReleaseCheckedAt: null,
          latestAppReleaseEtag: null,
          appUpdateState: 'idle',
          appUpdateError: null,
          appUpdateProgress: 0,
          appUpdateBytesReceived: null,
          appUpdateBytesTotal: null,
        }),
    }),
    {
      name: 'pao-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        showGearTab: state.showGearTab,
        speedUnit: state.speedUnit,
        hudAutoBrighten: state.hudAutoBrighten,
        hudBrightenOnlyWhenCharging: state.hudBrightenOnlyWhenCharging,
        debugBt: state.debugBt,
        // Optional peripheral toggles. Defaults of `true` in the initialiser
        // ensure first-launch (no persisted value) shows everything; an
        // explicit `false` here flips off all dial-/charger-associated UI.
        dialEnabled: state.dialEnabled,
        chargerEnabled: state.chargerEnabled,
        chargeTimeExtendMinutes: state.chargeTimeExtendMinutes,
        notificationsEnabled: state.notificationsEnabled,
        notificationMode: state.notificationMode,
        chargeTimeWarnMinutes: state.chargeTimeWarnMinutes,
        socWarnThresholdPct: state.socWarnThresholdPct,
        chargerFirmwareVersion: state.chargerFirmwareVersion,
        dialFirmwareVersion: state.dialFirmwareVersion,
        controllerFirmwareVersion: state.controllerFirmwareVersion,
        // OTA — persist `latestRelease` and `latestReleaseCheckedAt` for
        // every target so banners / settings can render without a network
        // round-trip on cold launch. `state`/`progress`/`error` are
        // intentionally omitted — they describe an in-flight transfer and
        // are meaningless across launches (they reset to baseline via the
        // initialiser above).
        //
        // NOTE: persisting the entire `latestRelease` blob (not just etag +
        // checkedAt) is REQUIRED for the existing charger UX — Phase 3
        // (decision #50) relies on the banner rendering instantly at next
        // launch from the cached tag/version/URLs. Keep this behaviour
        // identical across all targets.
        ota: {
          charger: {
            latestRelease: state.ota.charger.latestRelease,
            latestReleaseCheckedAt: state.ota.charger.latestReleaseCheckedAt,
          },
          dial: {
            latestRelease: state.ota.dial.latestRelease,
            latestReleaseCheckedAt: state.ota.dial.latestReleaseCheckedAt,
          },
          controller: {
            latestRelease: state.ota.controller.latestRelease,
            latestReleaseCheckedAt: state.ota.controller.latestReleaseCheckedAt,
          },
        },
        // App's own version (appVersion / appBuildNumber) is intentionally
        // NOT persisted. Persisting it created a rehydration race after an
        // OTA self-update: the App.tsx init effect would set the new running
        // version synchronously at boot, then AsyncStorage rehydration would
        // overwrite it with the stale previous-launch value. DeviceInfo
        // getVersion() is synchronous on Android, so the "em-dash flash" we
        // were avoiding is effectively a single frame at worst — not worth
        // the bug. These now live as ephemeral fields read fresh every boot.
        // Mobile self-update — persisted release-metadata fields.
        // appUpdateState / appUpdateError NOT included (deliberate — they
        // should reset to 'idle'/null on every launch, same pattern as the
        // charger's otaState/otaError).
        latestAppReleaseTag: state.latestAppReleaseTag,
        latestAppReleaseVersion: state.latestAppReleaseVersion,
        latestAppReleaseUrl: state.latestAppReleaseUrl,
        latestAppReleaseAssetUrl: state.latestAppReleaseAssetUrl,
        latestAppReleaseSha256Url: state.latestAppReleaseSha256Url,
        latestAppReleaseSize: state.latestAppReleaseSize,
        latestAppReleaseCheckedAt: state.latestAppReleaseCheckedAt,
        latestAppReleaseEtag: state.latestAppReleaseEtag,
      }),
      // Zustand-persist deep-merges the partialize result into the in-memory
      // initial state. For nested objects (like `ota.charger`), only the
      // explicitly-persisted KEYS overwrite — the volatile fields (state /
      // progress / error) keep their initial values. We rely on default
      // merge behavior here; if a future Zustand upgrade swaps to a
      // shallow-merge default for arbitrary nesting, we'll need a custom
      // `merge` fn that preserves the slice shape for ota[target].
      merge: (persisted, current) => {
        // Defensive: tolerate legacy persisted state where `ota` was missing
        // or partial (older builds had top-level `latestRelease*` fields).
        // Fill any missing target slice with current's defaults to avoid
        // `undefined` deref in selectors.
        const p = (persisted ?? {}) as Partial<AppState>;
        const persistedOta = (p.ota ?? {}) as Partial<Record<OtaTarget, Partial<OtaSlice>>>;
        const merged: AppState = {
          ...current,
          ...p,
          ota: {
            charger: {
              ...current.ota.charger,
              ...(persistedOta.charger ?? {}),
              // Always restore volatile fields to their baseline.
              state: current.ota.charger.state,
              progress: current.ota.charger.progress,
              error: current.ota.charger.error,
            },
            dial: {
              ...current.ota.dial,
              ...(persistedOta.dial ?? {}),
              state: current.ota.dial.state,
              progress: current.ota.dial.progress,
              error: current.ota.dial.error,
            },
            controller: {
              ...current.ota.controller,
              ...(persistedOta.controller ?? {}),
              state: current.ota.controller.state,
              progress: current.ota.controller.progress,
              error: current.ota.controller.error,
            },
          },
        };
        return merged;
      },
    },
  ),
);
