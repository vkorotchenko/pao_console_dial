/**
 * Binary packet encoding/decoding for PAO Console BLE protocol
 * Based on ADR-001: mobile/docs/adr-001-ble-gatt-service.md
 */

import {Buffer} from 'buffer';
import {
  Telemetry,
  ChargerConfig,
  Gear,
  MotorState,
  ChargeState,
  StatusFlags,
} from '../types';

/**
 * Decode telemetry packet from BLE (36 bytes, big-endian)
 * @param base64 - Base64 string from react-native-ble-plx
 */
export function decodeTelemetry(base64: string): Telemetry {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length < 36) {
    throw new Error(`Invalid telemetry packet size: ${buf.length}`);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const schemaVersion = view.getUint8(0);
  if (schemaVersion !== 0x01) {
    console.warn(`Unknown telemetry schema version: 0x${schemaVersion.toString(16)}`);
  }

  const statusFlagsByte = view.getUint8(14);
  const statusFlags: StatusFlags = {
    running: (statusFlagsByte & 0x01) !== 0,
    fault: (statusFlagsByte & 0x02) !== 0,
    warning: (statusFlagsByte & 0x04) !== 0,
    ready: (statusFlagsByte & 0x08) !== 0,
    gpsFix: (statusFlagsByte & 0x10) !== 0,
    preChargeReady: (statusFlagsByte & 0x20) !== 0,
    canConnected: (statusFlagsByte & 0x40) !== 0,
  };

  return {
    timestamp: Date.now(),
    schemaVersion,
    speedRpm: view.getInt16(1, false),
    motorTempC: view.getInt16(3, false) / 10,
    inverterTempC: view.getInt16(5, false) / 10,
    torqueNm: view.getInt16(7, false) / 10,
    dcVoltageV: view.getUint16(9, false) / 10,
    dcCurrentA: view.getInt16(11, false) / 10,
    motorState: view.getUint8(13) as MotorState,
    statusFlags,
    gear: view.getUint8(15) as Gear,
    gpsLat: view.getFloat32(16, false),
    gpsLon: view.getFloat32(20, false),
    gpsSpeedKmh: view.getFloat32(24, false),
    gpsAltitudeM: view.getFloat32(28, false),
    gpsSatellites: view.getUint8(32),
    chargePercent: view.getUint8(33),
    chargeErrorState: view.getUint8(34),
    chargeState: view.getUint8(35) as ChargeState,
  };
}

/**
 * Encode gear command for BLE (1 byte)
 * @param gear - Gear enum value
 */
export function encodeGearCommand(gear: Gear): string {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(gear, 0);
  return buf.toString('base64');
}

/**
 * Decode charger config packet from BLE (12 bytes, big-endian).
 * @param base64 - Base64 string from react-native-ble-plx
 */
export function decodeChargerConfig(base64: string): ChargerConfig {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length < 12) {
    throw new Error(`Invalid charger config packet size: ${buf.length}`);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  return {
    targetVoltageV: view.getUint16(0, false) / 10,
    maxCurrentA: view.getUint16(2, false) / 10,
    targetSocPercent: view.getUint8(4),
    maxChargeTimeSeconds: view.getUint16(5, false),
    actualVoltageV: view.getUint16(7, false) / 10,
    actualCurrentA: view.getUint16(9, false) / 10,
    chargeErrorState: view.getUint8(11),
  };
}

/**
 * Encode charger config for BLE write (7 bytes, big-endian)
 * @param config - Charger configuration (without read-only fields)
 */
export function encodeChargerConfig(
  config: Omit<ChargerConfig, 'actualVoltageV' | 'actualCurrentA' | 'chargeErrorState'>
): string {
  const buf = Buffer.alloc(7);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  view.setUint16(0, Math.round(config.targetVoltageV * 10), false);
  view.setUint16(2, Math.round(config.maxCurrentA * 10), false);
  view.setUint8(4, config.targetSocPercent);
  view.setUint16(5, config.maxChargeTimeSeconds, false);

  return buf.toString('base64');
}

/**
 * Helper: Convert ArrayBuffer to hex string for debugging
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Helper: Convert hex string to ArrayBuffer
 */
export function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || [];
  return new Uint8Array(bytes).buffer;
}
