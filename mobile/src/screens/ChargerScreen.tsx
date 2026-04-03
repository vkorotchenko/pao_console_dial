import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {useAppStore} from '../store/useAppStore';
import {ChargeState, ChargerDirectData} from '../types';
import {chargerBleManager} from '../ble/ChargerBleManager';
import {PageHeader} from '../components/PageHeader';
import {BleDebugPanel, DebugRow} from '../components/BleDebugPanel';

const FAULT_BITS: {bit: number; label: string}[] = [
  {bit: 0x01, label: 'Hardware failure'},
  {bit: 0x02, label: 'Overheating'},
  {bit: 0x04, label: 'Input voltage out of range'},
  {bit: 0x08, label: 'Charger off (reverse polarity protection)'},
  {bit: 0x10, label: 'Communication timeout'},
];

const MAX_TIME_SLIDER_MIN = 900;   // 15 minutes
const MAX_TIME_SLIDER_MAX = 43200; // 12h sentinel = "No Limit" (maps to 0 seconds written to firmware)
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
  const chargerData = useAppStore(state => state.chargerData);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);

  const isConnected = chargerBleStatus === 'connected';

  // SOC computed from voltage range (uses direct absolute min/max from firmware)
  const minV = chargerData?.absoluteMinV ?? 0;
  const maxV = chargerData?.absoluteMaxV ?? 0;
  const currentV = chargerData?.currentVoltageV ?? 0;
  const soc =
    maxV > minV && minV > 0
      ? Math.min(100, Math.max(0, ((currentV - minV) / (maxV - minV)) * 100))
      : null;

  // Draft/committed pattern for Max Current slider
  const fromSlider = (secs: number) => (secs >= MAX_TIME_SLIDER_MAX ? 0 : secs);

  const [draftMaxCurrentA, setDraftMaxCurrentA] = useState(0);
  const [committedMaxCurrentA, setCommittedMaxCurrentA] = useState(0);

  // Target SOC slider — seeded from device via readConfigValues(), not from notify data
  const [draftTargetSocPct, setDraftTargetSocPct] = useState(80);
  const [committedTargetSocPct, setCommittedTargetSocPct] = useState(80);

  // Max charge time — draft + committed, pending write state
  // 0 from firmware = no limit; mapped to/from MAX_TIME_SLIDER_MAX sentinel
  const [draftMaxTimeSec, setDraftMaxTimeSec] = useState(MAX_TIME_SLIDER_MAX);
  const [committedMaxTimeSec, setCommittedMaxTimeSec] = useState(MAX_TIME_SLIDER_MAX);

  const [pendingSave, setPendingSave] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const SERVICE_SHORT = '0x27B0';
  const DEBUG_ROWS: DebugRow[] = [
    { name: 'pv_voltage',      char: '0x2BED', access: 'N',   value: chargerData?.currentVoltageV?.toFixed(1) ?? '—',  unit: 'V' },
    { name: 'pv_current',      char: '0x2BF0', access: 'N',   value: chargerData?.currentAmpsA?.toFixed(1) ?? '—',     unit: 'A' },
    { name: 'running_time',    char: '0x2BEE', access: 'N',
      value: chargerData?.runningTimeSeconds != null
        ? new Date(chargerData.runningTimeSeconds * 1000).toISOString().substr(11, 8)
        : '—',
      unit: '' },
    { name: 'target_voltage',  char: '0x2A1B', access: 'R',   value: chargerData?.targetVoltageV?.toFixed(1) ?? '—',   unit: 'V' },
    { name: 'target_amps',     char: '0x2A1A', access: 'R',   value: chargerData?.targetAmpsA?.toFixed(1) ?? '—',      unit: 'A' },
    { name: 'charge_state',    char: '0xFF10', access: 'R+N',
      value: chargerData?.chargeState != null
        ? `${ChargeState[chargerData.chargeState]} (${chargerData.chargeState})`
        : '—',
      unit: '' },
    { name: 'soc_percent',     char: '0xFF11', access: 'R+N', value: chargerData?.socPercent?.toString() ?? '—',       unit: '%' },
    { name: 'error_state',     char: '0xFF12', access: 'R+N',
      value: chargerData?.errorState != null
        ? `0x${chargerData.errorState.toString(16).toUpperCase().padStart(2, '0')}`
        : '—',
      unit: '' },
    { name: 'nominal_voltage', char: '0xFF20', access: 'R+N', value: chargerData?.nominalVoltageV?.toFixed(1) ?? '—',  unit: 'V' },
    { name: 'max_multiplier',  char: '0xFF21', access: 'R+N', value: chargerData?.maxMultiplier?.toFixed(2) ?? '—',    unit: 'x' },
    { name: 'min_multiplier',  char: '0xFF22', access: 'R+N', value: chargerData?.minMultiplier?.toFixed(2) ?? '—',    unit: 'x' },
    { name: 'abs_max_voltage', char: '0xFF23', access: 'R+N', value: chargerData?.absoluteMaxV?.toFixed(1) ?? '—',     unit: 'V' },
    { name: 'abs_min_voltage', char: '0xFF24', access: 'R+N', value: chargerData?.absoluteMinV?.toFixed(1) ?? '—',     unit: 'V' },
    { name: 'max_current_cfg', char: '0xFF01', access: 'RW',  value: committedMaxCurrentA?.toFixed(1) ?? '—',          unit: 'A' },
    { name: 'target_pct_cfg',  char: '0xFF02', access: 'RW',  value: committedTargetSocPct?.toString() ?? '—',          unit: '%' },
    { name: 'max_time_cfg',    char: '0xFF03', access: 'RW',  value: committedMaxTimeSec?.toString() ?? '—',            unit: 's' },
    { name: 'config_cmd',      char: '0xFF05', access: 'W',   value: '(write-only)',                                    unit: '' },
  ];

  // Guard: seed sliders only once per connection, not on every BLE notification
  const seededRef = useRef(false);

  // Trigger a scan attempt when the charger screen is opened and charger is not connected
  useEffect(() => {
    const status = useAppStore.getState().chargerBleStatus;
    if (status === 'disconnected' || status === 'error') {
      useAppStore.getState().incrementScanTrigger();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed sliders once per connection by reading the writable config characteristics
  // directly from the charger (0xFF01/02/03). These are initialized at boot from
  // EEPROM, so they carry the actual configured values — not the notify data which
  // arrives in unpredictable order and carries different semantics (e.g. socPercent
  // is the current charge level, not the configured target percentage).
  useEffect(() => {
    if (!isConnected) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;

    chargerBleManager.readConfigValues()
      .then(cfg => {
        const clampedAmp = Math.min(20, Math.max(5, cfg.maxCurrentA));
        const clampedSoc = Math.min(100, Math.max(20, cfg.targetSocPct));
        setDraftMaxCurrentA(clampedAmp);
        setCommittedMaxCurrentA(clampedAmp);
        setDraftTargetSocPct(clampedSoc);
        setCommittedTargetSocPct(clampedSoc);
        const sliderTime =
          cfg.maxTimeSec === 0
            ? MAX_TIME_SLIDER_MAX
            : Math.min(MAX_TIME_SLIDER_MAX - MAX_TIME_SLIDER_STEP, Math.max(MAX_TIME_SLIDER_MIN, cfg.maxTimeSec));
        setDraftMaxTimeSec(sliderTime);
        setCommittedMaxTimeSec(sliderTime);
      })
      .catch(e => console.error('ChargerScreen: readConfigValues failed:', e));
  }, [isConnected]);

  useEffect(() => {
    if (!chargerData) return;
    console.log('[ChargerScreen] data:', JSON.stringify({
      tV: chargerData.targetVoltageV,
      cV: chargerData.currentVoltageV,
      cA: chargerData.currentAmpsA,
      absMax: chargerData.absoluteMaxV,
      absMin: chargerData.absoluteMinV,
      state: chargerData.chargeState,
      soc: chargerData.socPercent,
      err: chargerData.errorState,
    }));
  }, [chargerData]);

  const getChargeStateLabel = (state?: ChargeState): string => {
    switch (state) {
      case ChargeState.STOPPED:       return 'STOPPED';
      case ChargeState.ENABLED_IDLE:  return 'ENABLED';
      case ChargeState.CHARGING:      return 'CHARGING';
      case ChargeState.COMPLETE:      return 'COMPLETE';
      default:                        return '—';
    }
  };

  const getChargeStateBadgeColor = (state?: ChargeState): string => {
    switch (state) {
      case ChargeState.STOPPED:       return '#c0392b';  // Red
      case ChargeState.ENABLED_IDLE:  return '#F39C12';  // Orange
      case ChargeState.CHARGING:      return '#00C853';  // Green
      case ChargeState.COMPLETE:      return '#2196F3';  // Blue
      default:                        return '#9E9E9E';  // Gray
    }
  };

  const anyDirty =
    draftMaxCurrentA !== committedMaxCurrentA ||
    draftTargetSocPct !== committedTargetSocPct ||
    draftMaxTimeSec !== committedMaxTimeSec;

  const applyAll = async () => {
    if (!isConnected) {
      Alert.alert('Error', 'Not connected to charger');
      return;
    }
    setPendingSave(true);
    try {
      if (draftMaxCurrentA !== committedMaxCurrentA) {
        await chargerBleManager.writeMaxCurrent(Math.round(draftMaxCurrentA * 10));
        setCommittedMaxCurrentA(draftMaxCurrentA);
      }
      if (draftTargetSocPct !== committedTargetSocPct) {
        await chargerBleManager.writeTargetPct(Math.round(draftTargetSocPct * 10));
        setCommittedTargetSocPct(draftTargetSocPct);
      }
      if (draftMaxTimeSec !== committedMaxTimeSec) {
        const seconds = fromSlider(draftMaxTimeSec);
        await chargerBleManager.writeMaxTime(seconds);
        setCommittedMaxTimeSec(draftMaxTimeSec);
      }
      // Re-read target voltage/amps — they're derived from config so they update after a save
      chargerBleManager.refreshTargetReadings().then(refreshed => {
        if (Object.keys(refreshed).length > 0) {
          const current = useAppStore.getState().chargerData;
          useAppStore.getState().setChargerData({ ...({} as any), ...current, ...refreshed } as ChargerDirectData);
        }
      }).catch(() => {}); // non-fatal
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save configuration');
    } finally {
      setPendingSave(false);
    }
  };

  const cancelAll = () => {
    setDraftMaxCurrentA(committedMaxCurrentA);
    setDraftTargetSocPct(committedTargetSocPct);
    setDraftMaxTimeSec(committedMaxTimeSec);
  };

  const handleResetToDefaults = () => {
    Alert.alert(
      'Reset to Defaults',
      'This will reset all charger config to factory defaults on the device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await chargerBleManager.writeResetToDefaults();
              // Force re-seed on next connect by resetting the seeded guard
              seededRef.current = false;
              // Try immediate re-read of config values to update sliders
              chargerBleManager.readConfigValues().then(cfg => {
                const clampedAmp = Math.min(20, Math.max(5, cfg.maxCurrentA));
                const clampedSoc = Math.min(100, Math.max(20, cfg.targetSocPct));
                setDraftMaxCurrentA(clampedAmp);
                setCommittedMaxCurrentA(clampedAmp);
                setDraftTargetSocPct(clampedSoc);
                setCommittedTargetSocPct(clampedSoc);
                const sliderTime =
                  cfg.maxTimeSec === 0
                    ? MAX_TIME_SLIDER_MAX
                    : Math.min(MAX_TIME_SLIDER_MAX - MAX_TIME_SLIDER_STEP, Math.max(MAX_TIME_SLIDER_MIN, cfg.maxTimeSec));
                setDraftMaxTimeSec(sliderTime);
                setCommittedMaxTimeSec(sliderTime);
                seededRef.current = true;
              }).catch(() => {});
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to reset to defaults');
            }
          },
        },
      ],
    );
  };

  const handleStartStop = useCallback(async () => {
    const wantEnabled = chargerData?.chargeState === ChargeState.STOPPED;

    setIsStopping(true);
    try {
      await chargerBleManager.writeStartStop(wantEnabled);
    } catch (e) {
      console.error('ChargerBleManager writeStartStop error:', e);
    } finally {
      setIsStopping(false);
    }
  }, [chargerData?.chargeState]);

  const isActive =
    chargerData?.chargeState === ChargeState.ENABLED_IDLE ||
    chargerData?.chargeState === ChargeState.CHARGING ||
    chargerData?.chargeState === ChargeState.COMPLETE;

  const isHwEnabled =
    chargerData?.chargeState === ChargeState.CHARGING ||
    chargerData?.chargeState === ChargeState.COMPLETE;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}>
        <PageHeader
          title="Charging"
          bleSource="charger"
          style={{paddingHorizontal: 0}}
        />

        {/* SOC bar — computed from voltage range */}
        <View style={styles.socCard}>
          <View style={styles.socHeader}>
            <Text style={styles.readingLabel}>State of Charge</Text>
            <View style={styles.socHeaderRight}>
              <Text style={styles.runningTime}>
                {chargerData?.runningTimeSeconds != null
                  ? formatDuration(chargerData.runningTimeSeconds)
                  : '—'}
              </Text>
              <Text style={styles.socPercent}>
                {soc != null ? soc.toFixed(1) + '%' : '—'}
              </Text>
            </View>
          </View>
          {maxV > 0 ? (
            <>
              <View style={styles.socBarTrack}>
                <View
                  style={[
                    styles.socBarFill,
                    {width: `${soc ?? 0}%`},
                  ]}
                />
              </View>
              <View style={styles.socBarBounds}>
                <Text style={styles.socBarBoundText}>
                  {minV.toFixed(0)}V
                </Text>
                <Text style={styles.socBarBoundText}>
                  {maxV.toFixed(0)}V
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.socBarSkeleton} />
              <View style={styles.socBarBounds}>
                <Text style={styles.socBarBoundText}>—V</Text>
                <Text style={styles.socBarBoundText}>—V</Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Live Readings</Text>

        {/* Top tiles — Requested Voltage + Requested Amps */}
        <View style={styles.keyReadingsRow}>
          <View style={styles.keyReadingCard}>
            <Text style={styles.readingLabel}>Requested Voltage</Text>
            <Text style={styles.keyReadingValue}>
              {chargerData?.targetVoltageV != null
                ? chargerData.targetVoltageV.toFixed(1)
                : '—'}
            </Text>
            <Text style={styles.readingUnit}>
              {chargerData?.targetVoltageV != null ? 'V' : ''}
            </Text>
          </View>
          <View style={styles.keyReadingCard}>
            <Text style={styles.readingLabel}>Requested Amps</Text>
            <Text style={styles.keyReadingValue}>
              {chargerData?.targetAmpsA != null
                ? chargerData.targetAmpsA.toFixed(1)
                : '—'}
            </Text>
            <Text style={styles.readingUnit}>
              {chargerData?.targetAmpsA != null ? 'A' : ''}
            </Text>
          </View>
        </View>

        {/* Actual values row */}
        <View style={styles.readingsContainer}>
          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Actual Voltage</Text>
            <Text style={styles.readingValue}>
              {chargerData != null
                ? (chargerData.currentVoltageV ?? 0).toFixed(1)
                : '—'}
            </Text>
            <Text style={styles.readingUnit}>
              {chargerData != null ? 'V' : ''}
            </Text>
          </View>
          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Actual Amps</Text>
            <Text style={styles.readingValue}>
              {chargerData != null
                ? (chargerData.currentAmpsA ?? 0).toFixed(1)
                : '—'}
            </Text>
            <Text style={styles.readingUnit}>
              {chargerData != null ? 'A' : ''}
            </Text>
          </View>
        </View>

        {/* Charge state badge + Start/Stop button */}
        <View style={styles.readingsContainer}>
          <View style={[styles.readingCard, styles.readingCardWide]}>
            <Text style={styles.readingLabel}>Charge State</Text>
            <View style={styles.chargeStateRow}>
              <View
                style={[
                  styles.stateBadge,
                  {backgroundColor: getChargeStateBadgeColor(chargerData?.chargeState)},
                ]}>
                <Text style={styles.stateBadgeText}>
                  {getChargeStateLabel(chargerData?.chargeState)}
                </Text>
              </View>
              <View style={[styles.enableBadge, { backgroundColor: isHwEnabled ? '#00C853' : '#9E9E9E' }]}>
                <Text style={styles.enableBadgeText}>
                  {'CAN: ' + (isHwEnabled ? 'ENABLED' : 'DISABLED')}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.startStopTileBtn,
                  {backgroundColor: isActive ? '#c0392b' : '#27ae60'},
                  (!isConnected || isStopping || chargerData == null) && {opacity: 0.4},
                ]}
                onPress={handleStartStop}
                disabled={!isConnected || isStopping || chargerData == null}>
                <Text style={styles.startStopTileBtnText}>
                  {isStopping ? '...' : isActive ? 'STOP CHARGING' : 'START CHARGING'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Fault display — always visible */}
        {(() => {
          const faults = getActiveFaults(chargerData?.errorState ?? 0);
          return (
            <View style={[styles.faultCard, faults.length > 0 && { borderColor: '#c0392b' }]}>
              <Text style={[styles.faultTitle, { color: faults.length > 0 ? '#c0392b' : '#00C853' }]}>
                {faults.length > 0 ? 'Active Faults' : 'No Active Faults'}
              </Text>
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

          {/* Max Current */}
          <View style={styles.sliderGroup}>
            <Text style={styles.sliderLabel}>Max Current</Text>
            <Text style={styles.sliderValue}>
              {isConnected ? `${draftMaxCurrentA.toFixed(0)} A` : '—'}
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={5}
              maximumValue={20}
              step={1}
              value={draftMaxCurrentA}
              onValueChange={setDraftMaxCurrentA}
              minimumTrackTintColor="#87CEEB"
              maximumTrackTintColor="#334455"
              thumbTintColor="#87CEEB"
              disabled={!isConnected}
            />
            <View style={styles.sliderBounds}>
              <Text style={styles.sliderBoundText}>5 A</Text>
              <Text style={styles.sliderBoundText}>20 A</Text>
            </View>
          </View>

          {/* Target SOC */}
          <View style={styles.sliderGroup}>
            <Text style={styles.sliderLabel}>Target SOC</Text>
            <Text style={styles.sliderValue}>
              {isConnected ? `${Math.round(draftTargetSocPct)} %` : '—'}
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={20}
              maximumValue={100}
              step={5}
              value={draftTargetSocPct}
              onValueChange={setDraftTargetSocPct}
              minimumTrackTintColor="#87CEEB"
              maximumTrackTintColor="#334455"
              thumbTintColor="#87CEEB"
              disabled={!isConnected}
            />
            <View style={styles.sliderBounds}>
              <Text style={styles.sliderBoundText}>20%</Text>
              <Text style={styles.sliderBoundText}>100%</Text>
            </View>
          </View>

          {/* Max Charge Time */}
          <View style={styles.maxTimeGroup}>
            <View style={styles.maxTimeHeader}>
              <Text style={styles.sliderLabel}>Max Charge Time</Text>
              <Text style={styles.maxTimeValue}>
                {!isConnected
                  ? '—'
                  : pendingSave
                  ? '…'
                  : draftMaxTimeSec >= MAX_TIME_SLIDER_MAX
                  ? 'NO LIMIT'
                  : formatDuration(draftMaxTimeSec)}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={MAX_TIME_SLIDER_MIN}
              maximumValue={MAX_TIME_SLIDER_MAX}
              step={MAX_TIME_SLIDER_STEP}
              value={draftMaxTimeSec}
              onValueChange={val => setDraftMaxTimeSec(val)}
              minimumTrackTintColor="#87CEEB"
              maximumTrackTintColor="#334455"
              thumbTintColor="#87CEEB"
              disabled={!isConnected}
            />
            <View style={styles.sliderBounds}>
              <Text style={styles.sliderBoundText}>15m</Text>
              <Text style={styles.sliderBoundText}>12h</Text>
            </View>
          </View>

          {anyDirty && (
            <View style={styles.saveBar}>
              <TouchableOpacity
                style={[styles.saveBtn, (pendingSave || !isConnected) && styles.saveBtnDisabled]}
                onPress={applyAll}
                disabled={pendingSave || !isConnected}>
                <Text style={styles.saveBtnText}>{pendingSave ? 'Saving…' : 'Save Changes'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelAllBtn}
                onPress={cancelAll}
                disabled={pendingSave}>
                <Text style={styles.cancelAllBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            onPress={handleResetToDefaults}
            style={styles.resetBtn}
            disabled={!isConnected}>
            <Text style={[styles.resetBtnText, !isConnected && {opacity: 0.4}]}>Reset to Defaults</Text>
          </TouchableOpacity>

        </View>

        <BleDebugPanel
          rows={DEBUG_ROWS}
          serviceNote={`Service: ${SERVICE_SHORT} (000027b0-0000-1000-8000-00805f9b34fb)`}
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
  // Empty state
  emptyCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    marginTop: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9E9E9E',
    textAlign: 'center',
    lineHeight: 20,
  },
  // Top tiles — requested voltage + requested amps
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
  // SOC bar card
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
  socBarTrack: {
    height: 12,
    backgroundColor: '#2A2A2A',
    borderRadius: 6,
    overflow: 'hidden',
  },
  socBarFill: {
    height: '100%',
    backgroundColor: '#00C853',
    borderRadius: 6,
  },
  socBarBounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  socBarBoundText: {
    fontSize: 11,
    color: '#556677',
  },
  socBarSkeleton: {
    height: 12,
    backgroundColor: '#222222',
    borderRadius: 6,
  },
  // Actual values row
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
  readingCardWide: {
    width: '100%',
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
  saveBar: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334455',
  },
  saveBtn: {
    flex: 2,
    backgroundColor: '#87CEEB',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 15,
  },
  cancelAllBtn: {
    flex: 1,
    backgroundColor: '#1E2A33',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334455',
  },
  cancelAllBtnText: {
    color: '#87CEEB',
    fontWeight: '600',
    fontSize: 15,
  },
  // Charge state tile row (badge + start/stop button)
  chargeStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    flexWrap: 'wrap',
    gap: 12,
  },
  startStopTileBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  startStopTileBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  // Reset to Defaults button
  resetBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  resetBtnText: {
    color: '#FF6B6B',
    fontSize: 13,
  },
  // CAN enable/disable badge
  enableBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  enableBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
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
