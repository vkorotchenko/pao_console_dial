import React, {useState} from 'react';
import {View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator} from 'react-native';
import {Switch, SegmentedButtons, Button} from 'react-native-paper';
import {Device} from 'react-native-ble-plx';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager} from '../ble/PaoBleManager';
import {requestBlePermissions} from '../utils/permissions';

export default function SettingsScreen() {
  const bleStatus = useAppStore(state => state.bleStatus);
  const deviceId = useAppStore(state => state.deviceId);
  const showGearTab = useAppStore(state => state.showGearTab);
  const setShowGearTab = useAppStore(state => state.setShowGearTab);
  const speedUnit = useAppStore(state => state.speedUnit);
  const setSpeedUnit = useAppStore(state => state.setSpeedUnit);

  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  const canScan = bleStatus === 'disconnected' || bleStatus === 'error';
  const canDisconnect =
    bleStatus === 'connected' || bleStatus === 'connecting' || bleStatus === 'scanning';
  const isScanning = bleStatus === 'scanning';

  const statusColor =
    bleStatus === 'connected'
      ? '#4cff91'
      : bleStatus === 'scanning' || bleStatus === 'connecting'
      ? '#FFC107'
      : '#F44336'; // disconnected / error

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

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.container}>
      {/* BLE Connection Section */}
      <Text style={styles.sectionHeader}>Connection</Text>
      <View style={styles.card}>
        {/* Status row */}
        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusContainer}>
            {(isScanning || isRequestingPermission) && (
              <ActivityIndicator
                size="small"
                color="#FFC107"
                style={styles.spinner}
              />
            )}
            <Text style={[styles.value, {color: statusColor}]}>{bleStatus}</Text>
          </View>
        </View>

        {/* Device ID row */}
        {deviceId ? (
          <View style={styles.row}>
            <Text style={styles.label}>Device ID</Text>
            <Text style={styles.valueSmall} numberOfLines={1}>
              {deviceId}
            </Text>
          </View>
        ) : null}

        {/* Action buttons row */}
        <View style={styles.buttonRow}>
          <Button
            mode="contained"
            onPress={handleScan}
            disabled={!canScan || isRequestingPermission}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
            labelStyle={styles.actionButtonLabel}>
            Scan
          </Button>
          <Button
            mode="outlined"
            onPress={handleDisconnect}
            disabled={!canDisconnect}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
            labelStyle={styles.actionButtonLabel}>
            Disconnect
          </Button>
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
            onValueChange={val => setSpeedUnit(val as 'kmh' | 'mph')}
            buttons={[
              {value: 'kmh', label: 'km/h'},
              {value: 'mph', label: 'mph'},
            ]}
          />
        </View>
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
  value: {
    fontSize: 14,
    textTransform: 'capitalize',
  },
  valueSmall: {
    fontSize: 12,
    color: '#9E9E9E',
    maxWidth: 180,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    marginRight: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  actionButton: {
    flex: 1,
  },
  actionButtonContent: {
    height: 40,
  },
  actionButtonLabel: {
    fontSize: 13,
  },
  segmentedWrapper: {
    paddingTop: 8,
    paddingBottom: 12,
  },
});
