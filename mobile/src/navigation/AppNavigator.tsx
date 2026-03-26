import React, {useEffect} from 'react';
import {View, StyleSheet, Easing} from 'react-native';
import {BottomNavigation} from 'react-native-paper';
import DashboardScreen from '../screens/DashboardScreen';
import GearScreen from '../screens/GearScreen';
import ChargerScreen from '../screens/ChargerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HUDScreen from '../screens/HUDScreen';
import {FloatingIcons} from '../components/FloatingIcons';
import {useAppStore} from '../store/useAppStore';
import tabs from '../config/tabs.json';

const sceneMap = BottomNavigation.SceneMap({
  dashboard: DashboardScreen,
  charger: ChargerScreen,
  gear: GearScreen,
  settings: SettingsScreen,
});

export default function AppNavigator() {
  const [index, setIndex] = React.useState(0);
  const [showHUD, setShowHUD] = React.useState(false);
  const showGearTab = useAppStore(state => state.showGearTab);

  const routes = (
    tabs.navigation as Array<{key: string; title: string; focusedIcon: string}>
  ).filter(r => r.key !== 'gear' || showGearTab);

  useEffect(() => {
    if (index >= routes.length) {
      setIndex(0);
    }
  }, [routes.length, index]);

  return (
    <View style={styles.container}>
      <BottomNavigation
        navigationState={{index, routes}}
        onIndexChange={setIndex}
        renderScene={sceneMap}
        labelMaxFontSizeMultiplier={2}
        sceneAnimationEnabled={true}
        sceneAnimationType={'shifting'}
        sceneAnimationEasing={Easing.ease}
      />
      <FloatingIcons onOpenHUD={() => setShowHUD(true)} />
      <HUDScreen visible={showHUD} onClose={() => setShowHUD(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
