import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {BleStatus, Telemetry, ChargerConfig, ChargerDirectData} from '../types';

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

  // ── OTA: latest GitHub release (Phase 3 — read-only detection) ──────────
  // All `latestRelease*` fields are populated by services/githubReleases.ts
  // when a fresh `charger-v*` release is found. They're persisted via
  // partialize so the banner can render immediately at next launch — only
  // overwritten when a fresh fetch returns a different shape, never reset
  // on launch. Cleared explicitly only by store.reset().
  latestReleaseTag: string | null; // e.g. "charger-v0.1.0"
  latestReleaseVersion: string | null; // e.g. "0.1.0"
  latestReleaseUrl: string | null; // GitHub HTML URL
  latestReleaseBinUrl: string | null; // browser_download_url for .bin
  latestReleaseSha256Url: string | null; // browser_download_url for .bin.sha256
  latestReleaseSize: number | null; // bytes
  latestReleaseNotes: string | null; // markdown body
  latestReleaseCheckedAt: number | null; // Date.now() of last check (success OR 304)
  latestReleaseEtag: string | null; // last ETag for conditional GET

  // OTA flow state — NOT persisted (resets on every launch).
  // Phase 4 extends this enum: 'downloading' (fetching .bin),
  // 'verifying' (computing SHA256), 'ready' (verified, bytes in memory).
  // Phase 5 adds the flash states:
  //   'transferring'  — bytes streaming to charger via 0xFF26
  //   'rebooting'     — charger received OTA_END, restarting
  //   'reconnecting'  — scanning + reconnecting to the new image
  //   'finalizing'    — sending CMD_OTA_VERIFY, awaiting VERIFIED notify
  //   'done'          — success terminal; UI auto-clears to 'idle' after a beat
  otaState:
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
  otaError: string | null;
  // Phase 4 ephemeral progress fields. Live alongside `otaProgress`
  // (already 0..1). Set during 'downloading' from the streaming/arrayBuffer
  // progress callback in `firmwareDownload.ts`. Both reset to null at every
  // phase boundary that isn't actively downloading. NOT persisted — these
  // describe an in-flight transfer and are meaningless across launches.
  otaProgress: number; // 0..1, set explicitly at phase boundaries
  otaBytesReceived: number | null;
  otaBytesTotal: number | null;

  // Scan trigger — incrementing forces the unified scan effect to re-run
  // even when bleStatus / chargerBleStatus haven't changed value.
  scanTrigger: number;

  // App's own versionName / versionCode (read once at boot from native via
  // services/appVersion.ts). Persisted so the Settings "App" row doesn't flash
  // an em-dash on cold start before init resolves — the value rarely changes
  // and we'll overwrite it on the next boot anyway. Phase 1 of mobile
  // self-update: display-only.
  appVersion: string | null;
  appBuildNumber: string | null;

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

  // Actions (OTA — Phase 3)
  setLatestRelease: (
    info: {
      tag: string;
      version: string;
      htmlUrl: string;
      binAssetUrl: string;
      binAssetSize: number;
      sha256AssetUrl: string;
      releaseNotes: string;
      etag: string | null;
    } | null,
    checkedAt: number,
  ) => void;
  setOtaState: (
    s:
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
      | 'error',
  ) => void;
  setOtaError: (e: string | null) => void;
  // Phase 4 — explicit progress setters. `setOtaProgress` accepts both the
  // 0..1 fraction and the optional received/total byte counts. Pass nulls
  // to clear bytes display (e.g. when entering 'verifying' or 'ready').
  setOtaProgress: (
    frac: number,
    received?: number | null,
    total?: number | null,
  ) => void;
  resetOtaProgress: () => void;
  // Bumps `latestReleaseCheckedAt` only — used after a 304 response so the
  // "Last checked" timestamp updates without disturbing the cached fields.
  touchLatestReleaseCheckedAt: (checkedAt: number) => void;

  // Actions (scan trigger)
  incrementScanTrigger: () => void;

  // Actions (app version)
  setAppVersion: (version: string, build: string) => void;

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
  reset: () => void;
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

      // Initial state — OTA (Phase 3 — release metadata is persisted, but the
      // initializer here only runs on first launch / after store.reset()).
      latestReleaseTag: null,
      latestReleaseVersion: null,
      latestReleaseUrl: null,
      latestReleaseBinUrl: null,
      latestReleaseSha256Url: null,
      latestReleaseSize: null,
      latestReleaseNotes: null,
      latestReleaseCheckedAt: null,
      latestReleaseEtag: null,
      otaState: 'idle',
      otaError: null,
      otaProgress: 0,
      otaBytesReceived: null,
      otaBytesTotal: null,

      // Initial state — scan trigger
      scanTrigger: 0,

      // Initial state — app version (overwritten at boot by services/appVersion.ts)
      appVersion: null,
      appBuildNumber: null,

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

      // Actions — OTA (Phase 3)
      // Pass `null` to clear all release fields (e.g. when GitHub returned
      // an empty list). Pass a populated object to overwrite. `checkedAt` is
      // always updated; the rest only when info is non-null.
      setLatestRelease: (info, checkedAt) =>
        set(
          info
            ? {
                latestReleaseTag: info.tag,
                latestReleaseVersion: info.version,
                latestReleaseUrl: info.htmlUrl,
                latestReleaseBinUrl: info.binAssetUrl,
                latestReleaseSha256Url: info.sha256AssetUrl,
                latestReleaseSize: info.binAssetSize,
                latestReleaseNotes: info.releaseNotes,
                latestReleaseCheckedAt: checkedAt,
                latestReleaseEtag: info.etag,
              }
            : {
                latestReleaseTag: null,
                latestReleaseVersion: null,
                latestReleaseUrl: null,
                latestReleaseBinUrl: null,
                latestReleaseSha256Url: null,
                latestReleaseSize: null,
                latestReleaseNotes: null,
                latestReleaseCheckedAt: checkedAt,
                latestReleaseEtag: null,
              },
        ),
      setOtaState: s => set({otaState: s}),
      setOtaError: e => set({otaError: e}),
      setOtaProgress: (frac, received = null, total = null) =>
        set({
          otaProgress: Math.max(0, Math.min(1, frac)),
          otaBytesReceived: received,
          otaBytesTotal: total,
        }),
      resetOtaProgress: () =>
        set({otaProgress: 0, otaBytesReceived: null, otaBytesTotal: null}),
      touchLatestReleaseCheckedAt: checkedAt =>
        set({latestReleaseCheckedAt: checkedAt}),

      // Actions — scan trigger
      incrementScanTrigger: () => set(state => ({scanTrigger: state.scanTrigger + 1})),

      // Actions — app version
      setAppVersion: (version, build) =>
        set({appVersion: version, appBuildNumber: build}),

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
          latestReleaseTag: null,
          latestReleaseVersion: null,
          latestReleaseUrl: null,
          latestReleaseBinUrl: null,
          latestReleaseSha256Url: null,
          latestReleaseSize: null,
          latestReleaseNotes: null,
          latestReleaseCheckedAt: null,
          latestReleaseEtag: null,
          otaState: 'idle',
          otaError: null,
          otaProgress: 0,
          otaBytesReceived: null,
          otaBytesTotal: null,
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
        chargeTimeExtendMinutes: state.chargeTimeExtendMinutes,
        notificationsEnabled: state.notificationsEnabled,
        notificationMode: state.notificationMode,
        chargeTimeWarnMinutes: state.chargeTimeWarnMinutes,
        socWarnThresholdPct: state.socWarnThresholdPct,
        chargerFirmwareVersion: state.chargerFirmwareVersion,
        // OTA — Phase 3 persisted fields. otaState/otaError NOT included
        // (deliberate — they should reset to 'idle'/null on every launch).
        latestReleaseTag: state.latestReleaseTag,
        latestReleaseVersion: state.latestReleaseVersion,
        latestReleaseUrl: state.latestReleaseUrl,
        latestReleaseBinUrl: state.latestReleaseBinUrl,
        latestReleaseSha256Url: state.latestReleaseSha256Url,
        latestReleaseSize: state.latestReleaseSize,
        latestReleaseNotes: state.latestReleaseNotes,
        latestReleaseCheckedAt: state.latestReleaseCheckedAt,
        latestReleaseEtag: state.latestReleaseEtag,
        // App's own version — persisted to avoid an em-dash flash on cold
        // start. Overwritten by initAppVersion() at every boot.
        appVersion: state.appVersion,
        appBuildNumber: state.appBuildNumber,
      }),
    },
  ),
);
