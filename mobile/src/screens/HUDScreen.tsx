import React, {useEffect} from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import Orientation from 'react-native-orientation-locker';
import {useAppStore} from '../store/useAppStore';

interface HUDScreenProps {
  visible: boolean;
  onClose: () => void;
}

export default function HUDScreen({visible, onClose}: HUDScreenProps) {
  const telemetry = useAppStore(state => state.telemetry);
  const speedUnit = useAppStore(state => state.speedUnit);

  useEffect(() => {
    if (visible) {
      Orientation.lockToLandscapeLeft();
      StatusBar.setHidden(true, 'fade');
    } else {
      Orientation.unlockAllOrientations();
      StatusBar.setHidden(false, 'fade');
    }
    return () => {
      Orientation.unlockAllOrientations();
      StatusBar.setHidden(false, 'fade');
    };
  }, [visible]);

  const handleClose = () => {
    Orientation.unlockAllOrientations();
    StatusBar.setHidden(false, 'fade');
    onClose();
  };

  const rawSpeed = telemetry?.gpsSpeedKmh ?? 0;
  const speed = speedUnit === 'mph' ? rawSpeed * 0.621371 : rawSpeed;
  const speedLabel = speedUnit === 'mph' ? 'mph' : 'km/h';
  const torque = telemetry?.torqueNm ?? 0;
  const torqueDisplay = (torque >= 0 ? '+' : '') + torque.toFixed(1);
  const battery = telemetry?.chargePercent ?? 0;
  const rpm = telemetry?.speedRpm ?? 0;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.mirror}>
          {/* Close button — counter-mirrored so text reads correctly */}
          <View style={styles.closeWrapper}>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <View style={styles.counterMirror}>
                <Text style={styles.closeText}>✕</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Primary speed display */}
          <View style={styles.speedContainer}>
            <Text style={styles.speedNumber}>{Math.round(speed)}</Text>
            <Text style={styles.speedUnit}>{speedLabel}</Text>
          </View>

          {/* Secondary metrics row */}
          <View style={styles.metricsRow}>
            <View style={styles.metricTile}>
              <Text style={styles.metricValue}>{battery}%</Text>
              <Text style={styles.metricLabel}>Battery</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricTile}>
              <Text
                style={[styles.metricValue, torque < 0 && styles.negativeValue]}>
                {torqueDisplay}
              </Text>
              <Text style={styles.metricLabel}>Torque (Nm)</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricTile}>
              <Text style={styles.metricValue}>{rpm}</Text>
              <Text style={styles.metricLabel}>RPM</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  mirror: {
    flex: 1,
    backgroundColor: '#000',
    transform: [{scaleX: -1}],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  closeWrapper: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  closeButton: {
    padding: 12,
  },
  counterMirror: {
    transform: [{scaleX: -1}],
  },
  closeText: {
    color: '#888',
    fontSize: 24,
  },
  speedContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  speedNumber: {
    color: '#fff',
    fontSize: 120,
    fontWeight: '700',
    lineHeight: 130,
    letterSpacing: -4,
  },
  speedUnit: {
    color: '#aaa',
    fontSize: 28,
    fontWeight: '400',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#222',
    paddingTop: 24,
    gap: 0,
  },
  metricTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  metricDivider: {
    width: 1,
    height: 48,
    backgroundColor: '#222',
  },
  metricValue: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '600',
  },
  negativeValue: {
    color: '#ff6b6b',
  },
  metricLabel: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
