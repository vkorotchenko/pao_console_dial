import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {useAppStore} from '../store/useAppStore';
import {ChargeState} from '../types';
import {paoBleManager} from '../ble/PaoBleManager';

export default function ChargerScreen() {
  const {bleStatus, telemetry, chargerConfig} = useAppStore();
  
  const [targetVoltage, setTargetVoltage] = useState('');
  const [maxCurrent, setMaxCurrent] = useState('');
  const [targetSoc, setTargetSoc] = useState('');
  const [maxChargeTime, setMaxChargeTime] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (chargerConfig && !targetVoltage) {
      setTargetVoltage(chargerConfig.targetVoltageV.toString());
      setMaxCurrent(chargerConfig.maxCurrentA.toString());
      setTargetSoc(chargerConfig.targetSocPercent.toString());
      setMaxChargeTime((chargerConfig.maxChargeTimeSeconds / 60).toString());
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

  const handleApply = async () => {
    if (bleStatus !== 'connected') {
      Alert.alert('Error', 'Not connected to device');
      return;
    }

    const voltage = parseFloat(targetVoltage);
    const current = parseFloat(maxCurrent);
    const soc = parseInt(targetSoc, 10);
    const timeMinutes = parseInt(maxChargeTime, 10);

    if (isNaN(voltage) || voltage <= 0) {
      Alert.alert('Error', 'Invalid target voltage');
      return;
    }
    if (isNaN(current) || current <= 0) {
      Alert.alert('Error', 'Invalid max current');
      return;
    }
    if (isNaN(soc) || soc < 0 || soc > 100) {
      Alert.alert('Error', 'Target SOC must be between 0 and 100');
      return;
    }
    if (isNaN(timeMinutes) || timeMinutes <= 0) {
      Alert.alert('Error', 'Invalid max charge time');
      return;
    }

    setPending(true);
    try {
      await paoBleManager.writeChargerConfig({
        targetVoltageV: voltage,
        maxCurrentA: current,
        targetSocPercent: soc,
        maxChargeTimeSeconds: timeMinutes * 60,
      });
      
      setTimeout(() => {
        setPending(false);
      }, 3000);
    } catch (error: any) {
      setPending(false);
      Alert.alert('Error', error.message || 'Failed to apply configuration');
    }
  };

  return (
    <View style={styles.container}>
      {bleStatus !== 'connected' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Not connected</Text>
        </View>
      )}

      <ScrollView style={styles.scrollView}>
        <Text style={styles.sectionTitle}>Live Readings</Text>
        
        <View style={styles.readingsContainer}>
          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Actual Voltage</Text>
            <Text style={styles.readingValue}>
              {chargerConfig?.actualVoltageV?.toFixed(1) ?? '—'}
            </Text>
            <Text style={styles.readingUnit}>V</Text>
          </View>

          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Actual Current</Text>
            <Text style={styles.readingValue}>
              {chargerConfig?.actualCurrentA?.toFixed(1) ?? '—'}
            </Text>
            <Text style={styles.readingUnit}>A</Text>
          </View>

          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Charge State</Text>
            <View style={[
              styles.stateBadge,
              {backgroundColor: getChargeStateBadgeColor(telemetry?.chargeState)}
            ]}>
              <Text style={styles.stateBadgeText}>
                {getChargeStateLabel(telemetry?.chargeState)}
              </Text>
            </View>
          </View>

          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Charge %</Text>
            <Text style={styles.readingValue}>
              {telemetry?.chargePercent ?? '—'}
            </Text>
            <Text style={styles.readingUnit}>%</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Configuration</Text>

        <View style={styles.configContainer}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Target Voltage (V)</Text>
            <TextInput
              style={styles.input}
              value={targetVoltage}
              onChangeText={setTargetVoltage}
              keyboardType="decimal-pad"
              placeholder="320.0"
              placeholderTextColor="#555555"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Max Current (A)</Text>
            <TextInput
              style={styles.input}
              value={maxCurrent}
              onChangeText={setMaxCurrent}
              keyboardType="decimal-pad"
              placeholder="15.0"
              placeholderTextColor="#555555"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Target SOC (%)</Text>
            <TextInput
              style={styles.input}
              value={targetSoc}
              onChangeText={setTargetSoc}
              keyboardType="number-pad"
              placeholder="80"
              placeholderTextColor="#555555"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Max Charge Time (min)</Text>
            <TextInput
              style={styles.input}
              value={maxChargeTime}
              onChangeText={setMaxChargeTime}
              keyboardType="number-pad"
              placeholder="120"
              placeholderTextColor="#555555"
            />
          </View>

          <TouchableOpacity
            style={[styles.applyButton, pending && styles.applyButtonDisabled]}
            onPress={handleApply}
            disabled={pending}
          >
            <Text style={styles.applyButtonText}>
              {pending ? 'Pending...' : 'Apply'}
            </Text>
          </TouchableOpacity>
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 8,
    marginBottom: 12,
  },
  readingsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
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
  configContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: '#9E9E9E',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0D0D0D',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#333333',
  },
  applyButton: {
    backgroundColor: '#00C853',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  applyButtonDisabled: {
    backgroundColor: '#555555',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
