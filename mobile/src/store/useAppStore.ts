import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {BleStatus, Telemetry, ChargerConfig} from '../types';

interface AppState {
  // BLE connection state
  bleStatus: BleStatus;
  deviceId: string | null;
  error: string | null;

  // Data from BLE
  telemetry: Telemetry | null;
  chargerConfig: ChargerConfig | null;

  // Persisted settings
  showGearTab: boolean;
  speedUnit: 'kmh' | 'mph';

  // Actions
  setBleStatus: (status: BleStatus) => void;
  setDeviceId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setTelemetry: (data: Telemetry | null) => void;
  setChargerConfig: (config: ChargerConfig | null) => void;
  setShowGearTab: (show: boolean) => void;
  setSpeedUnit: (unit: 'kmh' | 'mph') => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      // Initial state
      bleStatus: 'disconnected',
      deviceId: null,
      error: null,
      telemetry: null,
      chargerConfig: null,
      showGearTab: false,
      speedUnit: 'kmh',

      // Actions
      setBleStatus: status => set({bleStatus: status}),
      setDeviceId: id => set({deviceId: id}),
      setError: error => set({error}),
      setTelemetry: data => set({telemetry: data}),
      setChargerConfig: config => set({chargerConfig: config}),
      setShowGearTab: show => set({showGearTab: show}),
      setSpeedUnit: unit => set({speedUnit: unit}),
      reset: () =>
        set({
          bleStatus: 'disconnected',
          deviceId: null,
          error: null,
          telemetry: null,
          chargerConfig: null,
        }),
    }),
    {
      name: 'pao-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        showGearTab: state.showGearTab,
        speedUnit: state.speedUnit,
      }),
    },
  ),
);
