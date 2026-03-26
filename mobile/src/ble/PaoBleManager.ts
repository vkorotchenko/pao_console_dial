import {BleManager, Device, BleError, Subscription, State} from 'react-native-ble-plx';
import {Platform} from 'react-native';
import {useAppStore} from '../store/useAppStore';
import {
  decodeTelemetry,
  encodeGearCommand,
  decodeChargerConfig,
  encodeChargerConfig,
} from './packets';
import {Gear, ChargerConfig} from '../types';

const PAO_SERVICE_UUID = 'c909d45a-0560-4725-85e7-c20a9bbb74c2';
const TELEMETRY_CHAR_UUID = 'c169df83-5127-46df-a18b-066672243018';
const GEAR_CHAR_UUID = 'b2b08d43-7ec9-40c4-add2-a3a899756607';
const CHARGER_CHAR_UUID = '06ad7ea2-24cc-46fe-b791-78167b76693e';
const DEVICE_NAME = 'PAO Console';

export class PaoBleManager {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private telemetrySubscription: Subscription | null = null;
  private chargerSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  /**
   * Scan for PAO Console devices
   * @param onDeviceFound - Callback when device is found
   */
  async scan(onDeviceFound: (device: Device) => void): Promise<void> {
    useAppStore.getState().setBleStatus('scanning');

    this.manager.startDeviceScan(
      [PAO_SERVICE_UUID],
      null,
      (error: BleError | null, device: Device | null) => {
        if (error) {
          console.error('Scan error:', error);
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

    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }
}

// Singleton instance
export const paoBleManager = new PaoBleManager();
