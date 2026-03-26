import React from 'react';
import {View, Text, StyleSheet, Button, Alert} from 'react-native';
import {useAppStore} from '../store/useAppStore';

export default function SettingsScreen() {
  const {bleStatus, deviceId} = useAppStore();

  const handleScan = () => {
    Alert.alert('BLE Scan', 'BLE scanning will be implemented after ADR-001');
  };

  const handleConnect = () => {
    Alert.alert(
      'BLE Connect',
      'BLE connection will be implemented after ADR-001',
    );
  };

  const handleDisconnect = () => {
    Alert.alert(
      'BLE Disconnect',
      'BLE disconnection will be implemented after ADR-001',
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BLE Settings</Text>
      <Text style={styles.subtitle}>Scan and connect to PAO Console</Text>

      <View style={styles.statusSection}>
        <Text style={styles.sectionTitle}>Connection Status</Text>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Status:</Text>
          <Text style={styles.value}>{bleStatus}</Text>
        </View>
        {deviceId && (
          <View style={styles.statusRow}>
            <Text style={styles.label}>Device:</Text>
            <Text style={styles.value}>{deviceId}</Text>
          </View>
        )}
      </View>

      <View style={styles.buttonSection}>
        <Button title="Scan for Devices" onPress={handleScan} />
        <View style={styles.buttonSpacer} />
        <Button
          title="Connect"
          onPress={handleConnect}
          disabled={bleStatus === 'connected'}
        />
        <View style={styles.buttonSpacer} />
        <Button
          title="Disconnect"
          onPress={handleDisconnect}
          disabled={bleStatus !== 'connected'}
          color="#ff6b6b"
        />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>Device Name</Text>
        <Text style={styles.infoText}>PAO Console</Text>
        <Text style={styles.infoNote}>
          BLE implementation will be added after docs/adr-001-ble-gatt-service.md
          is finalized
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
  },
  statusSection: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  value: {
    fontSize: 14,
    color: '#333',
  },
  buttonSection: {
    marginBottom: 24,
  },
  buttonSpacer: {
    height: 12,
  },
  infoSection: {
    padding: 16,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    marginBottom: 8,
  },
  infoNote: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
});
