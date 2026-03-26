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
  NOT_CHARGING = 0,
  CHARGING = 1,
  COMPLETE = 2,
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

export type BleStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';
