import * as React from 'react';
import {useState} from 'react';
import {Alert} from 'react-native';
import {FAB, Portal} from 'react-native-paper';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager} from '../ble/PaoBleManager';
import {Device} from 'react-native-ble-plx';
import {requestBlePermissions} from '../utils/permissions';

interface FloatingIconsProps {
  onOpenHUD: () => void;
}

export const FloatingIcons: React.FC<FloatingIconsProps> = ({onOpenHUD}) => {
  const [open, setOpen] = useState<boolean>(false);

  const bleStatus = useAppStore(state => state.bleStatus);

  const isScanning = bleStatus === 'scanning';
  const isConnected = bleStatus === 'connected';

  const handleScanPress = async () => {
    if (!isScanning && !isConnected) {
      const granted = await requestBlePermissions();
      if (!granted) {
        Alert.alert(
          'Bluetooth Permission Required',
          'Please grant Bluetooth permissions to connect to PAO Console.',
          [{text: 'OK'}],
        );
        return;
      }
      paoBleManager.scan((device: Device) => {
        console.log('FloatingIcons: device found, connecting to', device.name);
        paoBleManager.connect(device.id).catch((err: Error) => {
          console.error('FloatingIcons: connect error', err);
        });
      });
    } else if (isScanning) {
      paoBleManager.stopScan();
    }
  };

  return (
    <Portal>
      <FAB.Group
        open={open}
        visible={true}
        icon={isScanning ? 'refresh' : 'bluetooth-settings'}
        actions={[
          {
            icon: isConnected ? 'bluetooth' : 'bluetooth-off',
            label: 'PAO Console',
            onPress: handleScanPress,
          },
          {
            icon: 'speedometer',
            label: 'HUD',
            onPress: onOpenHUD,
          },
        ]}
        onStateChange={({open: isOpen}: {open: boolean}) => setOpen(isOpen)}
        onPress={() => {}}
        style={{paddingBottom: 90}}
      />
    </Portal>
  );
};
