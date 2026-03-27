import React, {useEffect} from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  SafeAreaView,
  Platform,
} from 'react-native';
import Orientation from 'react-native-orientation-locker';
import {useAppStore} from '../store/useAppStore';
import {paoBleManager} from '../ble/PaoBleManager';

interface HUDScreenProps {
  visible: boolean;
  onClose: () => void;
}

const TORQUE_MAX = 200; // ±200 Nm bipolar range
const RPM_MAX = 6000;

const TECH_FONT = Platform.OS === 'android' ? 'monospace' : 'Courier New';

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface VerticalBarProps {
  /** 0–1 fill fraction (clamped internally) */
  fill: number;
  /** When true the bar is bipolar: fill is –1…+1, centred at midpoint */
  bipolar?: boolean;
  /** Override bar fill colour */
  fillColor?: string;
  /** Label shown below the bar */
  label: string;
  /** Numeric string shown above the bar */
  valueText: string;
  /** Optional colour for the value text */
  valueColor?: string;
}

function VerticalBar({
  fill,
  bipolar = false,
  fillColor = '#87CEEB',
  label,
  valueText,
  valueColor = '#87CEEB',
}: VerticalBarProps) {
  const BAR_HEIGHT = 200;

  let filledHeight: number;
  let barTop: number; // offset from top of track where filled region starts

  if (bipolar) {
    // fill is in range –1…+1; midpoint is BAR_HEIGHT / 2
    const mid = BAR_HEIGHT / 2;
    const clamped = clamp(fill, -1, 1);
    if (clamped >= 0) {
      // positive: fill upward from centre
      filledHeight = clamped * mid;
      barTop = mid - filledHeight;
    } else {
      // negative: fill downward from centre
      filledHeight = -clamped * mid;
      barTop = mid;
    }
  } else {
    const clamped = clamp(fill, 0, 1);
    filledHeight = clamped * BAR_HEIGHT;
    barTop = BAR_HEIGHT - filledHeight;
  }

  return (
    <View style={barStyles.wrapper}>
      {/* Track + filled region — bar on TOP */}
      <View style={[barStyles.track, {height: BAR_HEIGHT}]}>
        {bipolar && (
          <View style={[barStyles.centreLine, {top: BAR_HEIGHT / 2}]} />
        )}
        <View
          style={[
            barStyles.filled,
            {
              height: filledHeight,
              top: barTop,
              backgroundColor: fillColor,
            },
          ]}
        />
      </View>

      {/* Numeric value below bar */}
      <Text style={[barStyles.valueText, {color: valueColor}]}>{valueText}</Text>

      {/* Text label below value */}
      <Text style={barStyles.labelText}>{label}</Text>
    </View>
  );
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

  useEffect(() => {
    if (!visible) {
      return;
    }
    const currentStatus = useAppStore.getState().bleStatus;
    if (currentStatus === 'disconnected' || currentStatus === 'error') {
      paoBleManager.scan((device) => {
        paoBleManager.connect(device.id).then(() => {
          paoBleManager.subscribeToTelemetry(() => {});
        }).catch(console.error);
      });
    }
    return () => {
      if (useAppStore.getState().bleStatus === 'scanning') {
        paoBleManager.stopScan();
      }
    };
  }, [visible]);

  const handleClose = () => {
    Orientation.unlockAllOrientations();
    StatusBar.setHidden(false, 'fade');
    onClose();
  };

  // --- Derived values ---
  const rawSpeed = telemetry?.gpsSpeedKmh ?? 0;
  const speed = speedUnit === 'mph' ? rawSpeed * 0.621371 : rawSpeed;
  const speedLabel = speedUnit === 'mph' ? 'mph' : 'km/h';

  const battery = telemetry?.chargePercent ?? 0;
  const batteryFill = clamp(battery / 100, 0, 1);

  const torque = telemetry?.torqueNm ?? 0;
  const torqueFill = clamp(torque / TORQUE_MAX, -1, 1); // –1…+1
  const torqueText = (torque >= 0 ? '+' : '') + torque.toFixed(1);
  const torqueColor = torque < 0 ? '#ff6b6b' : '#87CEEB';
  const torqueFillColor = torque < 0 ? '#ff6b6b' : '#87CEEB';

  const rpm = telemetry?.speedRpm ?? 0;
  const rpmFill = clamp(rpm / RPM_MAX, 0, 1);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}>
      <SafeAreaView style={styles.safeArea}>
        {/* Root mirror — entire HUD is horizontally flipped for windshield projection */}
        <View style={styles.mirror}>

          {/* Close button — counter-mirrored so the ✕ reads correctly */}
          <View style={styles.closeWrapper}>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <View style={styles.counterMirror}>
                <Text style={styles.closeText}>✕</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── Two-column layout ── */}
          <View style={styles.columns}>

            {/* LEFT: speed (flex:2) */}
            <View style={styles.leftHalf}>
              <Text style={styles.speedNumber}>{Math.round(speed)}</Text>
              <Text style={styles.speedUnit}>{speedLabel}</Text>
            </View>

            {/* Vertical divider */}
            <View style={styles.columnDivider} />

            {/* RIGHT: three vertical metric bars (flex:1) */}
            <View style={styles.rightHalf}>
              <VerticalBar
                fill={batteryFill}
                label="BATTERY"
                valueText={`${battery}%`}
              />
              <VerticalBar
                fill={torqueFill}
                bipolar
                fillColor={torqueFillColor}
                label="TORQUE"
                valueText={torqueText}
                valueColor={torqueColor}
              />
              <VerticalBar
                fill={rpmFill}
                label="RPM"
                valueText={String(rpm)}
              />
            </View>

          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Bar sub-component styles ────────────────────────────────────────────────

const barStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    paddingVertical: 4,
  },
  valueText: {
    fontFamily: TECH_FONT,
    fontSize: 22,
    fontWeight: '600',
    marginTop: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  track: {
    width: 26,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#1a2a35',
  },
  filled: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 3,
  },
  centreLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#1a2a35',
    zIndex: 1,
  },
  labelText: {
    fontFamily: TECH_FONT,
    color: '#5BA8C4',
    fontSize: 13,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
});

// ─── Screen layout styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  mirror: {
    flex: 1,
    backgroundColor: '#000',
    transform: [{scaleX: -1}],
  },
  closeWrapper: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
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
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  leftHalf: {
    flex: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedNumber: {
    fontFamily: TECH_FONT,
    color: '#87CEEB',
    fontSize: 200,
    fontWeight: '700',
    lineHeight: 200,
    letterSpacing: 3,
  },
  speedUnit: {
    fontFamily: TECH_FONT,
    color: '#5BA8C4',
    fontSize: 32,
    fontWeight: '400',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  columnDivider: {
    width: 1,
    backgroundColor: '#1a2a35',
    marginVertical: 24,
  },
  rightHalf: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'stretch',
    paddingHorizontal: 12,
    paddingVertical: 24,
  },
});
