import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, Alert} from 'react-native';
import {Icon} from 'react-native-paper';
import {useAppStore} from '../store/useAppStore';
import {Gear} from '../types';
import {paoBleManager} from '../ble/PaoBleManager';

export default function GearScreen() {
  const {bleStatus} = useAppStore();
  const chargerBleStatus = useAppStore(s => s.chargerBleStatus);
  const [pendingGear, setPendingGear] = useState<Gear | null>(null);
  const [confirmingGear, setConfirmingGear] = useState<Gear | null>(null);

  const isGearBlocked = chargerBleStatus === 'connected' && bleStatus !== 'connected';

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

  return (
    <View style={styles.container}>
      {bleStatus !== 'connected' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Not connected</Text>
        </View>
      )}

      <View style={styles.centeredContent}>
        {isGearBlocked && (
          <View style={styles.blockedOverlay}>
            <Icon source="lightning-bolt" size={48} color="#87CEEB" />
            <Text style={styles.blockedText}>
              Gear control unavailable{'\n'}while connected to charger
            </Text>
          </View>
        )}

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
              );
            })()}
          </View>
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
  gearLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  leftColumn: {
    flexDirection: 'column',
    gap: 20,
  },
  rightColumn: {
    justifyContent: 'center',
  },
  gearButton: {
    width: 130,
    height: 130,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
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
