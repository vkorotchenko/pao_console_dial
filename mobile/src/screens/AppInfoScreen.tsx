import React, {useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  BackHandler,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppStore} from '../store/useAppStore';

interface AppInfoScreenProps {
  onClose: () => void;
}

/**
 * Phase 1 of mobile self-update. Display-only counterpart to
 * FirmwareInfoScreen but for the running app itself. Shows versionName and
 * versionCode read from native at boot (services/appVersion.ts).
 *
 * Update detection, download, and install land in later phases — the
 * "Coming soon" footer is intentional, not a TODO marker.
 */
export default function AppInfoScreen({onClose}: AppInfoScreenProps) {
  const appVersion = useAppStore(s => s.appVersion);
  const appBuildNumber = useAppStore(s => s.appBuildNumber);

  // Android hardware back: this screen is a full-screen overlay in the
  // custom state-driven router (AppNavigator's `currentScreen`), not a
  // member of the swipe pager. Without an explicit BackHandler the default
  // Android behavior is to exit the app. Same pattern as FirmwareInfoScreen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true; // mark handled — prevents default app-exit
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          style={styles.backButton}>
          <Icon name="chevron-left" size={28} color="#87CEEB" />
        </TouchableOpacity>
        <Text style={styles.title}>App Info</Text>
        <View style={styles.backButton} />
      </View>

      <Text style={styles.sectionHeader}>Running on this device</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Version</Text>
          <Text style={styles.value}>
            {appVersion ? `v${appVersion}` : '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Build</Text>
          <Text style={styles.muted}>{appBuildNumber ?? '—'}</Text>
        </View>
      </View>

      <Text style={styles.sectionHeader}>Updates</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>App updates</Text>
            <Text style={styles.hint}>Coming soon</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  container: {
    padding: 16,
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 44,
    marginBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
    color: '#87CEEB',
    letterSpacing: 1,
    textAlign: 'center',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9E9E9E',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    marginRight: 12,
  },
  label: {
    fontSize: 15,
    color: '#E0E0E0',
    fontWeight: '500',
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  value: {
    fontSize: 15,
    color: '#9E9E9E',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  muted: {
    fontSize: 13,
    color: '#666',
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A2A2A',
  },
});
