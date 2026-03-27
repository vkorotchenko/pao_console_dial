import {BleManager, Device, BleError, Subscription} from 'react-native-ble-plx';
import {Buffer} from 'buffer';
import {useAppStore} from '../store/useAppStore';
import {ChargerDirectData, ChargeState} from '../types';

const CHARGER_SERVICE_UUID = '000027b0-0000-1000-8000-00805f9b34fb';

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

// Write characteristics
const CHAR_MAX_CURRENT    = '0000ff01-0000-1000-8000-00805f9b34fb';
const CHAR_TARGET_PCT     = '0000ff02-0000-1000-8000-00805f9b34fb';
const CHAR_MAX_TIME       = '0000ff03-0000-1000-8000-00805f9b34fb';

/**
 * Decode a base64 BLE value that encodes an ASCII hex string.
 * Adafruit BLE sends characteristic values as ASCII hex strings.
 * e.g. base64("1F4") → 0x1F4 → 500 (÷10 = 50.0)
 */
function decodeAsciiHex(base64Value: string): number {
  const ascii = Buffer.from(base64Value, 'base64').toString('ascii').trim();
  return parseInt(ascii, 16);
}

/**
 * Encode a 16-bit big-endian value as base64 for BLE write.
 */
function encodeBigEndian16(value: number): string {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value, 0);
  return buf.toString('base64');
}

export class ChargerBleManager {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private subscriptions: Subscription[] = [];
  private disconnectSubscription: Subscription | null = null;

  constructor() {
    this.manager = new BleManager();
  }

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
          console.error('ChargerBle scan error:', error);
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
      targetVoltageV: decodeAsciiHex(raw) / 10,
    }));

    monitor(CHAR_TARGET_AMPS, raw => ({
      targetAmpsA: decodeAsciiHex(raw) / 10,
    }));

    monitor(CHAR_CURRENT_VOLTAGE, raw => ({
      currentVoltageV: decodeAsciiHex(raw) / 10,
    }));

    monitor(CHAR_CURRENT_AMPS, raw => ({
      currentAmpsA: decodeAsciiHex(raw) / 10,
    }));

    monitor(CHAR_RUNNING_TIME, raw => ({
      runningTimeSeconds: decodeAsciiHex(raw),
    }));

    monitor(CHAR_CHARGE_STATE, raw => ({
      chargeState: decodeAsciiHex(raw) as ChargeState,
    }));

    monitor(CHAR_SOC_PERCENT, raw => ({
      socPercent: decodeAsciiHex(raw),
    }));

    monitor(CHAR_ERROR_STATE, raw => ({
      errorState: decodeAsciiHex(raw),
    }));

    monitor(CHAR_NOMINAL_VOLT, raw => ({
      nominalVoltageV: decodeAsciiHex(raw) / 10,
    }));

    monitor(CHAR_MAX_MULT, raw => ({
      maxMultiplier: decodeAsciiHex(raw) / 100,
    }));
    monitor(CHAR_MIN_MULT, raw => ({
      minMultiplier: decodeAsciiHex(raw) / 100,
    }));
  }

  /**
   * Write max current (2 bytes big-endian, value in ampsX10).
   */
  async writeMaxCurrent(ampsX10: number): Promise<void> {
    await this.writeChar(CHAR_MAX_CURRENT, ampsX10);
  }

  /**
   * Write target SOC percentage (2 bytes big-endian, value × 1000).
   */
  async writeTargetPct(pctX1000: number): Promise<void> {
    await this.writeChar(CHAR_TARGET_PCT, pctX1000);
  }

  /**
   * Write max charge time (2 bytes big-endian, seconds).
   */
  async writeMaxTime(seconds: number): Promise<void> {
    await this.writeChar(CHAR_MAX_TIME, seconds);
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

  private async writeChar(charUUID: string, value: number): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: No device connected');
    }

    const encoded = encodeBigEndian16(value);
    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        CHARGER_SERVICE_UUID,
        charUUID,
        encoded,
      );
    } catch (error: any) {
      console.error(`ChargerBle write error (${charUUID}):`, error);
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
