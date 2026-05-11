import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppStore} from '../store/useAppStore';
import {getReadyOtaSha256} from '../services/otaController';
import {formatVersion} from '../services/semver';

interface FirmwareInfoScreenProps {
  onClose: () => void;
}

// Same binary-units helper used elsewhere — firmware folks expect 1 KB = 1024.
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

// Coarse relative-time formatter (matches SettingsScreen.formatRelative).
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
 * Read-only supplementary info for charger firmware. The primary OTA UI lives
 * in Settings; this screen is reached via the ⓘ icon in the Firmware row.
 * No actions — just data display + a "View changelog" link.
 */
export default function FirmwareInfoScreen({onClose}: FirmwareInfoScreenProps) {
  const chargerFirmwareVersion = useAppStore(s => s.chargerFirmwareVersion);
  const latestReleaseTag = useAppStore(s => s.latestReleaseTag);
  const latestReleaseVersion = useAppStore(s => s.latestReleaseVersion);
  const latestReleaseUrl = useAppStore(s => s.latestReleaseUrl);
  const latestReleaseSize = useAppStore(s => s.latestReleaseSize);
  const latestReleaseCheckedAt = useAppStore(s => s.latestReleaseCheckedAt);

  // Tick once a minute so "Last checked" relative time stays current while
  // the screen is mounted.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Prefer the locally-verified hash (we just downloaded + verified the .bin)
  // over any future store-level field. Falls back to '—' when no payload is
  // ready in memory yet.
  const sha = getReadyOtaSha256();
  const shaAbbrev = sha ? `${sha.slice(0, 6)}…${sha.slice(-4)}` : '—';

  const openInBrowser = () => {
    if (!latestReleaseUrl) {
      return;
    }
    Linking.openURL(latestReleaseUrl).catch(() => {
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
        <Text style={styles.title}>Firmware Info</Text>
        <View style={styles.backButton} />
      </View>

      {/* Running on charger */}
      <Text style={styles.sectionHeader}>Running on charger</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Version</Text>
          <Text style={styles.value}>
            {chargerFirmwareVersion
              ? formatVersion(chargerFirmwareVersion)
              : '—'}
          </Text>
        </View>
      </View>

      {/* Latest available */}
      <Text style={styles.sectionHeader}>Latest available</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Version</Text>
          <Text style={styles.value}>
            {latestReleaseVersion
              ? formatVersion(latestReleaseVersion)
              : 'None'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Tag</Text>
          <Text style={styles.muted}>{latestReleaseTag ?? '—'}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Size</Text>
          <Text style={styles.value}>{formatBytes(latestReleaseSize)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>SHA256</Text>
            <Text style={styles.hint}>verified before install</Text>
          </View>
          <Text style={styles.shaText}>{shaAbbrev}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Last checked</Text>
          <Text style={styles.muted}>
            {formatRelative(now, latestReleaseCheckedAt)}
          </Text>
        </View>
      </View>

      {/* Release notes */}
      <Text style={styles.sectionHeader}>Release notes</Text>
      <View style={styles.card}>
        <TouchableOpacity
          onPress={openInBrowser}
          disabled={!latestReleaseUrl}
          style={styles.linkRow}
          accessibilityRole="link"
          accessibilityState={{disabled: !latestReleaseUrl}}
          accessibilityLabel="View changelog">
          <Text
            style={[
              styles.linkText,
              !latestReleaseUrl && styles.linkTextDisabled,
            ]}>
            View changelog
          </Text>
          <Icon
            name="chevron-right"
            size={20}
            color={latestReleaseUrl ? '#5BA8C4' : '#444'}
          />
        </TouchableOpacity>
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
  shaText: {
    fontSize: 13,
    color: '#9E9E9E',
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
