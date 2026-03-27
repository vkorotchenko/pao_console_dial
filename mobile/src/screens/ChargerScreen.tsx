import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {ProgressBar} from 'react-native-paper';
import {useAppStore} from '../store/useAppStore';
import {ChargeState, ChargerDirectData} from '../types';
import {paoBleManager} from '../ble/PaoBleManager';
import {chargerBleManager} from '../ble/ChargerBleManager';
import {PageHeader} from '../components/PageHeader';

const FAULT_BITS: {bit: number; label: string}[] = [
  {bit: 0x01, label: 'Hardware failure'},
  {bit: 0x02, label: 'Overheating'},
  {bit: 0x04, label: 'Input voltage out of range'},
  {bit: 0x08, label: 'Charger off (reverse polarity protection)'},
  {bit: 0x10, label: 'Communication timeout'},
];

const MAX_TIME_SLIDER_MIN = 900;   // 15 minutes
const MAX_TIME_SLIDER_MAX = 87300; // 24h + 1 step sentinel = "No Limit"
const MAX_TIME_SLIDER_STEP = 900;  // 15-minute increments

function getActiveFaults(errorState: number): string[] {
  return FAULT_BITS.filter(f => (errorState & f.bit) !== 0).map(f => f.label);
}

/**
 * Format a duration in seconds to a human-readable string.
 * e.g. 5000 → "1h 23m", 2700 → "45m", 30 → "< 1m"
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return '< 1m';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) {
    return `${m}m`;
  }
  if (m === 0) {
    return `${h}h`;
  }
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export default function ChargerScreen() {
  const chargerConfig = useAppStore(s => s.chargerConfig);
  const chargerData = useAppStore(s => s.chargerData);
  const bleStatus = useAppStore(s => s.bleStatus);
  const chargerBleStatus = useAppStore(s => s.chargerBleStatus);
  const telemetry = useAppStore(s => s.telemetry);

  const isPeripheralConnected = bleStatus === 'connected';

  // Use peripheral data if available, otherwise charger direct data
  const activeData = isPeripheralConnected ? chargerConfig : chargerData;
  const dataSource: 'peripheral' | 'charger' | null = isPeripheralConnected
    ? 'peripheral'
    : chargerBleStatus === 'connected'
    ? 'charger'
    : null;

  // Draft state (changes as slider moves) + committed state (last applied value)
  const [draftCurrent, setDraftCurrent] = useState(chargerConfig?.maxCurrentA ?? 5);
  const [draftSoc, setDraftSoc] = useState(chargerConfig?.targetSocPercent ?? 80);
  const [committedCurrent, setCommittedCurrent] = useState(chargerConfig?.maxCurrentA ?? 5);
  const [committedSoc, setCommittedSoc] = useState(chargerConfig?.targetSocPercent ?? 80);

  const [pendingCurrent, setPendingCurrent] = useState(false);
  const [pendingSoc, setPendingSoc] = useState(false);

  // Max charge time — draft + committed, pending write state
  // 0 from firmware = no limit; mapped to/from MAX_TIME_SLIDER_MAX sentinel
  const toSlider = (secs: number) => secs === 0 ? MAX_TIME_SLIDER_MAX : secs;
  const fromSlider = (secs: number) => secs >= MAX_TIME_SLIDER_MAX ? 0 : secs;
  const [draftMaxTime, setDraftMaxTime] = useState(
    toSlider(chargerConfig?.maxChargeTimeSeconds ?? 14400),
  );
  const [committedMaxTime, setCommittedMaxTime] = useState(
    toSlider(chargerConfig?.maxChargeTimeSeconds ?? 14400),
  );
  const [pendingMaxTime, setPendingMaxTime] = useState(false);

  // Sync draft + committed when config arrives from BLE
  useEffect(() => {
    if (chargerConfig) {
      setDraftCurrent(chargerConfig.maxCurrentA);
      setCommittedCurrent(chargerConfig.maxCurrentA);
      setDraftSoc(chargerConfig.targetSocPercent);
      setCommittedSoc(chargerConfig.targetSocPercent);
      setDraftMaxTime(toSlider(chargerConfig.maxChargeTimeSeconds));
      setCommittedMaxTime(toSlider(chargerConfig.maxChargeTimeSeconds));
    }
  }, [chargerConfig]);

  useEffect(() => {
    if (bleStatus === 'connected') {
      paoBleManager.readChargerConfig();
    }
  }, [bleStatus]);

  const getChargeStateLabel = (state?: ChargeState): string => {
    switch (state) {
      case ChargeState.NOT_CHARGING: return 'NOT CHARGING';
      case ChargeState.CHARGING: return 'CHARGING';
      case ChargeState.COMPLETE: return 'COMPLETE';
      default: return '—';
    }
  };

  const getChargeStateBadgeColor = (state?: ChargeState): string => {
    switch (state) {
      case ChargeState.CHARGING: return '#00C853';
      case ChargeState.COMPLETE: return '#2196F3';
      default: return '#9E9E9E';
    }
  };

  const nominalV = chargerData?.nominalVoltageV ?? 320;
  const minMult = chargerData?.minMultiplier ?? 0.81;
  const maxMult = chargerData?.maxMultiplier ?? 1.14;
  // 0% SOC = nominalV × minMult, 100% SOC = nominalV × maxMult (linear)
  const minV = nominalV * minMult;
  const maxV = nominalV * maxMult;
  const computedTargetV = minV + (draftSoc / 100) * (maxV - minV);

  const isConnected = isPeripheralConnected || chargerBleStatus === 'connected';

  const applyField = async (field: 'current' | 'soc') => {
    if (!isConnected) {
      Alert.alert('Error', 'Not connected to device');
      return;
    }
    const setPending = field === 'current' ? setPendingCurrent : setPendingSoc;
    setPending(true);
    try {
      if (isPeripheralConnected) {
        await paoBleManager.writeChargerConfig({
          targetVoltageV: chargerConfig?.targetVoltageV ?? nominalV * maxMult,
          maxCurrentA: field === 'current' ? draftCurrent : committedCurrent,
          targetSocPercent: Math.round(field === 'soc' ? draftSoc : committedSoc),
          maxChargeTimeSeconds: committedMaxTime,
        });
      } else {
        if (field === 'current') {
          await chargerBleManager.writeMaxCurrent(Math.round(draftCurrent * 10));
        } else {
          await chargerBleManager.writeTargetPct(Math.round(draftSoc * 1000));
        }
      }
      if (field === 'current') { setCommittedCurrent(draftCurrent); }
      else { setCommittedSoc(draftSoc); }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to apply');
    } finally {
      setPending(false);
    }
  };

  const applyMaxTime = async (seconds: number) => {
    if (!isConnected) {
      Alert.alert('Error', 'Not connected to device');
      return;
    }
    setPendingMaxTime(true);
    try {
      if (isPeripheralConnected) {
        await paoBleManager.writeChargerConfig({
          targetVoltageV: chargerConfig?.targetVoltageV ?? nominalV * maxMult,
          maxCurrentA: committedCurrent,
          targetSocPercent: Math.round(committedSoc),
          maxChargeTimeSeconds: seconds,
        });
      } else {
        await chargerBleManager.writeMaxTime(seconds);
      }
      setDraftMaxTime(seconds);
      setCommittedMaxTime(seconds);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to apply');
    } finally {
      setPendingMaxTime(false);
    }
  };

  // Resolve readings from the active data source
  const actualVoltage = isPeripheralConnected
    ? chargerConfig?.actualVoltageV
    : chargerData?.currentVoltageV;
  const actualCurrent = isPeripheralConnected
    ? chargerConfig?.actualCurrentA
    : chargerData?.currentAmpsA;
  const displayChargeState = isPeripheralConnected
    ? telemetry?.chargeState
    : chargerData?.chargeState;
  const displayChargePercent = isPeripheralConnected
    ? telemetry?.chargePercent
    : chargerData?.socPercent;

  return (
    <View style={styles.container}>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        <PageHeader title="Charging" bleSource="charger" style={{paddingHorizontal: 0}} />
        <Text style={styles.sectionTitle}>Live Readings</Text>

        {/* SOC progress bar card */}
        <View style={styles.socCard}>
          <View style={styles.socHeader}>
            <Text style={styles.readingLabel}>State of Charge</Text>
            <View style={styles.socHeaderRight}>
              {chargerData != null && (
                <Text style={styles.runningTime}>
                  {formatDuration(chargerData.runningTimeSeconds)}
                </Text>
              )}
              <Text style={styles.socPercent}>{displayChargePercent ?? '—'}%</Text>
            </View>
          </View>
          <ProgressBar
            progress={(displayChargePercent ?? 0) / 100}
            color="#00C853"
            style={styles.progressBar}
          />
        </View>

        {/* Key readings — full width, prominent */}
        <View style={styles.keyReadingsRow}>
          <View style={styles.keyReadingCard}>
            <Text style={styles.readingLabel}>Charger Target</Text>
            <Text style={styles.keyReadingValue}>
              {(isPeripheralConnected
                ? chargerConfig?.targetVoltageV
                : chargerData?.targetVoltageV
              )?.toFixed(1) ?? '—'}
            </Text>
            <Text style={styles.readingUnit}>V</Text>
            <Text style={styles.readingCaption}>From device</Text>
          </View>
          <View style={styles.keyReadingCard}>
            <Text style={styles.readingLabel}>Current</Text>
            <Text style={styles.keyReadingValue}>
              {actualCurrent?.toFixed(1) ?? '—'}
            </Text>
            <Text style={styles.readingUnit}>A</Text>
            {chargerData != null && chargerData.targetAmpsA != null && (
              <Text style={styles.readingCaption}>
                of {chargerData.targetAmpsA.toFixed(1)} A target
              </Text>
            )}
          </View>
        </View>

        {/* Secondary readings */}
        <View style={styles.readingsContainer}>
          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Actual Voltage</Text>
            <Text style={styles.readingValue}>{actualVoltage?.toFixed(1) ?? '—'}</Text>
            <Text style={styles.readingUnit}>V</Text>
          </View>
          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Charge State</Text>
            <View style={[styles.stateBadge, {backgroundColor: getChargeStateBadgeColor(displayChargeState)}]}>
              <Text style={styles.stateBadgeText}>{getChargeStateLabel(displayChargeState)}</Text>
            </View>
          </View>
        </View>

        {/* Fault display — only shown when faults are present */}
        {(() => {
          const errorState = isPeripheralConnected
            ? chargerConfig?.chargeErrorState
            : chargerData?.errorState;
          const faults = getActiveFaults(errorState ?? 0);
          if (faults.length === 0) return null;
          return (
            <View style={styles.faultCard}>
              <Text style={styles.faultTitle}>Active Faults</Text>
              {faults.map((fault, i) => (
                <View key={i} style={styles.faultRow}>
                  <Text style={styles.faultBullet}>•</Text>
                  <Text style={styles.faultText}>{fault}</Text>
                </View>
              ))}
            </View>
          );
        })()}

        <Text style={styles.sectionTitle}>Configuration</Text>

        <View style={styles.configContainer}>

          {/* Charge Voltage — computed from SOC slider, read-only */}
          <View style={styles.readonlyRow}>
            <View>
              <Text style={styles.readonlyLabel}>Charge Voltage</Text>
              <Text style={styles.readonlySubLabel}>at selected SOC</Text>
            </View>
            <View style={styles.readonlyValueColumn}>
              <View style={styles.readonlyValueRow}>
                <Text style={styles.readonlyValue}>{computedTargetV.toFixed(1)}</Text>
                <Text style={styles.readonlyUnit}>V</Text>
              </View>
            </View>
          </View>

          {/* Max Current */}
          <View style={styles.sliderGroup}>
            <Text style={styles.sliderLabel}>Max Current</Text>
            <Text style={styles.sliderValue}>{draftCurrent.toFixed(0)} A</Text>
            <Slider
              style={styles.slider}
              minimumValue={5}
              maximumValue={20}
              step={1}
              value={draftCurrent}
              onValueChange={setDraftCurrent}
              minimumTrackTintColor="#87CEEB"
              maximumTrackTintColor="#334455"
              thumbTintColor="#87CEEB"
            />
            <View style={styles.sliderBounds}>
              <Text style={styles.sliderBoundText}>5 A</Text>
              <Text style={styles.sliderBoundText}>20 A</Text>
            </View>
            {draftCurrent !== committedCurrent && (
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  style={[styles.confirmBtn, pendingCurrent && styles.confirmBtnDisabled]}
                  onPress={() => applyField('current')}
                  disabled={pendingCurrent}>
                  <Text style={styles.confirmBtnText}>{pendingCurrent ? '…' : '✓ Confirm'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setDraftCurrent(committedCurrent)}
                  disabled={pendingCurrent}>
                  <Text style={styles.cancelBtnText}>✕ Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Target SOC */}
          <View style={styles.sliderGroup}>
            <Text style={styles.sliderLabel}>Target SOC</Text>
            <Text style={styles.sliderValue}>{Math.round(draftSoc)} %</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={100}
              step={5}
              value={draftSoc}
              onValueChange={setDraftSoc}
              minimumTrackTintColor="#87CEEB"
              maximumTrackTintColor="#334455"
              thumbTintColor="#87CEEB"
            />
            <View style={styles.sliderBounds}>
              <Text style={styles.sliderBoundText}>0%</Text>
              <Text style={styles.sliderBoundText}>100%</Text>
            </View>
            {draftSoc !== committedSoc && (
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  style={[styles.confirmBtn, pendingSoc && styles.confirmBtnDisabled]}
                  onPress={() => applyField('soc')}
                  disabled={pendingSoc}>
                  <Text style={styles.confirmBtnText}>{pendingSoc ? '…' : '✓ Confirm'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setDraftSoc(committedSoc)}
                  disabled={pendingSoc}>
                  <Text style={styles.cancelBtnText}>✕ Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Max Charge Time */}
          <View style={styles.maxTimeGroup}>
            <View style={styles.maxTimeHeader}>
              <Text style={styles.sliderLabel}>Max Charge Time</Text>
              <Text style={styles.maxTimeValue}>
                {pendingMaxTime
                  ? '…'
                  : draftMaxTime >= MAX_TIME_SLIDER_MAX
                  ? 'NO LIMIT'
                  : formatDuration(draftMaxTime)}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={MAX_TIME_SLIDER_MIN}
              maximumValue={MAX_TIME_SLIDER_MAX}
              step={MAX_TIME_SLIDER_STEP}
              value={draftMaxTime}
              onValueChange={val => setDraftMaxTime(val)}
              minimumTrackTintColor="#87CEEB"
              maximumTrackTintColor="#334455"
              thumbTintColor="#87CEEB"
            />
            <View style={styles.sliderBounds}>
              <Text style={styles.sliderBoundText}>15m</Text>
              <Text style={styles.sliderBoundText}>∞</Text>
            </View>
            {draftMaxTime !== committedMaxTime && (
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  style={[styles.confirmBtn, pendingMaxTime && styles.confirmBtnDisabled]}
                  onPress={() => applyMaxTime(fromSlider(draftMaxTime))}
                  disabled={pendingMaxTime}>
                  <Text style={styles.confirmBtnText}>{pendingMaxTime ? '…' : '✓ Confirm'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setDraftMaxTime(committedMaxTime)}
                  disabled={pendingMaxTime}>
                  <Text style={styles.cancelBtnText}>✕ Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
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
  scrollContent: {
    paddingBottom: 200, // clearance for floating FAB
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 8,
    marginBottom: 12,
  },
  // SOC progress bar card
  socCard: {
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  socHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  socHeaderRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  runningTime: {
    fontSize: 12,
    color: '#9E9E9E',
    fontVariant: ['tabular-nums'],
  },
  socPercent: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#00C853',
  },
  progressBar: {
    height: 12,
    borderRadius: 6,
  },
  // Key readings (target voltage + actual current) — prominent
  keyReadingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  keyReadingCard: {
    width: '48%',
    backgroundColor: '#0D2030',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#87CEEB33',
  },
  keyReadingValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#87CEEB',
    marginBottom: 4,
  },
  // Secondary readings grid
  readingsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  readingCard: {
    width: '48%',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  readingLabel: {
    fontSize: 12,
    color: '#9E9E9E',
    marginBottom: 8,
  },
  readingValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  readingUnit: {
    fontSize: 14,
    color: '#9E9E9E',
  },
  stateBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  stateBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Fault display
  faultCard: {
    backgroundColor: '#2D0A0A',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F44336',
  },
  faultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F44336',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  faultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  faultBullet: {
    color: '#F44336',
    fontSize: 14,
    marginRight: 8,
    lineHeight: 20,
  },
  faultText: {
    color: '#FFCDD2',
    fontSize: 13,
    flex: 1,
    lineHeight: 20,
  },
  // Configuration section
  configContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  sliderGroup: {
    marginBottom: 24,
  },
  sliderLabel: {
    fontSize: 14,
    color: '#9E9E9E',
    marginBottom: 4,
  },
  sliderValue: {
    fontSize: 22,
    fontWeight: '600',
    color: '#87CEEB',
    textAlign: 'right',
    marginBottom: 6,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderBounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sliderBoundText: {
    fontSize: 11,
    color: '#556677',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#87CEEB',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#1E2A33',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334455',
  },
  cancelBtnText: {
    color: '#87CEEB',
    fontWeight: '600',
    fontSize: 14,
  },
  readonlyRow: {
    backgroundColor: '#111111',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222222',
  },
  readonlyLabel: {
    fontSize: 14,
    color: '#9E9E9E',
  },
  readonlySubLabel: {
    fontSize: 11,
    color: '#556677',
    marginTop: 2,
  },
  readonlyValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  readonlyValue: {
    fontSize: 22,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  readonlyUnit: {
    fontSize: 14,
    color: '#9E9E9E',
  },
  readonlyValueColumn: {
    alignItems: 'flex-end',
  },
  readingCaption: {
    fontSize: 10,
    color: '#556677',
    marginTop: 2,
  },
  readonlyCaption: {
    fontSize: 10,
    color: '#556677',
    marginTop: 4,
    textAlign: 'right',
  },
  // Max charge time control
  maxTimeGroup: {
    marginBottom: 8,
  },
  maxTimeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  maxTimeValue: {
    fontSize: 22,
    fontWeight: '600',
    color: '#87CEEB',
  },
});
