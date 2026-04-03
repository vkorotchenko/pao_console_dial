import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {BleStatus, Telemetry, ChargerConfig, ChargerDirectData} from '../types';

interface AppState {
  // BLE connection state (peripheral)
  bleStatus: BleStatus;
  deviceId: string | null;
  error: string | null;

  // BLE connection state (charger direct)
  chargerBleStatus: BleStatus;
  chargerDeviceId: string | null;
  chargerError: string | null;

  // Data from BLE
  telemetry: Telemetry | null;
  chargerConfig: ChargerConfig | null;
  chargerData: ChargerDirectData | null;

  // Scan trigger — incrementing forces the unified scan effect to re-run
  // even when bleStatus / chargerBleStatus haven't changed value.
  scanTrigger: number;

  // Persisted settings
  showGearTab: boolean;
  speedUnit: 'kmh' | 'mph';
  hudAutoBrighten: boolean;
  hudBrightenOnlyWhenCharging: boolean;

  // Actions (peripheral)
  setBleStatus: (status: BleStatus) => void;
  setDeviceId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setTelemetry: (data: Telemetry | null) => void;
  setChargerConfig: (config: ChargerConfig | null) => void;

  // Actions (charger direct)
  setChargerBleStatus: (s: BleStatus) => void;
  setChargerDeviceId: (id: string | null) => void;
  setChargerError: (e: string | null) => void;
  setChargerData: (d: ChargerDirectData | null) => void;

  // Actions (scan trigger)
  incrementScanTrigger: () => void;

  // Actions (settings)
  setShowGearTab: (show: boolean) => void;
  setSpeedUnit: (unit: 'kmh' | 'mph') => void;
  setHudAutoBrighten: (v: boolean) => void;
  setHudBrightenOnlyWhenCharging: (v: boolean) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      // Initial state — peripheral
      bleStatus: 'disconnected',
      deviceId: null,
      error: null,
      telemetry: null,
      chargerConfig: null,

      // Initial state — charger direct
      chargerBleStatus: 'disconnected',
      chargerDeviceId: null,
      chargerError: null,
      chargerData: null,

      // Initial state — scan trigger
      scanTrigger: 0,

      // Initial state — settings
      showGearTab: false,
      speedUnit: 'kmh',
      hudAutoBrighten: true,
      hudBrightenOnlyWhenCharging: true,

      // Actions — peripheral
      setBleStatus: status => set({bleStatus: status}),
      setDeviceId: id => set({deviceId: id}),
      setError: error => set({error}),
      setTelemetry: data => set({telemetry: data}),
      setChargerConfig: config => set({chargerConfig: config}),

      // Actions — charger direct
      setChargerBleStatus: s => set({chargerBleStatus: s}),
      setChargerDeviceId: id => set({chargerDeviceId: id}),
      setChargerError: e => set({chargerError: e}),
      setChargerData: d => set({chargerData: d}),

      // Actions — scan trigger
      incrementScanTrigger: () => set(state => ({scanTrigger: state.scanTrigger + 1})),

      // Actions — settings
      setShowGearTab: show => set({showGearTab: show}),
      setSpeedUnit: unit => set({speedUnit: unit}),
      setHudAutoBrighten: v => set({hudAutoBrighten: v}),
      setHudBrightenOnlyWhenCharging: v => set({hudBrightenOnlyWhenCharging: v}),
      reset: () =>
        set({
          bleStatus: 'disconnected',
          deviceId: null,
          error: null,
          telemetry: null,
          chargerConfig: null,
          chargerBleStatus: 'disconnected',
          chargerDeviceId: null,
          chargerError: null,
          chargerData: null,
        }),
    }),
    {
      name: 'pao-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        showGearTab: state.showGearTab,
        speedUnit: state.speedUnit,
        hudAutoBrighten: state.hudAutoBrighten,
        hudBrightenOnlyWhenCharging: state.hudBrightenOnlyWhenCharging,
      }),
    },
  ),
);
