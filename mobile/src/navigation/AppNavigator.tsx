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
import FirmwareInfoScreen from '../screens/FirmwareInfoScreen';
import AppInfoScreen from '../screens/AppInfoScreen';
import {FloatingIcons} from '../components/FloatingIcons';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager, PAO_SERVICE_UUID} from '../ble/PaoBleManager';
import {chargerBleManager, CHARGER_SERVICE_UUID} from '../ble/ChargerBleManager';
import {controllerBleManager, CONTROLLER_SERVICE_UUID} from '../ble/ControllerBleManager';
import {sharedBleManager} from '../ble/bleInstance';
import {ChargerDirectData} from '../types';
import {requestBlePermissions} from '../utils/permissions';
import {checkForChargerUpdate} from '../services/otaController';
import PagerView from 'react-native-pager-view';
import MediaControl from '../native/MediaControl';
import _ScreenBrightness from 'react-native-screen-brightness';
const ScreenBrightness = _ScreenBrightness as any;

type Screen =
  | 'dashboard'
  | 'charger'
  | 'gear'
  | 'settings'
  | 'hud'
  | 'firmware-info'
  | 'app-info';

const SCAN_TIMEOUT_MS = 15_000; // stop scanning after 15s if nothing found
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;
const DIRECT_CONNECT_TIMEOUT_MS = 5_000;
const PAO_DEVICE_ID_KEY = 'pao_device_id';
const CHARGER_DEVICE_ID_KEY = 'charger_device_id';
const CONTROLLER_DEVICE_ID_KEY = 'controller_device_id';

export default function AppNavigator() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('hud');
  // Bug 1 fix: track whether BLE permissions have been granted so scan effects
  // never run before the system dialog has resolved.
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  // Pending tab hint for SettingsScreen. Set whenever we navigate back to
  // Settings from a sub-screen (FirmwareInfo / AppInfo) so the user lands on
  // the tab they were already looking at instead of always defaulting to
  // Bluetooth. Reset to undefined on the next user-driven navigation away
  // from Settings so explicit re-entries (tap Settings in tab bar) start
  // clean. Type is the same string-union SettingsScreen uses internally —
  // kept loose here to avoid coupling navigator + screen file via a shared
  // type export for a 1-string-wide concern.
  const [pendingSettingsTab, setPendingSettingsTab] = useState<
    'bluetooth' | 'charging' | 'firmware' | 'display' | undefined
  >(undefined);

  const showGearTab = useAppStore(state => state.showGearTab);
  const bleStatus = useAppStore(state => state.bleStatus);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);
  const controllerBleStatus = useAppStore(state => state.controllerBleStatus);
  // OTA phase — used to PAUSE the unified scan effect during an orchestrated
  // OTA reconnect. Without this, the BLE-level disconnect that fires when
  // the charger reboots would flip chargerBleStatus to 'disconnected',
  // re-trigger this effect, and start a competing scan against the same
  // sharedBleManager that the orchestrator is using — killing the
  // orchestrator's scan and leaving the user stuck.
  const otaState = useAppStore(state => state.ota.charger.state);
  // Pause controller auto-reconnect during controller OTA orchestration.
  const controllerOtaState = useAppStore(state => state.ota.controller.state);
  // scanTrigger lives in the store so Settings screen "Connect" buttons can
  // increment it without starting their own independent scans.
  const scanTrigger = useAppStore(state => state.scanTrigger);

  const pagerRef = useRef<PagerView>(null);

  const swipeScreens = useMemo<Screen[]>(() => {
    const base: Screen[] = ['dashboard', 'charger', 'settings'];
    if (showGearTab) { base.splice(2, 0, 'gear'); }
    return base;
  }, [showGearTab]);

  const paoRetries = useRef(0);
  const chargerRetries = useRef(0);
  const controllerRetries = useRef(0);
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
  const saveControllerDeviceId = async (id: string) => {
    try { await AsyncStorage.setItem(CONTROLLER_DEVICE_ID_KEY, id); } catch {}
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
        // Seed readable state immediately without waiting for first notification
        chargerBleManager.readInitialState().then(initial => {
          if (Object.keys(initial).length > 0) {
            const current = useAppStore.getState().chargerData;
            useAppStore.getState().setChargerData({...({} as any), ...current, ...initial} as ChargerDirectData);
          }
        }).catch(() => {}); // non-fatal
        // Re-read after 1.5 s — firmware Ble::loop() fires ~1s post-connect and
        // populates chargeState/soc/error which start at VALUE=0 in GATT.
        setTimeout(() => {
          if (!chargerBleManager.isConnected()) return;
          chargerBleManager.readInitialState().then(refreshed => {
            if (Object.keys(refreshed).length > 0) {
              const current = useAppStore.getState().chargerData;
              useAppStore.getState().setChargerData({...({} as any), ...current, ...refreshed} as ChargerDirectData);
            }
          }).catch(() => {});
        }, 1500);
      }
    } catch {
      clearTimeout(timer);
      if (!timedOut) {
        useAppStore.getState().setChargerBleStatus('disconnected');
      }
    }
  };

  const connectControllerDirectOrScan = async (knownId: string) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      useAppStore.getState().setControllerBleStatus('disconnected');
    }, DIRECT_CONNECT_TIMEOUT_MS);

    try {
      await controllerBleManager.connect(knownId);
      clearTimeout(timer);
      if (!timedOut) {
        await saveControllerDeviceId(knownId);
        controllerBleManager.wirePostConnectSubscriptions();
      }
    } catch {
      clearTimeout(timer);
      if (!timedOut) {
        useAppStore.getState().setControllerBleStatus('disconnected');
      }
    }
  };

  useEffect(() => {
    Orientation.lockToLandscapeLeft();
  }, []);

  // Fire-and-forget GitHub release check on app mount. Errors are swallowed
  // inside checkForChargerUpdate — they live in the store as
  // otaState='error', never bubble. The 1-hour TTL inside the service
  // prevents thrashing if the app is restarted frequently.
  useEffect(() => {
    checkForChargerUpdate().catch(() => {});
  }, []);

  // Re-check whenever the charger connects. The 1-hour TTL still applies,
  // so connect/disconnect cycles within an hour are essentially free
  // (cache hit). Fresh data lands when the user reconnects after a long gap
  // — exactly the moment they care.
  useEffect(() => {
    if (chargerBleStatus === 'connected') {
      checkForChargerUpdate().catch(() => {});
    }
  }, [chargerBleStatus]);

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
      const [storedPaoId, storedChargerId, storedControllerId] = await Promise.all([
        AsyncStorage.getItem(PAO_DEVICE_ID_KEY).catch(() => null),
        AsyncStorage.getItem(CHARGER_DEVICE_ID_KEY).catch(() => null),
        AsyncStorage.getItem(CONTROLLER_DEVICE_ID_KEY).catch(() => null),
      ]);

      const bleState = await sharedBleManager.state();

      if (bleState === State.PoweredOn) {
        if (storedPaoId && mounted) {
          connectPaoDirectOrScan(storedPaoId);
        }
        if (storedChargerId && mounted) {
          connectChargerDirectOrScan(storedChargerId);
        }
        if (storedControllerId && mounted) {
          connectControllerDirectOrScan(storedControllerId);
        }
      }

      // Subscribe to BLE state changes — if BT was off at launch and the user
      // turns it on, trigger a fresh connection attempt.
      bleStateSubscription = sharedBleManager.onStateChange(newState => {
        if (!mounted) { return; }
        if (newState === State.PoweredOn) {
          const {bleStatus: pStatus, chargerBleStatus: cStatus, controllerBleStatus: ctrlStatus} = useAppStore.getState();
          if (pStatus === 'disconnected' || pStatus === 'error') {
            paoRetries.current = 0;
            useAppStore.getState().incrementScanTrigger();
          }
          if (cStatus === 'disconnected' || cStatus === 'error') {
            chargerRetries.current = 0;
            useAppStore.getState().incrementScanTrigger();
          }
          if (ctrlStatus === 'disconnected' || ctrlStatus === 'error') {
            controllerRetries.current = 0;
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

  // Persist device ID and reset retry counter when controller connects successfully.
  useEffect(() => {
    if (controllerBleStatus === 'connected') {
      controllerRetries.current = 0;
      const id = useAppStore.getState().controllerDevice?.id;
      if (id) { saveControllerDeviceId(id); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controllerBleStatus]);

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

    // Guard: pause auto-reconnect while the OTA orchestrator owns the BLE
    // pipeline. States 'rebooting' and 'reconnecting' explicitly cover the
    // window where the orchestrator is scanning + connecting to the new
    // firmware. 'finalizing' is the verify step; the connection is live by
    // then and we don't want to step on it. Other OTA states (downloading,
    // verifying, ready, transferring) don't touch the shared scan/connect
    // surface so they're fine to let pass.
    if (
      otaState === 'rebooting' ||
      otaState === 'reconnecting' ||
      otaState === 'finalizing' ||
      controllerOtaState === 'rebooting' ||
      controllerOtaState === 'reconnecting' ||
      controllerOtaState === 'finalizing'
    ) {
      console.log(`[AppNavigator] auto-reconnect tick: paused (otaState=${otaState} controllerOtaState=${controllerOtaState})`);
      return;
    }

    // Manual scan request: reset retry counters so a fresh set of 3 attempts begins
    if (scanTrigger !== prevScanTrigger.current) {
      prevScanTrigger.current = scanTrigger;
      paoRetries.current = 0;
      chargerRetries.current = 0;
      controllerRetries.current = 0;
    }

    // Bug 2 fix: treat 'error' the same as 'disconnected' so a failed connect
    // attempt is retried by the unified scan rather than being stuck forever.
    const needsPao = bleStatus === 'disconnected' || bleStatus === 'error';
    const needsCharger = chargerBleStatus === 'disconnected' || chargerBleStatus === 'error';
    const needsController = controllerBleStatus === 'disconnected' || controllerBleStatus === 'error';

    console.log(
      `[AppNavigator] auto-reconnect tick: bleStatus=${bleStatus} chargerBleStatus=${chargerBleStatus} controllerBleStatus=${controllerBleStatus} otaState=${otaState} needsPao=${needsPao} needsCharger=${needsCharger} needsController=${needsController} scanTrigger=${scanTrigger}`,
    );

    // Nothing to do if all are already connected/connecting/scanning/error
    if (!needsPao && !needsCharger && !needsController) { return; }

    // Don't start a new scan attempt if retries are exhausted for all needed devices
    const paoExhausted = needsPao && paoRetries.current >= MAX_RETRIES;
    const chargerExhausted = needsCharger && chargerRetries.current >= MAX_RETRIES;
    const controllerExhausted = needsController && controllerRetries.current >= MAX_RETRIES;
    if ((!needsPao || paoExhausted) && (!needsCharger || chargerExhausted) && (!needsController || controllerExhausted)) { return; }

    // Compute backoff delay — use the smallest of the relevant delays so
    // no device waits longer than necessary.
    const paoDelay = needsPao && !paoExhausted
      ? BACKOFF_BASE_MS * Math.pow(2, paoRetries.current)
      : Infinity;
    const chargerDelay = needsCharger && !chargerExhausted
      ? BACKOFF_BASE_MS * Math.pow(2, chargerRetries.current)
      : Infinity;
    const controllerDelay = needsController && !controllerExhausted
      ? BACKOFF_BASE_MS * Math.pow(2, controllerRetries.current)
      : Infinity;
    const delay = Math.min(paoDelay, chargerDelay, controllerDelay);

    // Increment retry counters for whichever devices we are about to attempt
    if (needsPao && !paoExhausted) { paoRetries.current += 1; }
    if (needsCharger && !chargerExhausted) { chargerRetries.current += 1; }
    if (needsController && !controllerExhausted) { controllerRetries.current += 1; }

    backoffTimer.current = setTimeout(() => {
      // Adafruit Bluefruit SPI puts its UUID in the scan response, not primary advertisement.
      // Android UUID filters only match primary advertisement — CHARGER_SERVICE_UUID as a filter
      // will never return the charger device. Use null (scan all) whenever charger is needed.
      // PAO_SERVICE_UUID and CONTROLLER_SERVICE_UUID are both safe to filter because NimBLE
      // devices include them in primary advertisement, but since we already scan null for the
      // charger when needed, we extend that null path to cover controller scanning as well.
      const uuidsToScan: string[] | null =
        (needsCharger && !chargerExhausted)
          ? null                                                   // scan all — charger UUID is in scan response
          : (needsController && !controllerExhausted)
          ? null                                                   // scan all alongside controller — consistent with charger path
          : (needsPao && !paoExhausted) ? [PAO_SERVICE_UUID]      // PAO only — safe to filter
          : null;

      if (!needsPao && !needsCharger && !needsController) { return; }

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
            if (needsController && !controllerExhausted) {
              useAppStore.getState().setControllerBleStatus('error');
              useAppStore.getState().setControllerError(error.message);
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

          // Controller: ESP32-S3 NimBLE device advertising service 0x27B1.
          // Match by service UUID in primary advertisement or by device name.
          const isController =
            !isPao && !isCharger && (
              advertised.includes(CONTROLLER_SERVICE_UUID.toLowerCase()) ||
              device.name?.toLowerCase() === 'pao controller'
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
              // Seed readable state immediately without waiting for first notification
              chargerBleManager.readInitialState().then(initial => {
                if (Object.keys(initial).length > 0) {
                  const current = useAppStore.getState().chargerData;
                  useAppStore.getState().setChargerData({...({} as any), ...current, ...initial} as ChargerDirectData);
                }
              }).catch(() => {}); // non-fatal
              // Re-read after 1.5 s — firmware Ble::loop() fires ~1s post-connect and
              // populates chargeState/soc/error which start at VALUE=0 in GATT.
              setTimeout(() => {
                if (!chargerBleManager.isConnected()) return;
                chargerBleManager.readInitialState().then(refreshed => {
                  if (Object.keys(refreshed).length > 0) {
                    const current = useAppStore.getState().chargerData;
                    useAppStore.getState().setChargerData({...({} as any), ...current, ...refreshed} as ChargerDirectData);
                  }
                }).catch(() => {});
              }, 1500);
            } catch (e) {
              console.error('Charger connect error:', e);
              useAppStore.getState().setChargerBleStatus('disconnected');
            }
          }

          if (isController && needsController && useAppStore.getState().controllerBleStatus === 'disconnected') {
            console.log('Unified scan: found controller device', device.name, device.id);

            // Same stop-before-connect pattern as PAO/charger above
            sharedBleManager.stopDeviceScan();
            if (scanTimer.current) {
              clearTimeout(scanTimer.current);
              scanTimer.current = null;
            }

            useAppStore.getState().setControllerBleStatus('connecting');

            try {
              await controllerBleManager.connect(device.id);
              await saveControllerDeviceId(device.id);
              // Controller is OTA-only — wirePostConnectSubscriptions subscribes
              // to the firmware version notify and seeds the version via readInitialState.
              controllerBleManager.wirePostConnectSubscriptions();
            } catch (e) {
              console.error('Controller connect error:', e);
              useAppStore.getState().setControllerBleStatus('disconnected');
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
        const stillNeedsController = needsController && !controllerExhausted &&
          useAppStore.getState().controllerBleStatus === 'disconnected';

        if (stillNeedsPao || stillNeedsCharger || stillNeedsController) {
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
  }, [bleStatus, chargerBleStatus, controllerBleStatus, permissionsGranted, scanTrigger, otaState, controllerOtaState]);

  const navigate = (screen: string) => {
    if (screen === 'hud') {
      Orientation.lockToLandscapeLeft();
    } else {
      Orientation.lockToPortrait();
    }
    setCurrentScreen(screen as Screen);
  };

  const closeFirmwareInfo = () => {
    Orientation.lockToPortrait();
    // Both info screens hang off the Firmware tab, so returning to Settings
    // should drop the user back on Firmware — not the default Bluetooth tab.
    setPendingSettingsTab('firmware');
    setCurrentScreen('settings');
  };

  const openFirmwareInfo = () => {
    Orientation.lockToPortrait();
    setCurrentScreen('firmware-info');
  };

  // Minimal info screen reached from Settings → App ⓘ. Mirrors the
  // firmware-info open/close pair so navigation feels symmetric.
  const closeAppInfo = () => {
    Orientation.lockToPortrait();
    // Same as firmware-info: the App row lives in the Firmware tab, so the
    // user expects to return there.
    setPendingSettingsTab('firmware');
    setCurrentScreen('settings');
  };

  const openAppInfo = () => {
    Orientation.lockToPortrait();
    setCurrentScreen('app-info');
  };

  const renderScreen = (screen: Screen) => {
    switch (screen) {
      case 'hud': return <HUDScreen onClose={() => { Orientation.lockToPortrait(); setCurrentScreen('dashboard'); }} />;
      case 'charger': return <ChargerScreen />;
      case 'gear': return <GearScreen />;
      case 'settings': return (
        <SettingsScreen
          onOpenFirmwareInfo={openFirmwareInfo}
          onOpenAppInfo={openAppInfo}
          initialTab={pendingSettingsTab}
        />
      );
      case 'firmware-info': return <FirmwareInfoScreen onClose={closeFirmwareInfo} />;
      case 'app-info': return <AppInfoScreen onClose={closeAppInfo} />;
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

  // Firmware-info screen: full-screen overlay outside the swipe pager. The
  // user reaches it via the ⓘ button in Settings → Firmware. FloatingIcons
  // stays mounted so the user can jump elsewhere at any time.
  if (currentScreen === 'firmware-info') {
    return (
      <View style={styles.container}>
        {renderScreen('firmware-info')}
        <FloatingIcons onNavigate={navigate} showGearTab={showGearTab} currentScreen={currentScreen} isHUD={false} />
      </View>
    );
  }

  // App-info screen: same overlay pattern as firmware-info. Reached via the
  // ⓘ button in Settings → App. Display-only.
  if (currentScreen === 'app-info') {
    return (
      <View style={styles.container}>
        {renderScreen('app-info')}
        <FloatingIcons onNavigate={navigate} showGearTab={showGearTab} currentScreen={currentScreen} isHUD={false} />
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
