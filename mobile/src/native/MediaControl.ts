import { NativeModules } from 'react-native';

const { MediaControl: _MediaControl } = NativeModules;

const COMMANDS: Record<number, () => void> = {
  0x01: () => _MediaControl?.playPause(),
  0x02: () => _MediaControl?.next(),
  0x03: () => _MediaControl?.previous(),
  0x04: () => _MediaControl?.volumeUp(),
  0x05: () => _MediaControl?.volumeDown(),
  0x06: () => _MediaControl?.mute(),
};

const MediaControl = {
  dispatch(cmd: number): void {
    COMMANDS[cmd]?.();
  },
};

export default MediaControl;
