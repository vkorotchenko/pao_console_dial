import React, {useEffect, useRef, useState} from 'react';
import {View, StyleSheet, StatusBar} from 'react-native';
import Orientation from 'react-native-orientation-locker';
import DashboardScreen from '../screens/DashboardScreen';
import GearScreen from '../screens/GearScreen';
import ChargerScreen from '../screens/ChargerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HUDScreen from '../screens/HUDScreen';
import {FloatingIcons} from '../components/FloatingIcons';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager} from '../ble/PaoBleManager';
import {chargerBleManager} from '../ble/ChargerBleManager';
import {ChargerDirectData} from '../types';
import _ScreenBrightness from 'react-native-screen-brightness';
const ScreenBrightness = _ScreenBrightness as any;

type Screen = 'dashboard' | 'charger' | 'gear' | 'settings' | 'hud';

const SCAN_TIMEOUT_MS = 15_000; // stop scanning after 15s if nothing found
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;

export default function AppNavigator() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('hud');
  const showGearTab = useAppStore(state => state.showGearTab);
  const bleStatus = useAppStore(state => state.bleStatus);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);

  const paoRetries = useRef(0);
  const paoBackoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paoScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chargerRetries = useRef(0);
  const chargerBackoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chargerScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Peripheral BLE — auto-reconnect with backoff and scan timeout
  useEffect(() => {
    if (bleStatus === 'connected') {
      // Reset retry counter on successful connection
      paoRetries.current = 0;
      return;
    }

    if (bleStatus !== 'disconnected') {
      // Don't auto-scan while connecting/scanning or on error (user retries manually)
      return;
    }

    if (paoRetries.current >= MAX_RETRIES) {
      return;
    }

    const delay = BACKOFF_BASE_MS * Math.pow(2, paoRetries.current);
    paoRetries.current += 1;

    paoBackoffTimer.current = setTimeout(() => {
      paoBleManager.scan(device => {
        if (paoScanTimer.current) {
          clearTimeout(paoScanTimer.current);
          paoScanTimer.current = null;
        }
        paoBleManager.connect(device.id).then(() => {
          paoBleManager.subscribeToTelemetry(() => {});
        }).catch(console.error);
      });

      // Scan timeout — give up if nothing found
      paoScanTimer.current = setTimeout(() => {
        paoBleManager.stopScan();
      }, SCAN_TIMEOUT_MS);
    }, delay);

    return () => {
      if (paoBackoffTimer.current) { clearTimeout(paoBackoffTimer.current); }
      if (paoScanTimer.current) { clearTimeout(paoScanTimer.current); }
    };
  }, [bleStatus]);

  // Charger BLE — auto-reconnect with backoff and scan timeout
  useEffect(() => {
    if (chargerBleStatus === 'connected') {
      chargerRetries.current = 0;
      return;
    }

    if (chargerBleStatus !== 'disconnected') {
      return;
    }

    if (chargerRetries.current >= MAX_RETRIES) {
      return;
    }

    const delay = BACKOFF_BASE_MS * Math.pow(2, chargerRetries.current);
    chargerRetries.current += 1;

    chargerBackoffTimer.current = setTimeout(() => {
      chargerBleManager.scan((deviceId) => {
        if (chargerScanTimer.current) {
          clearTimeout(chargerScanTimer.current);
          chargerScanTimer.current = null;
        }
        chargerBleManager.connect(deviceId).then(() => {
          chargerBleManager.subscribeToAll(partial => {
            const current = useAppStore.getState().chargerData;
            useAppStore.getState().setChargerData({...({} as any), ...current, ...partial} as ChargerDirectData);
          });
        }).catch(console.error);
      });

      chargerScanTimer.current = setTimeout(() => {
        chargerBleManager.stopScan();
      }, SCAN_TIMEOUT_MS);
    }, delay);

    return () => {
      if (chargerBackoffTimer.current) { clearTimeout(chargerBackoffTimer.current); }
      if (chargerScanTimer.current) { clearTimeout(chargerScanTimer.current); }
    };
  }, [chargerBleStatus]);

  const navigate = (screen: string) => {
    if (screen === 'hud') {
      Orientation.lockToLandscapeLeft();
    } else {
      Orientation.lockToPortrait();
    }
    setCurrentScreen(screen as Screen);
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 'hud': return <HUDScreen onClose={() => { Orientation.lockToPortrait(); setCurrentScreen('dashboard'); }} />;
      case 'charger': return <ChargerScreen />;
      case 'gear': return <GearScreen />;
      case 'settings': return <SettingsScreen />;
      default: return <DashboardScreen />;
    }
  };

  return (
    <View style={styles.container}>
      {renderScreen()}
      <FloatingIcons onNavigate={navigate} showGearTab={showGearTab} currentScreen={currentScreen} isHUD={currentScreen === 'hud'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
});
