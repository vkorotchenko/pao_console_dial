import React from 'react';
import {View, Text, StyleSheet, ActivityIndicator, ViewStyle} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppStore} from '../store/useAppStore';

interface PageHeaderProps {
  title: string;
  bleSource: 'peripheral' | 'charger';
  style?: ViewStyle;
}

function BleIndicator({status}: {status: string}) {
  if (status === 'scanning' || status === 'connecting') {
    return <ActivityIndicator size={16} color="#5BA8C4" />;
  }
  if (status === 'connected') {
    return <Icon name="bluetooth" size={18} color="#4cff91" />;
  }
  return <Icon name="bluetooth-off" size={18} color="#444" />;
}

export function PageHeader({title, bleSource, style}: PageHeaderProps) {
  const bleStatus = useAppStore(state => state.bleStatus);
  const chargerBleStatus = useAppStore(state => state.chargerBleStatus);
  const status = bleSource === 'charger' ? chargerBleStatus : bleStatus;

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>{title}</Text>
      <BleIndicator status={status} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 44,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
    color: '#87CEEB',
    letterSpacing: 1,
  },
});
