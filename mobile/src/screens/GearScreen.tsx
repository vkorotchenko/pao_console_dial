import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView} from 'react-native';
import {Icon} from 'react-native-paper';
import {useAppStore} from '../store/useAppStore';
import {Gear, MotorState} from '../types';
import {paoBleManager} from '../ble/PaoBleManager';
import {PageHeader} from '../components/PageHeader';
import {BleDebugPanel, DebugRow} from '../components/BleDebugPanel';

const gearReadbackLabels: Record<Gear, string> = {
  [Gear.DRIVE]: 'DRIVE',
  [Gear.NEUTRAL]: 'NEUTRAL',
  [Gear.REVERSE]: 'REVERSE',
  [Gear.PARK]: 'PARK',
};

export default function GearScreen() {
  const {bleStatus} = useAppStore();
  const chargerBleStatus = useAppStore(s => s.chargerBleStatus);
  const telemetry = useAppStore(s => s.telemetry);
  const [pendingGear, setPendingGear] = useState<Gear | null>(null);
  const [confirmingGear, setConfirmingGear] = useState<Gear | null>(null);

  const currentGearLabel = telemetry != null
    ? gearReadbackLabels[telemetry.gear] ?? '---'
    : '---';

  const isChargerBlocked = chargerBleStatus === 'connected' && bleStatus !== 'connected';
  const isSpeedBlocked = (telemetry?.gpsSpeedKmh ?? 0) >= 5;
  const isGearBlocked = isChargerBlocked || isSpeedBlocked;

  const handleGearPress = async (gear: Gear) => {
    if (bleStatus !== 'connected' || isGearBlocked) return;

    if (pendingGear !== gear) {
      // First tap (or tapping a different gear) → highlight orange
      setPendingGear(gear);
      return;
    }

    // Second tap on same gear → confirm: highlight blue, send command
    setPendingGear(null);
    setConfirmingGear(gear);
    try {
      await paoBleManager.writeGearCommand(gear);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to shift gear');
    } finally {
      setConfirmingGear(null);
    }
  };

  const labels: Record<Gear, string> = {
    [Gear.DRIVE]: 'D',
    [Gear.NEUTRAL]: 'N',
    [Gear.REVERSE]: 'R',
    [Gear.PARK]: 'P',
  };

  const TELEMETRY_CHAR = 'c169df83';
  const DEBUG_ROWS: DebugRow[] = [
    { name: 'speed_rpm',        char: TELEMETRY_CHAR, access: 'N', value: telemetry?.speedRpm?.toString() ?? '—',               unit: 'rpm' },
    { name: 'motor_temp',       char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.motorTempC.toFixed(1) : '—',    unit: '°C' },
    { name: 'inverter_temp',    char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.inverterTempC.toFixed(1) : '—', unit: '°C' },
    { name: 'torque',           char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.torqueNm.toFixed(1) : '—',      unit: 'Nm' },
    { name: 'dc_voltage',       char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.dcVoltageV.toFixed(1) : '—',    unit: 'V' },
    { name: 'dc_current',       char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.dcCurrentA.toFixed(1) : '—',    unit: 'A' },
    { name: 'motor_state',      char: TELEMETRY_CHAR, access: 'N', value: telemetry?.motorState != null ? MotorState[telemetry.motorState] ?? String(telemetry.motorState) : '—', unit: '' },
    { name: 'gear',             char: TELEMETRY_CHAR, access: 'N', value: telemetry?.gear != null ? Gear[telemetry.gear] ?? String(telemetry.gear) : '—', unit: '' },
    { name: 'flag_running',     char: TELEMETRY_CHAR, access: 'N', value: telemetry ? (telemetry.statusFlags.running ? 'true' : 'false') : '—', unit: '' },
    { name: 'flag_fault',       char: TELEMETRY_CHAR, access: 'N', value: telemetry ? (telemetry.statusFlags.fault ? 'true' : 'false') : '—', unit: '' },
    { name: 'flag_warning',     char: TELEMETRY_CHAR, access: 'N', value: telemetry ? (telemetry.statusFlags.warning ? 'true' : 'false') : '—', unit: '' },
    { name: 'flag_ready',       char: TELEMETRY_CHAR, access: 'N', value: telemetry ? (telemetry.statusFlags.ready ? 'true' : 'false') : '—', unit: '' },
    { name: 'flag_gps_fix',     char: TELEMETRY_CHAR, access: 'N', value: telemetry ? (telemetry.statusFlags.gpsFix ? 'true' : 'false') : '—', unit: '' },
    { name: 'flag_can',         char: TELEMETRY_CHAR, access: 'N', value: telemetry ? (telemetry.statusFlags.canConnected ? 'true' : 'false') : '—', unit: '' },
    { name: 'flag_pre_chg',     char: TELEMETRY_CHAR, access: 'N', value: telemetry ? (telemetry.statusFlags.preChargeReady ? 'true' : 'false') : '—', unit: '' },
    { name: 'gps_speed',        char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.gpsSpeedKmh.toFixed(1) : '—',   unit: 'km/h' },
    { name: 'gps_satellites',   char: TELEMETRY_CHAR, access: 'N', value: telemetry?.gpsSatellites?.toString() ?? '—',          unit: '' },
    { name: 'gps_lat',          char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.gpsLat.toFixed(5) : '—',        unit: '' },
    { name: 'gps_lon',          char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.gpsLon.toFixed(5) : '—',        unit: '' },
    { name: 'gps_altitude',     char: TELEMETRY_CHAR, access: 'N', value: telemetry ? telemetry.gpsAltitudeM.toFixed(1) : '—',  unit: 'm' },
    { name: 'charge_percent',   char: TELEMETRY_CHAR, access: 'N', value: telemetry?.chargePercent?.toString() ?? '—',          unit: '%' },
    { name: 'charge_state',     char: TELEMETRY_CHAR, access: 'N', value: telemetry?.chargeState?.toString() ?? '—',            unit: '' },
    { name: 'charge_err_state', char: TELEMETRY_CHAR, access: 'N', value: telemetry?.chargeErrorState != null ? `0x${telemetry.chargeErrorState.toString(16).toUpperCase().padStart(2,'0')}` : '—', unit: '' },
  ];

  return (
    <View style={styles.container}>
      <PageHeader title="Gear" bleSource="peripheral" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.centeredContent}>
          {isGearBlocked && (
            <View style={styles.blockedOverlay}>
              <Icon
                source={isSpeedBlocked ? 'speedometer' : 'lightning-bolt'}
                size={48}
                color="#87CEEB"
              />
              <Text style={styles.blockedText}>
                {isSpeedBlocked
                  ? 'Reduce speed below 5 km/h\nto change gears'
                  : 'Gear control unavailable\nwhile connected to charger'}
              </Text>
            </View>
          )}

          {/* Current gear readback */}
          <View style={styles.readbackRow}>
            <Text style={styles.readbackLabel}>CURRENT GEAR</Text>
            <Text style={styles.readbackValue}>{currentGearLabel}</Text>
          </View>

          <View style={styles.gearLayout}>
            {/* Left column */}
            <View style={styles.leftColumn}>
              {[Gear.DRIVE, Gear.NEUTRAL, Gear.REVERSE].map(gear => {
                const isPending = pendingGear === gear;
                const isConfirming = confirmingGear === gear;
                const isDisabled = bleStatus !== 'connected' || isGearBlocked;
                return (
                  <TouchableOpacity
                    key={gear}
                    style={[
                      styles.gearButton,
                      isConfirming && styles.gearButtonConfirming,
                      isPending && styles.gearButtonPending,
                    ]}
                    onPress={() => handleGearPress(gear)}
                    disabled={isDisabled}
                    activeOpacity={0.7}>
                    <Text style={[styles.gearButtonText, isDisabled && styles.gearButtonTextDisabled]}>
                      {labels[gear]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Right column — Park centred to align with Neutral */}
            <View style={styles.rightColumn}>
              {(() => {
                const gear = Gear.PARK;
                const isPending = pendingGear === gear;
                const isConfirming = confirmingGear === gear;
                const isDisabled = bleStatus !== 'connected' || isGearBlocked;
                return (
                  <>
                    <View style={styles.gearSpacer} />
                    <TouchableOpacity
                      style={[
                        styles.gearButton,
                        isConfirming && styles.gearButtonConfirming,
                        isPending && styles.gearButtonPending,
                      ]}
                      onPress={() => handleGearPress(gear)}
                      disabled={isDisabled}
                      activeOpacity={0.7}>
                      <Text style={[styles.gearButtonText, isDisabled && styles.gearButtonTextDisabled]}>
                        P
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.gearSpacer} />
                  </>
                );
              })()}
            </View>
          </View>
        </View>
        <BleDebugPanel
          rows={DEBUG_ROWS}
          serviceNote="Service: c909d45a-... | Char: c169df83-... (36-byte telemetry)"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#F44336',
    padding: 12,
    alignItems: 'center',
    zIndex: 10,
  },
  overlayText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  centeredContent: {
    padding: 16,
    minHeight: 420,
  },
  readbackRow: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2A35',
  },
  readbackLabel: {
    color: '#5BA8C4',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  readbackValue: {
    color: '#87CEEB',
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  gearLayout: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  leftColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 16,
  },
  rightColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 16,
  },
  gearSpacer: {
    flex: 1,
  },
  gearButton: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2A2A2A',
  },
  gearButtonPending: {
    backgroundColor: '#2D1A00',
    borderColor: '#FF8C00',
  },
  gearButtonConfirming: {
    backgroundColor: '#001D26',
    borderColor: '#87CEEB',
  },
  gearButtonText: {
    fontSize: 52,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  gearButtonTextDisabled: {
    color: '#444444',
  },
  blockedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  blockedText: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 24,
  },
});
