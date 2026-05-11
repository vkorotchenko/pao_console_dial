import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import {Switch, SegmentedButtons, Button} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager} from '../ble/PaoBleManager';
import {chargerBleManager} from '../ble/ChargerBleManager';
import {requestBlePermissions} from '../utils/permissions';
import {
  checkForChargerUpdate,
  prepareOtaPayload,
  cancelOtaPreparation,
} from '../services/otaController';
import {flashChargerFirmware} from '../services/otaOrchestrator';
import {activateKeepAwake, deactivateKeepAwake} from '../utils/keepAwake';
import {compare, formatVersion, parse} from '../services/semver';
import _ScreenBrightness from 'react-native-screen-brightness';
import {PageHeader} from '../components/PageHeader';
const ScreenBrightness = _ScreenBrightness as any;

interface SettingsScreenProps {
  onOpenFirmwareInfo?: () => void;
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

export default function SettingsScreen({onOpenFirmwareInfo}: SettingsScreenProps = {}) {
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
  const otaState = useAppStore(state => state.otaState);
  const otaError = useAppStore(state => state.otaError);
  const otaProgress = useAppStore(state => state.otaProgress);
  const otaBytesReceived = useAppStore(state => state.otaBytesReceived);
  const otaBytesTotal = useAppStore(state => state.otaBytesTotal);
  const latestReleaseCheckedAt = useAppStore(state => state.latestReleaseCheckedAt);
  const latestReleaseVersion = useAppStore(state => state.latestReleaseVersion);

  // ── OTA flash flow state (consolidated into Settings — Phase 5 polish) ──
  // AbortController for the live flash run. We mirror the lifecycle that used
  // to live in UpdateScreen: own the controller in a ref so the user can
  // cancel a transferring flash, recreate on each fresh attempt, release the
  // wake-lock on settle, and abort on unmount.
  const flashAbortRef = useRef<AbortController | null>(null);
  const [hasWriteSettings, setHasWriteSettings] = useState<boolean | null>(null);
  // Tick once a minute so the "Last checked" relative time updates without
  // forcing a re-render of the rest of the screen. Cheap; runs only while
  // SettingsScreen is mounted.
  const [now, setNow] = useState(Date.now());
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
    const {
      chargerFirmwareVersion: fw,
      latestReleaseVersion: latest,
    } = useAppStore.getState();

    if (!fw) {
      Alert.alert(
        "Couldn't determine running firmware",
        'Connect to the charger to check for updates.',
      );
      return;
    }
    if (!parse(fw)) {
      Alert.alert(
        "Couldn't determine running firmware",
        `The charger reported an unrecognized firmware version (${fw}). Please reconnect or reflash.`,
      );
      return;
    }
    if (!latest) {
      Alert.alert('No releases available yet', 'No published charger firmware release was found.');
      return;
    }
    if (compare(latest, fw) === 1) {
      // Newer release exists — red dot + contextual button already convey it.
      return;
    }
    Alert.alert(
      "You're on the latest version",
      `Running ${formatVersion(fw)}.`,
    );
  };

  // ── OTA flash flow handlers (Phase 5 polish — consolidated into Settings) ─
  // The contextual Firmware button delegates here when an update is available.
  // We mirror the lifecycle that used to live in UpdateScreen:
  //   1. tap → activate wake-lock, kick off prepareOtaPayload (downloads +
  //      verifies). The orchestrator runs the moment otaState flips to
  //      'ready' (handled in the watcher effect below — keeps the button a
  //      single "Update to vX.Y.Z" tap instead of two).
  //   2. cancel during transfer → abort the controller; orchestrator catches
  //      it and lands in 'idle' / 'error'.

  const onUpdateRequest = () => {
    // Reset any prior abort controller defensively.
    flashAbortRef.current?.abort();
    flashAbortRef.current = new AbortController();
    // KeepAwake is wrapped already in utils/keepAwake but some Android versions
    // can still throw under odd activation orderings (e.g. activate-deactivate
    // races during rapid OTA re-attempts). Extra belt-and-suspenders try/catch.
    try {
      activateKeepAwake();
    } catch (e) {
      console.warn('[OTA] activateKeepAwake failed:', e);
    }
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
    // releaseWakeLock fires on BOTH success and failure of flashChargerFirmware,
    // and can fire after this component unmounts (the orchestrator's tail
    // runs independently of the UI lifecycle). Guard the deactivate call —
    // KeepAwake itself is forgiving but RN/Android can throw on duplicate
    // deactivates or post-unmount calls in rare cases.
    const releaseWakeLock = () => {
      try {
        deactivateKeepAwake();
      } catch (e) {
        console.warn('[OTA] deactivateKeepAwake (post-flash) failed:', e);
      }
    };
    flashChargerFirmware({signal: controller.signal}).then(
      releaseWakeLock,
      releaseWakeLock,
    );
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
        if (s.otaState === 'done') {
          s.setOtaState('idle');
        }
      }, 3000);
      return () => {
        if (autoRevertTimerRef.current) {
          clearTimeout(autoRevertTimerRef.current);
          autoRevertTimerRef.current = null;
        }
      };
    }
    if (otaState === 'idle' || otaState === 'error') {
      try {
        deactivateKeepAwake();
      } catch (e) {
        console.warn('[OTA] deactivateKeepAwake on idle/error failed:', e);
      }
    }
    return undefined;
  }, [otaState]);

  // Drop wake-lock + abort on unmount. Also flips mountedRef so the auto-revert
  // timer (if still pending) becomes a no-op when it eventually fires.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (autoRevertTimerRef.current) {
        clearTimeout(autoRevertTimerRef.current);
        autoRevertTimerRef.current = null;
      }
      try {
        deactivateKeepAwake();
      } catch (e) {
        console.warn('[OTA] deactivateKeepAwake on unmount failed:', e);
      }
      flashAbortRef.current?.abort();
    };
  }, []);

  // Pre-compute the firmware section state so the JSX below stays readable.
  const hasUpdateAvailable = (() => {
    if (!chargerFirmwareVersion || !latestReleaseVersion) return false;
    if (!parse(chargerFirmwareVersion)) return false;
    return compare(latestReleaseVersion, chargerFirmwareVersion) === 1;
  })();

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
    if (hasUpdateAvailable && latestReleaseVersion) {
      return `Update to ${formatVersion(latestReleaseVersion)}`;
    }
    return 'Check for updates';
  })();

  const onFirmwareButtonPress = () => {
    if (isOtaInFlight) {
      // Only meaningful during 'transferring' but no harm in being permissive.
      onUpdateCancel();
      return;
    }
    if (otaState === 'error' && hasUpdateAvailable) {
      // Retry the install path.
      onUpdateRequest();
      return;
    }
    if (hasUpdateAvailable) {
      onUpdateRequest();
      return;
    }
    handleCheckForUpdates();
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.container}>
      <PageHeader title="Settings" bleSource="peripheral" showBleIndicator={false} style={{paddingHorizontal: 0}} />

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

        <View style={styles.divider} />

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

      {/* Firmware Section — consolidated OTA UI (Phase 5 polish).
          Layout:
            - Top row: "Charger firmware  ⓘ          v0.1.5  •"
              (• red dot only when an update is available)
            - Optional hint: "Latest available: v0.1.6"
            - Divider
            - State-driven body:
                idle / up-to-date     → [Check for updates] + last-checked
                idle + update         → [Update to v0.1.6]  + last-checked
                in-flight             → progress bar + phase + bytes + [Cancel]
                done                  → "✓ Update complete" success line
                error                 → "⚠ {message}" + [Try again]
      */}
      <Text style={styles.sectionHeader}>Firmware</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.fwTitleRow}>
            <Text style={styles.label}>Charger firmware</Text>
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
              {chargerFirmwareVersion
                ? formatVersion(chargerFirmwareVersion)
                : '—'}
            </Text>
            {hasUpdateAvailable ? (
              <View
                style={styles.updateDot}
                accessibilityLabel="Update available"
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
                disabled={
                  hasUpdateAvailable &&
                  chargerBleStatus !== 'connected'
                }
                style={styles.fwFullWidthButton}>
                {firmwareButtonLabel}
              </Button>
            </View>
            <Text style={styles.fwHint}>
              {hasUpdateAvailable &&
              chargerBleStatus !== 'connected'
                ? 'Connect to the charger to install the update'
                : `Last checked: ${formatRelative(now, latestReleaseCheckedAt)}`}
            </Text>
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

      {/* Charging Section */}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  container: {
    padding: 16,
    paddingBottom: 120,
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
