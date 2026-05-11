import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
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
function formatBytesShort(bytes: number): string {
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
  // Pre-flight modal gate + AbortController for the live flash run. We mirror
  // the lifecycle that used to live in UpdateScreen: own the controller in a
  // ref so the user can cancel a transferring flash, recreate on each fresh
  // attempt, release the wake-lock on settle, and abort on unmount.
  const [showPreflight, setShowPreflight] = useState(false);
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
  //   1. tap → show pre-flight modal
  //   2. confirm → activate wake-lock, kick off prepareOtaPayload (downloads
  //      + verifies). The orchestrator runs the moment otaState flips to
  //      'ready' (handled in the watcher effect below — keeps the button a
  //      single "Update to vX.Y.Z" tap instead of two).
  //   3. cancel during transfer → abort the controller; orchestrator catches
  //      it and lands in 'idle' / 'error'.

  const onUpdateRequest = () => {
    setShowPreflight(true);
  };

  const onPreflightCancel = () => {
    setShowPreflight(false);
  };

  const onPreflightConfirm = () => {
    setShowPreflight(false);
    // Reset any prior abort controller defensively.
    flashAbortRef.current?.abort();
    flashAbortRef.current = new AbortController();
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
    const releaseWakeLock = () => deactivateKeepAwake();
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
  useEffect(() => {
    if (otaState === 'done') {
      const t = setTimeout(() => {
        const s = useAppStore.getState();
        if (s.otaState === 'done') {
          s.setOtaState('idle');
        }
      }, 3000);
      return () => clearTimeout(t);
    }
    if (otaState === 'idle' || otaState === 'error') {
      deactivateKeepAwake();
    }
    return undefined;
  }, [otaState]);

  // Drop wake-lock + abort on unmount.
  useEffect(() => {
    return () => {
      deactivateKeepAwake();
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

  const progressPct = Math.round(
    Math.max(0, Math.min(1, otaProgress)) * 100,
  );

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
              accessibilityRole="button"
              accessibilityLabel="Open firmware info"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={styles.infoIcon}>
              <Icon name="information-outline" size={18} color="#5BA8C4" />
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

        {/* In-flight: progress bar + label + optional bytes + Cancel */}
        {isOtaInFlight ? (
          <View style={styles.fwBody}>
            <View style={styles.progressBarTrack}>
              <View
                style={[styles.progressBarFill, {width: `${progressPct}%`}]}
              />
              <Text style={styles.progressPctOverlay}>{progressPct}%</Text>
            </View>
            <Text style={styles.fwPhase}>
              {phaseLabel}
              {otaState === 'rebooting' ||
              otaState === 'reconnecting' ||
              otaState === 'finalizing' ? (
                <ActivityIndicator
                  size="small"
                  color="#5BA8C4"
                  style={styles.inlineSpinner}
                />
              ) : null}
            </Text>
            {(otaState === 'downloading' || otaState === 'transferring') &&
            otaBytesReceived !== null &&
            otaBytesTotal !== null &&
            otaBytesTotal > 0 ? (
              <Text style={styles.fwBytes}>
                {formatBytesShort(otaBytesReceived)} /{' '}
                {formatBytesShort(otaBytesTotal)}
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

      {/* Pre-flight modal — same copy as the old UpdateScreen, just rendered
          from Settings now. Confirms intent and reminds about foreground/parked
          requirements before kicking off the flash flow. */}
      <Modal
        visible={showPreflight}
        transparent
        animationType="fade"
        onRequestClose={onPreflightCancel}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Icon
              name="alert-circle-outline"
              size={32}
              color="#F4A340"
              style={styles.modalIcon}
            />
            <Text style={styles.modalTitle}>Update charger firmware?</Text>
            <Text style={styles.modalBody}>
              Charging will pause during the update and resume when it's done.
              Make sure the vehicle is parked. Keep the app open and don't lock
              the screen — the update takes about a minute.
            </Text>
            <Text style={styles.modalBody}>
              The charger will restart and reconnect automatically. If anything
              goes wrong the bootloader will roll back to the previous version
              on the next power cycle.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={onPreflightCancel}
                style={styles.modalCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancel update">
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onPreflightConfirm}
                style={styles.modalConfirm}
                accessibilityRole="button"
                accessibilityLabel="Start update">
                <Text style={styles.modalConfirmText}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  progressPctOverlay: {
    alignSelf: 'center',
    color: '#0D0D0D',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  // Pre-flight modal styles (lifted verbatim from UpdateScreen).
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalIcon: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    color: '#E0E0E0',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  modalBody: {
    color: '#C0C0C0',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  modalCancel: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  modalCancelText: {
    color: '#9E9E9E',
    fontSize: 15,
    fontWeight: '600',
  },
  modalConfirm: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#00C853',
    borderRadius: 6,
  },
  modalConfirmText: {
    color: '#0D0D0D',
    fontSize: 15,
    fontWeight: '700',
  },
});
