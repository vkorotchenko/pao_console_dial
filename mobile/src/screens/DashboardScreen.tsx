import React from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import {useAppStore} from '../store/useAppStore';
import {MotorState, Gear, ChargeState} from '../types';

export default function DashboardScreen() {
  const {bleStatus, telemetry} = useAppStore();

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

  return (
    <View style={styles.container}>
      {bleStatus !== 'connected' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Not connected</Text>
        </View>
      )}
      
      <ScrollView style={styles.scrollView}>
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
        </View>
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
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
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
    marginTop: 8,
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
    marginTop: 12,
    marginBottom: 16,
  },
  flagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
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
