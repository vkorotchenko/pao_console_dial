import React, {useEffect, useState} from 'react';
import {View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator} from 'react-native';
import {Switch, SegmentedButtons, Button} from 'react-native-paper';
import {Device} from 'react-native-ble-plx';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager} from '../ble/PaoBleManager';
import {chargerBleManager} from '../ble/ChargerBleManager';
import {requestBlePermissions} from '../utils/permissions';
import _ScreenBrightness from 'react-native-screen-brightness';
import {PageHeader} from '../components/PageHeader';
const ScreenBrightness = _ScreenBrightness as any;

export default function SettingsScreen() {
  const bleStatus = useAppStore(state => state.bleStatus);
  const deviceId = useAppStore(state => state.deviceId);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);
  const chargerDeviceId = useAppStore(state => state.chargerDeviceId);
  const setChargerBleStatus = useAppStore(state => state.setChargerBleStatus);
  const setChargerData = useAppStore(state => state.setChargerData);
  const showGearTab = useAppStore(state => state.showGearTab);
  const setShowGearTab = useAppStore(state => state.setShowGearTab);
  const speedUnit = useAppStore(state => state.speedUnit);
  const setSpeedUnit = useAppStore(state => state.setSpeedUnit);
  const hudAutoBrighten = useAppStore(state => state.hudAutoBrighten);
  const setHudAutoBrighten = useAppStore(state => state.setHudAutoBrighten);
  const [hasWriteSettings, setHasWriteSettings] = useState<boolean | null>(null);

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
  // const canScan = bleStatus === 'disconnected' || bleStatus === 'error';
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
  // const canScanCharger = chargerBleStatus === 'disconnected' || chargerBleStatus === 'error';
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

    paoBleManager.scan((device: Device) => {
      paoBleManager.connect(device.id).catch(console.error);
    });
  };

  const handleDisconnect = () => {
    paoBleManager.disconnect();
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

    setChargerBleStatus('scanning');
    chargerBleManager.scan((deviceId, _deviceName) => {
      chargerBleManager.connect(deviceId).then(() => {
        chargerBleManager.subscribeToAll(partial => {
          const current = useAppStore.getState().chargerData;
          setChargerData({...({} as any), ...current, ...partial});
        });
      }).catch(console.error);
    });
  };

  const handleDisconnectCharger = () => {
    chargerBleManager.disconnect();
    setChargerData(null);
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
            <Text style={styles.hint}>Maximizes screen brightness while HUD is open and charging</Text>
          </View>
          <Switch
            value={hudAutoBrighten}
            onValueChange={setHudAutoBrighten}
            color="#00C853"
          />
        </View>
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
  label: {
    fontSize: 15,
    color: '#E0E0E0',
    fontWeight: '500',
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
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
});
