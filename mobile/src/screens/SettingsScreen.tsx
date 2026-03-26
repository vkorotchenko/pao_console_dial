import React from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import {Switch, SegmentedButtons} from 'react-native-paper';
import {useAppStore} from '../store/useAppStore';

export default function SettingsScreen() {
  const bleStatus = useAppStore(state => state.bleStatus);
  const deviceId = useAppStore(state => state.deviceId);
  const showGearTab = useAppStore(state => state.showGearTab);
  const setShowGearTab = useAppStore(state => state.setShowGearTab);
  const speedUnit = useAppStore(state => state.speedUnit);
  const setSpeedUnit = useAppStore(state => state.setSpeedUnit);

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.container}>
      {/* BLE Connection Section */}
      <Text style={styles.sectionHeader}>Connection</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <Text
            style={[
              styles.value,
              bleStatus === 'connected' && styles.valueConnected,
              bleStatus === 'error' && styles.valueError,
            ]}>
            {bleStatus}
          </Text>
        </View>
        {deviceId ? (
          <View style={styles.row}>
            <Text style={styles.label}>Device ID</Text>
            <Text style={styles.valueSmall} numberOfLines={1}>
              {deviceId}
            </Text>
          </View>
        ) : null}
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
    color: '#9E9E9E',
    textTransform: 'capitalize',
  },
  valueConnected: {
    color: '#00C853',
  },
  valueError: {
    color: '#F44336',
  },
  valueSmall: {
    fontSize: 12,
    color: '#9E9E9E',
    maxWidth: 180,
  },
  segmentedWrapper: {
    paddingTop: 8,
    paddingBottom: 12,
  },
});
