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

// Read + Write + Notify config characteristics (PROPERTIES=0x0A — direct per-value writes, send write-back notifications)
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

    // CHAR_CURRENT_VOLTAGE (0x2BED) and CHAR_CURRENT_AMPS (0x2BF0) are PROPERTIES=0x10
    // (Notify only — not readable). They cannot be seeded via readCharacteristicForService.
    // The UI will show '—' until the first BLE notification arrives from firmware (~1s after connect).
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

  /**
   * Read all readable characteristics immediately on connect, so the UI can display
   * state and config values without waiting for the first 1s BLE notification cycle.
   * CHAR_CURRENT_VOLTAGE and CHAR_CURRENT_AMPS have PROPERTIES=0x10 (Notify-only)
   * and CANNOT be read directly — excluded here.
   * CHAR_TARGET_VOLTAGE and CHAR_TARGET_AMPS are now PROPERTIES=0x02 (Read-only)
   * and are included here.
   */
  async readInitialState(): Promise<Partial<ChargerDirectData>> {
    if (!this.connectedDevice) throw new Error('ChargerBle: Not connected');
    const reads = await Promise.allSettled([
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_CHARGE_STATE),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_SOC_PERCENT),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_ERROR_STATE),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_NOMINAL_VOLT),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_MAX_MULT),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_MIN_MULT),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_ABSOLUTE_MAX_V),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_ABSOLUTE_MIN_V),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_TARGET_VOLTAGE),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_TARGET_AMPS),
    ]);
    const [cs, soc, err, nomV, maxM, minM, absMax, absMin, tVolt, tAmp] = reads;
    return {
      ...(cs.status === 'fulfilled' && cs.value?.value ? { chargeState: decodeCharValue(cs.value.value) as ChargeState } : {}),
      ...(soc.status === 'fulfilled' && soc.value?.value ? { socPercent: decodeCharValue(soc.value.value) } : {}),
      ...(err.status === 'fulfilled' && err.value?.value ? { errorState: decodeCharValue(err.value.value) } : {}),
      ...(nomV.status === 'fulfilled' && nomV.value?.value ? { nominalVoltageV: decodeCharValue(nomV.value.value) / 10 } : {}),
      ...(maxM.status === 'fulfilled' && maxM.value?.value ? { maxMultiplier: decodeCharValue(maxM.value.value) / 100 } : {}),
      ...(minM.status === 'fulfilled' && minM.value?.value ? { minMultiplier: decodeCharValue(minM.value.value) / 100 } : {}),
      ...(absMax.status === 'fulfilled' && absMax.value?.value ? { absoluteMaxV: decodeCharValue(absMax.value.value) / 10 } : {}),
      ...(absMin.status === 'fulfilled' && absMin.value?.value ? { absoluteMinV: decodeCharValue(absMin.value.value) / 10 } : {}),
      ...(tVolt.status === 'fulfilled' && tVolt.value?.value ? { targetVoltageV: decodeCharValue(tVolt.value.value) / 10 } : {}),
      ...(tAmp.status === 'fulfilled' && tAmp.value?.value ? { targetAmpsA: decodeCharValue(tAmp.value.value) / 10 } : {}),
    };
  }

  /**
   * Re-read targetVoltageV and targetAmpsA after config is saved.
   * These are derived from config (nomV × mult × targetPct) so they change
   * when the user writes new config values. PROPERTIES=0x02 (Read-only) —
   * no notification, must be read explicitly.
   */
  async refreshTargetReadings(): Promise<Partial<ChargerDirectData>> {
    if (!this.connectedDevice) return {};
    const reads = await Promise.allSettled([
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_TARGET_VOLTAGE),
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_TARGET_AMPS),
    ]);
    const [tVolt, tAmp] = reads;
    return {
      ...(tVolt.status === 'fulfilled' && tVolt.value?.value ? { targetVoltageV: decodeCharValue(tVolt.value.value) / 10 } : {}),
      ...(tAmp.status === 'fulfilled' && tAmp.value?.value ? { targetAmpsA: decodeCharValue(tAmp.value.value) / 10 } : {}),
    };
  }

  async writeMaxCurrent(ampsX10: number): Promise<void> {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(ampsX10, 0);
    await this.writeChar(CHAR_MAX_CURRENT, buf);
  }

  async writeTargetPct(pctX10: number): Promise<void> {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(pctX10, 0);
    await this.writeChar(CHAR_TARGET_PCT, buf);
  }

  async writeMaxTime(seconds: number): Promise<void> {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(seconds, 0);
    await this.writeChar(CHAR_MAX_TIME, buf);
  }

  async writeStartStop(enabled: boolean): Promise<void> {
    // Start/stop still uses the command characteristic (0xFF05, cmd=4)
    await this.writeConfigCmd(4, enabled ? 1 : 0);
  }

  async writeResetToDefaults(): Promise<void> {
    await this.writeConfigCmd(5, 0);
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

  /**
   * Write a raw buffer directly to a characteristic (2-byte big-endian).
   */
  private async writeChar(charUUID: string, buf: Buffer): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: Not connected');
    }
    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        CHARGER_SERVICE_UUID,
        charUUID,
        buf.toString('base64'),
      );
    } catch (error: any) {
      console.error(`ChargerBle writeChar error (${charUUID}):`, error);
      throw error;
    }
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
