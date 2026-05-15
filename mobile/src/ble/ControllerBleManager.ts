import {Device, BleError, Subscription} from 'react-native-ble-plx';
import {sharedBleManager} from './bleInstance';
import {Buffer} from 'buffer';
import {useAppStore} from '../store/useAppStore';
import {decodeFirmwareVersion} from './firmwareVersion';

// Controller BLE service (0x27B1 — distinct from charger 0x27B0 so mobile
// can identify the controller by service UUID alone when both are in range).
export const CONTROLLER_SERVICE_UUID = '000027b1-0000-1000-8000-00805f9b34fb';

// Controller BLE is OTA-ONLY. Telemetry routes via I²C → dial → mobile
// (unchanged). No telemetry, status, or config characteristics are exposed
// here. Any BLE characteristic defined below is for OTA or version-read only.

// Firmware version characteristic (Read + Notify, 4 bytes little-endian:
// [major, minor, patch, build]). Wire-identical to charger 0xFF25 and dial
// ff250001-…. `decodeFirmwareVersion` (shared module) handles all three.
const CHAR_FW_VERSION     = '0000ff25-0000-1000-8000-00805f9b34fb';

// OTA command dispatcher (WRITE). cmd byte + payload — same contract as
// charger 0xFF05 extensions (cmd=10/11/12/13).
const CHAR_CONFIG_CMD     = '0000ff05-0000-1000-8000-00805f9b34fb';

// OTA chunk receiver (WRITE_WITHOUT_RESPONSE). Same as charger 0xFF26.
const CHAR_OTA_DATA       = '0000ff26-0000-1000-8000-00805f9b34fb';

// OTA status pipe (NOTIFY). Same 5-byte format as charger 0xFF27:
// [status_code: u8][bytes_received: u32 LE]. Same status-code table.
const CHAR_OTA_STATUS     = '0000ff27-0000-1000-8000-00805f9b34fb';

// OTA command opcodes — identical numeric values to charger / dial.
// Redefined here so firmwareTransfer.ts can resolve per-target without
// cross-importing between BLE managers.
export const CTRL_CMD_OTA_BEGIN  = 10;
export const CTRL_CMD_OTA_END    = 11;
export const CTRL_CMD_OTA_ABORT  = 12;
export const CTRL_CMD_OTA_VERIFY = 13;

// AsyncStorage key for last-known controller device ID (Decision #31 pattern).
// Exported so AppNavigator (auto-reconnect) and SettingsScreen (manual
// Disconnect) reference the same string rather than redeclaring it.
export const CONTROLLER_DEVICE_ID_KEY = 'controller_device_id';

export class ControllerBleManager {
  private manager = sharedBleManager;
  private connectedDevice: Device | null = null;
  private subscriptions: Subscription[] = [];
  private disconnectSubscription: Subscription | null = null;

  /**
   * Scan for controller devices advertising the controller service UUID.
   */
  scan(onDeviceFound: (deviceId: string, deviceName: string) => void): void {
    useAppStore.getState().setControllerBleStatus('scanning');

    this.manager.startDeviceScan(
      [CONTROLLER_SERVICE_UUID],
      null,
      (error: BleError | null, device: Device | null) => {
        if (error) {
          if (error.message?.includes('Cannot start scanning operation')) {
            return;
          }
          console.warn('ControllerBle scan error:', error);
          useAppStore.getState().setControllerBleStatus('error');
          useAppStore.getState().setControllerError(error.message);
          return;
        }

        if (device) {
          console.log('ControllerBle found device:', device.name, device.id);
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
    if (useAppStore.getState().controllerBleStatus === 'scanning') {
      useAppStore.getState().setControllerBleStatus('disconnected');
    }
  }

  /**
   * Connect to a controller device by device ID. Follows the same pattern
   * as ChargerBleManager.connect — stop scan, set status, connect, discover.
   */
  async connect(deviceId: string): Promise<void> {
    try {
      this.stopScan();
      useAppStore.getState().setControllerBleStatus('connecting');

      console.log(`[ControllerBle] connect requested for ${deviceId}`);
      const device = await this.manager.connectToDevice(deviceId);

      console.log('ControllerBle connected, discovering services...');
      await device.discoverAllServicesAndCharacteristics();
      console.log('[ControllerBle] connected device=' + device.id);

      this.connectedDevice = device;
      useAppStore.getState().setControllerBleStatus('connected');
      useAppStore.getState().setControllerDevice(device);
      useAppStore.getState().setControllerDeviceId(deviceId);
      // Persist last-known controller device ID (Decision #31).
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.setItem(CONTROLLER_DEVICE_ID_KEY, deviceId);
      } catch {}

      this.setupDisconnectHandler(deviceId);

      console.log('ControllerBle connected successfully');
    } catch (error: any) {
      console.error('ControllerBle connection error:', error);
      useAppStore.getState().setControllerBleStatus('error');
      useAppStore.getState().setControllerError(error.message || 'Connection failed');
      throw error;
    }
  }

  /**
   * Subscribe to the firmware-version notify characteristic so a post-OTA
   * reboot updates the displayed version without a manual reconnect.
   * Controller is OTA-only on BLE — this is the only subscription needed.
   * Unlike charger, there are no telemetry or config notify subscriptions.
   */
  subscribeToAll(): void {
    if (!this.connectedDevice) {
      console.error('ControllerBle: No device connected');
      return;
    }

    const fwSub = this.connectedDevice.monitorCharacteristicForService(
      CONTROLLER_SERVICE_UUID,
      CHAR_FW_VERSION,
      (error: BleError | null, characteristic: any) => {
        if (error) {
          const otaPhase = useAppStore.getState().ota.controller.state;
          if (otaPhase !== 'rebooting' && otaPhase !== 'reconnecting') {
            console.error(`ControllerBle monitor error (${CHAR_FW_VERSION}):`, error);
          }
          return;
        }
        if (characteristic?.value) {
          const ver = decodeFirmwareVersion(characteristic.value);
          console.log(`[ControllerBle][BleNotify] firmwareVersion b64=${characteristic.value} decoded=${ver}`);
          if (ver) {
            useAppStore.getState().setControllerFirmwareVersion(ver);
          }
        }
      },
    );
    this.subscriptions.push(fwSub);
  }

  /**
   * Read the firmware version characteristic immediately on connect so the
   * Settings row shows the version without waiting for a notify.
   * Controller BLE is OTA-only — this is the only readable state to seed.
   */
  async readInitialState(): Promise<void> {
    if (!this.connectedDevice) return;
    try {
      const ch = await this.connectedDevice.readCharacteristicForService(
        CONTROLLER_SERVICE_UUID,
        CHAR_FW_VERSION,
      );
      if (ch.value) {
        const ver = decodeFirmwareVersion(ch.value);
        console.log(`[ControllerBle][BleInit] firmwareVersion b64=${ch.value} decoded=${ver}`);
        if (ver) {
          useAppStore.getState().setControllerFirmwareVersion(ver);
        } else {
          console.warn('[ControllerBle][BleInit] firmwareVersion: decode returned null — payload too short or corrupt');
        }
      } else {
        console.warn('[ControllerBle][BleInit] firmwareVersion: read fulfilled but value is empty');
      }
    } catch (e) {
      console.warn('[ControllerBle][BleInit] firmwareVersion: read REJECTED', e);
    }
  }

  /**
   * Wire up post-connect subscriptions + seed initial state.
   * Called by AppNavigator after connect and by otaOrchestrator after
   * post-OTA reconnect. OTA-only: only firmware version is subscribed.
   */
  wirePostConnectSubscriptions(): void {
    if (!this.connectedDevice) {
      console.warn('[ControllerBle] wirePostConnectSubscriptions: no device');
      return;
    }

    this.subscribeToAll();

    // Seed version immediately without waiting for the first notify.
    this.readInitialState().catch(() => {}); // non-fatal
  }

  /**
   * Returns the current connected device, for the OTA orchestrator's
   * reconnect flow.
   */
  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  /**
   * Returns true if currently connected to a controller device.
   */
  isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  // ── OTA primitives ────────────────────────────────────────────────────────
  // Wire-identical to ChargerBleManager OTA primitives. Only the service UUID
  // and characteristic UUIDs differ. The firmwareTransfer.ts engine drives
  // both without additional branching.

  /**
   * Request MTU 517. Same logic as ChargerBleManager.requestOtaMtu.
   */
  async requestOtaMtu(): Promise<number> {
    if (!this.connectedDevice) {
      throw new Error('ControllerBle: Not connected');
    }
    try {
      console.log('[ota] requesting MTU 517 on controller device', this.connectedDevice.id);
      const updated = await this.connectedDevice.requestMTU(517);
      const rawMtu = (updated as any)?.mtu;
      const mtu = rawMtu ?? 23;
      console.log('[ota] controller negotiated MTU:', mtu, '(raw=', rawMtu, ')');
      console.log(`[OTA] controller negotiated MTU=${mtu} (chunkSize=${Math.max(20, mtu - 3)})`);
      return mtu;
    } catch (e) {
      console.warn('[OTA] controller requestMTU failed, falling back to 23:', e);
      return 23;
    }
  }

  /**
   * Subscribe to the OTA status notify pipe (0xFF27). Same 5-byte format as
   * charger. Subscription lifetime owned by caller — call .remove() when done.
   * NOT added to this.subscriptions (orchestrator manages lifecycle independently).
   */
  subscribeOtaStatus(
    handler: (code: number, bytesReceived: number) => void,
  ): Subscription {
    if (!this.connectedDevice) {
      throw new Error('ControllerBle: Not connected');
    }
    return this.connectedDevice.monitorCharacteristicForService(
      CONTROLLER_SERVICE_UUID,
      CHAR_OTA_STATUS,
      (error: BleError | null, characteristic: any) => {
        if (error) {
          if (!error.message?.includes('cancelled')) {
            console.warn(`[OTA] controller status monitor error: ${error.message}`);
          }
          return;
        }
        if (!characteristic?.value) return;
        const bytes = Buffer.from(characteristic.value, 'base64');
        if (bytes.length < 5) {
          console.warn(`[OTA] controller short status payload: ${bytes.length} bytes`);
          return;
        }
        const code = bytes[0];
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const bytesReceived = view.getUint32(1, true);
        handler(code, bytesReceived);
      },
    );
  }

  /**
   * Write an OTA command to 0xFF05 with optional payload.
   * Same format as charger: [cmd: u8, ...payload].
   */
  async writeOtaCommand(cmd: number, payload?: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('ControllerBle: Not connected');
    }
    const len = 1 + (payload?.byteLength ?? 0);
    const buf = Buffer.alloc(len);
    buf[0] = cmd;
    if (payload) {
      buf.set(payload, 1);
    }
    if (cmd === 10) {
      console.log('[ota] controller writing OTA_BEGIN, bytes:', buf.length);
    } else {
      console.log(`[ota] controller writing OTA cmd=${cmd}, bytes:`, buf.length);
    }
    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        CONTROLLER_SERVICE_UUID,
        CHAR_CONFIG_CMD,
        buf.toString('base64'),
      );
    } catch (err: any) {
      const detail = {
        message: err?.message,
        errorCode: err?.errorCode,
        attErrorCode: err?.attErrorCode,
        androidErrorCode: err?.androidErrorCode,
        iosErrorCode: err?.iosErrorCode,
        reason: err?.reason,
      };
      if (cmd === 10) {
        console.log('[ota] controller OTA_BEGIN write failed:', JSON.stringify(detail));
      } else {
        console.log(`[ota] controller OTA cmd=${cmd} write failed:`, JSON.stringify(detail));
      }
      throw err;
    }
  }

  /**
   * Write a single OTA data chunk to 0xFF26 (WRITE_WITHOUT_RESPONSE).
   */
  async writeOtaChunk(chunk: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('ControllerBle: Not connected');
    }
    const buf = Buffer.from(chunk);
    await this.connectedDevice.writeCharacteristicWithoutResponseForService(
      CONTROLLER_SERVICE_UUID,
      CHAR_OTA_DATA,
      buf.toString('base64'),
    );
  }

  /**
   * Read the firmware version characteristic. Used by the OTA orchestrator
   * after reconnect to confirm the new image booted.
   */
  async readFirmwareVersion(): Promise<string | null> {
    if (!this.connectedDevice) return null;
    try {
      const ch = await this.connectedDevice.readCharacteristicForService(
        CONTROLLER_SERVICE_UUID,
        CHAR_FW_VERSION,
      );
      return decodeFirmwareVersion(ch.value);
    } catch (e) {
      console.warn('[OTA] controller readFirmwareVersion failed:', e);
      return null;
    }
  }

  /**
   * Disconnect from the controller and clean up all subscriptions.
   *
   * NOTE: controllerFirmwareVersion is intentionally NOT cleared here.
   * Same pattern as ChargerBleManager — persisted "last-known" value
   * survives transient disconnects so the Settings row doesn't flicker.
   */
  disconnect(): void {
    this.unsubscribeAll();

    if (this.connectedDevice) {
      console.log('ControllerBle disconnecting...');
      this.manager
        .cancelDeviceConnection(this.connectedDevice.id)
        .catch(e => console.error('ControllerBle disconnect error:', e));
      this.connectedDevice = null;
    }

    useAppStore.getState().setControllerBleStatus('disconnected');
    useAppStore.getState().setControllerDevice(null);
    useAppStore.getState().setControllerError('Controller disconnected');
  }

  private setupDisconnectHandler(deviceId: string): void {
    this.disconnectSubscription?.remove();

    this.disconnectSubscription = this.manager.onDeviceDisconnected(
      deviceId,
      (error: BleError | null, device: Device | null) => {
        console.log('ControllerBle device disconnected:', device?.name);
        if (error) {
          console.error('ControllerBle disconnect error:', error);
        }

        this.unsubscribeAll();
        this.connectedDevice = null;

        useAppStore.getState().setControllerBleStatus('disconnected');
        useAppStore.getState().setControllerDevice(null);
        // NOTE: controllerFirmwareVersion intentionally NOT cleared —
        // same pattern as charger. Last-known persisted version avoids
        // the "—" flicker on transient disconnects.
        useAppStore.getState().setControllerError('Controller disconnected');
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
export const controllerBleManager = new ControllerBleManager();
