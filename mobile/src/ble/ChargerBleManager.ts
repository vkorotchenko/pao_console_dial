import {Device, BleError, Subscription} from 'react-native-ble-plx';
import {sharedBleManager} from './bleInstance';
import {Buffer} from 'buffer';
import {useAppStore} from '../store/useAppStore';
import {ChargerDirectData, ChargeState} from '../types';
import {decodeCharValue} from './decodeCharValue';

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

// On/off characteristic (Write-with-response, 1 byte: 0x01=on, 0x00=off)
const CHAR_ON_OFF         = '0000ff06-0000-1000-8000-00805f9b34fb';

// Firmware version characteristic (Read + Notify, 4 bytes little-endian: [major, minor, patch, build])
const CHAR_FW_VERSION     = '0000ff25-0000-1000-8000-00805f9b34fb';

// ── OTA characteristics (Phase 5) ───────────────────────────────────────────
// 0xFF26: WRITE_WITHOUT_RESPONSE — chunked firmware bytes. We rely on the
// BLE link-layer framing here, with a small windowing protocol on top
// (16 chunks then wait for an ACK on 0xFF27) to avoid drowning the ESP32
// write queue.
const CHAR_OTA_DATA       = '0000ff26-0000-1000-8000-00805f9b34fb';
// 0xFF27: NOTIFY-only status pipe. 5-byte payload:
// [status_code: u8][bytes_received: u32 LE]. Status codes are documented in
// services/firmwareTransfer.ts.
const CHAR_OTA_STATUS     = '0000ff27-0000-1000-8000-00805f9b34fb';

// OTA command opcodes (write to existing CHAR_CONFIG_CMD = 0xFF05).
// The cmd byte is followed by an opcode-specific payload; the firmware
// dispatches based on byte[0]. Empty payload = just write the cmd byte.
export const CMD_OTA_BEGIN  = 10; // payload: 4-byte LE total_size + 32-byte SHA256 (binary, NOT hex)
export const CMD_OTA_END    = 11; // payload: empty
export const CMD_OTA_ABORT  = 12; // payload: empty
export const CMD_OTA_VERIFY = 13; // payload: empty (post-reconnect verify gate)

/**
 * Decode the 4-byte firmware version payload (little-endian) to the canonical
 * bare semver string (no "v" prefix — the prefix is a display-time concern,
 * applied by `formatVersion()` at render time).
 * Format: [major, minor, patch, build] → "MAJOR.MINOR.PATCH+BUILD"
 *         When build == 0, render as "MAJOR.MINOR.PATCH".
 * Returns null if the payload is missing or shorter than 4 bytes.
 *
 * History: previously returned "vMAJOR.MINOR.PATCH..." which produced the
 * "vv0.0.0" double-prefix bug when UI sites also prepended "v" at render
 * time. Storage is now bare so that `compare()` in semver.ts works directly
 * against `latestReleaseVersion` (also bare, e.g. "0.1.0").
 */
function decodeFirmwareVersion(base64Value: string | null | undefined): string | null {
  if (!base64Value) return null;
  const bytes = Buffer.from(base64Value, 'base64');
  if (bytes.length < 4) return null;
  const major = bytes[0];
  const minor = bytes[1];
  const patch = bytes[2];
  const build = bytes[3];
  const base = `${major}.${minor}.${patch}`;
  return build === 0 ? base : `${base}+${build}`;
}

function logBleRead(label: string, value: string | null | undefined, divisor = 1): void {
  if (!value) { console.log(`[BleInit] ${label}: FAILED/NULL`); return; }
  const raw = decodeCharValue(value);
  console.log(`[BleInit] ${label}: b64=${value} decoded=${raw} final=${(raw / divisor).toFixed(2)}`);
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
      console.log('[BleManager] connected device=' + device.id);

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
    monitor(CHAR_CURRENT_VOLTAGE, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] currentVoltageV b64=${raw} decoded=${v} final=${(v/10).toFixed(1)}`);
      return { currentVoltageV: v / 10 };
    });

    monitor(CHAR_CURRENT_AMPS, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] currentAmpsA b64=${raw} decoded=${v} final=${(v/10).toFixed(1)}`);
      return { currentAmpsA: v / 10 };
    });

    monitor(CHAR_RUNNING_TIME, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] runningTime b64=${raw} decoded=${v}`);
      return { runningTimeSeconds: v };
    });

    monitor(CHAR_CHARGE_STATE, raw => {
      const v = decodeCharValue(raw);
      // Firmware convention: 0 = actively charging (isCharging && chargerEnabled),
      // 1 = not charging (stopped, idle, or timer expired).
      const chargeState = v === 0 ? ChargeState.CHARGING : ChargeState.STOPPED;
      console.log(`[BleNotify] chargeState b64=${raw} decoded=${v} mapped=${chargeState}`);
      return { chargeState };
    });

    monitor(CHAR_SOC_PERCENT, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] socPercent b64=${raw} decoded=${v}`);
      return { socPercent: v };
    });

    monitor(CHAR_ERROR_STATE, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] errorState b64=${raw} decoded=${v} bits=0b${v.toString(2).padStart(8,'0')}`);
      return { errorState: v };
    });

    // Firmware version (0xFF25): subscribe to notifications so a charger firmware
    // hot-swap or post-OTA reboot updates the displayed version without a reconnect.
    // The decoded value is pushed directly to the store rather than through
    // ChargerDirectData — firmwareVersion lives in its own persisted slice.
    if (this.connectedDevice) {
      const fwSub = this.connectedDevice.monitorCharacteristicForService(
        CHARGER_SERVICE_UUID,
        CHAR_FW_VERSION,
        (error: BleError | null, characteristic: any) => {
          if (error) {
            console.error(`ChargerBle monitor error (${CHAR_FW_VERSION}):`, error);
            return;
          }
          if (characteristic?.value) {
            const ver = decodeFirmwareVersion(characteristic.value);
            console.log(`[BleNotify] firmwareVersion b64=${characteristic.value} decoded=${ver}`);
            if (ver) {
              useAppStore.getState().setChargerFirmwareVersion(ver);
            }
          }
        },
      );
      this.subscriptions.push(fwSub);
    }
  }

  /**
   * Subscribe to write-back echo notifications from the config characteristics.
   * Call this ONLY after flashing firmware with GATTADDCHAR MAX_LEN=5 for 0xFF01/02/03.
   * Requires the nRF51822 CCCD budget — do not call alongside subscribeToAll on old firmware.
   */
  subscribeToConfigEcho(onData: (data: Partial<ChargerDirectData>) => void): void {
    if (!this.connectedDevice) return;

    const monitor = (charUUID: string, handler: (raw: string) => Partial<ChargerDirectData>): void => {
      const sub = this.connectedDevice!.monitorCharacteristicForService(
        CHARGER_SERVICE_UUID,
        charUUID,
        (error: BleError | null, characteristic: any) => {
          if (error) { console.error(`ChargerBle cfg echo error (${charUUID}):`, error); return; }
          if (characteristic?.value) {
            try { onData(handler(characteristic.value)); } catch (e: any) { console.error(`ChargerBle cfg echo decode error (${charUUID}):`, e); }
          }
        },
      );
      this.subscriptions.push(sub);
    };

    monitor(CHAR_MAX_CURRENT, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] cfgMaxCurrentA b64=${raw} decoded=${v} final=${(v/10).toFixed(1)}`);
      return { cfgMaxCurrentA: v / 10 };
    });
    monitor(CHAR_TARGET_PCT, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] cfgTargetSocPct b64=${raw} decoded=${v} final=${(v/10).toFixed(1)}`);
      return { cfgTargetSocPct: v / 10 };
    });
    monitor(CHAR_MAX_TIME, raw => {
      const v = decodeCharValue(raw);
      console.log(`[BleNotify] cfgMaxTimeSec b64=${raw} decoded=${v}`);
      return { cfgMaxTimeSec: v };
    });
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
      this.connectedDevice.readCharacteristicForService(CHARGER_SERVICE_UUID, CHAR_FW_VERSION),
    ]);
    const [cs, soc, err, nomV, maxM, minM, absMax, absMin, tVolt, tAmp, fwVer] = reads;
    // Firmware version lives in its own persisted store slice (not ChargerDirectData),
    // so push it directly rather than returning it in the partial.
    // Diagnostic logging covers all three failure modes so the bug doesn't
    // recur silently: (a) read rejected, (b) read fulfilled but value empty,
    // (c) decode produced null.
    if (fwVer.status === 'fulfilled') {
      if (fwVer.value?.value) {
        const ver = decodeFirmwareVersion(fwVer.value.value);
        console.log(`[BleInit] firmwareVersion b64=${fwVer.value.value} decoded=${ver}`);
        if (ver) {
          useAppStore.getState().setChargerFirmwareVersion(ver);
        } else {
          console.warn('[BleInit] firmwareVersion: decode returned null — payload too short or corrupt');
        }
      } else {
        console.warn('[BleInit] firmwareVersion: read fulfilled but value is empty');
      }
    } else {
      console.warn('[BleInit] firmwareVersion: read REJECTED', fwVer.reason);
    }
    logBleRead('targetVoltageV',  tVolt.status==='fulfilled' ? tVolt.value?.value : null, 10);
    logBleRead('targetAmpsA',     tAmp.status==='fulfilled'  ? tAmp.value?.value  : null, 10);
    logBleRead('absoluteMaxV',    absMax.status==='fulfilled'? absMax.value?.value : null, 10);
    logBleRead('absoluteMinV',    absMin.status==='fulfilled'? absMin.value?.value : null, 10);
    logBleRead('maxMultiplier',   maxM.status==='fulfilled'  ? maxM.value?.value  : null, 100);
    logBleRead('minMultiplier',   minM.status==='fulfilled'  ? minM.value?.value  : null, 100);
    logBleRead('nominalVoltageV', nomV.status==='fulfilled'  ? nomV.value?.value  : null, 10);
    logBleRead('chargeState',     cs.status==='fulfilled'    ? cs.value?.value    : null);
    logBleRead('errorState',      err.status==='fulfilled'   ? err.value?.value   : null);
    return {
      ...(cs.status === 'fulfilled' && cs.value?.value ? { chargeState: decodeCharValue(cs.value.value) === 0 ? ChargeState.CHARGING : ChargeState.STOPPED } : {}),
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
    // 0xFF06 on/off: single byte, 0x01=enable, 0x00=disable.
    // Firmware bleOnOffCallback reads data[0] directly.
    const buf = Buffer.alloc(1);
    buf[0] = enabled ? 1 : 0;
    await this.writeChar(CHAR_ON_OFF, buf);
  }

  async writeResetToDefaults(): Promise<void> {
    await this.writeConfigCmd(5, 0);
  }

  // ── Phase 5 — OTA primitives ──────────────────────────────────────────────
  // Low-level, transport-only. The orchestration / windowed protocol /
  // reconnect / verify lives in services/firmwareTransfer.ts and
  // services/otaOrchestrator.ts. The manager only knows how to push bytes
  // and watch the status pipe.

  /**
   * Returns the current connected device, for the OTA orchestrator's reconnect
   * flow (it needs to monitor disconnect signals on the *new* device after a
   * reboot, and re-subscribe to characteristics on it). The orchestrator must
   * not retain this reference across a disconnect — fetch it fresh post-reconnect.
   */
  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  /**
   * Request MTU 517 — the max permitted by the BLE spec. The actual negotiated
   * MTU depends on what the central + peripheral agree on (Android typically
   * lands on 247, iOS auto-negotiates around 185). We always ask for the max
   * and use whatever we get.
   *
   * On iOS this is a no-op at the API level (the OS auto-negotiates), so we
   * can't pass MTU through and `requestMTU` resolves with whatever it knows.
   * Returns the negotiated MTU, falling back to 23 (the BLE spec default) if
   * the call isn't supported or fails — chunkSize then becomes 20, which is
   * slow but always safe.
   */
  async requestOtaMtu(): Promise<number> {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: Not connected');
    }
    try {
      const updated = await this.connectedDevice.requestMTU(517);
      // The Device proxy exposes the negotiated MTU on the returned object.
      // If unavailable, default to 23 — the BLE spec minimum.
      const mtu = (updated as any)?.mtu ?? 23;
      console.log(`[OTA] negotiated MTU=${mtu} (chunkSize=${Math.max(20, mtu - 3)})`);
      return mtu;
    } catch (e) {
      console.warn('[OTA] requestMTU failed, falling back to 23:', e);
      return 23;
    }
  }

  /**
   * Subscribe to the OTA status notify pipe (0xFF27). The 5-byte payload is
   * [status_code: u8][bytes_received: u32 LE]; we parse and forward to the
   * caller. Subscription lifetime is owned by the caller — call .remove() on
   * the returned object when done. We DON'T add this subscription to
   * `this.subscriptions` because the orchestrator needs to manage its
   * lifecycle independently of normal connect/disconnect (and re-subscribe
   * on the new device after reconnect).
   */
  subscribeOtaStatus(
    handler: (code: number, bytesReceived: number) => void,
  ): Subscription {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: Not connected');
    }
    return this.connectedDevice.monitorCharacteristicForService(
      CHARGER_SERVICE_UUID,
      CHAR_OTA_STATUS,
      (error: BleError | null, characteristic: any) => {
        if (error) {
          // EOF / cancellation surfaces here on disconnect — that's expected
          // mid-OTA (the charger reboots). The orchestrator's disconnect
          // listener handles the actual state transition.
          if (!error.message?.includes('cancelled')) {
            console.warn(`[OTA] status monitor error: ${error.message}`);
          }
          return;
        }
        if (!characteristic?.value) return;
        const bytes = Buffer.from(characteristic.value, 'base64');
        if (bytes.length < 5) {
          console.warn(`[OTA] short status payload: ${bytes.length} bytes`);
          return;
        }
        const code = bytes[0];
        // u32 little-endian — DataView handles alignment cleanly.
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const bytesReceived = view.getUint32(1, true);
        handler(code, bytesReceived);
      },
    );
  }

  /**
   * Write an OTA command to the cmd dispatcher characteristic (0xFF05) with
   * an optional payload. Format on the wire: [cmd: u8, ...payload]. Uses
   * write-with-response for reliability (the charger ACKs the write before
   * we proceed to the next state).
   */
  async writeOtaCommand(cmd: number, payload?: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: Not connected');
    }
    const len = 1 + (payload?.byteLength ?? 0);
    const buf = Buffer.alloc(len);
    buf[0] = cmd;
    if (payload) {
      buf.set(payload, 1);
    }
    await this.connectedDevice.writeCharacteristicWithResponseForService(
      CHARGER_SERVICE_UUID,
      CHAR_CONFIG_CMD,
      buf.toString('base64'),
    );
  }

  /**
   * Write a single OTA data chunk to 0xFF26 with no link-layer ACK — this is
   * the hot path. With windowing on top (see firmwareTransfer.ts), we trade
   * per-chunk ACK reliability for bulk throughput, then catch up on the
   * status pipe every 16 chunks.
   */
  async writeOtaChunk(chunk: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('ChargerBle: Not connected');
    }
    const buf = Buffer.from(chunk);
    await this.connectedDevice.writeCharacteristicWithoutResponseForService(
      CHARGER_SERVICE_UUID,
      CHAR_OTA_DATA,
      buf.toString('base64'),
    );
  }

  /**
   * Read the firmware version characteristic and return the decoded semver
   * string ("MAJOR.MINOR.PATCH" or "MAJOR.MINOR.PATCH+BUILD"). Used by the
   * OTA orchestrator after reconnect to confirm the new image booted before
   * sending CMD_OTA_VERIFY.
   */
  async readFirmwareVersion(): Promise<string | null> {
    if (!this.connectedDevice) return null;
    try {
      const ch = await this.connectedDevice.readCharacteristicForService(
        CHARGER_SERVICE_UUID,
        CHAR_FW_VERSION,
      );
      return decodeFirmwareVersion(ch.value);
    } catch (e) {
      console.warn('[OTA] readFirmwareVersion failed:', e);
      return null;
    }
  }

  /**
   * Disconnect from the charger and clean up all subscriptions.
   *
   * NOTE: chargerFirmwareVersion is intentionally NOT cleared here. It's a
   * persisted "last-known" value — wiping it on every disconnect (including
   * transient drops) defeats the purpose of persisting it and causes the
   * Settings "Firmware" row to flip to "—" on every reconnect. It's
   * overwritten only when a fresh read on next connect returns a real value.
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
        // NOTE: chargerFirmwareVersion intentionally NOT cleared — see
        // disconnect() above. Keeping the last-known value avoids the
        // "Firmware: —" flicker on transient disconnects and makes the
        // persisted version actually useful across reconnects.
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
