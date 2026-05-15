import * as React from 'react';
import {useState} from 'react';
import {FAB, Portal} from 'react-native-paper';
import {useAppStore} from '../store/useAppStore';

interface FloatingIconsProps {
  onNavigate: (screen: string) => void;
  showGearTab: boolean;
  currentScreen: string;
  isHUD: boolean;
}

export const FloatingIcons: React.FC<FloatingIconsProps> = ({onNavigate, showGearTab, currentScreen, isHUD}) => {
  const [open, setOpen] = useState<boolean>(false);
  // Optional peripheral: when chargerEnabled is OFF the charger nav action
  // (lightning-bolt) drops from the FAB row so there's no path to a screen
  // the app no longer registers.
  const chargerEnabled = useAppStore(state => state.chargerEnabled);

  const isActive = (screen: string) =>
    screen === 'hud' ? isHUD : !isHUD && currentScreen === screen;

  const actionStyle = (screen: string) => ({
    color: isActive(screen) ? '#87CEEB' : '#555',
  });

  const navActions = [
    {icon: 'speedometer', onPress: () => onNavigate('hud'), ...actionStyle('hud')},
    {icon: 'car', onPress: () => onNavigate('dashboard'), ...actionStyle('dashboard')},
    ...(chargerEnabled ? [{icon: 'lightning-bolt', onPress: () => onNavigate('charger'), ...actionStyle('charger')}] : []),
    ...(showGearTab ? [{icon: 'power-standby', onPress: () => onNavigate('gear'), ...actionStyle('gear')}] : []),
    {icon: 'car-wrench', onPress: () => onNavigate('settings'), ...actionStyle('settings')},
  ];

  return (
    <Portal>
      <FAB.Group
        open={open}
        visible={!isHUD}
        icon={open ? 'close' : 'menu'}
        actions={navActions}
        onStateChange={({open: isOpen}) => setOpen(isOpen)}
        onPress={() => {}}
        backdropColor="transparent"
        color="#87CEEB"
        fabStyle={{transform: [{scale: 1.25}], backgroundColor: '#1e4a6e'}}
        style={{paddingBottom: 16}}
      />
    </Portal>
  );
};
