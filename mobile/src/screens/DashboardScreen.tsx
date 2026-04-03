import React, {useState, useEffect} from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import {useAppStore} from '../store/useAppStore';
import {MotorState, Gear, ChargeState} from '../types';
import {PageHeader} from '../components/PageHeader';
import {BleDebugPanel, DebugRow} from '../components/BleDebugPanel';

export default function DashboardScreen() {
  const {bleStatus, telemetry} = useAppStore();
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (telemetry) {
        setIsStale(Date.now() - telemetry.timestamp > 3000);
      } else {
        setIsStale(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [telemetry]);

  const getMotorStateLabel = (state?: MotorState): string => {
    switch (state) {
      case MotorState.DISABLED: return 'DISABLED';
      case MotorState.STANDBY: return 'STANDBY';
      case MotorState.ENABLE: return 'ENABLE';
      case MotorState.POWERDOWN: return 'POWERDOWN';
      default: return '—';
    }
  };

  const getGearLabel = (gear?: Gear): string => {
    switch (gear) {
      case Gear.NEUTRAL: return 'NEUTRAL';
      case Gear.DRIVE: return 'DRIVE';
      case Gear.REVERSE: return 'REVERSE';
      case Gear.PARK: return 'PARK';
      default: return '—';
    }
  };

  const getChargeStateLabel = (state?: ChargeState): string => {
    switch (state) {
      case ChargeState.NOT_CHARGING: return 'NOT CHARGING';
      case ChargeState.CHARGING: return 'CHARGING';
      case ChargeState.COMPLETE: return 'COMPLETE';
      default: return '—';
    }
  };

  const getTempColor = (temp?: number): string => {
    if (!temp) return '#FFFFFF';
    if (temp > 100) return '#F44336';
    if (temp > 80) return '#FFD600';
    return '#FFFFFF';
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
      <ScrollView style={styles.scrollView}>
        <PageHeader title="Live Data" bleSource="peripheral" />

        {isStale && (
          <View style={styles.staleIndicator}>
            <Text style={styles.staleText}>● STALE</Text>
          </View>
        )}

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Motor: </Text>
          <Text style={styles.statusValue}>{getMotorStateLabel(telemetry?.motorState)}</Text>

          <Text style={[styles.statusLabel, {marginLeft: 16}]}>Gear: </Text>
          <Text style={styles.statusValue}>{getGearLabel(telemetry?.gear)}</Text>

          <Text style={[styles.statusLabel, {marginLeft: 16}]}>Charge: </Text>
          <Text style={styles.statusValue}>{getChargeStateLabel(telemetry?.chargeState)}</Text>
        </View>

        <View style={styles.flagsRow}>
          <View style={styles.flagContainer}>
            <View style={[styles.flagDot, telemetry?.statusFlags.running && styles.flagGreen]} />
            <Text style={styles.flagLabel}>Running</Text>
          </View>
          <View style={styles.flagContainer}>
            <View style={[styles.flagDot, telemetry?.statusFlags.fault && styles.flagRed]} />
            <Text style={styles.flagLabel}>Fault</Text>
          </View>
          <View style={styles.flagContainer}>
            <View style={[styles.flagDot, telemetry?.statusFlags.warning && styles.flagYellow]} />
            <Text style={styles.flagLabel}>Warning</Text>
          </View>
          <View style={styles.flagContainer}>
            <View style={[styles.flagDot, telemetry?.statusFlags.ready && styles.flagGreen]} />
            <Text style={styles.flagLabel}>Ready</Text>
          </View>
          <View style={styles.flagContainer}>
            <View style={[styles.flagDot, telemetry?.statusFlags.gpsFix && styles.flagBlue]} />
            <Text style={styles.flagLabel}>GPS</Text>
          </View>
          <View style={styles.flagContainer}>
            <View style={[styles.flagDot, telemetry?.statusFlags.canConnected && styles.flagGreen]} />
            <Text style={styles.flagLabel}>CAN</Text>
          </View>
          <View style={styles.flagContainer}>
            <View style={[styles.flagDot, telemetry?.statusFlags.preChargeReady && styles.flagGreen]} />
            <Text style={styles.flagLabel}>PreChg</Text>
          </View>
        </View>

        <View style={styles.gridContainer}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Speed</Text>
            <Text style={styles.cardValue}>
              {telemetry?.speedRpm ?? '—'}
            </Text>
            <Text style={styles.cardUnit}>RPM</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Motor Temp</Text>
            <Text style={[styles.cardValue, {color: getTempColor(telemetry?.motorTempC)}]}>
              {telemetry ? telemetry.motorTempC.toFixed(1) : '—'}
            </Text>
            <Text style={styles.cardUnit}>°C</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Inverter Temp</Text>
            <Text style={[styles.cardValue, {color: getTempColor(telemetry?.inverterTempC)}]}>
              {telemetry ? telemetry.inverterTempC.toFixed(1) : '—'}
            </Text>
            <Text style={styles.cardUnit}>°C</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Torque</Text>
            <Text style={styles.cardValue}>
              {telemetry ? telemetry.torqueNm.toFixed(1) : '—'}
            </Text>
            <Text style={styles.cardUnit}>Nm</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>DC Voltage</Text>
            <Text style={styles.cardValue}>
              {telemetry ? telemetry.dcVoltageV.toFixed(1) : '—'}
            </Text>
            <Text style={styles.cardUnit}>V</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>DC Current</Text>
            <Text style={styles.cardValue}>
              {telemetry ? telemetry.dcCurrentA.toFixed(1) : '—'}
            </Text>
            <Text style={styles.cardUnit}>A</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>DC Power</Text>
            <Text style={styles.cardValue}>
              {telemetry ? (telemetry.dcVoltageV * telemetry.dcCurrentA / 1000).toFixed(1) : '—'}
            </Text>
            <Text style={styles.cardUnit}>kW</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>GPS Speed</Text>
            <Text style={styles.cardValue}>
              {telemetry ? telemetry.gpsSpeedKmh.toFixed(0) : '—'}
            </Text>
            <Text style={styles.cardUnit}>km/h</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Satellites</Text>
            <Text style={styles.cardValue}>
              {telemetry?.gpsSatellites ?? '—'}
            </Text>
            <Text style={styles.cardUnit}></Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Charge</Text>
            <Text style={styles.cardValue}>
              {telemetry?.chargePercent ?? '—'}
            </Text>
            <Text style={styles.cardUnit}>%</Text>
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
  banner: {
    backgroundColor: '#F44336',
    padding: 12,
    alignItems: 'center',
  },
  bannerText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  staleIndicator: {
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  staleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF8C00',
    letterSpacing: 1,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  card: {
    width: '48%',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 12,
    color: '#9E9E9E',
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  cardUnit: {
    fontSize: 14,
    color: '#9E9E9E',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    padding: 12,
    borderRadius: 8,
    flexWrap: 'wrap',
  },
  statusLabel: {
    fontSize: 14,
    color: '#9E9E9E',
  },
  statusValue: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  flagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#1A1A1A',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  flagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '33%',
    marginBottom: 8,
  },
  flagDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#333333',
    marginRight: 6,
  },
  flagGreen: {
    backgroundColor: '#00C853',
  },
  flagRed: {
    backgroundColor: '#F44336',
  },
  flagYellow: {
    backgroundColor: '#FFD600',
  },
  flagBlue: {
    backgroundColor: '#2196F3',
  },
  flagLabel: {
    fontSize: 12,
    color: '#9E9E9E',
  },
});
