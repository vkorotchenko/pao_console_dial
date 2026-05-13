import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  AppState,
  AppStateStatus,
  StatusBar,
  Platform,
} from 'react-native';
import {Switch, SegmentedButtons, Button} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager} from '../ble/PaoBleManager';
import {chargerBleManager} from '../ble/ChargerBleManager';
import {requestBlePermissions} from '../utils/permissions';
import {
  checkForChargerUpdate,
  checkForUpdate,
  prepareOtaPayload,
  cancelOtaPreparation,
} from '../services/otaController';
import {
  checkForMobileUpdate,
  prepareAppPayload,
  cancelAppUpdatePreparation,
  getReadyAppApkPath,
} from '../services/mobileUpdateController';
import {
  installApk,
  canRequestInstalls,
  openInstallPermissionSettings,
} from '../services/apkInstaller';
import {flashChargerFirmware, flashFirmware} from '../services/otaOrchestrator';
import {formatVersion} from '../services/semver';
import {computeUpdateOffer} from '../services/updateOffer';
import _ScreenBrightness from 'react-native-screen-brightness';
import {activateKeepAwake, deactivateKeepAwake} from '../utils/keepAwake';
import {PageHeader} from '../components/PageHeader';
const ScreenBrightness = _ScreenBrightness as any;

interface SettingsScreenProps {
  onOpenFirmwareInfo?: () => void;
  onOpenAppInfo?: () => void;
  // Initial tab override — set by AppNavigator when returning from
  // FirmwareInfoScreen / AppInfoScreen so the user lands back on the tab
  // they were already looking at (Firmware) instead of always defaulting
  // to Bluetooth. Optional; undefined means use the default initial tab.
  initialTab?: SettingsTab;
}

// Compact form for the in-flight progress UI ("412 KB / 612 KB"). Mirrors the
// helper that used to live in UpdateScreen; pulled in-line since the OTA UI
// now lives here.
//
// Defensive against null / NaN / non-finite. During post-transfer phases
// (rebooting / reconnecting / finalizing / done) the byte counters can be
// null or zero, and we'd rather render an em-dash than crash on
// `null.toFixed()`. Callers should still guard the *line* itself when bytes
// are missing — this is belt-and-suspenders.
function formatBytesShort(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

const PAO_DEVICE_ID_KEY = 'pao_device_id';
const CHARGER_DEVICE_ID_KEY = 'charger_device_id';

// Tiny relative-time formatter for the "Last checked" line. Intentionally
// coarse — we don't need second-level granularity here.
function formatRelative(now: number, then: number | null): string {
  if (then === null) {
    return 'Never';
  }
  const deltaMs = now - then;
  if (deltaMs < 0) {
    // Clock skew — clamp to "Just now".
    return 'Just now';
  }
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) {
    return 'Just now';
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min} minute${min === 1 ? '' : 's'} ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Settings is now a 4-tab screen. Tap-only top tab bar (no swipe / no
// PagerView) — keeping the UX dead simple and avoiding a new dependency.
// Each tab mounts its own ScrollView so long tabs (Charging in particular,
// which holds Charging + Notifications) scroll independently and tab swaps
// reset scroll position cleanly.
type SettingsTab = 'bluetooth' | 'charging' | 'firmware' | 'display';

const TABS: ReadonlyArray<{key: SettingsTab; label: string}> = [
  {key: 'display', label: 'Display'},
  {key: 'charging', label: 'Charging'},
  {key: 'bluetooth', label: 'Bluetooth'},
  {key: 'firmware', label: 'Firmware'},
];

export default function SettingsScreen({onOpenFirmwareInfo, onOpenAppInfo, initialTab}: SettingsScreenProps = {}) {
  const bleStatus = useAppStore(state => state.bleStatus);
  const deviceId = useAppStore(state => state.deviceId);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);
  const chargerDeviceId = useAppStore(state => state.chargerDeviceId);
  const setChargerData = useAppStore(state => state.setChargerData);
  const showGearTab = useAppStore(state => state.showGearTab);
  const setShowGearTab = useAppStore(state => state.setShowGearTab);
  const speedUnit = useAppStore(state => state.speedUnit);
  const setSpeedUnit = useAppStore(state => state.setSpeedUnit);
  const hudAutoBrighten = useAppStore(state => state.hudAutoBrighten);
  const setHudAutoBrighten = useAppStore(state => state.setHudAutoBrighten);
  const hudBrightenOnlyWhenCharging = useAppStore(state => state.hudBrightenOnlyWhenCharging);
  const setHudBrightenOnlyWhenCharging = useAppStore(state => state.setHudBrightenOnlyWhenCharging);
  const debugBt = useAppStore(state => state.debugBt);
  const setDebugBt = useAppStore(state => state.setDebugBt);
  const chargeTimeExtendMinutes = useAppStore(state => state.chargeTimeExtendMinutes);
  const setChargeTimeExtendMinutes = useAppStore(state => state.setChargeTimeExtendMinutes);
  const notificationsEnabled = useAppStore(state => state.notificationsEnabled);
  const setNotificationsEnabled = useAppStore(state => state.setNotificationsEnabled);
  const notificationMode = useAppStore(state => state.notificationMode);
  const setNotificationMode = useAppStore(state => state.setNotificationMode);
  const chargeTimeWarnMinutes = useAppStore(state => state.chargeTimeWarnMinutes);
  const setChargeTimeWarnMinutes = useAppStore(state => state.setChargeTimeWarnMinutes);
  const socWarnThresholdPct = useAppStore(state => state.socWarnThresholdPct);
  const setSocWarnThresholdPct = useAppStore(state => state.setSocWarnThresholdPct);
  const chargerFirmwareVersion = useAppStore(state => state.chargerFirmwareVersion);
  // Per-target OTA selectors. Charger + dial both wired in Stream 2 —
  // controller UI lands in Stream 3 once Bart's controller OTA chars ship.
  const otaState = useAppStore(state => state.ota.charger.state);
  const otaError = useAppStore(state => state.ota.charger.error);
  const otaProgress = useAppStore(state => state.ota.charger.progress.frac);
  const otaBytesReceived = useAppStore(
    state => state.ota.charger.progress.received,
  );
  const otaBytesTotal = useAppStore(state => state.ota.charger.progress.total);
  const latestReleaseCheckedAt = useAppStore(
    state => state.ota.charger.latestReleaseCheckedAt,
  );
  const latestReleaseVersion = useAppStore(
    state => state.ota.charger.latestRelease.version,
  );
  // ── Dial OTA selectors (Phase 5 mobile — Stream 2) ─────────────────────
  // Mirrors the charger selectors above. `dialFirmwareVersion` is the
  // currently-running version (top-level, persisted via partialize like
  // chargerFirmwareVersion). The `ota.dial.*` slice is the multi-target
  // shape from Decision #60.
  const dialFirmwareVersion = useAppStore(state => state.dialFirmwareVersion);
  const dialOtaState = useAppStore(state => state.ota.dial.state);
  const dialOtaError = useAppStore(state => state.ota.dial.error);
  const dialOtaProgress = useAppStore(state => state.ota.dial.progress.frac);
  const dialOtaBytesReceived = useAppStore(
    state => state.ota.dial.progress.received,
  );
  const dialOtaBytesTotal = useAppStore(
    state => state.ota.dial.progress.total,
  );
  const dialLatestReleaseCheckedAt = useAppStore(
    state => state.ota.dial.latestReleaseCheckedAt,
  );
  const dialLatestReleaseVersion = useAppStore(
    state => state.ota.dial.latestRelease.version,
  );
  // ── Controller OTA selectors (Stream 3 mobile) ───────────────────────────
  // Mirrors the dial selectors above. Controller is OTA-only (no telemetry
  // on BLE) so there are no chargerData equivalents — just version + OTA state.
  const controllerBleStatus = useAppStore(state => state.controllerBleStatus);
  const controllerFirmwareVersion = useAppStore(
    state => state.controllerFirmwareVersion,
  );
  const controllerOtaState = useAppStore(state => state.ota.controller.state);
  const controllerOtaError = useAppStore(
    state => state.ota.controller.error,
  );
  const controllerOtaProgress = useAppStore(
    state => state.ota.controller.progress.frac,
  );
  const controllerOtaBytesReceived = useAppStore(
    state => state.ota.controller.progress.received,
  );
  const controllerOtaBytesTotal = useAppStore(
    state => state.ota.controller.progress.total,
  );
  const controllerLatestReleaseCheckedAt = useAppStore(
    state => state.ota.controller.latestReleaseCheckedAt,
  );
  const controllerLatestReleaseVersion = useAppStore(
    state => state.ota.controller.latestRelease.version,
  );
  // App self-update — running app versionName plus detection fields
  // (latestAppReleaseVersion, etc) so the App row mirrors the Firmware row's
  // red-dot + "Latest available" hint + contextual button pattern.
  const appVersion = useAppStore(state => state.appVersion);
  const latestAppReleaseVersion = useAppStore(
    state => state.latestAppReleaseVersion,
  );
  const latestAppReleaseCheckedAt = useAppStore(
    state => state.latestAppReleaseCheckedAt,
  );
  const appUpdateState = useAppStore(state => state.appUpdateState);
  const appUpdateError = useAppStore(state => state.appUpdateError);
  const appUpdateProgress = useAppStore(state => state.appUpdateProgress);
  const appUpdateBytesReceived = useAppStore(
    state => state.appUpdateBytesReceived,
  );
  const appUpdateBytesTotal = useAppStore(state => state.appUpdateBytesTotal);

  // ── OTA flash flow state (consolidated into Settings) ──────────────────
  // AbortController for the live flash run. We mirror the lifecycle that used
  // to live in UpdateScreen: own the controller in a ref so the user can
  // cancel a transferring flash, recreate on each fresh attempt, and abort on
  // unmount. Wake-lock is provided by a tiny in-tree native module
  // (`KeepAwakeModule.kt` → `utils/keepAwake.ts`) that toggles
  // FLAG_KEEP_SCREEN_ON on the Activity window — replaces the abandoned
  // `react-native-keep-awake` library that broke Gradle 9 CI builds.
  const flashAbortRef = useRef<AbortController | null>(null);
  // Independent AbortController for the dial flash — dial + charger can be
  // updated in the same session (just not literally concurrently, since
  // there's only one phone). Keeping the refs separate so a charger flash
  // doesn't inadvertently cancel a dial flash mid-run, or vice versa.
  const dialFlashAbortRef = useRef<AbortController | null>(null);
  // Independent AbortController for the controller flash — mirrors the
  // dial ref above. Controller OTA runs through the same orchestrator path.
  const controllerFlashAbortRef = useRef<AbortController | null>(null);
  const [hasWriteSettings, setHasWriteSettings] = useState<boolean | null>(null);
  // Tick once a minute so the "Last checked" relative time updates without
  // forcing a re-render of the rest of the screen. Cheap; runs only while
  // SettingsScreen is mounted.
  const [now, setNow] = useState(Date.now());

  // Tap-only tab state. Display is the natural default — first-launch lands
  // on the most general configuration tab. When AppNavigator passes an
  // `initialTab` (set when returning from FirmwareInfoScreen / AppInfoScreen),
  // seed the active tab from it so the user lands back where they were
  // instead of being bounced to the default.
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab ?? 'display',
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    ScreenBrightness.hasPermission().then(setHasWriteSettings).catch(() => setHasWriteSettings(false));
  }, []);

  const requestWriteSettings = async () => {
    await ScreenBrightness.requestPermission();
    // Re-check after returning from settings
    setTimeout(async () => {
      const has = await ScreenBrightness.hasPermission().catch(() => false);
      setHasWriteSettings(has);
    }, 500);
  };

  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isRequestingChargerPermission, setIsRequestingChargerPermission] = useState(false);

  // Peripheral BLE helpers
  const canDisconnect =
    bleStatus === 'connected' || bleStatus === 'connecting' || bleStatus === 'scanning';
  const isScanning = bleStatus === 'scanning';

  const statusColor =
    bleStatus === 'connected'
      ? '#4cff91'
      : bleStatus === 'scanning' || bleStatus === 'connecting'
      ? '#FFC107'
      : '#F44336';

  // Charger BLE helpers
  const canDisconnectCharger =
    chargerBleStatus === 'connected' ||
    chargerBleStatus === 'connecting' ||
    chargerBleStatus === 'scanning';
  const isScanningCharger = chargerBleStatus === 'scanning';

  const chargerStatusColor =
    chargerBleStatus === 'connected'
      ? '#4cff91'
      : chargerBleStatus === 'scanning' || chargerBleStatus === 'connecting'
      ? '#FFC107'
      : '#F44336';

  const handleScan = async () => {
    setIsRequestingPermission(true);
    let granted = false;
    try {
      granted = await requestBlePermissions();
    } finally {
      setIsRequestingPermission(false);
    }

    if (!granted) {
      Alert.alert(
        'Bluetooth Permission Required',
        'Please grant Bluetooth permissions to connect to PAO Console.',
        [{text: 'OK'}],
      );
      return;
    }

    useAppStore.getState().setBleStatus('disconnected');
    useAppStore.getState().incrementScanTrigger();
  };

  const handleDisconnect = () => {
    paoBleManager.disconnect();
    AsyncStorage.removeItem(PAO_DEVICE_ID_KEY).catch(() => {});
  };

  const handleScanCharger = async () => {
    setIsRequestingChargerPermission(true);
    let granted = false;
    try {
      granted = await requestBlePermissions();
    } finally {
      setIsRequestingChargerPermission(false);
    }

    if (!granted) {
      Alert.alert(
        'Bluetooth Permission Required',
        'Please grant Bluetooth permissions to connect to the charger.',
        [{text: 'OK'}],
      );
      return;
    }

    useAppStore.getState().setChargerBleStatus('disconnected');
    useAppStore.getState().incrementScanTrigger();
  };

  const handleDisconnectCharger = () => {
    chargerBleManager.disconnect();
    setChargerData(null);
    AsyncStorage.removeItem(CHARGER_DEVICE_ID_KEY).catch(() => {});
  };

  // Forced GitHub release check used by the contextual Firmware button when
  // we're NOT in "newer release detected" mode. Alerts mirror the previous
  // behavior — honest about unknowns, silent when a newer release exists
  // (the red dot communicates that), explicit when fully up to date.
  const handleCheckForUpdates = async () => {
    const result = await checkForChargerUpdate({force: true});
    if (!result.ok) {
      Alert.alert('Update check failed', result.errorMessage ?? 'Unknown error');
      return;
    }
    const s = useAppStore.getState();
    const offer = computeUpdateOffer(s.chargerFirmwareVersion, s.ota.charger.latestRelease.version);
    if (offer.kind === 'none') {
      Alert.alert('No releases available yet', 'No published charger firmware release was found.');
      return;
    }
    // 'update' and 'unknown-current' — red dot + contextual button already
    // communicate the actionable state; no alert needed. 'up-to-date' → silent.
    // Network / parse error branches above continue to alert.
  };

  // ── OTA flash flow handlers (consolidated into Settings) ────────────────
  // The contextual Firmware button delegates here when an update is available.
  // We mirror the lifecycle that used to live in UpdateScreen:
  //   1. tap → kick off prepareOtaPayload (downloads + verifies). The
  //      orchestrator runs the moment otaState flips to 'ready' (handled in
  //      the watcher effect below — keeps the button a single
  //      "Update to vX.Y.Z" tap instead of two).
  //   2. cancel during transfer → abort the controller; orchestrator catches
  //      it and lands in 'idle' / 'error'.

  const onUpdateRequest = () => {
    // Reset any prior abort controller defensively.
    flashAbortRef.current?.abort();
    flashAbortRef.current = new AbortController();
    // Keep the screen awake for the whole OTA — download, verify, transfer,
    // reboot, reconnect, finalize can take several minutes. Released by the
    // otaState watcher when we hit a terminal state (idle / error / done) and
    // belt-and-suspenders in the unmount effect.
    activateKeepAwake();
    // Start the download/verify. Errors land in the store via the controller,
    // not via throw — no .catch needed here.
    prepareOtaPayload();
  };

  // Whenever otaState becomes 'ready' AND we kicked off a flash attempt
  // (flashAbortRef.current is non-null), immediately call flashChargerFirmware.
  // This eliminates the manual "Flash now" step from the old UpdateScreen
  // and matches the new "single contextual button" requirement.
  useEffect(() => {
    if (otaState !== 'ready' || !flashAbortRef.current) {
      return;
    }
    const controller = flashAbortRef.current;
    // Fire and forget — the orchestrator surfaces errors via the store, not
    // via throw, so no .catch is needed. otaState transitions drive the UI.
    flashChargerFirmware({signal: controller.signal});
    // We intentionally don't clear flashAbortRef here; controller.signal must
    // stay valid for any late callbacks from the orchestrator. It's overwritten
    // by the next attempt.
  }, [otaState]);

  const onUpdateCancel = () => {
    // Same button serves as "Cancel" during transferring; whichever path the
    // user took, both prepare + flash respect this signal.
    flashAbortRef.current?.abort();
    cancelOtaPreparation();
  };

  // Auto-clear 'done' → 'idle' after a brief success display, so the contextual
  // button can revert to "Check for updates" and the success line disappears.
  //
  // The timer id lives in a ref so the unmount cleanup below can clear it even
  // if the effect's own cleanup hasn't fired yet (e.g. parent navigated away
  // mid-3s wait — the state is global Zustand so writing to it after unmount
  // is technically safe, but we still want to avoid the no-op work + keep the
  // diagnostic log tidy). `mountedRef` gates the actual setState call as a
  // second line of defense against any path that might keep the timer alive.
  const autoRevertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    if (otaState === 'done') {
      // Wake-lock no longer needed — release it now that the flash succeeded.
      deactivateKeepAwake();
      // Clear any prior timer defensively (shouldn't happen — effect cleanup
      // handles it — but cheap insurance against rapid re-entries).
      if (autoRevertTimerRef.current) {
        clearTimeout(autoRevertTimerRef.current);
      }
      autoRevertTimerRef.current = setTimeout(() => {
        autoRevertTimerRef.current = null;
        if (!mountedRef.current) {
          return;
        }
        console.log('[OTA] auto-revert to idle after done');
        const s = useAppStore.getState();
        if (s.ota.charger.state === 'done') {
          s.setOtaState('charger', 'idle');
        }
      }, 3000);
      return () => {
        if (autoRevertTimerRef.current) {
          clearTimeout(autoRevertTimerRef.current);
          autoRevertTimerRef.current = null;
        }
      };
    }
    // Terminal non-success states also release the wake-lock — the OTA
    // pipeline isn't going to make further progress without another user tap.
    if (otaState === 'idle' || otaState === 'error') {
      deactivateKeepAwake();
    }
    return undefined;
  }, [otaState]);

  // ── Dial OTA flash flow (Stream 2 mobile) ──────────────────────────────
  // Mirrors the charger flow above. Independent abort ref + watchers so
  // dial / charger don't interfere. Both share the global wake-lock — only
  // one flash can run at a time in practice (single phone), so reusing the
  // wake-lock is fine; the unmount cleanup releases it once.
  const handleCheckForDialUpdates = async () => {
    const result = await checkForUpdate('dial', {force: true});
    if (!result.ok) {
      Alert.alert('Update check failed', result.errorMessage ?? 'Unknown error');
      return;
    }
    const s = useAppStore.getState();
    const offer = computeUpdateOffer(s.dialFirmwareVersion, s.ota.dial.latestRelease.version);
    if (offer.kind === 'none') {
      Alert.alert('No releases available yet', 'No published dial firmware release was found.');
      return;
    }
    // 'update' and 'unknown-current' — contextual button already surfaces the
    // install affordance. 'up-to-date' → silent.
  };

  const onDialUpdateRequest = () => {
    dialFlashAbortRef.current?.abort();
    dialFlashAbortRef.current = new AbortController();
    activateKeepAwake();
    prepareOtaPayload('dial');
  };

  useEffect(() => {
    if (dialOtaState !== 'ready' || !dialFlashAbortRef.current) {
      return;
    }
    const controller = dialFlashAbortRef.current;
    flashFirmware('dial', {signal: controller.signal});
  }, [dialOtaState]);

  const onDialUpdateCancel = () => {
    dialFlashAbortRef.current?.abort();
    cancelOtaPreparation('dial');
  };

  // Auto-revert 'done' → 'idle' for dial.
  const dialAutoRevertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (dialOtaState === 'done') {
      deactivateKeepAwake();
      if (dialAutoRevertTimerRef.current) {
        clearTimeout(dialAutoRevertTimerRef.current);
      }
      dialAutoRevertTimerRef.current = setTimeout(() => {
        dialAutoRevertTimerRef.current = null;
        if (!mountedRef.current) {
          return;
        }
        console.log('[OTA:dial] auto-revert to idle after done');
        const s = useAppStore.getState();
        if (s.ota.dial.state === 'done') {
          s.setOtaState('dial', 'idle');
        }
      }, 3000);
      return () => {
        if (dialAutoRevertTimerRef.current) {
          clearTimeout(dialAutoRevertTimerRef.current);
          dialAutoRevertTimerRef.current = null;
        }
      };
    }
    if (dialOtaState === 'idle' || dialOtaState === 'error') {
      deactivateKeepAwake();
    }
    return undefined;
  }, [dialOtaState]);

  // ── Controller OTA flash flow (Stream 3 mobile) ───────────────────────────
  // Mirrors the dial flow above. Independent abort ref + watchers so
  // controller / charger / dial don't interfere. Controller is OTA-only —
  // after connect, wirePostConnectSubscriptions() sets up version notify only.
  const handleCheckForControllerUpdates = async () => {
    const result = await checkForUpdate('controller', {force: true});
    if (!result.ok) {
      Alert.alert('Update check failed', result.errorMessage ?? 'Unknown error');
      return;
    }
    const s = useAppStore.getState();
    const offer = computeUpdateOffer(s.controllerFirmwareVersion, s.ota.controller.latestRelease.version);
    if (offer.kind === 'none') {
      Alert.alert('No releases available yet', 'No published controller firmware release was found.');
      return;
    }
    // 'update' and 'unknown-current' — contextual button already surfaces the
    // install affordance. 'up-to-date' → silent.
  };

  const onControllerUpdateRequest = () => {
    controllerFlashAbortRef.current?.abort();
    controllerFlashAbortRef.current = new AbortController();
    activateKeepAwake();
    prepareOtaPayload('controller');
  };

  useEffect(() => {
    if (controllerOtaState !== 'ready' || !controllerFlashAbortRef.current) {
      return;
    }
    const controller = controllerFlashAbortRef.current;
    flashFirmware('controller', {signal: controller.signal});
  }, [controllerOtaState]);

  const onControllerUpdateCancel = () => {
    controllerFlashAbortRef.current?.abort();
    cancelOtaPreparation('controller');
  };

  // Auto-revert 'done' → 'idle' for controller.
  const controllerAutoRevertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (controllerOtaState === 'done') {
      deactivateKeepAwake();
      if (controllerAutoRevertTimerRef.current) {
        clearTimeout(controllerAutoRevertTimerRef.current);
      }
      controllerAutoRevertTimerRef.current = setTimeout(() => {
        controllerAutoRevertTimerRef.current = null;
        if (!mountedRef.current) {
          return;
        }
        console.log('[OTA:controller] auto-revert to idle after done');
        const s = useAppStore.getState();
        if (s.ota.controller.state === 'done') {
          s.setOtaState('controller', 'idle');
        }
      }, 3000);
      return () => {
        if (controllerAutoRevertTimerRef.current) {
          clearTimeout(controllerAutoRevertTimerRef.current);
          controllerAutoRevertTimerRef.current = null;
        }
      };
    }
    if (controllerOtaState === 'idle' || controllerOtaState === 'error') {
      deactivateKeepAwake();
    }
    return undefined;
  }, [controllerOtaState]);

  // Abort any in-flight flash on unmount. Also flips mountedRef so the
  // auto-revert timer (if still pending) becomes a no-op when it eventually
  // fires. Belt-and-suspenders wake-lock release in case we unmount mid-flash
  // (e.g. user backs out of the screen) — the otaState watcher would only
  // fire if state changes, and a torn-down component won't see those updates.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (autoRevertTimerRef.current) {
        clearTimeout(autoRevertTimerRef.current);
        autoRevertTimerRef.current = null;
      }
      if (dialAutoRevertTimerRef.current) {
        clearTimeout(dialAutoRevertTimerRef.current);
        dialAutoRevertTimerRef.current = null;
      }
      if (controllerAutoRevertTimerRef.current) {
        clearTimeout(controllerAutoRevertTimerRef.current);
        controllerAutoRevertTimerRef.current = null;
      }
      flashAbortRef.current?.abort();
      dialFlashAbortRef.current?.abort();
      controllerFlashAbortRef.current?.abort();
      deactivateKeepAwake();
    };
  }, []);

  // Pre-compute UpdateOffer for all four targets so the JSX below stays readable.
  // Using computeUpdateOffer instead of bare booleans means null/unknown current
  // version now yields 'unknown-current' (install affordance) rather than hiding
  // the install button entirely — this is the bootstrap fix (Decision inbox entry
  // milhouse-unknown-current-version-install-offer).
  const chargerOffer = computeUpdateOffer(chargerFirmwareVersion, latestReleaseVersion);
  const hasUpdateAvailable = chargerOffer.kind === 'update';

  // Same structure for the App section. parse() guards against weird native
  // build outputs (alpha/beta tags that don't fit X.Y.Z) are now inside
  // computeUpdateOffer, so we don't need to duplicate them here.
  const appOffer = computeUpdateOffer(appVersion, latestAppReleaseVersion);
  const hasAppUpdateAvailable = appOffer.kind === 'update';
  const isAppCheckInFlight = appUpdateState === 'checking';

  // Forced GitHub release check used by the App section's contextual button.
  // Alerts mirror handleCheckForUpdates for the charger:
  //  - explicit "up to date" when running >= latest
  //  - silent when newer release exists (red dot + button label cover it)
  //  - explicit "no releases yet" when GitHub returns nothing matching
  const handleCheckForAppUpdates = async () => {
    const result = await checkForMobileUpdate({force: true});
    if (!result.ok) {
      Alert.alert('Update check failed', result.errorMessage ?? 'Unknown error');
      return;
    }
    const {
      appVersion: running,
      latestAppReleaseVersion: latest,
    } = useAppStore.getState();
    const offer = computeUpdateOffer(running, latest);
    if (offer.kind === 'none') {
      Alert.alert('No releases available yet', 'No published app release was found.');
      return;
    }
    // 'update' and 'unknown-current' — contextual button already surfaces the
    // install affordance. 'up-to-date' → silent. Network / parse-error branches
    // above continue to alert.
  };

  // Real install flow. On tap:
  //   1. Check Android per-source install consent. If missing, prompt + deep
  //      link the user to Settings; abort this attempt (they retry after).
  //   2. Keep the screen awake for the whole download/verify (~30–60s on LTE).
  //   3. prepareAppPayload() downloads the APK to cache + streams SHA256.
  //      Errors land in the store (appUpdateState='error') — no throw.
  //   4. A useEffect below watches appUpdateState === 'ready' and dispatches
  //      installApk() with the local path. The system installer takes over
  //      and ultimately replaces this app process.
  const onAppUpdateRequest = async () => {
    try {
      const can = await canRequestInstalls();
      if (!can) {
        Alert.alert(
          'Permission required',
          'Allow the Mobile App to install updates? You\'ll be taken to Settings to grant "Install unknown apps" for this app, then return here and tap Update again.',
          [
            {text: 'Cancel', style: 'cancel'},
            {
              text: 'Open Settings',
              onPress: () => {
                openInstallPermissionSettings().catch(() => {});
              },
            },
          ],
        );
        return;
      }
    } catch (err) {
      console.warn('[AppUpdate] canRequestInstalls check failed:', err);
      // Fall through — if the check itself fails, let the install intent try
      // and surface its own error.
    }

    activateKeepAwake();
    // Errors land in the store; no .catch needed.
    prepareAppPayload();
  };

  // Watcher: when prepareAppPayload finishes (appUpdateState flips to 'ready')
  // AND the user actually started a flow (we know because the wake-lock is
  // active — we don't have a "did the user tap?" flag, but `ready` only
  // happens after a successful download + verify which only runs after a tap),
  // dispatch the install intent.
  //
  // We don't try to detect "install succeeded" — Android kills our process
  // before that happens. Instead we transition into 'installing' and trust
  // the system installer to finish or fail. If the user backs out of the
  // installer, the state stays at 'installing' until next launch (when the
  // store resets it to 'idle' because appUpdateState isn't persisted).
  useEffect(() => {
    if (appUpdateState !== 'ready') return;
    const path = getReadyAppApkPath();
    if (!path) {
      console.warn('[AppUpdate] state=ready but no APK path available');
      return;
    }
    useAppStore.getState().setAppUpdateState('installing');
    installApk(path).catch((err: any) => {
      // Most failures are permission-related (user revoked between check and
      // install) or "intent has no handler" on misconfigured devices.
      console.warn('[AppUpdate] installApk failed:', err);
      const s = useAppStore.getState();
      s.setAppUpdateState('error');
      s.setAppUpdateError(
        err?.message ?? 'Install failed — open the APK from Files manually.',
      );
      deactivateKeepAwake();
    });
  }, [appUpdateState]);

  // Wake-lock release on terminal app-update states. Mirrors the charger
  // pattern. 'installing' deliberately keeps the lock active so the system
  // installer dialog doesn't dim out from under the user.
  useEffect(() => {
    if (appUpdateState === 'idle' || appUpdateState === 'error') {
      deactivateKeepAwake();
    }
  }, [appUpdateState]);

  // Install-hang recovery. The 'installing' state is set right before we fire
  // the system install intent. On the success path Android kills our process
  // and the new APK replaces us — this listener never fires. If the user taps
  // Cancel on the system dialog, or Android refuses the install (e.g. signing
  // mismatch), control returns to us with `appUpdateState` stuck at
  // 'installing' and the UI showing "Waiting for installer…" indefinitely.
  //
  // Detect that case by listening for AppState → 'active' while we're in the
  // installing state. The 1.5s delay is a race-tolerance window: if Android
  // is going to replace us, the process dies within milliseconds, so a
  // sustained 'installing' state after a foreground transition means the
  // install didn't go through.
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => {
        if (next !== 'active') return;
        // Read fresh — the outer-closure value may be stale.
        if (useAppStore.getState().appUpdateState !== 'installing') return;
        setTimeout(() => {
          const s = useAppStore.getState();
          if (s.appUpdateState !== 'installing') return;
          s.setAppUpdateError(
            'Install was cancelled or refused. The downloaded update may be signed with a different key than the installed app — try downloading and installing the APK manually once.',
          );
          s.setAppUpdateState('error');
        }, 1500);
      },
    );
    return () => sub.remove();
  }, []);

  const onAppUpdateCancel = () => {
    cancelAppUpdatePreparation();
  };

  const isAppUpdateInFlight =
    appUpdateState === 'checking' ||
    appUpdateState === 'downloading' ||
    appUpdateState === 'verifying' ||
    appUpdateState === 'installing';

  const appPhaseLabel = (() => {
    switch (appUpdateState) {
      case 'checking':
        return 'Checking…';
      case 'downloading':
        return 'Downloading…';
      case 'verifying':
        return 'Verifying…';
      case 'installing':
        return 'Waiting for installer…';
      default:
        return '';
    }
  })();

  const appProgressPctRaw = Number.isFinite(appUpdateProgress)
    ? Math.max(0, Math.min(1, appUpdateProgress as number)) * 100
    : 0;
  const appProgressPct = Math.round(appProgressPctRaw);

  const appBytesPresent =
    typeof appUpdateBytesReceived === 'number' &&
    Number.isFinite(appUpdateBytesReceived) &&
    appUpdateBytesReceived >= 0 &&
    typeof appUpdateBytesTotal === 'number' &&
    Number.isFinite(appUpdateBytesTotal) &&
    appUpdateBytesTotal > 0;
  const showAppBytesLine =
    appUpdateState === 'downloading' && appBytesPresent;

  const appButtonLabel = (() => {
    if (isAppUpdateInFlight) {
      return appUpdateState === 'downloading' ? 'Cancel' : '…';
    }
    if (appUpdateState === 'error') return 'Try again';
    if (appOffer.kind === 'update') {
      return `Update to ${formatVersion(appOffer.latest)}`;
    }
    if (appOffer.kind === 'unknown-current') {
      return `Install latest`;
    }
    return 'Check for updates';
  })();

  const onAppButtonPress = () => {
    if (isAppUpdateInFlight) {
      // Only "downloading" exposes a real cancel; the other in-flight states
      // are short enough to ride out, but being permissive doesn't hurt.
      onAppUpdateCancel();
      return;
    }
    if (appUpdateState === 'error' && (hasAppUpdateAvailable || appOffer.kind === 'unknown-current')) {
      onAppUpdateRequest();
      return;
    }
    if (hasAppUpdateAvailable) {
      onAppUpdateRequest();
      return;
    }
    if (appOffer.kind === 'unknown-current') {
      Alert.alert(
        `Install ${formatVersion(appOffer.latest)}?`,
        `The running version of this app could not be read.\n\nInstalling the latest release may fail if the app build is incompatible. Continue?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Install anyway', onPress: onAppUpdateRequest},
        ],
      );
      return;
    }
    handleCheckForAppUpdates();
  };

  const isOtaInFlight =
    otaState === 'checking' ||
    otaState === 'downloading' ||
    otaState === 'verifying' ||
    otaState === 'transferring' ||
    otaState === 'rebooting' ||
    otaState === 'reconnecting' ||
    otaState === 'finalizing';

  // Defensive: clamp + guard against null/NaN/Infinity. `otaProgress` is typed
  // `number` in the store and defaults to 0, but if a future path slips a null
  // through, `Math.round(NaN * 100) = NaN` would render as "NaN%" — ugly, and
  // a templated `width: NaN%` style can also throw on Android.
  const progressPctRaw = Number.isFinite(otaProgress)
    ? Math.max(0, Math.min(1, otaProgress as number)) * 100
    : 0;
  const progressPct = Math.round(progressPctRaw);

  // Bytes line render guard. Only show "X KB / Y KB (NN%)" when:
  //   - we're in a phase where the orchestrator is actually streaming bytes
  //     (downloading or transferring — the post-transfer phases reset bytes)
  //   - both counters are present, finite, non-negative numbers
  //   - total > 0 (no divide-by-zero, no "X / 0")
  // For every other phase (rebooting / reconnecting / finalizing / done) we
  // render JUST the phase label and bar. The phase label is enough context;
  // showing "(NaN%)" or "(100%)" forever after transfer is worse than nothing.
  const bytesPresent =
    typeof otaBytesReceived === 'number' &&
    Number.isFinite(otaBytesReceived) &&
    otaBytesReceived >= 0 &&
    typeof otaBytesTotal === 'number' &&
    Number.isFinite(otaBytesTotal) &&
    otaBytesTotal > 0;
  const showBytesLine =
    (otaState === 'downloading' || otaState === 'transferring') && bytesPresent;

  // Diagnostic: if we're showing progress but bytes are null, that's the
  // suspected post-transfer null window. Log it once per render so the next
  // reproduction's logcat pinpoints whether we hit the bad branch.
  if (!bytesPresent && otaProgress > 0 && otaState !== 'idle') {
    console.log(
      '[OTA] render guard: bytes null at progress',
      otaProgress,
      'state',
      otaState,
    );
  }

  // Phase label shown above the progress bar — one human-readable word per
  // pipeline stage. Order tracks the orchestrator's otaState transitions.
  const phaseLabel = (() => {
    switch (otaState) {
      case 'checking':
        return 'Checking…';
      case 'downloading':
        return 'Downloading…';
      case 'verifying':
        return 'Verifying…';
      case 'transferring':
        return 'Transferring…';
      case 'rebooting':
        return 'Charger restarting…';
      case 'reconnecting':
        return 'Reconnecting…';
      case 'finalizing':
        return 'Finalizing…';
      default:
        return '';
    }
  })();

  // Button label is fully driven by state. The "contextual button" requirement.
  const firmwareButtonLabel = (() => {
    if (isOtaInFlight) {
      return otaState === 'transferring' ? 'Cancel' : '…';
    }
    if (otaState === 'error') {
      return 'Try again';
    }
    if (chargerOffer.kind === 'update') {
      return `Update to ${formatVersion(chargerOffer.latest)}`;
    }
    if (chargerOffer.kind === 'unknown-current') {
      return 'Install latest';
    }
    return 'Check for updates';
  })();

  const onFirmwareButtonPress = () => {
    if (isOtaInFlight) {
      // Only meaningful during 'transferring' but no harm in being permissive.
      onUpdateCancel();
      return;
    }
    if (otaState === 'error' && (hasUpdateAvailable || chargerOffer.kind === 'unknown-current')) {
      // Retry the install path.
      onUpdateRequest();
      return;
    }
    if (hasUpdateAvailable) {
      onUpdateRequest();
      return;
    }
    if (chargerOffer.kind === 'unknown-current') {
      Alert.alert(
        `Install ${formatVersion(chargerOffer.latest)}?`,
        `The running version on this charger could not be read.\n\nInstalling the latest release may fail if the charger doesn't support over-the-air updates yet. For a freshly-acquired charger, a USB flash is required for the first deploy.\n\nContinue?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Install anyway', onPress: onUpdateRequest},
        ],
      );
      return;
    }
    handleCheckForUpdates();
  };

  // ── Dial OTA derivations — mirror the charger block above ──────────────
  const dialOffer = computeUpdateOffer(dialFirmwareVersion, dialLatestReleaseVersion);
  const hasDialUpdateAvailable = dialOffer.kind === 'update';

  const isDialOtaInFlight =
    dialOtaState === 'checking' ||
    dialOtaState === 'downloading' ||
    dialOtaState === 'verifying' ||
    dialOtaState === 'transferring' ||
    dialOtaState === 'rebooting' ||
    dialOtaState === 'reconnecting' ||
    dialOtaState === 'finalizing';

  const dialProgressPctRaw = Number.isFinite(dialOtaProgress)
    ? Math.max(0, Math.min(1, dialOtaProgress as number)) * 100
    : 0;
  const dialProgressPct = Math.round(dialProgressPctRaw);

  const dialBytesPresent =
    typeof dialOtaBytesReceived === 'number' &&
    Number.isFinite(dialOtaBytesReceived) &&
    dialOtaBytesReceived >= 0 &&
    typeof dialOtaBytesTotal === 'number' &&
    Number.isFinite(dialOtaBytesTotal) &&
    dialOtaBytesTotal > 0;
  const showDialBytesLine =
    (dialOtaState === 'downloading' || dialOtaState === 'transferring') &&
    dialBytesPresent;

  const dialPhaseLabel = (() => {
    switch (dialOtaState) {
      case 'checking':
        return 'Checking…';
      case 'downloading':
        return 'Downloading…';
      case 'verifying':
        return 'Verifying…';
      case 'transferring':
        return 'Transferring…';
      case 'rebooting':
        return 'Dial restarting…';
      case 'reconnecting':
        return 'Reconnecting…';
      case 'finalizing':
        return 'Finalizing…';
      default:
        return '';
    }
  })();

  const dialFirmwareButtonLabel = (() => {
    if (isDialOtaInFlight) {
      return dialOtaState === 'transferring' ? 'Cancel' : '…';
    }
    if (dialOtaState === 'error') {
      return 'Try again';
    }
    if (dialOffer.kind === 'update') {
      return `Update to ${formatVersion(dialOffer.latest)}`;
    }
    if (dialOffer.kind === 'unknown-current') {
      return 'Install latest';
    }
    return 'Check for updates';
  })();

  const onDialFirmwareButtonPress = () => {
    if (isDialOtaInFlight) {
      onDialUpdateCancel();
      return;
    }
    if (dialOtaState === 'error' && (hasDialUpdateAvailable || dialOffer.kind === 'unknown-current')) {
      onDialUpdateRequest();
      return;
    }
    if (hasDialUpdateAvailable) {
      onDialUpdateRequest();
      return;
    }
    if (dialOffer.kind === 'unknown-current') {
      Alert.alert(
        `Install ${formatVersion(dialOffer.latest)}?`,
        `The running version on this dial could not be read.\n\nInstalling the latest release may fail if the dial doesn't support over-the-air updates yet. For a freshly-acquired dial, a USB flash is required for the first deploy.\n\nContinue?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Install anyway', onPress: onDialUpdateRequest},
        ],
      );
      return;
    }
    handleCheckForDialUpdates();
  };

  // ── Controller OTA derivations — mirror the dial block above ──────────────
  const controllerOffer = computeUpdateOffer(controllerFirmwareVersion, controllerLatestReleaseVersion);
  const hasControllerUpdateAvailable = controllerOffer.kind === 'update';

  const isControllerOtaInFlight =
    controllerOtaState === 'checking' ||
    controllerOtaState === 'downloading' ||
    controllerOtaState === 'verifying' ||
    controllerOtaState === 'transferring' ||
    controllerOtaState === 'rebooting' ||
    controllerOtaState === 'reconnecting' ||
    controllerOtaState === 'finalizing';

  const controllerProgressPctRaw = Number.isFinite(controllerOtaProgress)
    ? Math.max(0, Math.min(1, controllerOtaProgress as number)) * 100
    : 0;
  const controllerProgressPct = Math.round(controllerProgressPctRaw);

  const controllerBytesPresent =
    typeof controllerOtaBytesReceived === 'number' &&
    Number.isFinite(controllerOtaBytesReceived) &&
    controllerOtaBytesReceived >= 0 &&
    typeof controllerOtaBytesTotal === 'number' &&
    Number.isFinite(controllerOtaBytesTotal) &&
    controllerOtaBytesTotal > 0;
  const showControllerBytesLine =
    (controllerOtaState === 'downloading' || controllerOtaState === 'transferring') &&
    controllerBytesPresent;

  const controllerPhaseLabel = (() => {
    switch (controllerOtaState) {
      case 'checking':
        return 'Checking…';
      case 'downloading':
        return 'Downloading…';
      case 'verifying':
        return 'Verifying…';
      case 'transferring':
        return 'Transferring…';
      case 'rebooting':
        return 'Controller restarting…';
      case 'reconnecting':
        return 'Reconnecting…';
      case 'finalizing':
        return 'Finalizing…';
      default:
        return '';
    }
  })();

  const controllerFirmwareButtonLabel = (() => {
    if (isControllerOtaInFlight) {
      return controllerOtaState === 'transferring' ? 'Cancel' : '…';
    }
    if (controllerOtaState === 'error') {
      return 'Try again';
    }
    if (controllerOffer.kind === 'update') {
      return `Update to ${formatVersion(controllerOffer.latest)}`;
    }
    if (controllerOffer.kind === 'unknown-current') {
      return 'Install latest';
    }
    return 'Check for updates';
  })();

  const onControllerFirmwareButtonPress = () => {
    if (isControllerOtaInFlight) {
      onControllerUpdateCancel();
      return;
    }
    if (controllerOtaState === 'error' && (hasControllerUpdateAvailable || controllerOffer.kind === 'unknown-current')) {
      onControllerUpdateRequest();
      return;
    }
    if (hasControllerUpdateAvailable) {
      onControllerUpdateRequest();
      return;
    }
    if (controllerOffer.kind === 'unknown-current') {
      Alert.alert(
        `Install ${formatVersion(controllerOffer.latest)}?`,
        `The running version on this controller could not be read.\n\nInstalling the latest release may fail if the controller doesn't support over-the-air updates yet. For a freshly-acquired controller, a USB flash is required for the first deploy.\n\nContinue?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Install anyway', onPress: onControllerUpdateRequest},
        ],
      );
      return;
    }
    handleCheckForControllerUpdates();
  };

  // Safe-area padding for the tab bar. PageHeader handles the status bar
  // already (paddingTop:44), but we apply the defensive pattern here too so
  // future layouts that drop PageHeader don't have the tab bar slide under
  // the status bar on Android. Both react-native-safe-area-context insets
  // and StatusBar.currentHeight are checked; we take whichever is bigger.
  const insets = useSafeAreaInsets();
  const tabBarSafeTop = Math.max(
    insets.top,
    (Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tab-content renderers. Kept inline so they close over the same state /
  // handlers / store selectors as the main component. Each returns the raw
  // section JSX that used to live directly in the screen's ScrollView.
  // ─────────────────────────────────────────────────────────────────────────

  const renderBluetoothTab = () => (
    <>
      {/* Bluetooth Section */}
      <Text style={styles.sectionHeader}>Bluetooth</Text>
      <View style={styles.card}>
        {/* Peripheral */}
        <View style={styles.bleRow}>
          <View style={styles.bleRowLeft}>
            <Text style={styles.label}>Peripheral</Text>
            {deviceId ? (
              <Text style={styles.hint} numberOfLines={1}>{deviceId}</Text>
            ) : null}
          </View>
          <View style={styles.bleRowRight}>
            <View style={styles.statusIndicator}>
              {(isScanning || isRequestingPermission) ? (
                <ActivityIndicator size="small" color="#FFC107" />
              ) : (
                <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
              )}
            </View>
            {canDisconnect ? (
              <Button
                mode="outlined"
                onPress={handleDisconnect}
                style={styles.bleButton}>
                Disconnect
              </Button>
            ) : (
              <Button
                mode="contained"
                onPress={handleScan}
                disabled={isScanning || isRequestingPermission}
                style={styles.bleButton}>
                {isScanning || isRequestingPermission ? 'Scanning…' : 'Connect'}
              </Button>
            )}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Charger */}
        <View style={styles.bleRow}>
          <View style={styles.bleRowLeft}>
            <Text style={styles.label}>Charger</Text>
            {chargerDeviceId ? (
              <Text style={styles.hint} numberOfLines={1}>{chargerDeviceId}</Text>
            ) : null}
          </View>
          <View style={styles.bleRowRight}>
            <View style={styles.statusIndicator}>
              {(isScanningCharger || isRequestingChargerPermission) ? (
                <ActivityIndicator size="small" color="#FFC107" />
              ) : (
                <View style={[styles.statusDot, {backgroundColor: chargerStatusColor}]} />
              )}
            </View>
            {canDisconnectCharger ? (
              <Button
                mode="outlined"
                onPress={handleDisconnectCharger}
                style={styles.bleButton}>
                Disconnect
              </Button>
            ) : (
              <Button
                mode="contained"
                onPress={handleScanCharger}
                disabled={isScanningCharger || isRequestingChargerPermission}
                style={styles.bleButton}>
                {isScanningCharger || isRequestingChargerPermission ? 'Scanning…' : 'Connect'}
              </Button>
            )}
          </View>
        </View>
      </View>

      {/* Debug Section — isolated from the primary BT connection controls
          so the diagnostic toggle reads as a separate concern. */}
      <Text style={styles.sectionHeader}>Debug</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Debug BT</Text>
            <Text style={styles.hint}>Show BLE characteristic debug panel on all screens</Text>
          </View>
          <Switch
            value={debugBt}
            onValueChange={setDebugBt}
            color="#00C853"
          />
        </View>
      </View>
    </>
  );

  const renderChargingTab = () => (
    <>
      {/* Charging Section — the "Extend Time Button" lived previously under a
          Charging section; it's the wake-time / extend-time setting the user
          referenced. Notifications merge in here too (they're charge-related
          milestone alerts, not display config). */}
      <Text style={styles.sectionHeader}>Charging</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Extend Time Button</Text>
        <Text style={styles.hint}>Amount added by the +Xm button on the charging screen</Text>
        <View style={styles.segmentedWrapper}>
          <SegmentedButtons
            value={String(chargeTimeExtendMinutes)}
            onValueChange={val => setChargeTimeExtendMinutes(Number(val))}
            buttons={[
              {value: '15', label: '15m'},
              {value: '30', label: '30m'},
              {value: '45', label: '45m'},
              {value: '60', label: '60m'},
            ]}
          />
        </View>
      </View>

      {/* Notifications Section */}
      <Text style={styles.sectionHeader}>Notifications</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Enable notifications</Text>
            <Text style={styles.hint}>Alert when a charging milestone is reached</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={setNotificationsEnabled}
            color="#00C853"
          />
        </View>
        {notificationsEnabled && (
          <>
            <Text style={styles.subLabel}>Alert type</Text>
            <View style={styles.segmentedWrapper}>
              <SegmentedButtons
                value={notificationMode}
                onValueChange={val => setNotificationMode(val as 'time' | 'soc')}
                buttons={[
                  {value: 'time', label: 'Time remaining'},
                  {value: 'soc',  label: 'Charge level'},
                ]}
              />
            </View>
            {notificationMode === 'time' && (
              <>
                <Text style={styles.subLabel}>Warn when time left</Text>
                <View style={styles.segmentedWrapper}>
                  <SegmentedButtons
                    value={String(chargeTimeWarnMinutes)}
                    onValueChange={val => setChargeTimeWarnMinutes(Number(val))}
                    buttons={[
                      {value: '5',  label: '5m'},
                      {value: '10', label: '10m'},
                      {value: '15', label: '15m'},
                      {value: '30', label: '30m'},
                    ]}
                  />
                </View>
              </>
            )}
            {notificationMode === 'soc' && (
              <>
                <Text style={styles.subLabel}>Alert at SOC</Text>
                <View style={styles.segmentedWrapper}>
                  <SegmentedButtons
                    value={String(socWarnThresholdPct)}
                    onValueChange={val => setSocWarnThresholdPct(Number(val))}
                    buttons={[
                      {value: '80', label: '80%'},
                      {value: '85', label: '85%'},
                      {value: '90', label: '90%'},
                      {value: '95', label: '95%'},
                    ]}
                  />
                </View>
              </>
            )}
          </>
        )}
      </View>
    </>
  );

  const renderFirmwareTab = () => (
    <>
      {/* Firmware Section — consolidated OTA UI.
          Layout:
            - Top row: 🔌 ⓘ          v0.1.5  •
              (chip icon distinguishes the row from the App row below; •
               red dot only when an update is available)
            - Optional hint: "Latest available: v0.1.6"
            - Divider
            - State-driven body:
                idle / up-to-date     → [Check for updates] + last-checked
                idle + update         → [Update to v0.1.6]  + last-checked
                in-flight             → progress bar + phase + bytes + [Cancel]
                done                  → "✓ Update complete" success line
                error                 → "⚠ {message}" + [Try again]
      */}
      {/* App Section — mobile self-update.
          Mirrors the Firmware section's layout for visual + cognitive parity:
            - Top row: 📱 ⓘ          v0.3.3  •
              (• red dot only when latestAppReleaseVersion > appVersion)
            - Optional hint: "Latest available: v0.3.4"
            - Divider
            - Button: "Check for updates" OR "Update to v0.3.4" when newer
            - Last-checked timestamp underneath */}
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.fwTitleRow}>
            {/* Inline row title replacing the prior external "APP" section
                header + leading cellphone icon. Carries the same visual
                weight as the section header used to, but lives inside the
                card row alongside the info icon and version on the right. */}
            <Text style={styles.fwRowTitle}>Mobile App</Text>
            <TouchableOpacity
              onPress={() => onOpenAppInfo?.()}
              accessibilityRole="button"
              accessibilityLabel="Open app info"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={styles.infoIcon}>
              <Icon
                name="information-outline"
                size={18}
                color="#5BA8C4"
              />
            </TouchableOpacity>
            {(hasAppUpdateAvailable || appOffer.kind === 'unknown-current') && latestAppReleaseVersion ? (
              <Text style={styles.fwHint}>
                Latest available: {formatVersion(latestAppReleaseVersion)}
              </Text>
            ) : null}
          </View>
          <View style={styles.fwVersionRow}>
            <Text style={styles.value}>
              {appOffer.kind === 'unknown-current'
                ? 'Unknown'
                : appVersion
                  ? `v${appVersion}`
                  : '—'}
            </Text>
            {hasAppUpdateAvailable || appOffer.kind === 'unknown-current' ? (
              <View
                style={styles.updateDot}
                accessibilityLabel={appOffer.kind === 'unknown-current' ? 'Install available' : 'App update available'}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* In-flight: same visual language as the Firmware section's flash
            progress — phase label + bar + optional bytes line + Cancel.
            'installing' shows just the phase + bar (no cancel) because once
            the system installer dialog is up, we can't interrupt it. No
            spinner anywhere in this block — the progress bar carries the
            visual feedback during download, and once the install intent
            fires the Android system installer dialog takes over. */}
        {isAppUpdateInFlight ? (
          <View style={styles.fwBody}>
            <Text style={styles.fwPhase}>{appPhaseLabel}</Text>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {width: `${appProgressPct}%`},
                ]}
              />
            </View>
            {showAppBytesLine ? (
              <Text style={styles.fwBytes}>
                {formatBytesShort(appUpdateBytesReceived)} /{' '}
                {formatBytesShort(appUpdateBytesTotal)}
                {` (${appProgressPct}%)`}
              </Text>
            ) : null}
            {appUpdateState === 'downloading' ? (
              <View style={styles.fwButtonRow}>
                <Button
                  mode="outlined"
                  onPress={onAppUpdateCancel}
                  style={styles.fwFullWidthButton}>
                  Cancel
                </Button>
              </View>
            ) : null}
          </View>
        ) : appUpdateState === 'error' && appUpdateError ? (
          <View style={styles.fwBody}>
            <Text style={styles.errorText}>⚠ {appUpdateError}</Text>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onAppButtonPress}
                style={styles.fwFullWidthButton}>
                {appButtonLabel}
              </Button>
            </View>
          </View>
        ) : (
          <View style={styles.fwBody}>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onAppButtonPress}
                disabled={isAppCheckInFlight}
                style={styles.fwFullWidthButton}>
                {appButtonLabel}
              </Button>
            </View>
            <Text style={styles.fwHint}>
              Last checked: {formatRelative(now, latestAppReleaseCheckedAt)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.fwTitleRow}>
            {/* Inline row title replacing the prior external
                "CHARGER FIRMWARE" section header + leading chip icon.
                Visual weight matches the Mobile App row above for parity. */}
            <Text style={styles.fwRowTitle}>Charger</Text>
            <TouchableOpacity
              onPress={() => onOpenFirmwareInfo?.()}
              disabled={isOtaInFlight}
              accessibilityRole="button"
              accessibilityLabel="Open firmware info"
              accessibilityState={{disabled: isOtaInFlight}}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={[styles.infoIcon, isOtaInFlight && styles.infoIconDisabled]}>
              <Icon
                name="information-outline"
                size={18}
                color={isOtaInFlight ? '#666' : '#5BA8C4'}
              />
            </TouchableOpacity>
            {latestReleaseVersion ? (
              <Text style={styles.fwHint}>
                Latest available: {formatVersion(latestReleaseVersion)}
              </Text>
            ) : null}
          </View>
          <View style={styles.fwVersionRow}>
            <Text style={styles.value}>
              {chargerOffer.kind === 'unknown-current'
                ? 'Unknown'
                : chargerFirmwareVersion
                  ? formatVersion(chargerFirmwareVersion)
                  : '—'}
            </Text>
            {hasUpdateAvailable || chargerOffer.kind === 'unknown-current' ? (
              <View
                style={styles.updateDot}
                accessibilityLabel={chargerOffer.kind === 'unknown-current' ? 'Install available' : 'Update available'}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* In-flight: phase label + progress bar + optional bytes/percent + Cancel
            Layout intentionally puts the phase title ABOVE the bar and moves the
            percentage out of the bar's row into the bytes line as
            "X KB / Y KB (NN%)". For phases without a byte counter (rebooting,
            reconnecting, finalizing) we just show "(NN%)" on its own line. */}
        {isOtaInFlight ? (
          <View style={styles.fwBody}>
            <Text style={styles.fwPhase}>
              {phaseLabel}
              {otaState === 'rebooting' || otaState === 'finalizing' ? (
                <ActivityIndicator
                  size="small"
                  color="#5BA8C4"
                  style={styles.inlineSpinner}
                />
              ) : null}
            </Text>
            <View style={styles.progressBarTrack}>
              <View
                style={[styles.progressBarFill, {width: `${progressPct}%`}]}
              />
            </View>
            {showBytesLine ? (
              <Text style={styles.fwBytes}>
                {formatBytesShort(otaBytesReceived)} /{' '}
                {formatBytesShort(otaBytesTotal)}
                {` (${progressPct}%)`}
              </Text>
            ) : null}
            {otaState === 'transferring' ||
            otaState === 'downloading' ||
            otaState === 'verifying' ? (
              <View style={styles.fwButtonRow}>
                <Button
                  mode="outlined"
                  onPress={onUpdateCancel}
                  style={styles.fwFullWidthButton}>
                  Cancel
                </Button>
              </View>
            ) : null}
          </View>
        ) : otaState === 'done' ? (
          <View style={styles.fwBody}>
            <Text style={styles.successText}>✓ Update complete</Text>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={handleCheckForUpdates}
                style={styles.fwFullWidthButton}>
                Check for updates
              </Button>
            </View>
            <Text style={styles.fwHint}>
              Last checked: {formatRelative(now, latestReleaseCheckedAt)}
            </Text>
          </View>
        ) : otaState === 'error' && otaError ? (
          <View style={styles.fwBody}>
            <Text style={styles.errorText}>⚠ {otaError}</Text>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onFirmwareButtonPress}
                style={styles.fwFullWidthButton}>
                {firmwareButtonLabel}
              </Button>
            </View>
          </View>
        ) : (
          <View style={styles.fwBody}>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onFirmwareButtonPress}
                disabled={chargerBleStatus !== 'connected'}
                style={styles.fwFullWidthButton}>
                {firmwareButtonLabel}
              </Button>
            </View>
            <Text style={styles.fwHint}>
              {chargerBleStatus !== 'connected'
                ? hasUpdateAvailable || chargerOffer.kind === 'unknown-current'
                  ? 'Connect to the charger to install the update'
                  : 'Connect to the charger to check for updates'
                : `Last checked: ${formatRelative(now, latestReleaseCheckedAt)}`}
            </Text>
            {chargerOffer.kind === 'unknown-current' && chargerBleStatus === 'connected' ? (
              <Text style={styles.fwHint}>
                Install may fail if device firmware predates OTA support — USB flash required for first deploy.
              </Text>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.fwTitleRow}>
            {/* Dial firmware row — mirrors the Charger row above so the two
                OTA targets present identically. Visual weight matches both
                the Mobile App and Charger rows for parity. */}
            <Text style={styles.fwRowTitle}>Dial</Text>
            {dialLatestReleaseVersion ? (
              <Text style={styles.fwHint}>
                Latest available: {formatVersion(dialLatestReleaseVersion)}
              </Text>
            ) : null}
          </View>
          <View style={styles.fwVersionRow}>
            <Text style={styles.value}>
              {dialOffer.kind === 'unknown-current'
                ? 'Unknown'
                : dialFirmwareVersion
                  ? formatVersion(dialFirmwareVersion)
                  : '—'}
            </Text>
            {hasDialUpdateAvailable || dialOffer.kind === 'unknown-current' ? (
              <View
                style={styles.updateDot}
                accessibilityLabel={dialOffer.kind === 'unknown-current' ? 'Install available' : 'Update available'}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* In-flight: phase label + progress bar + optional bytes/percent + Cancel
            Mirrors the charger row above. For dial, "rebooting" / "reconnecting" /
            "finalizing" show a spinner inline with the phase label. */}
        {isDialOtaInFlight ? (
          <View style={styles.fwBody}>
            <Text style={styles.fwPhase}>
              {dialPhaseLabel}
              {dialOtaState === 'rebooting' ||
              dialOtaState === 'reconnecting' ||
              dialOtaState === 'finalizing' ? (
                <ActivityIndicator
                  size="small"
                  color="#5BA8C4"
                  style={styles.inlineSpinner}
                />
              ) : null}
            </Text>
            <View style={styles.progressBarTrack}>
              <View
                style={[styles.progressBarFill, {width: `${dialProgressPct}%`}]}
              />
            </View>
            {showDialBytesLine ? (
              <Text style={styles.fwBytes}>
                {formatBytesShort(dialOtaBytesReceived)} /{' '}
                {formatBytesShort(dialOtaBytesTotal)}
                {` (${dialProgressPct}%)`}
              </Text>
            ) : null}
            {dialOtaState === 'transferring' ||
            dialOtaState === 'downloading' ||
            dialOtaState === 'verifying' ? (
              <View style={styles.fwButtonRow}>
                <Button
                  mode="outlined"
                  onPress={onDialUpdateCancel}
                  style={styles.fwFullWidthButton}>
                  Cancel
                </Button>
              </View>
            ) : null}
          </View>
        ) : dialOtaState === 'done' ? (
          <View style={styles.fwBody}>
            <Text style={styles.successText}>✓ Update complete</Text>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={handleCheckForDialUpdates}
                style={styles.fwFullWidthButton}>
                Check for updates
              </Button>
            </View>
            <Text style={styles.fwHint}>
              Last checked: {formatRelative(now, dialLatestReleaseCheckedAt)}
            </Text>
          </View>
        ) : dialOtaState === 'error' && dialOtaError ? (
          <View style={styles.fwBody}>
            <Text style={styles.errorText}>⚠ {dialOtaError}</Text>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onDialFirmwareButtonPress}
                style={styles.fwFullWidthButton}>
                {dialFirmwareButtonLabel}
              </Button>
            </View>
          </View>
        ) : (
          <View style={styles.fwBody}>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onDialFirmwareButtonPress}
                disabled={bleStatus !== 'connected'}
                style={styles.fwFullWidthButton}>
                {dialFirmwareButtonLabel}
              </Button>
            </View>
            <Text style={styles.fwHint}>
              {bleStatus !== 'connected'
                ? hasDialUpdateAvailable || dialOffer.kind === 'unknown-current'
                  ? 'Connect to the dial to install the update'
                  : 'Connect to the dial to check for updates'
                : `Last checked: ${formatRelative(now, dialLatestReleaseCheckedAt)}`}
            </Text>
            {dialOffer.kind === 'unknown-current' && bleStatus === 'connected' ? (
              <Text style={styles.fwHint}>
                Install may fail if device firmware predates OTA support — USB flash required for first deploy.
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {/* Controller firmware row — mirrors the Dial row above. Controller is
          OTA-only on BLE; telemetry routes through the dial. The button is
          gated on controllerBleStatus === 'connected' because OTA_BEGIN
          requires an active GATT connection to 0x27B1. */}
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.fwTitleRow}>
            <Text style={styles.fwRowTitle}>Controller</Text>
            {controllerLatestReleaseVersion ? (
              <Text style={styles.fwHint}>
                Latest available: {formatVersion(controllerLatestReleaseVersion)}
              </Text>
            ) : null}
          </View>
          <View style={styles.fwVersionRow}>
            <Text style={styles.value}>
              {controllerOffer.kind === 'unknown-current'
                ? 'Unknown'
                : controllerFirmwareVersion
                  ? formatVersion(controllerFirmwareVersion)
                  : '—'}
            </Text>
            {hasControllerUpdateAvailable || controllerOffer.kind === 'unknown-current' ? (
              <View
                style={styles.updateDot}
                accessibilityLabel={controllerOffer.kind === 'unknown-current' ? 'Install available' : 'Update available'}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* In-flight: phase label + progress bar + optional bytes/percent + Cancel */}
        {isControllerOtaInFlight ? (
          <View style={styles.fwBody}>
            <Text style={styles.fwPhase}>
              {controllerPhaseLabel}
              {controllerOtaState === 'rebooting' ||
              controllerOtaState === 'reconnecting' ||
              controllerOtaState === 'finalizing' ? (
                <ActivityIndicator
                  size="small"
                  color="#5BA8C4"
                  style={styles.inlineSpinner}
                />
              ) : null}
            </Text>
            <View style={styles.progressBarTrack}>
              <View
                style={[styles.progressBarFill, {width: `${controllerProgressPct}%`}]}
              />
            </View>
            {showControllerBytesLine ? (
              <Text style={styles.fwBytes}>
                {formatBytesShort(controllerOtaBytesReceived)} /{' '}
                {formatBytesShort(controllerOtaBytesTotal)}
                {` (${controllerProgressPct}%)`}
              </Text>
            ) : null}
            {controllerOtaState === 'transferring' ||
            controllerOtaState === 'downloading' ||
            controllerOtaState === 'verifying' ? (
              <View style={styles.fwButtonRow}>
                <Button
                  mode="outlined"
                  onPress={onControllerUpdateCancel}
                  style={styles.fwFullWidthButton}>
                  Cancel
                </Button>
              </View>
            ) : null}
          </View>
        ) : controllerOtaState === 'done' ? (
          <View style={styles.fwBody}>
            <Text style={styles.successText}>✓ Update complete</Text>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={handleCheckForControllerUpdates}
                style={styles.fwFullWidthButton}>
                Check for updates
              </Button>
            </View>
            <Text style={styles.fwHint}>
              Last checked: {formatRelative(now, controllerLatestReleaseCheckedAt)}
            </Text>
          </View>
        ) : controllerOtaState === 'error' && controllerOtaError ? (
          <View style={styles.fwBody}>
            <Text style={styles.errorText}>⚠ {controllerOtaError}</Text>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onControllerFirmwareButtonPress}
                style={styles.fwFullWidthButton}>
                {controllerFirmwareButtonLabel}
              </Button>
            </View>
          </View>
        ) : (
          <View style={styles.fwBody}>
            <View style={styles.fwButtonRow}>
              <Button
                mode="contained"
                onPress={onControllerFirmwareButtonPress}
                disabled={controllerBleStatus !== 'connected'}
                style={styles.fwFullWidthButton}>
                {controllerFirmwareButtonLabel}
              </Button>
            </View>
            <Text style={styles.fwHint}>
              {controllerBleStatus !== 'connected'
                ? hasControllerUpdateAvailable || controllerOffer.kind === 'unknown-current'
                  ? 'Connect to the controller to install the update'
                  : 'Connect to the controller to check for updates'
                : `Last checked: ${formatRelative(now, controllerLatestReleaseCheckedAt)}`}
            </Text>
            {controllerOffer.kind === 'unknown-current' && controllerBleStatus === 'connected' ? (
              <Text style={styles.fwHint}>
                Install may fail if device firmware predates OTA support — USB flash required for first deploy.
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </>
  );

  const renderDisplayTab = () => (
    <>
      {/* Display Section */}
      <Text style={styles.sectionHeader}>Display</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Speed Unit</Text>
        <View style={styles.segmentedWrapper}>
          <SegmentedButtons
            value={speedUnit}
            onValueChange={async val => {
              const unit = val as 'kmh' | 'mph';
              setSpeedUnit(unit);
              if (bleStatus === 'connected') {
                try {
                  await paoBleManager.writeSpeedUnit(unit);
                } catch (e) {
                  console.warn('Could not write speed unit to peripheral:', e);
                }
              }
            }}
            buttons={[
              {value: 'kmh', label: 'km/h'},
              {value: 'mph', label: 'mph'},
            ]}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Auto-brighten HUD</Text>
            <Text style={styles.hint}>Maximizes screen brightness while HUD</Text>
          </View>
          <Switch
            value={hudAutoBrighten}
            onValueChange={setHudAutoBrighten}
            color="#00C853"
          />
        </View>
        {hudAutoBrighten && (
          <View style={[styles.row, styles.subRow]}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Only while charging</Text>
              <Text style={styles.hint}>Limit brightness boost to when the phone is plugged in</Text>
            </View>
            <Switch
              value={hudBrightenOnlyWhenCharging}
              onValueChange={setHudBrightenOnlyWhenCharging}
              color="#00C853"
            />
          </View>
        )}
        {hudAutoBrighten && hasWriteSettings === false && (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.hint}>Grant "Modify system settings" for full brightness</Text>
            </View>
            <Button mode="outlined" onPress={requestWriteSettings} style={styles.bleButton}>
              Grant
            </Button>
          </View>
        )}
      </View>

      {/* Navigation Section */}
      <Text style={styles.sectionHeader}>Navigation</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Manual Gear Control</Text>
            <Text style={styles.hint}>Show the Gear tab in the bottom bar</Text>
          </View>
          <Switch
            value={showGearTab}
            onValueChange={setShowGearTab}
            color="#00C853"
          />
        </View>
      </View>
    </>
  );

  // Pick which tab body to render. Only one is mounted at a time — keeps
  // scroll state reset and avoids stacking multiple ScrollViews. The active
  // tab's contents render inside the shared ScrollView below.
  const renderActiveTab = () => {
    switch (activeTab) {
      case 'bluetooth':
        return renderBluetoothTab();
      case 'charging':
        return renderChargingTab();
      case 'firmware':
        return renderFirmwareTab();
      case 'display':
        return renderDisplayTab();
      default:
        return null;
    }
  };

  return (
    <View style={styles.screen}>
      {/* Wake-lock note: the previous implementation used `react-native-keep-awake`,
          which was abandoned and referenced the removed `jcenter()` Gradle repo,
          breaking CI on Gradle 9. It has been replaced with a tiny in-tree
          native module (`KeepAwakeModule.kt` + `KeepAwakePackage.kt`) wrapped
          by `utils/keepAwake.ts`. The JS wrapper Platform-checks for Android
          and is a no-op on iOS. The module toggles FLAG_KEEP_SCREEN_ON on the
          Activity window — activated when the user kicks off an OTA, released
          when otaState transitions to a terminal state (idle / error / done)
          and again in the unmount effect as belt-and-suspenders. */}
      <PageHeader title="Settings" bleSource="peripheral" showBleIndicator={false} style={{paddingHorizontal: 16}} />

      {/* Tap-only top tab bar. Underline indicator on active tab. Lives
          immediately below the page header — paddingTop falls back to
          StatusBar.currentHeight on Android in case PageHeader is ever
          removed; today PageHeader handles the visible top inset. */}
      <View style={[styles.tabBar, {paddingTop: Math.max(0, tabBarSafeTop - 44) /* PageHeader already absorbs 44px */}]}>
        {TABS.map(tab => {
          const active = tab.key === activeTab;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{selected: active}}
              style={styles.tabItem}>
              <Text
                style={[
                  styles.tabLabel,
                  active && styles.tabLabelActive,
                ]}
                numberOfLines={1}>
                {tab.label}
              </Text>
              <View
                style={[
                  styles.tabUnderline,
                  active && styles.tabUnderlineActive,
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}>
        {renderActiveTab()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  container: {
    padding: 16,
    paddingBottom: 120,
  },
  // ── Top tab bar ────────────────────────────────────────────────────────
  // Horizontal row of 4 equal-width tap targets. Underline indicator on the
  // active tab matches the app's existing accent color (#5BA8C4 — same blue
  // used by info icons + page titles). Inactive label is muted #9E9E9E so
  // the active label visually pops.
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0D0D0D',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A2A',
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 0,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9E9E9E',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingBottom: 8,
  },
  tabLabelActive: {
    color: '#87CEEB',
  },
  tabUnderline: {
    height: 2,
    width: '70%',
    backgroundColor: 'transparent',
  },
  tabUnderlineActive: {
    backgroundColor: '#5BA8C4',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9E9E9E',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A2A',
  },
  rowText: {
    flex: 1,
    marginRight: 12,
  },
  subRow: {
    marginLeft: 16,
    borderLeftWidth: 2,
    borderLeftColor: '#2A2A2A',
    paddingLeft: 12,
  },
  label: {
    fontSize: 15,
    color: '#E0E0E0',
    fontWeight: '500',
  },
  subLabel: {
    fontSize: 12,
    color: '#9E9E9E',
    fontWeight: '500',
    marginTop: 12,
    marginBottom: 0,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  value: {
    fontSize: 15,
    color: '#9E9E9E',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  bleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  bleRowLeft: {
    width: 90,
    flexShrink: 0,
  },
  statusIndicator: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bleRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 4,
  },
  bleButton: {
    width: 120,
  },
  segmentedWrapper: {
    paddingTop: 8,
    paddingBottom: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A2A2A',
    marginVertical: 4,
  },
  // Firmware section — consolidated OTA UI styles.
  fwTitleRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginRight: 12,
  },
  // Inline row title for Firmware-tab cards. Replaces the prior external
  // section headers ("APP", "CHARGER FIRMWARE") and the small leading
  // chip/cellphone icons. Mirrors the standard in-row `label` weight/size
  // so the title visually anchors the row without needing an outer header.
  fwRowTitle: {
    fontSize: 15,
    color: '#E0E0E0',
    fontWeight: '600',
  },
  infoIcon: {
    marginLeft: 6,
    padding: 2,
  },
  infoIconDisabled: {
    opacity: 0.5,
  },
  fwHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    width: '100%',
  },
  fwVersionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // 8px round red dot indicating "newer release available".
  updateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  fwBody: {
    paddingVertical: 12,
  },
  fwButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  fwFullWidthButton: {
    flex: 1,
  },
  fwPhase: {
    fontSize: 13,
    color: '#C0C0C0',
    marginTop: 8,
    fontWeight: '500',
  },
  inlineSpinner: {
    marginLeft: 6,
  },
  fwBytes: {
    fontSize: 12,
    color: '#9E9E9E',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  successText: {
    color: '#00C853',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  errorText: {
    color: '#F44336',
    fontSize: 13,
    marginBottom: 12,
  },
  // Inline progress bar — matches the previous UpdateScreen visual language
  // (#2A2A2A track, #00C853 fill) but inline in the card instead of a modal.
  progressBarTrack: {
    width: '100%',
    height: 14,
    backgroundColor: '#2A2A2A',
    borderRadius: 7,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#00C853',
    borderRadius: 7,
  },
});
