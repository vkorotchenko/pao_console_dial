import {Device, BleError, Subscription, State} from 'react-native-ble-plx';
import {sharedBleManager} from './bleInstance';
import {Platform} from 'react-native';
import {Buffer} from 'buffer';
import {useAppStore} from '../store/useAppStore';
import {
  decodeTelemetry,
  encodeGearCommand,
  decodeChargerConfig,
  encodeChargerConfig,
} from './packets';
import {Gear, ChargerConfig} from '../types';
import {decodeFirmwareVersion} from './firmwareVersion';

export const PAO_SERVICE_UUID = 'c909d45a-0560-4725-85e7-c20a9bbb74c2';
const TELEMETRY_CHAR_UUID = 'c169df83-5127-46df-a18b-066672243018';
const GEAR_CHAR_UUID = 'b2b08d43-7ec9-40c4-add2-a3a899756607';
const CHARGER_CHAR_UUID = '06ad7ea2-24cc-46fe-b791-78167b76693e';
const SPEED_UNIT_CHAR_UUID = 'd3b4f172-9e8a-4c0b-a1d2-7f3e8c5b2a91';
const MEDIA_CMD_CHAR_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567891';
const DEVICE_NAME = 'PAO Console';

// ── Phase 1 + Phase 5 dial characteristics (Bart's firmware decisions
//    #58 + dial-phase5-ota-firmware) ──────────────────────────────────────
// Firmware version (Read + Notify). 4-byte LE payload `[major, minor, patch, build]` —
// byte-identical to charger 0xFF25 (decodeFirmwareVersion handles both).
export const PAO_FW_VERSION_CHAR_UUID =
  'ff250001-5127-46df-a18b-066672243018';

// OTA dispatcher (WRITE). cmd byte + payload — see firmwareTransfer.ts for
// the cmd code table. This is NOT grafted onto CHARGER_CHAR_UUID (Bart's
// design call — the existing charger config char is structured, not a cmd
// dispatcher). New dedicated UUID.
export const PAO_OTA_DISPATCH_CHAR_UUID =
  'ff050001-5127-46df-a18b-066672243018';

// OTA chunk receiver (WRITE_NR only). Up to (MTU-3) bytes per write.
export const PAO_OTA_DATA_CHAR_UUID =
  'ff260001-5127-46df-a18b-066672243018';

// OTA status pipe (NOTIFY only). 5-byte payload `[code:u8][bytesReceived:u32 LE]`.
// Wire-identical to charger 0xFF27 — same status-code decoder for both.
export const PAO_OTA_STATUS_CHAR_UUID =
  'ff270001-5127-46df-a18b-066672243018';

// OTA command opcodes (mirror charger ChargerBleManager.ts CMD_OTA_* — same
// firmware contract; redefined here so firmwareTransfer.ts can pick them up
// per target without cross-importing between BLE managers).
export const PAO_CMD_OTA_BEGIN = 10;
export const PAO_CMD_OTA_END = 11;
export const PAO_CMD_OTA_ABORT = 12;
export const PAO_CMD_OTA_VERIFY = 13;

export class PaoBleManager {
  private manager = sharedBleManager;
  private connectedDevice: Device | null = null;
  private telemetrySubscription: Subscription | null = null;
  private chargerSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private speedUnitSubscription: Subscription | null = null;
  private mediaCmdSubscription: Subscription | null = null;
  // Phase 1 dial: live firmware-version notifications (post-OTA reboot,
  // firmware-side hot-swap). One subscription per connect, torn down by
  // unsubscribeAll on disconnect.
  private fwVersionSubscription: Subscription | null = null;

  /**
   * Scan for PAO Console devices
   * @param onDeviceFound - Callback when device is found
   */
  async scan(onDeviceFound: (device: Device) => void): Promise<void> {
    // Guard: skip if already scanning, connecting, or connected
    const currentStatus = useAppStore.getState().bleStatus;
    if (
      currentStatus === 'scanning' ||
      currentStatus === 'connecting' ||
      currentStatus === 'connected'
    ) {
      return;
    }

    // Guard: BLE must be powered on
    const bleState = await this.manager.state();
    if (bleState !== State.PoweredOn) {
      console.warn('PaoBle: BLE not ready, state:', bleState);
      return;
    }

    useAppStore.getState().setBleStatus('scanning');

    this.manager.startDeviceScan(
      [PAO_SERVICE_UUID],
      null,
      (error: BleError | null, device: Device | null) => {
        if (error) {
          if (error.message?.includes('Cannot start scanning operation')) {
            return;
          }
          console.warn('Scan error:', error);
          useAppStore.getState().setBleStatus('error');
          useAppStore.getState().setError(error.message);
          return;
        }

        if (device) {
          console.log('Found device:', device.name, device.id);
          onDeviceFound(device);
        }
      }
    );
  }

  /**
   * Stop scanning
   */
  stopScan(): void {
    this.manager.stopDeviceScan();
    if (useAppStore.getState().bleStatus === 'scanning') {
      useAppStore.getState().setBleStatus('disconnected');
    }
  }

  /**
   * Connect to a PAO Console device
   * @param deviceId - The BLE device ID to connect to
   */
  async connect(deviceId: string): Promise<void> {
    try {
      this.stopScan();
      useAppStore.getState().setBleStatus('connecting');

      console.log('Connecting to device:', deviceId);
      const device = await this.manager.connectToDevice(deviceId, {
        requestMTU: 128,
      });

      console.log('Connected, discovering services...');
      await device.discoverAllServicesAndCharacteristics();

      if (Platform.OS === 'android') {
        console.log('Requesting MTU 128 (Android)');
        await device.requestMTU(128);
      }

      this.connectedDevice = device;
      useAppStore.getState().setBleStatus('connected');
      useAppStore.getState().setDeviceId(deviceId);

      // Read speed unit preference from peripheral
      try {
        const su = await device.readCharacteristicForService(PAO_SERVICE_UUID, SPEED_UNIT_CHAR_UUID);
        if (su.value) {
          const buf = Buffer.from(su.value, 'base64');
          const unit = buf[0] === 0 ? 'kmh' : 'mph';
          useAppStore.getState().setSpeedUnit(unit);
        }
      } catch (e) {
        console.warn('PaoBle: could not read speed unit:', e);
      }

      this.subscribeToSpeedUnit();
      // Phase 1 dial: read the firmware version characteristic + subscribe for
      // live notifications. Both the read and the subscribe are best-effort —
      // a dial running pre-Phase-1 firmware simply won't expose this char and
      // both calls will reject; we swallow those failures so a legacy dial
      // keeps connecting cleanly. The store value stays at its persisted
      // last-known until a fresh read succeeds.
      this.readDialFirmwareVersion().catch(() => {});
      this.subscribeToDialFirmwareVersion();
      this.setupDisconnectHandler(deviceId);

      console.log('Connected successfully');
    } catch (error: any) {
      console.error('Connection error:', error);
      useAppStore.getState().setBleStatus('error');
      useAppStore.getState().setError(error.message || 'Connection failed');
      throw error;
    }
  }

  /**
   * Subscribe to telemetry notifications
   * @param callback - Called when new telemetry data arrives
   */
  subscribeToTelemetry(callback: (data: any) => void): void {
    if (!this.connectedDevice) {
      console.error('No device connected');
      return;
    }

    console.log('Subscribing to telemetry notifications...');
    this.telemetrySubscription = this.connectedDevice.monitorCharacteristicForService(
      PAO_SERVICE_UUID,
      TELEMETRY_CHAR_UUID,
      (error: BleError | null, characteristic: any) => {
        if (error) {
          console.error('Telemetry subscription error:', error);
          useAppStore.getState().setError(`Telemetry error: ${error.message}`);
          return;
        }

        if (characteristic?.value) {
          try {
            const telemetry = decodeTelemetry(characteristic.value);
            callback(telemetry);
            useAppStore.getState().setTelemetry(telemetry);
            useAppStore.getState().setError(null);
          } catch (decodeError: any) {
            console.error('Telemetry decode error:', decodeError);
            useAppStore.getState().setError(`Decode error: ${decodeError.message}`);
          }
        }
      }
    );
  }

  /**
   * Subscribe to charger config notifications
   * @param callback - Called when charger config changes
   */
  subscribeToChargerNotifications(callback: (config: ChargerConfig) => void): void {
    if (!this.connectedDevice) {
      console.error('No device connected');
      return;
    }

    console.log('Subscribing to charger notifications...');
    this.chargerSubscription = this.connectedDevice.monitorCharacteristicForService(
      PAO_SERVICE_UUID,
      CHARGER_CHAR_UUID,
      (error: BleError | null, characteristic: any) => {
        if (error) {
          console.error('Charger subscription error:', error);
          return;
        }

        if (characteristic?.value) {
          try {
            const config = decodeChargerConfig(characteristic.value);
            callback(config);
            useAppStore.getState().setChargerConfig(config);
          } catch (decodeError: any) {
            console.error('Charger config decode error:', decodeError);
          }
        }
      }
    );
  }

  /**
   * Write gear command to device
   * @param gear - Gear enum value
   */
  async writeGearCommand(gear: Gear): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log(`Writing gear command: ${gear}`);
    const encoded = encodeGearCommand(gear);

    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        PAO_SERVICE_UUID,
        GEAR_CHAR_UUID,
        encoded
      );
      console.log('Gear command written successfully');
    } catch (error: any) {
      console.error('Gear command write error:', error);
      throw error;
    }
  }

  /**
   * Subscribe to speed unit notifications from peripheral
   */
  subscribeToSpeedUnit(): void {
    if (!this.connectedDevice) return;
    this.speedUnitSubscription = this.connectedDevice.monitorCharacteristicForService(
      PAO_SERVICE_UUID,
      SPEED_UNIT_CHAR_UUID,
      (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          const buf = Buffer.from(characteristic.value, 'base64');
          const unit = buf[0] === 0 ? 'kmh' : 'mph';
          useAppStore.getState().setSpeedUnit(unit);
        }
      },
    );
  }

  /**
   * Subscribe to media command notifications from peripheral (Spotify screen)
   * @param callback - Called with the raw command byte when a notification arrives
   */
  subscribeToMediaCommands(callback: (cmd: number) => void): void {
    if (!this.connectedDevice) return;
    this.mediaCmdSubscription = this.connectedDevice.monitorCharacteristicForService(
      PAO_SERVICE_UUID,
      MEDIA_CMD_CHAR_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const buf = Buffer.from(characteristic.value, 'base64');
        if (buf.length >= 1) callback(buf[0]);
      },
    );
  }

  /**
   * Write speed unit preference to peripheral
   * @param unit - 'kmh' (0) or 'mph' (1)
   */
  async writeSpeedUnit(unit: 'kmh' | 'mph'): Promise<void> {
    if (!this.connectedDevice) throw new Error('No device connected');
    const buf = Buffer.alloc(1);
    buf.writeUInt8(unit === 'kmh' ? 0 : 1, 0);
    await this.connectedDevice.writeCharacteristicWithResponseForService(
      PAO_SERVICE_UUID,
      SPEED_UNIT_CHAR_UUID,
      buf.toString('base64'),
    );
  }

  /**
   * Read charger configuration from device
   */
  async readChargerConfig(): Promise<ChargerConfig> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log('Reading charger config...');
    const characteristic = await this.connectedDevice.readCharacteristicForService(
      PAO_SERVICE_UUID,
      CHARGER_CHAR_UUID
    );

    if (!characteristic.value) {
      throw new Error('No charger config data received');
    }

    const config = decodeChargerConfig(characteristic.value);
    useAppStore.getState().setChargerConfig(config);
    return config;
  }

  /**
   * Write charger configuration to device
   * @param config - Charger configuration to write
   */
  async writeChargerConfig(
    config: Omit<ChargerConfig, 'actualVoltageV' | 'actualCurrentA' | 'chargeErrorState'>
  ): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    console.log('Writing charger config:', config);
    const encoded = encodeChargerConfig(config);

    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        PAO_SERVICE_UUID,
        CHARGER_CHAR_UUID,
        encoded
      );
      console.log('Charger config written successfully');
    } catch (error: any) {
      console.error('Charger config write error:', error);
      throw error;
    }
  }

  // ── Phase 1 dial: firmware-version primitives ──────────────────────────
  //
  // The dial exposes its currently-running firmware version on
  // PAO_FW_VERSION_CHAR_UUID (`ff250001-…`) — Read + Notify. The 4-byte LE
  // payload is byte-identical to charger 0xFF25, so we reuse the shared
  // `decodeFirmwareVersion` decoder (Decision #61 B-3 — no parallel decoder).
  //
  // The store field `dialFirmwareVersion` is intentionally NOT cleared on
  // disconnect (mirrors the charger pattern in Decision #44) — wiping it on
  // every transient drop would flicker the Settings row to "—" on every
  // reconnect. A fresh read on next connect overwrites it.

  /**
   * Read the dial firmware version characteristic and push the decoded semver
   * to the store. Used by the OTA orchestrator (after post-OTA reconnect) and
   * by `connect()` for initial seeding. Returns the decoded version (or null
   * on failure / decode error). Best-effort — failures don't disturb the
   * connection.
   */
  async readDialFirmwareVersion(): Promise<string | null> {
    if (!this.connectedDevice) return null;
    try {
      const ch = await this.connectedDevice.readCharacteristicForService(
        PAO_SERVICE_UUID,
        PAO_FW_VERSION_CHAR_UUID,
      );
      const ver = decodeFirmwareVersion(ch.value);
      if (ver) {
        console.log(
          `[PaoBle] firmwareVersion read b64=${ch.value} decoded=${ver}`,
        );
        useAppStore.getState().setDialFirmwareVersion(ver);
        return ver;
      }
      console.warn(
        '[PaoBle] firmwareVersion read returned an unrecognised payload',
      );
      return null;
    } catch (e) {
      console.warn('[PaoBle] readDialFirmwareVersion failed:', e);
      return null;
    }
  }

  /**
   * Subscribe to live notifications on PAO_FW_VERSION_CHAR_UUID. Firmware
   * notifies once on connect (Bart's Phase 1) and again post-OTA reboot when
   * the new image comes up — so this catches both the initial state and the
   * post-flash version flip without forcing a re-connect cycle.
   */
  subscribeToDialFirmwareVersion(): void {
    if (!this.connectedDevice) return;
    // Defensive: if a prior subscription is still around (e.g. stale state
    // from a half-torn-down reconnect), drop it before re-monitoring.
    this.fwVersionSubscription?.remove();
    this.fwVersionSubscription =
      this.connectedDevice.monitorCharacteristicForService(
        PAO_SERVICE_UUID,
        PAO_FW_VERSION_CHAR_UUID,
        (error: BleError | null, characteristic: any) => {
          if (error) {
            // Suppress noise on the disconnect that fires when the dial reboots
            // as part of the OTA flow — that disconnect is the protocol signal,
            // not an error worth shouting about.
            const otaPhase = useAppStore.getState().ota.dial.state;
            if (otaPhase !== 'rebooting' && otaPhase !== 'reconnecting') {
              console.warn(
                `[PaoBle] firmwareVersion notify error: ${error.message}`,
              );
            }
            return;
          }
          if (characteristic?.value) {
            const ver = decodeFirmwareVersion(characteristic.value);
            if (ver) {
              console.log(
                `[PaoBle] firmwareVersion notify b64=${characteristic.value} decoded=${ver}`,
              );
              useAppStore.getState().setDialFirmwareVersion(ver);
            }
          }
        },
      );
  }

  // ── Phase 5 dial: OTA primitives ────────────────────────────────────────
  //
  // Mirrors the OTA API surface on `ChargerBleManager`. The wire contract is
  // byte-identical (cmd codes, status codes, payload shapes — see Decision
  // #52 / dial-phase5-ota-firmware) so `firmwareTransfer.ts` and
  // `otaOrchestrator.ts` can drive both targets through a single profile-
  // dispatched interface. The only thing that differs is which characteristic
  // UUIDs we write to / monitor.

  /**
   * Returns the connected dial device. Mirrors
   * `ChargerBleManager.getConnectedDevice()` — used by the OTA orchestrator's
   * reconnect path. Caller MUST refetch after a disconnect (the Device proxy
   * is unsafe across reconnects).
   */
  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  /**
   * Returns true if currently connected to a dial device.
   */
  isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  /**
   * Request MTU 517 (BLE spec max). The dial firmware sets MTU=517 in
   * `paoService.begin()` (Decision #58 point 5) — the actual negotiated value
   * is whichever the central + peripheral both accept (Android typically lands
   * on 247, iOS on ~185). Returns the negotiated MTU; falls back to 23 if the
   * platform doesn't support `requestMTU` (iOS auto-negotiates).
   */
  async requestOtaMtu(): Promise<number> {
    if (!this.connectedDevice) {
      throw new Error('PaoBle: Not connected');
    }
    try {
      console.log('[ota] requesting dial MTU 517 on device', this.connectedDevice.id);
      const updated = await this.connectedDevice.requestMTU(517);
      const rawMtu = (updated as any)?.mtu;
      const mtu = rawMtu ?? 23;
      console.log('[ota] negotiated dial MTU:', mtu, '(raw=', rawMtu, ')');
      return mtu;
    } catch (e) {
      console.warn('[OTA] requestMTU (dial) failed, falling back to 23:', e);
      return 23;
    }
  }

  /**
   * Subscribe to the dial OTA status notify pipe (`ff270001-…`). 5-byte
   * payload `[code:u8][bytesReceived:u32 LE]`. Returns the subscription so
   * the caller can manage its lifecycle (the orchestrator re-subscribes on
   * the new device after a post-OTA reconnect). Intentionally NOT added to
   * `this.subscriptions` for that reason.
   */
  subscribeOtaStatus(
    handler: (code: number, bytesReceived: number) => void,
  ): Subscription {
    if (!this.connectedDevice) {
      throw new Error('PaoBle: Not connected');
    }
    return this.connectedDevice.monitorCharacteristicForService(
      PAO_SERVICE_UUID,
      PAO_OTA_STATUS_CHAR_UUID,
      (error: BleError | null, characteristic: any) => {
        if (error) {
          // EOF / cancellation surfaces here on disconnect — expected mid-OTA
          // when the dial reboots. The orchestrator's disconnect listener is
          // the authoritative "reboot happened" signal.
          if (!error.message?.includes('cancelled')) {
            console.warn(`[OTA] dial status monitor error: ${error.message}`);
          }
          return;
        }
        if (!characteristic?.value) return;
        const bytes = Buffer.from(characteristic.value, 'base64');
        if (bytes.length < 5) {
          console.warn(`[OTA] short dial status payload: ${bytes.length} bytes`);
          return;
        }
        const code = bytes[0];
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        const bytesReceived = view.getUint32(1, true);
        handler(code, bytesReceived);
      },
    );
  }

  /**
   * Write an OTA command to the dial dispatcher (`ff050001-…`) with an
   * optional payload. Format on the wire: `[cmd: u8, ...payload]`. Uses
   * write-with-response — the dial ACKs the write before we proceed.
   *
   * The 38-byte OTA_BEGIN payload (cmd + 4-byte size + 32-byte sha256) is
   * the binding constraint on MTU; firmwareTransfer.ts fails fast if the
   * negotiated MTU is too small.
   */
  async writeOtaCommand(cmd: number, payload?: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('PaoBle: Not connected');
    }
    const len = 1 + (payload?.byteLength ?? 0);
    const buf = Buffer.alloc(len);
    buf[0] = cmd;
    if (payload) {
      buf.set(payload, 1);
    }
    if (cmd === PAO_CMD_OTA_BEGIN) {
      console.log('[ota] writing dial OTA_BEGIN, bytes:', buf.length);
    } else {
      console.log(`[ota] writing dial OTA cmd=${cmd}, bytes:`, buf.length);
    }
    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        PAO_SERVICE_UUID,
        PAO_OTA_DISPATCH_CHAR_UUID,
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
      if (cmd === PAO_CMD_OTA_BEGIN) {
        console.log('[ota] dial OTA_BEGIN write failed:', JSON.stringify(detail));
      } else {
        console.log(`[ota] dial OTA cmd=${cmd} write failed:`, JSON.stringify(detail));
      }
      throw err;
    }
  }

  /**
   * Write a single OTA data chunk to `ff260001-…` (WRITE_NR). Hot path —
   * the windowing protocol on top (see firmwareTransfer.ts) catches up with
   * ACKs every WINDOW_SIZE chunks via the status pipe.
   */
  async writeOtaChunk(chunk: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('PaoBle: Not connected');
    }
    const buf = Buffer.from(chunk);
    await this.connectedDevice.writeCharacteristicWithoutResponseForService(
      PAO_SERVICE_UUID,
      PAO_OTA_DATA_CHAR_UUID,
      buf.toString('base64'),
    );
  }

  /**
   * Read the dial firmware version and return the decoded semver string.
   * Used by the OTA orchestrator after the post-OTA reconnect to confirm the
   * new image booted before sending CMD_OTA_VERIFY. Wraps
   * `readDialFirmwareVersion` to expose the same `readFirmwareVersion()` name
   * as the charger manager — orchestrator-side dispatch stays uniform.
   */
  async readFirmwareVersion(): Promise<string | null> {
    return this.readDialFirmwareVersion();
  }

  /**
   * Wire up post-connect subscriptions used by the OTA orchestrator after a
   * post-OTA reconnect. Mirrors `ChargerBleManager.wirePostConnectSubscriptions()`.
   * For the dial we don't have the same broad telemetry-seed pattern (the
   * existing `connect()` path drives speed unit + firmware version directly),
   * so this is just re-establishing the firmware-version notify subscription.
   * Idempotent — `subscribeToDialFirmwareVersion()` removes any prior sub
   * before re-monitoring.
   */
  wirePostConnectSubscriptions(): void {
    if (!this.connectedDevice) {
      console.warn('[PaoBle] wirePostConnectSubscriptions: no device');
      return;
    }
    this.subscribeToDialFirmwareVersion();
    // Re-seed firmware version with an explicit read in case the device
    // wasn't ready to notify yet at reconnect moment.
    this.readDialFirmwareVersion().catch(() => {});
  }

  /**
   * Disconnect from the current device
   */
  async disconnect(): Promise<void> {
    this.unsubscribeAll();

    if (this.connectedDevice) {
      console.log('Disconnecting from device...');
      await this.manager.cancelDeviceConnection(this.connectedDevice.id);
      this.connectedDevice = null;
    }

    useAppStore.getState().setBleStatus('disconnected');
    useAppStore.getState().setDeviceId(null);
    useAppStore.getState().setTelemetry(null);
    useAppStore.getState().setChargerConfig(null);
  }

  /**
   * Check if BLE is powered on
   */
  async isBlePoweredOn(): Promise<boolean> {
    const state = await this.manager.state();
    return state === State.PoweredOn;
  }

  /**
   * Get current BLE state
   */
  async getBleState(): Promise<State> {
    return await this.manager.state();
  }

  /**
   * Setup disconnect handler for reconnection
   */
  private setupDisconnectHandler(deviceId: string): void {
    this.disconnectSubscription?.remove();

    this.disconnectSubscription = this.manager.onDeviceDisconnected(
      deviceId,
      (error: BleError | null, device: Device | null) => {
        console.log('Device disconnected:', device?.name);
        if (error) {
          console.error('Disconnect error:', error);
        }

        this.unsubscribeAll();
        this.connectedDevice = null;

        useAppStore.getState().setBleStatus('disconnected');
        useAppStore.getState().setDeviceId(null);
        useAppStore.getState().setTelemetry(null);
        useAppStore.getState().setError('Device disconnected');
      }
    );
  }

  /**
   * Unsubscribe from all notifications
   */
  private unsubscribeAll(): void {
    this.telemetrySubscription?.remove();
    this.telemetrySubscription = null;

    this.chargerSubscription?.remove();
    this.chargerSubscription = null;

    this.speedUnitSubscription?.remove();
    this.speedUnitSubscription = null;

    this.mediaCmdSubscription?.remove();
    this.mediaCmdSubscription = null;

    // Phase 1 dial: tear down firmware-version notify. The store value
    // (dialFirmwareVersion) is intentionally NOT cleared here — it's a
    // persisted "last-known" value (mirrors charger pattern, Decision #44).
    this.fwVersionSubscription?.remove();
    this.fwVersionSubscription = null;

    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }
}

// Singleton instance
export const paoBleManager = new PaoBleManager();
