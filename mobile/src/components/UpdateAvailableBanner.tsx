import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppStore} from '../store/useAppStore';
import {compare, formatVersion, parse} from '../services/semver';

interface UpdateAvailableBannerProps {
  onPress: () => void;
}

// Thin colored bar shown when the running charger firmware is older than the
// newest GitHub release. Mounted once in AppNavigator; visible on every
// non-HUD screen. No dismissal control — that arrives in Phase 6 alongside
// the prereleases toggle.
export function UpdateAvailableBanner({onPress}: UpdateAvailableBannerProps) {
  const chargerFirmwareVersion = useAppStore(s => s.chargerFirmwareVersion);
  const latestReleaseVersion = useAppStore(s => s.latestReleaseVersion);

  // Only render if we have BOTH versions AND latest > current.
  // - `chargerFirmwareVersion` is null when the charger has never connected.
  // - `latestReleaseVersion` is null when no release has been found yet.
  // - If the running version is unparseable, hide the banner — comparing
  //   against null in compare() would always return 1 (latest "wins"), which
  //   would falsely show the banner for a junk fw string. Honest "we don't
  //   know" beats false-positive nag.
  if (!chargerFirmwareVersion || !latestReleaseVersion) {
    return null;
  }
  if (!parse(chargerFirmwareVersion)) {
    return null;
  }
  if (compare(latestReleaseVersion, chargerFirmwareVersion) !== 1) {
    return null;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.container}
      accessibilityRole="button"
      accessibilityLabel={`Charger update available: version ${latestReleaseVersion}`}>
      <Icon name="download" size={16} color="#0D0D0D" style={styles.icon} />
      <Text style={styles.text} numberOfLines={1}>
        Charger update available — {formatVersion(latestReleaseVersion)}
      </Text>
      <Icon name="chevron-right" size={18} color="#0D0D0D" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    // #FFD600 is the existing "warning" yellow per the project palette
    // (history.md: warning #FFD600). Foreground darkened for legibility.
    backgroundColor: '#FFD600',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  icon: {
    marginRight: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: '#0D0D0D',
    fontWeight: '600',
  },
});
