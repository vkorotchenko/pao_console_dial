export enum Gear {
  NEUTRAL = 0,
  DRIVE = 1,
  REVERSE = 2,
  PARK = 3,
}

export enum MotorState {
  DISABLED = 0,
  STANDBY = 1,
  ENABLE = 2,
  POWERDOWN = 3,
}

export enum ChargeState {
  STOPPED = 0,        // charger disabled by user
  ENABLED_IDLE = 1,   // charger enabled, not yet charging
  CHARGING = 2,       // actively charging
  COMPLETE = 3,       // charge complete
}

export interface StatusFlags {
  running: boolean;
  fault: boolean;
  warning: boolean;
  ready: boolean;
  gpsFix: boolean;
  preChargeReady: boolean;
  canConnected: boolean;
}

export interface Telemetry {
  timestamp: number;
  schemaVersion: number;
  speedRpm: number;
  motorTempC: number;
  inverterTempC: number;
  torqueNm: number;
  dcVoltageV: number;
  dcCurrentA: number;
  motorState: MotorState;
  statusFlags: StatusFlags;
  gear: Gear;
  gpsLat: number;
  gpsLon: number;
  gpsSpeedKmh: number;
  gpsAltitudeM: number;
  gpsSatellites: number;
  chargePercent: number;
  chargeErrorState: number;
  chargeState: ChargeState;
}

export interface ChargerConfig {
  targetVoltageV: number;
  maxCurrentA: number;
  targetSocPercent: number;
  maxChargeTimeSeconds: number;
  actualVoltageV?: number;
  actualCurrentA?: number;
  chargeErrorState?: number;
}

export interface ChargerDirectData {
  targetVoltageV: number;       // from char 0x2A1B (ASCII hex, ÷10)
  targetAmpsA: number;          // from char 0x2A1A (ASCII hex, ÷10)
  currentVoltageV: number;      // from char 0x2BED (ASCII hex, ÷10)
  currentAmpsA: number;         // from char 0x2BF0 (ASCII hex, ÷10)
  runningTimeSeconds: number;   // from char 0x2BEE (ASCII hex, raw)
  chargeState: ChargeState;     // from char 0xFF10 (new, 1 byte)
  socPercent: number;           // from char 0xFF11 (new, 1 byte)
  errorState: number;           // from char 0xFF12 (new, 1 byte)
  nominalVoltageV?: number;     // from char 0xFF20 (2-byte big-endian ASCII hex, ÷10)
  maxMultiplier?: number;       // from char 0xFF21 (1-byte ASCII hex, ÷100, e.g. 114 → 1.14)
  minMultiplier?: number;       // from char 0xFF22 (1-byte ASCII hex, ÷100, e.g. 81 → 0.81)
  absoluteMaxV?: number;        // from char 0xFF23 (nominalV × maxMult, uint16 big-endian ASCII hex, ÷10)
  absoluteMinV?: number;        // from char 0xFF24 (nominalV × minMult, uint16 big-endian ASCII hex, ÷10)
  cfgMaxCurrentA?: number;      // echo from 0xFF01 after mobile write
  cfgTargetSocPct?: number;     // echo from 0xFF02 (raw tenths, so 950 = 95.0%)
  cfgMaxTimeSec?: number;       // echo from 0xFF03 in seconds
}

export type BleStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';
