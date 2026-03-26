import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DashboardScreen from '../screens/DashboardScreen';
import GearScreen from '../screens/GearScreen';
import ChargerScreen from '../screens/ChargerScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type RootTabParamList = {
  Dashboard: undefined;
  Gear: undefined;
  Charger: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#2196F3',
        tabBarInactiveTintColor: '#757575',
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Icon name="view-dashboard" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Gear"
        component={GearScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Icon name="car-shift-pattern" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Charger"
        component={ChargerScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Icon name="battery-charging" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Icon name="bluetooth-settings" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
