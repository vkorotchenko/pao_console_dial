import {create} from 'zustand';
import {BleStatus, Telemetry, ChargerConfig} from '../types';

interface AppState {
  // BLE connection state
  bleStatus: BleStatus;
  deviceId: string | null;
  error: string | null;

  // Data from BLE
  telemetry: Telemetry | null;
  chargerConfig: ChargerConfig | null;

  // Actions
  setBleStatus: (status: BleStatus) => void;
  setDeviceId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setTelemetry: (data: Telemetry | null) => void;
  setChargerConfig: (config: ChargerConfig | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>(set => ({
  // Initial state
  bleStatus: 'disconnected',
  deviceId: null,
  error: null,
  telemetry: null,
  chargerConfig: null,

  // Actions
  setBleStatus: status => set({bleStatus: status}),
  setDeviceId: id => set({deviceId: id}),
  setError: error => set({error}),
  setTelemetry: data => set({telemetry: data}),
  setChargerConfig: config => set({chargerConfig: config}),
  reset: () =>
    set({
      bleStatus: 'disconnected',
      deviceId: null,
      error: null,
      telemetry: null,
      chargerConfig: null,
    }),
}));
