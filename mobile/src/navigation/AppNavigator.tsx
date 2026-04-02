import React, {useEffect, useMemo, useRef, useState} from 'react';
import {View, StyleSheet, StatusBar} from 'react-native';
import Orientation from 'react-native-orientation-locker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {State, Subscription} from 'react-native-ble-plx';
import DashboardScreen from '../screens/DashboardScreen';
import GearScreen from '../screens/GearScreen';
import ChargerScreen from '../screens/ChargerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HUDScreen from '../screens/HUDScreen';
import {FloatingIcons} from '../components/FloatingIcons';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager, PAO_SERVICE_UUID} from '../ble/PaoBleManager';
import {chargerBleManager, CHARGER_SERVICE_UUID} from '../ble/ChargerBleManager';
import {sharedBleManager} from '../ble/bleInstance';
import {ChargerDirectData} from '../types';
import {requestBlePermissions} from '../utils/permissions';
import PagerView from 'react-native-pager-view';
import MediaControl from '../native/MediaControl';
import _ScreenBrightness from 'react-native-screen-brightness';
const ScreenBrightness = _ScreenBrightness as any;

type Screen = 'dashboard' | 'charger' | 'gear' | 'settings' | 'hud';

const SCAN_TIMEOUT_MS = 15_000; // stop scanning after 15s if nothing found
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;
const DIRECT_CONNECT_TIMEOUT_MS = 5_000;
const PAO_DEVICE_ID_KEY = 'pao_device_id';
const CHARGER_DEVICE_ID_KEY = 'charger_device_id';

export default function AppNavigator() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('hud');
  // Bug 1 fix: track whether BLE permissions have been granted so scan effects
  // never run before the system dialog has resolved.
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  const showGearTab = useAppStore(state => state.showGearTab);
  const bleStatus = useAppStore(state => state.bleStatus);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);
  // scanTrigger lives in the store so Settings screen "Connect" buttons can
  // increment it without starting their own independent scans.
  const scanTrigger = useAppStore(state => state.scanTrigger);

  const pagerRef = useRef<PagerView>(null);

  const swipeScreens = useMemo<Screen[]>(() => {
    const base: Screen[] = ['dashboard', 'charger', 'settings'];
    if (showGearTab) { base.splice(1, 0, 'gear'); }
    return base;
  }, [showGearTab]);

  const paoRetries = useRef(0);
  const chargerRetries = useRef(0);
  const prevScanTrigger = useRef(0);
  // Single shared timer refs for the unified scan effect
  const backoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // helpers to persist known device IDs
  const savePaoDeviceId = async (id: string) => {
    try { await AsyncStorage.setItem(PAO_DEVICE_ID_KEY, id); } catch {}
  };
  const saveChargerDeviceId = async (id: string) => {
    try { await AsyncStorage.setItem(CHARGER_DEVICE_ID_KEY, id); } catch {}
  };

  // attempt direct reconnect to a known device ID; fall back to scan if
  // connection times out or fails.
  const connectPaoDirectOrScan = async (knownId: string) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Direct connect timed out — let the scan effect handle it
      useAppStore.getState().setBleStatus('disconnected');
    }, DIRECT_CONNECT_TIMEOUT_MS);

    try {
      await paoBleManager.connect(knownId);
      clearTimeout(timer);
      if (!timedOut) {
        await savePaoDeviceId(knownId);
        paoBleManager.subscribeToTelemetry(() => {});
        paoBleManager.subscribeToMediaCommands(cmd => {
          MediaControl.dispatch(cmd);
        });
      }
    } catch {
      clearTimeout(timer);
      if (!timedOut) {
        // Connection failed — fall through to scan by resetting to disconnected
        useAppStore.getState().setBleStatus('disconnected');
      }
    }
  };

  const connectChargerDirectOrScan = async (knownId: string) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      useAppStore.getState().setChargerBleStatus('disconnected');
    }, DIRECT_CONNECT_TIMEOUT_MS);

    try {
      await chargerBleManager.connect(knownId);
      clearTimeout(timer);
      if (!timedOut) {
        await saveChargerDeviceId(knownId);
        chargerBleManager.subscribeToAll(partial => {
          const current = useAppStore.getState().chargerData;
          useAppStore.getState().setChargerData({...({} as any), ...current, ...partial} as ChargerDirectData);
        });
      }
    } catch {
      clearTimeout(timer);
      if (!timedOut) {
        useAppStore.getState().setChargerBleStatus('disconnected');
      }
    }
  };

  useEffect(() => {
    Orientation.lockToLandscapeLeft();
  }, []);

  useEffect(() => {
    StatusBar.setHidden(currentScreen === 'hud', 'fade');
    if (currentScreen !== 'hud') {
      ScreenBrightness.setAppBrightness(-1).catch(() => {});
      ScreenBrightness.setAutoBrightnessEnabled(true).catch(() => {});
    }
  }, [currentScreen]);

  useEffect(() => {
    if (currentScreen === 'hud') { return; }
    const idx = swipeScreens.indexOf(currentScreen);
    if (idx >= 0) { pagerRef.current?.setPage(idx); }
  }, [currentScreen, swipeScreens]);

  // On mount: request BLE permissions, restore known device IDs, attempt direct
  // reconnect, then subscribe to BLE state changes for late Bluetooth enable.
  // Bug 1 fix: setPermissionsGranted(true) only after permissions resolve — this
  // gates the unified scan effect so it never starts before Android grants access.
  useEffect(() => {
    let bleStateSubscription: Subscription | null = null;
    let mounted = true;

    const init = async () => {
      // Bug 1 fix: request permissions before any scan or connect attempt
      const granted = await requestBlePermissions();
      if (!granted || !mounted) {
        return;
      }

      // Bug 1 fix: signal that permissions are available — unblocks scan effect
      setPermissionsGranted(true);

      // Restore last-known device IDs and attempt direct reconnect
      const [storedPaoId, storedChargerId] = await Promise.all([
        AsyncStorage.getItem(PAO_DEVICE_ID_KEY).catch(() => null),
        AsyncStorage.getItem(CHARGER_DEVICE_ID_KEY).catch(() => null),
      ]);

      const bleState = await sharedBleManager.state();

      if (bleState === State.PoweredOn) {
        if (storedPaoId && mounted) {
          connectPaoDirectOrScan(storedPaoId);
        }
        if (storedChargerId && mounted) {
          connectChargerDirectOrScan(storedChargerId);
        }
      }

      // Subscribe to BLE state changes — if BT was off at launch and the user
      // turns it on, trigger a fresh connection attempt.
      bleStateSubscription = sharedBleManager.onStateChange(newState => {
        if (!mounted) { return; }
        if (newState === State.PoweredOn) {
          const {bleStatus: pStatus, chargerBleStatus: cStatus} = useAppStore.getState();
          if (pStatus === 'disconnected' || pStatus === 'error') {
            paoRetries.current = 0;
            useAppStore.getState().incrementScanTrigger();
          }
          if (cStatus === 'disconnected' || cStatus === 'error') {
            chargerRetries.current = 0;
            useAppStore.getState().incrementScanTrigger();
          }
        }
      }, true /* emitCurrentState */);
    };

    init();

    return () => {
      mounted = false;
      bleStateSubscription?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist device ID and reset retry counter when PAO connects successfully.
  useEffect(() => {
    if (bleStatus === 'connected') {
      paoRetries.current = 0;
      const id = useAppStore.getState().deviceId;
      if (id) { savePaoDeviceId(id); }
      // PAO status transitions (disconnected → connecting → connected) re-run the
      // unified scan effect and consume charger retries as collateral damage. Reset
      // charger retries now so it gets fresh attempts from this stable connected state.
      if (useAppStore.getState().chargerBleStatus === 'disconnected') {
        chargerRetries.current = 0;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleStatus]);

  // Persist device ID and reset retry counter when charger connects successfully.
  useEffect(() => {
    if (chargerBleStatus === 'connected') {
      chargerRetries.current = 0;
      const id = useAppStore.getState().chargerDeviceId;
      if (id) { saveChargerDeviceId(id); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargerBleStatus]);

  // Bug 2 fix — unified scan effect.
  //
  // Both PAO and charger previously started independent scans against the same
  // sharedBleManager instance, causing each new startDeviceScan() call to kill
  // the previous one. This single effect runs ONE scan covering both service
  // UUIDs, routes discovered devices by their advertised serviceUUIDs, and
  // manages statuses externally so internal stopScan() calls in the managers
  // cannot reset status to 'disconnected' at the wrong moment.
  //
  // Bug 1 fix: guarded by permissionsGranted — will not run until the Android
  // permissions dialog has resolved successfully.
  useEffect(() => {
    // Guard: permissions must be granted before any scan attempt
    if (!permissionsGranted) { return; }

    // Manual scan request: reset retry counters so a fresh set of 3 attempts begins
    if (scanTrigger !== prevScanTrigger.current) {
      prevScanTrigger.current = scanTrigger;
      paoRetries.current = 0;
      chargerRetries.current = 0;
    }

    // Bug 2 fix: treat 'error' the same as 'disconnected' so a failed connect
    // attempt is retried by the unified scan rather than being stuck forever.
    const needsPao = bleStatus === 'disconnected' || bleStatus === 'error';
    const needsCharger = chargerBleStatus === 'disconnected' || chargerBleStatus === 'error';

    // Nothing to do if both are already connected/connecting/scanning/error
    if (!needsPao && !needsCharger) { return; }

    // Don't start a new scan attempt if retries are exhausted for all needed devices
    const paoExhausted = needsPao && paoRetries.current >= MAX_RETRIES;
    const chargerExhausted = needsCharger && chargerRetries.current >= MAX_RETRIES;
    if ((!needsPao || paoExhausted) && (!needsCharger || chargerExhausted)) { return; }

    // Compute backoff delay — use the smaller of the two relevant delays so
    // neither device waits longer than necessary.
    const paoDelay = needsPao && !paoExhausted
      ? BACKOFF_BASE_MS * Math.pow(2, paoRetries.current)
      : Infinity;
    const chargerDelay = needsCharger && !chargerExhausted
      ? BACKOFF_BASE_MS * Math.pow(2, chargerRetries.current)
      : Infinity;
    const delay = Math.min(paoDelay, chargerDelay);

    // Increment retry counters for whichever devices we are about to attempt
    if (needsPao && !paoExhausted) { paoRetries.current += 1; }
    if (needsCharger && !chargerExhausted) { chargerRetries.current += 1; }

    backoffTimer.current = setTimeout(() => {
      // Adafruit Bluefruit SPI puts its UUID in the scan response, not primary advertisement.
      // Android UUID filters only match primary advertisement — CHARGER_SERVICE_UUID as a filter
      // will never return the charger device. Use null (scan all) whenever charger is needed.
      // PAO_SERVICE_UUID is safe to filter on because PAO includes it in primary advertisement.
      const uuidsToScan: string[] | null =
        (needsCharger && !chargerExhausted)
          ? null                                                   // scan all — charger UUID is in scan response
          : (needsPao && !paoExhausted) ? [PAO_SERVICE_UUID]      // PAO only — safe to filter
          : null;

      if (!needsPao && !needsCharger) { return; }

      sharedBleManager.startDeviceScan(
        uuidsToScan,
        null,
        async (error, device) => {
          if (error) {
            if (error.message?.includes('Cannot start scanning operation')) {
              return;
            }
            console.warn('Unified BLE scan error:', error);
            // Only flip to error for devices that were actually scanning
            if (needsPao && !paoExhausted) {
              useAppStore.getState().setBleStatus('error');
              useAppStore.getState().setError(error.message);
            }
            if (needsCharger && !chargerExhausted) {
              useAppStore.getState().setChargerBleStatus('error');
              useAppStore.getState().setChargerError(error.message);
            }
            return;
          }

          if (!device) { return; }

          // Normalize advertised service UUIDs to lowercase for comparison
          const advertised = (device.serviceUUIDs ?? []).map(u => u.toLowerCase());

          // PAO Console always includes its service UUID in the primary advertisement
          // AND has a known device name — use either signal.
          const isPao =
            advertised.includes(PAO_SERVICE_UUID.toLowerCase()) ||
            device.name === 'PAO Console';

          // Charger: Adafruit Bluefruit SPI puts UUID in scan response so serviceUUIDs
          // may be empty at callback time. Match by advertised UUID, saved device ID,
          // or fallback (any non-PAO device when scanning with null filter for charger).
          const savedChargerId = useAppStore.getState().chargerDeviceId;
          const isCharger =
            !isPao && (
              advertised.includes(CHARGER_SERVICE_UUID.toLowerCase()) ||
              (savedChargerId != null && device.id === savedChargerId) ||
              device.name?.toLowerCase() === 'pao charger'
            );

          if (isPao && needsPao && useAppStore.getState().bleStatus === 'disconnected') {
            console.log('Unified scan: found PAO device', device.name, device.id);

            // Stop the shared scan BEFORE connecting so neither manager's
            // internal stopScan() can reset status to 'disconnected'.
            sharedBleManager.stopDeviceScan();
            if (scanTimer.current) {
              clearTimeout(scanTimer.current);
              scanTimer.current = null;
            }

            // Set status to 'connecting' NOW — connect() calls stopScan()
            // internally which checks bleStatus === 'scanning'; since we
            // already stopped the scan and status is 'connecting' (not
            // 'scanning'), the internal stopScan() becomes a harmless no-op.
            useAppStore.getState().setBleStatus('connecting');

            try {
              await paoBleManager.connect(device.id);
              await savePaoDeviceId(device.id);
              paoBleManager.subscribeToTelemetry(() => {});
              paoBleManager.subscribeToMediaCommands(cmd => {
                MediaControl.dispatch(cmd);
              });
            } catch (e) {
              console.error('PAO connect error:', e);
              useAppStore.getState().setBleStatus('disconnected');
            }

            // If charger is still needed after PAO result, kick off a charger scan immediately
            // rather than waiting for the effect's next scheduled backoff.
            const chargerStillNeeded =
              useAppStore.getState().chargerBleStatus === 'disconnected' ||
              useAppStore.getState().chargerBleStatus === 'error';
            if (chargerStillNeeded && !chargerExhausted) {
              chargerRetries.current = 0; // reset so the next effect run starts fresh
              useAppStore.getState().incrementScanTrigger();
            }
          }

          if (isCharger && needsCharger && useAppStore.getState().chargerBleStatus === 'disconnected') {
            console.log('Unified scan: found charger device', device.name, device.id);

            // Same stop-before-connect pattern as PAO above
            sharedBleManager.stopDeviceScan();
            if (scanTimer.current) {
              clearTimeout(scanTimer.current);
              scanTimer.current = null;
            }

            useAppStore.getState().setChargerBleStatus('connecting');

            try {
              await chargerBleManager.connect(device.id);
              await saveChargerDeviceId(device.id);
              chargerBleManager.subscribeToAll(partial => {
                const current = useAppStore.getState().chargerData;
                useAppStore.getState().setChargerData({...({} as any), ...current, ...partial} as ChargerDirectData);
              });
            } catch (e) {
              console.error('Charger connect error:', e);
              useAppStore.getState().setChargerBleStatus('disconnected');
            }
          }
        },
      );

      // Single scan timeout — if nothing is found in 15s, stop and force the
      // unified scan effect to re-run for any device still waiting. We use
      // setScanTrigger instead of setting status to 'disconnected' because Zustand
      // equality checks swallow no-op sets — if status is already 'disconnected'
      // the effect would never re-run and the retry loop would silently stall.
      scanTimer.current = setTimeout(() => {
        sharedBleManager.stopDeviceScan();
        scanTimer.current = null;

        const stillNeedsPao = needsPao && !paoExhausted &&
          useAppStore.getState().bleStatus === 'disconnected';
        const stillNeedsCharger = needsCharger && !chargerExhausted &&
          useAppStore.getState().chargerBleStatus === 'disconnected';

        if (stillNeedsPao || stillNeedsCharger) {
          // Force the effect to re-run even though statuses haven't changed
          useAppStore.getState().incrementScanTrigger();
        }
      }, SCAN_TIMEOUT_MS);
    }, delay);

    return () => {
      if (backoffTimer.current) { clearTimeout(backoffTimer.current); }
      if (scanTimer.current) {
        clearTimeout(scanTimer.current);
        scanTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleStatus, chargerBleStatus, permissionsGranted, scanTrigger]);

  const navigate = (screen: string) => {
    if (screen === 'hud') {
      Orientation.lockToLandscapeLeft();
    } else {
      Orientation.lockToPortrait();
    }
    setCurrentScreen(screen as Screen);
  };

  const renderScreen = (screen: Screen) => {
    switch (screen) {
      case 'hud': return <HUDScreen onClose={() => { Orientation.lockToPortrait(); setCurrentScreen('dashboard'); }} />;
      case 'charger': return <ChargerScreen />;
      case 'gear': return <GearScreen />;
      case 'settings': return <SettingsScreen />;
      default: return <DashboardScreen />;
    }
  };

  if (currentScreen === 'hud') {
    return (
      <View style={styles.container}>
        {renderScreen('hud')}
        <FloatingIcons onNavigate={navigate} showGearTab={showGearTab} currentScreen={currentScreen} isHUD={true} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={Math.max(0, swipeScreens.indexOf(currentScreen))}
        onPageSelected={e => {
          const screen = swipeScreens[e.nativeEvent.position];
          if (screen) { setCurrentScreen(screen); }
        }}
      >
        {swipeScreens.map(screen => (
          <View key={screen} style={styles.page}>
            {renderScreen(screen)}
          </View>
        ))}
      </PagerView>
      <FloatingIcons onNavigate={navigate} showGearTab={showGearTab} currentScreen={currentScreen} isHUD={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  pager: {flex: 1},
  page: {flex: 1},
});
