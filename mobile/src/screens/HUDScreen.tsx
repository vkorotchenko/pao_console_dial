import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import _ScreenBrightness from 'react-native-screen-brightness';
const ScreenBrightness = _ScreenBrightness as any;
import {isBatteryCharging} from 'react-native-device-info';
import {useAppStore} from '../store/useAppStore';

interface HUDScreenProps {
  onClose: () => void;
}

const TORQUE_MAX = 120;  // Nm
const TORQUE_MIN = -20;  // Nm
const RPM_MAX = 6000;

const TECH_FONT = 'espacion.regular';

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface VerticalBarProps {
  /** 0–1 fill fraction (clamped internally) */
  fill: number;
  /** When true the bar is bipolar: fill is –1…+1, centred at midpoint */
  bipolar?: boolean;
  /** 0–1 position of the zero line when bipolar (default 0.5 = centre) */
  zeroPoint?: number;
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
  zeroPoint = 0.5,
  fillColor = '#87CEEB',
  label,
  valueText,
  valueColor = '#87CEEB',
}: VerticalBarProps) {
  const [trackHeight, setTrackHeight] = useState(200);

  let filledHeight: number;
  let barTop: number; // offset from top of track where filled region starts

  if (bipolar) {
    // zeroPoint (0–1 from bottom) converted to pixels from top
    const zeroFromTop = trackHeight * (1 - zeroPoint);
    const clamped = clamp(fill, -1, 1);
    if (clamped >= 0) {
      // positive: fill upward from zero line
      filledHeight = clamped * trackHeight * zeroPoint;
      barTop = zeroFromTop - filledHeight;
    } else {
      // negative: fill downward from zero line
      filledHeight = -clamped * trackHeight * (1 - zeroPoint);
      barTop = zeroFromTop;
    }
  } else {
    const clamped = clamp(fill, 0, 1);
    filledHeight = clamped * trackHeight;
    barTop = trackHeight - filledHeight;
  }

  return (
    <View style={barStyles.wrapper}>
      {/* Track + filled region */}
      <View
        style={barStyles.track}
        onLayout={e => setTrackHeight(e.nativeEvent.layout.height)}>
        {bipolar && (
          <View style={[barStyles.centreLine, {top: trackHeight * (1 - zeroPoint)}]} />
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

export default function HUDScreen({onClose}: HUDScreenProps) {
  const telemetry = useAppStore(state => state.telemetry);
  const speedUnit = useAppStore(state => state.speedUnit);
  const hudAutoBrighten = useAppStore(state => state.hudAutoBrighten);

  // --- Brightness control ---
  const [isPhoneCharging, setIsPhoneCharging] = useState(false);
  const originalAppBrightness = useRef<number | null>(null);
  const originalSysBrightness = useRef<number | null>(null);
  const originalAutoBrightness = useRef<boolean | null>(null);
  const permissionRequested = useRef(false);

  useEffect(() => {
    const check = async () => {
      try { setIsPhoneCharging(await isBatteryCharging()); } catch {}
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;

    const applyBrightness = async () => {
      if (isPhoneCharging && hudAutoBrighten) {
        try {
          if (originalAppBrightness.current === null) {
            originalAppBrightness.current = await ScreenBrightness.getAppBrightness();
          }
          if (originalSysBrightness.current === null) {
            originalSysBrightness.current = await ScreenBrightness.getSystemBrightness();
          }
          if (!active) { return; }
          // Set window-level brightness (no permission needed)
          await ScreenBrightness.setAppBrightness(1.0);
          // Boost system brightness + disable auto-brightness — requires WRITE_SETTINGS
          const hasPerm = await ScreenBrightness.hasPermission();
          if (hasPerm) {
            if (originalAutoBrightness.current === null) {
              originalAutoBrightness.current = await ScreenBrightness.getAutoBrightnessEnabled();
            }
            await ScreenBrightness.setAutoBrightnessEnabled(false);
            await ScreenBrightness.setSystemBrightness(1.0);
          } else if (!permissionRequested.current) {
            permissionRequested.current = true;
            ScreenBrightness.requestPermission();
          }
        } catch (e) {
          console.warn('[HUD Brightness] Error:', e);
        }
      } else {
        // Phone stopped charging — hand brightness back to system immediately
        originalAppBrightness.current = null;
        originalSysBrightness.current = null;
        originalAutoBrightness.current = null;
        ScreenBrightness.setAppBrightness(-1).catch(() => {});
        ScreenBrightness.setAutoBrightnessEnabled(true).catch(() => {});
      }
    };

    applyBrightness();

    return () => {
      active = false;
    };
  }, [isPhoneCharging, hudAutoBrighten]);

  // Restore brightness when component unmounts
  useEffect(() => {
    return () => {
      if (originalAutoBrightness.current !== null) {
        ScreenBrightness.setAutoBrightnessEnabled(originalAutoBrightness.current).catch(() => {});
        originalAutoBrightness.current = null;
      }
      if (originalSysBrightness.current !== null) {
        ScreenBrightness.setSystemBrightness(originalSysBrightness.current).catch(() => {});
        originalSysBrightness.current = null;
      }
      if (originalAppBrightness.current !== null) {
        ScreenBrightness.setAppBrightness(originalAppBrightness.current).catch(() => {});
        originalAppBrightness.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    onClose();
  };

  // --- Derived values ---
  const rawSpeed = telemetry?.gpsSpeedKmh ?? 0;
  const speed = speedUnit === 'mph' ? rawSpeed * 0.621371 : rawSpeed;
  const speedLabel = speedUnit === 'mph' ? 'mph' : 'km/h';

  const battery = telemetry?.chargePercent ?? 0;
  const batteryFill = clamp(battery / 100, 0, 1);

  const torque = telemetry?.torqueNm ?? 0;
  // bipolar fill: positive = 0→+1 (up to TORQUE_MAX), negative = 0→-1 (down to TORQUE_MIN)
  const torqueFill = torque >= 0
    ? clamp(torque / TORQUE_MAX, 0, 1)
    : clamp(torque / (-TORQUE_MIN), -1, 0);
  const TORQUE_ZERO_POINT = (-TORQUE_MIN) / (TORQUE_MAX - TORQUE_MIN); // 20/140
  const torqueText = (torque >= 0 ? '+' : '') + torque.toFixed(1);
  const torqueColor = torque < 0 ? '#ff6b6b' : '#87CEEB';
  const torqueFillColor = torque < 0 ? '#ff6b6b' : '#87CEEB';

  const rpm = telemetry?.speedRpm ?? 0;
  const rpmFill = clamp(rpm / RPM_MAX, 0, 1);

  return (
    <View style={styles.safeArea}>
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
              <Text style={styles.speedNumber}>
                {Math.round(speed) < 5 ? '- -' : String(Math.round(speed)).padStart(3, '0')}
              </Text>
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
                zeroPoint={TORQUE_ZERO_POINT}
                fillColor={torqueFillColor}
                label="TORQUE Nm"
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
    </View>
  );
}

// ─── Bar sub-component styles ────────────────────────────────────────────────

const barStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    flex: 1,
  },
  valueText: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  track: {
    flex: 1,
    width: 26,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#FFFFFF',
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
    fontSize: 240,
    lineHeight: 240,
    letterSpacing: 3,
  },
  speedUnit: {
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
    paddingVertical: 0,
  },
});
