import React from 'react';
import {View, StyleSheet, ActivityIndicator} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppStore} from '../store/useAppStore';

type BleStatus = string;

function BleIndicator({status}: {status: BleStatus}) {
  if (status === 'scanning' || status === 'connecting') {
    return <ActivityIndicator size={14} color="#5BA8C4" style={styles.icon} />;
  }
  if (status === 'connected') {
    return <Icon name="bluetooth" size={16} color="#4cff91" style={styles.icon} />;
  }
  return <Icon name="bluetooth-off" size={16} color="#444" style={styles.icon} />;
}

export function BleStatusBar() {
  const bleStatus = useAppStore(state => state.bleStatus);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);

  return (
    <View style={styles.container} pointerEvents="none">
      <BleIndicator status={bleStatus} />
      <BleIndicator status={chargerBleStatus} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 10,
    zIndex: 50,
  },
  icon: {
    opacity: 0.7,
  },
});
