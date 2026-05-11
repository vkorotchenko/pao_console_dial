import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  BackHandler,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppStore} from '../store/useAppStore';
import {formatVersion} from '../services/semver';

interface AppInfoScreenProps {
  onClose: () => void;
}

// Same binary-units helper used in FirmwareInfoScreen.
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

// Coarse relative-time formatter (matches SettingsScreen / FirmwareInfoScreen).
function formatRelative(now: number, then: number | null): string {
  if (then === null) {
    return 'Never';
  }
  const deltaMs = now - then;
  if (deltaMs < 0) {
    return 'Just now';
  }
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) {
    return 'Just now';
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min} minute${min === 1 ? '' : 's'} ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Phase 3 of mobile self-update. Read-only supplementary info for the app —
 * mirrors FirmwareInfoScreen's structure: "Running" version on top, "Latest
 * available" with tag/size/last-checked, and a "View changelog" link to the
 * GitHub release page.
 *
 * No actions and no install path here — Phase 4 (download + verify) and
 * Phase 5 (PackageManager install) will add those. The primary entry point
 * for triggering a check remains the Settings "App" section's button.
 */
export default function AppInfoScreen({onClose}: AppInfoScreenProps) {
  const appVersion = useAppStore(s => s.appVersion);
  const appBuildNumber = useAppStore(s => s.appBuildNumber);
  const latestAppReleaseTag = useAppStore(s => s.latestAppReleaseTag);
  const latestAppReleaseVersion = useAppStore(
    s => s.latestAppReleaseVersion,
  );
  const latestAppReleaseUrl = useAppStore(s => s.latestAppReleaseUrl);
  const latestAppReleaseSize = useAppStore(s => s.latestAppReleaseSize);
  const latestAppReleaseCheckedAt = useAppStore(
    s => s.latestAppReleaseCheckedAt,
  );

  // Tick once a minute so "Last checked" relative time stays current while
  // the screen is mounted. Matches FirmwareInfoScreen.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  const openInBrowser = () => {
    if (!latestAppReleaseUrl) {
      return;
    }
    Linking.openURL(latestAppReleaseUrl).catch(() => {
      // Best-effort open; non-actionable failure.
    });
  };

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

      {/* Running on this device */}
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

      {/* Latest available */}
      <Text style={styles.sectionHeader}>Latest available</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Version</Text>
          <Text style={styles.value}>
            {latestAppReleaseVersion
              ? formatVersion(latestAppReleaseVersion)
              : 'None'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Tag</Text>
          <Text style={styles.muted}>{latestAppReleaseTag ?? '—'}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Size</Text>
          <Text style={styles.value}>{formatBytes(latestAppReleaseSize)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Last checked</Text>
          <Text style={styles.muted}>
            {formatRelative(now, latestAppReleaseCheckedAt)}
          </Text>
        </View>
      </View>

      {/* Release notes */}
      <Text style={styles.sectionHeader}>Release notes</Text>
      <View style={styles.card}>
        <TouchableOpacity
          onPress={openInBrowser}
          disabled={!latestAppReleaseUrl}
          style={styles.linkRow}
          accessibilityRole="link"
          accessibilityState={{disabled: !latestAppReleaseUrl}}
          accessibilityLabel="View changelog">
          <Text
            style={[
              styles.linkText,
              !latestAppReleaseUrl && styles.linkTextDisabled,
            ]}>
            View changelog
          </Text>
          <Icon
            name="chevron-right"
            size={20}
            color={latestAppReleaseUrl ? '#5BA8C4' : '#444'}
          />
        </TouchableOpacity>
      </View>

      {/* Updates — the install path lands in Phase 4/5. Until then this row
          is purely informational so users know the section is intentional
          and not broken. */}
      <Text style={styles.sectionHeader}>Updates</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>In-app install</Text>
            <Text style={styles.hint}>
              Coming soon — grab the APK from GitHub for now
            </Text>
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  linkText: {
    color: '#5BA8C4',
    fontSize: 15,
    fontWeight: '500',
  },
  linkTextDisabled: {
    color: '#444',
  },
});
