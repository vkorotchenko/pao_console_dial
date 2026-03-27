import React, {useEffect, useState} from 'react';
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

export default function AppNavigator() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('hud');
  const showGearTab = useAppStore(state => state.showGearTab);
  const bleStatus = useAppStore(state => state.bleStatus);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);

  useEffect(() => {
    // HUD is default screen on launch — lock to landscape immediately
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
    if (bleStatus === 'disconnected' || bleStatus === 'error') {
      paoBleManager.scan(device => {
        paoBleManager.connect(device.id).then(() => {
          paoBleManager.subscribeToTelemetry(() => {});
        }).catch(console.error);
      });
    }
  }, [bleStatus]);

  useEffect(() => {
    if (chargerBleStatus === 'disconnected' || chargerBleStatus === 'error') {
      chargerBleManager.scan((deviceId) => {
        useAppStore.getState().setChargerBleStatus('connecting');
        chargerBleManager.connect(deviceId).then(() => {
          chargerBleManager.subscribeToAll(partial => {
            const current = useAppStore.getState().chargerData;
            useAppStore.getState().setChargerData({...({} as any), ...current, ...partial} as ChargerDirectData);
          });
        }).catch(console.error);
      });
    }
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
