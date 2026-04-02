import {Device, BleError, Subscription} from 'react-native-ble-plx';
import {sharedBleManager} from './bleInstance';
import {Buffer} from 'buffer';
import {useAppStore} from '../store/useAppStore';
import {ChargerDirectData, ChargeState} from '../types';

export const CHARGER_SERVICE_UUID = '000027b0-0000-1000-8000-00805f9b34fb';

// Notify characteristics
const CHAR_TARGET_VOLTAGE = '00002a1b-0000-1000-8000-00805f9b34fb';
const CHAR_TARGET_AMPS    = '00002a1a-0000-1000-8000-00805f9b34fb';
const CHAR_CURRENT_VOLTAGE = '00002bed-0000-1000-8000-00805f9b34fb';
const CHAR_CURRENT_AMPS   = '00002bf0-0000-1000-8000-00805f9b34fb';
const CHAR_RUNNING_TIME   = '00002bee-0000-1000-8000-00805f9b34fb';
const CHAR_CHARGE_STATE   = '0000ff10-0000-1000-8000-00805f9b34fb';
const CHAR_SOC_PERCENT    = '0000ff11-0000-1000-8000-00805f9b34fb';
const CHAR_ERROR_STATE    = '0000ff12-0000-1000-8000-00805f9b34fb';

// Read + Notify characteristics (new)
const CHAR_NOMINAL_VOLT   = '0000ff20-0000-1000-8000-00805f9b34fb'; // 2-byte big-endian ASCII hex, ÷10
const CHAR_MAX_MULT       = '0000ff21-0000-1000-8000-00805f9b34fb'; // 1-byte ASCII hex, ÷100
const CHAR_MIN_MULT       = '0000ff22-0000-1000-8000-00805f9b34fb'; // 1-byte ASCII hex, ÷100
const CHAR_ABSOLUTE_MAX_V = '0000ff23-0000-1000-8000-00805f9b34fb'; // nominalV × maxMult, uint16 big-endian ASCII hex, ÷10
const CHAR_ABSOLUTE_MIN_V = '0000ff24-0000-1000-8000-00805f9b34fb'; // nominalV × minMult, uint16 big-endian ASCII hex, ÷10

// Read-only config characteristics (PROPERTIES=0x12 Read+Notify — no longer writable)
const CHAR_MAX_CURRENT    = '0000ff01-0000-1000-8000-00805f9b34fb';
const CHAR_TARGET_PCT     = '0000ff02-0000-1000-8000-00805f9b34fb';
const CHAR_MAX_TIME       = '0000ff03-0000-1000-8000-00805f9b34fb';

// Command characteristic (Write-with-response, 4 bytes)
const CHAR_CONFIG_CMD     = '0000ff05-0000-1000-8000-00805f9b34fb';

/**
 * Decode a BLE characteristic value from base64.
 * Handles both Adafruit ASCII-hex-string format ("C8" stored as ASCII [0x43,0x38])
 * and raw binary format (0xC8 stored as binary byte [0xC8]).
 * Auto-detects which format by checking if all bytes are valid ASCII hex characters.
 */
function decodeCharValue(base64Value: string): number {
  const bytes = Buffer.from(base64Value, 'base64');
  if (bytes.length === 0) return 0;

  // Check if all bytes are valid ASCII hex characters (0-9, A-F, a-f)
  const allAsciiHex = bytes.every(
    b =>
      (b >= 0x30 && b <= 0x39) || // '0'-'9'
      (b >= 0x41 && b <= 0x46) || // 'A'-'F'
      (b >= 0x61 && b <= 0x66),   // 'a'-'f'
  );

  if (allAsciiHex) {
    // ASCII hex string: "C8" → 200, "0C80" → 3200
    const ascii = bytes.toString('ascii').trim();
    const parsed = parseInt(ascii, 16);
    if (!isNaN(parsed)) return parsed;
  }

  // Raw binary big-endian: [0xC8] → 200, [0x0D, 0x8A] → 3466
  let val = 0;
  for (const b of bytes) {
    val = (val << 8) | b;
  }
  return val;
}


export class ChargerBleManager {
  private manager = sharedBleManager;
  private connectedDevice: Device | null = null;
  private subscriptions: Subscription[] = [];
  private disconnectSubscription: Subscription | null = null;

  /**
   * Scan for charger devices advertising the charger service UUID.
   */
  scan(onDeviceFound: (deviceId: string, deviceName: string) => void): void {
    useAppStore.getState().setChargerBleStatus('scanning');

    this.manager.startDeviceScan(
      [CHARGER_SERVICE_UUID],
      null,
      (error: BleError | null, device: Device | null) => {
        if (error) {
          if (error.message?.includes('Cannot start scanning operation')) {
            return;
          }
          console.warn('ChargerBle scan error:', error);
          useAppStore.getState().setChargerBleStatus('error');
          useAppStore.getState().setChargerError(error.message);
          return;
        }

        if (device) {
          console.log('ChargerBle found device:', device.name, device.id);
          onDeviceFound(device.id, device.name ?? device.id);
        }
      },
    );
  }

  /**
   * Stop scanning.
   */
  stopScan(): void {
    this.manager.stopDeviceScan();
    if (useAppStore.getState().chargerBleStatus === 'scanning') {
      useAppStore.getState().setChargerBleStatus('disconnected');
    }
  }

  /**
   * Connect to a charger device by device ID.
   */
  async connect(deviceId: string): Promise<void> {
    try {
      this.stopScan();
      useAppStore.getState().setChargerBleStatus('connecting');

      console.log('ChargerBle connecting to:', deviceId);
      const device = await this.manager.connectToDevice(deviceId);

      console.log('ChargerBle connected, discovering services...');
      await device.discoverAllServicesAndCharacteristics();

      this.connectedDevice = device;
      useAppStore.getState().setChargerBleStatus('connected');
      useAppStore.getState().setChargerDeviceId(deviceId);

      this.setupDisconnectHandler(deviceId);

      console.log('ChargerBle connected successfully');
    } catch (error: any) {
      console.error('ChargerBle connection error:', error);
      useAppStore.getState().setChargerBleStatus('error');
      useAppStore.getState().setChargerError(error.message || 'Connection failed');
      throw error;
    }
  }

  /**
   * Subscribe to all notify characteristics. Calls onData with partial updates
   * for each notification; the caller merges them.
   */
  subscribeToAll(onData: (data: Partial<ChargerDirectData>) => void): void {
    if (!this.connectedDevice) {
      console.error('ChargerBle: No device connected');
      return;
    }

    const monitor = (
      charUUID: string,
      handler: (raw: string) => Partial<ChargerDirectData>,
    ): void => {
      const sub = this.connectedDevice!.monitorCharacteristicForService(
        CHARGER_SERVICE_UUID,
        charUUID,
        (error: BleError | null, characteristic: any) => {
          if (error) {
            console.error(`ChargerBle monitor error (${charUUID}):`, error);
            return;
          }
          if (characteristic?.value) {
            try {
              const partial = handler(characteristic.value);
              onData(partial);
            } catch (e: any) {
              console.error(`ChargerBle decode error (${charUUID}):`, e);
            }
          }
        },
      );
      this.subscriptions.push(sub);
    };

    monitor(CHAR_TARGET_VOLTAGE, raw => ({
      targetVoltageV: decodeCharValue(raw) / 10,
    }));

    monitor(CHAR_TARGET_AMPS, raw => ({
      targetAmpsA: decodeCharValue(raw) / 10,
    }));

    monitor(CHAR_CURRENT_VOLTAGE, raw => ({
      currentVoltageV: decodeCharValue(raw) / 10,
    }));

    monitor(CHAR_CURRENT_AMPS, raw => ({
      currentAmpsA: decodeCharValue(raw) / 10,
    }));

    monitor(CHAR_RUNNING_TIME, raw => ({
      runningTimeSeconds: decodeCharValue(raw),
    }));

    monitor(CHAR_CHARGE_STATE, raw => ({
      chargeState: decodeCharValue(raw) as ChargeState,
    }));

    monitor(CHAR_SOC_PERCENT, raw => ({
      socPercent: decodeCharValue(raw),
    }));

    monitor(CHAR_ERROR_STATE, raw => ({
      errorState: decodeCharValue(raw),
    }));

    monitor(CHAR_NOMINAL_VOLT, raw => ({
      nominalVoltageV: decodeCharValue(raw) / 10,
    }));

    monitor(CHAR_MAX_MULT, raw => ({
      maxMultiplier: decodeCharValue(raw) / 100,
    }));
    monitor(CHAR_MIN_MULT, raw => ({
      minMultiplier: decodeCharValue(raw) / 100,
    }));
    monitor(CHAR_ABSOLUTE_MAX_V, raw => ({
      absoluteMaxV: decodeCharValue(raw) / 10,
    }));
    monitor(CHAR_ABSOLUTE_MIN_V, raw => ({
      absoluteMinV: decodeCharValue(raw) / 10,
    }));
  }

  /**
   * Read the current config values from the writable characteristics.
   * These are initialized at charger boot from EEPROM, so they reflect
   * the actual configured values — correct source for seeding sliders.
   */
  async readConfigValues(): Promise<{
    maxCurrentA: number;
    targetSocPct: number;
    maxTimeSec: number;
  }> {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: Not connected');
    }

    const [ampChar, pctChar, timeChar] = await Promise.all([
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_MAX_CURRENT),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_TARGET_PCT),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_MAX_TIME),
    ]);

    return {
      maxCurrentA: decodeCharValue(ampChar.value ?? '') / 10,   // 200 → 20.0 A
      targetSocPct: decodeCharValue(pctChar.value ?? '') / 10,  // 950 → 95.0 %
      maxTimeSec: decodeCharValue(timeChar.value ?? ''),         // 43200 → 43200 s
    };
  }

  async writeMaxCurrent(ampsX10: number): Promise<void> {
    await this.writeConfigCmd(1, ampsX10);
  }

  async writeTargetPct(pctX10: number): Promise<void> {
    await this.writeConfigCmd(2, pctX10);
  }

  async writeMaxTime(seconds: number): Promise<void> {
    await this.writeConfigCmd(3, seconds);
  }

  async writeStartStop(enabled: boolean): Promise<void> {
    await this.writeConfigCmd(4, enabled ? 1 : 0);
  }

  /**
   * Disconnect from the charger and clean up all subscriptions.
   */
  disconnect(): void {
    this.unsubscribeAll();

    if (this.connectedDevice) {
      console.log('ChargerBle disconnecting...');
      this.manager
        .cancelDeviceConnection(this.connectedDevice.id)
        .catch(e => console.error('ChargerBle disconnect error:', e));
      this.connectedDevice = null;
    }

    useAppStore.getState().setChargerBleStatus('disconnected');
    useAppStore.getState().setChargerDeviceId(null);
    useAppStore.getState().setChargerData(null);
  }

  /**
   * Returns true if currently connected to a charger device.
   */
  isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  private async writeConfigCmd(cmdId: number, value: number): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: No device connected');
    }
    const buf = Buffer.alloc(4);
    buf[0] = cmdId;
    buf[1] = 0;
    buf.writeUInt16BE(value, 2);
    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        CHARGER_SERVICE_UUID,
        CHAR_CONFIG_CMD,
        buf.toString('base64'),
      );
    } catch (error: any) {
      console.error(`ChargerBle writeConfigCmd error (cmd=${cmdId}):`, error);
      throw error;
    }
  }

  private setupDisconnectHandler(deviceId: string): void {
    this.disconnectSubscription?.remove();

    this.disconnectSubscription = this.manager.onDeviceDisconnected(
      deviceId,
      (error: BleError | null, device: Device | null) => {
        console.log('ChargerBle device disconnected:', device?.name);
        if (error) {
          console.error('ChargerBle disconnect error:', error);
        }

        this.unsubscribeAll();
        this.connectedDevice = null;

        useAppStore.getState().setChargerBleStatus('disconnected');
        useAppStore.getState().setChargerDeviceId(null);
        useAppStore.getState().setChargerError('Charger disconnected');
      },
    );
  }

  private unsubscribeAll(): void {
    for (const sub of this.subscriptions) {
      sub.remove();
    }
    this.subscriptions = [];

    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }
}

// Singleton instance
export const chargerBleManager = new ChargerBleManager();
