import React, {useEffect, useState} from 'react';
import {View, StyleSheet} from 'react-native';
import Orientation from 'react-native-orientation-locker';
import DashboardScreen from '../screens/DashboardScreen';
import GearScreen from '../screens/GearScreen';
import ChargerScreen from '../screens/ChargerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HUDScreen from '../screens/HUDScreen';
import {FloatingIcons} from '../components/FloatingIcons';
import {useAppStore} from '../store/useAppStore';

type Screen = 'dashboard' | 'charger' | 'gear' | 'settings';

export default function AppNavigator() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('dashboard');
  const [showHUD, setShowHUD] = useState(true); // HUD is default on launch
  const showGearTab = useAppStore(state => state.showGearTab);

  useEffect(() => {
    Orientation.lockToPortrait();
  }, []);

  const navigate = (screen: string) => {
    if (screen === 'hud') {
      setShowHUD(true);
    } else {
      setCurrentScreen(screen as Screen);
      setShowHUD(false);
    }
  };

  const renderScreen = () => {
    // If gear is disabled and somehow on gear screen, fall back to dashboard
    if (currentScreen === 'gear' && !showGearTab) {
      return <DashboardScreen />;
    }
    switch (currentScreen) {
      case 'charger': return <ChargerScreen />;
      case 'gear': return <GearScreen />;
      case 'settings': return <SettingsScreen />;
      default: return <DashboardScreen />;
    }
  };

  return (
    <View style={styles.container}>
      {renderScreen()}
      <FloatingIcons onNavigate={navigate} showGearTab={showGearTab} currentScreen={currentScreen} isHUD={showHUD} />
      <HUDScreen visible={showHUD} onClose={() => setShowHUD(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
});
