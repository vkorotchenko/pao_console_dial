import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, Alert} from 'react-native';
import {useAppStore} from '../store/useAppStore';
import {Gear} from '../types';
import {paoBleManager} from '../ble/PaoBleManager';

export default function GearScreen() {
  const {bleStatus, telemetry} = useAppStore();
  const [sending, setSending] = useState(false);

  const currentGear = telemetry?.gear;

  const getGearLabel = (gear?: Gear): string => {
    switch (gear) {
      case Gear.NEUTRAL: return 'N';
      case Gear.DRIVE: return 'D';
      case Gear.REVERSE: return 'R';
      case Gear.PARK: return 'P';
      default: return '—';
    }
  };

  const getGearFullLabel = (gear?: Gear): string => {
    switch (gear) {
      case Gear.NEUTRAL: return 'NEUTRAL';
      case Gear.DRIVE: return 'DRIVE';
      case Gear.REVERSE: return 'REVERSE';
      case Gear.PARK: return 'PARK';
      default: return '—';
    }
  };

  const handleGearPress = async (gear: Gear) => {
    if (bleStatus !== 'connected') {
      Alert.alert('Error', 'Not connected to device');
      return;
    }

    if (sending) return;

    const shiftGear = async () => {
      setSending(true);
      try {
        await paoBleManager.writeGearCommand(gear);
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to shift gear');
      } finally {
        setSending(false);
      }
    };

    if (gear === Gear.DRIVE) {
      Alert.alert(
        'Confirm',
        'Shift to DRIVE?',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Confirm', onPress: shiftGear},
        ]
      );
    } else if (gear === Gear.REVERSE) {
      Alert.alert(
        'Confirm',
        'Shift to REVERSE?',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Confirm', onPress: shiftGear},
        ]
      );
    } else {
      await shiftGear();
    }
  };

  return (
    <View style={styles.container}>
      {bleStatus !== 'connected' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Not connected</Text>
        </View>
      )}

      <View style={styles.centeredContent}>
        <Text style={styles.currentLabel}>Current Gear</Text>
        <Text style={styles.currentGear}>
          {getGearFullLabel(currentGear)}
        </Text>

        {sending && (
          <Text style={styles.sendingText}>Sending…</Text>
        )}

        <View style={styles.gearGrid}>
          <TouchableOpacity
            style={[
              styles.gearButton,
              currentGear === Gear.PARK && styles.gearButtonActive,
            ]}
            onPress={() => handleGearPress(Gear.PARK)}
            disabled={sending}
          >
            <Text style={styles.gearButtonText}>P</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.gearButton,
              currentGear === Gear.NEUTRAL && styles.gearButtonActive,
            ]}
            onPress={() => handleGearPress(Gear.NEUTRAL)}
            disabled={sending}
          >
            <Text style={styles.gearButtonText}>N</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.gearButton,
              currentGear === Gear.DRIVE && styles.gearButtonActive,
            ]}
            onPress={() => handleGearPress(Gear.DRIVE)}
            disabled={sending}
          >
            <Text style={styles.gearButtonText}>D</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.gearButton,
              currentGear === Gear.REVERSE && styles.gearButtonActive,
            ]}
            onPress={() => handleGearPress(Gear.REVERSE)}
            disabled={sending}
          >
            <Text style={styles.gearButtonText}>R</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  currentLabel: {
    fontSize: 16,
    color: '#9E9E9E',
    marginBottom: 8,
  },
  currentGear: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 32,
  },
  sendingText: {
    fontSize: 14,
    color: '#FFD600',
    marginBottom: 16,
  },
  gearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 260,
    justifyContent: 'space-between',
  },
  gearButton: {
    width: 120,
    height: 120,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  gearButtonActive: {
    borderColor: '#00C853',
  },
  gearButtonText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
