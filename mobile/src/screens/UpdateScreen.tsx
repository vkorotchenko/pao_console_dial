import React from 'react';
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
import {
  prepareOtaPayload,
  cancelOtaPreparation,
  getReadyOtaSha256,
} from '../services/otaController';
import {formatVersion} from '../services/semver';

interface UpdateScreenProps {
  onClose: () => void;
}

// Human-readable size in KB / MB (binary, not SI — firmware folks expect
// 1 KB = 1024 bytes).
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

// Compact form for the in-flight progress UI ("412 KB / 612 KB"). No B suffix
// at the low end — for a 600KB-ish payload we always want KB or larger.
function formatBytesShort(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

const NOTES_PREVIEW_CHARS = 600;

export default function UpdateScreen({onClose}: UpdateScreenProps) {
  const chargerFirmwareVersion = useAppStore(s => s.chargerFirmwareVersion);
  const latestReleaseTag = useAppStore(s => s.latestReleaseTag);
  const latestReleaseVersion = useAppStore(s => s.latestReleaseVersion);
  const latestReleaseUrl = useAppStore(s => s.latestReleaseUrl);
  const latestReleaseSize = useAppStore(s => s.latestReleaseSize);
  const latestReleaseNotes = useAppStore(s => s.latestReleaseNotes);

  // Phase 4 — OTA flow state.
  const otaState = useAppStore(s => s.otaState);
  const otaError = useAppStore(s => s.otaError);
  const otaProgress = useAppStore(s => s.otaProgress);
  const otaBytesReceived = useAppStore(s => s.otaBytesReceived);
  const otaBytesTotal = useAppStore(s => s.otaBytesTotal);

  const hasRelease = !!latestReleaseVersion;
  const isInFlight =
    otaState === 'checking' ||
    otaState === 'downloading' ||
    otaState === 'verifying';

  const startInstall = () => {
    // prepareOtaPayload swallows its own errors into the store. Don't await.
    prepareOtaPayload();
  };

  const onCancel = () => {
    cancelOtaPreparation();
  };

  const notesPreview = (() => {
    if (!latestReleaseNotes) {
      return '';
    }
    if (latestReleaseNotes.length <= NOTES_PREVIEW_CHARS) {
      return latestReleaseNotes;
    }
    return latestReleaseNotes.slice(0, NOTES_PREVIEW_CHARS) + '…';
  })();

  const openInBrowser = () => {
    if (!latestReleaseUrl) {
      return;
    }
    Linking.openURL(latestReleaseUrl).catch(() => {
      // Linking failure is rare and non-actionable on this screen — silently swallow.
    });
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Charger Update</Text>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.closeButton}>
          <Icon name="close" size={24} color="#E0E0E0" />
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Current version</Text>
          <Text style={styles.value}>
            {formatVersion(chargerFirmwareVersion)}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Available version</Text>
            {latestReleaseTag ? (
              <Text style={styles.tagText}>{latestReleaseTag}</Text>
            ) : null}
          </View>
          <Text style={styles.value}>
            {latestReleaseVersion ? formatVersion(latestReleaseVersion) : '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Size</Text>
          <Text style={styles.value}>{formatBytes(latestReleaseSize)}</Text>
        </View>
      </View>

      <Text style={styles.sectionHeader}>Release notes</Text>
      <View style={styles.card}>
        {notesPreview ? (
          <Text style={styles.notesText}>{notesPreview}</Text>
        ) : (
          <Text style={styles.notesEmpty}>No release notes provided.</Text>
        )}
        {latestReleaseUrl ? (
          <TouchableOpacity
            onPress={openInBrowser}
            style={styles.linkButton}
            accessibilityRole="link"
            accessibilityLabel="Open release in browser">
            <Icon
              name="open-in-new"
              size={16}
              color="#5BA8C4"
              style={styles.linkIcon}
            />
            <Text style={styles.linkText}>Open in browser</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Install CTA area — Phase 4.
          Phase 4 adds download + SHA256 verify. The "Ready to flash"
          terminal state is intentionally non-actionable; Phase 5 will
          enable the actual BLE OTA push. */}
      <View style={styles.ctaContainer}>
        {isInFlight ? (
          <View style={styles.progressCard}>
            <Text style={styles.progressLabel}>
              {otaState === 'verifying'
                ? 'Verifying integrity…'
                : otaState === 'downloading'
                ? 'Downloading…'
                : 'Checking for update…'}
            </Text>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.round(
                      Math.max(0, Math.min(1, otaProgress)) * 100,
                    )}%`,
                  },
                ]}
              />
            </View>
            {otaState === 'downloading' &&
            otaBytesReceived !== null &&
            otaBytesTotal !== null &&
            otaBytesTotal > 0 ? (
              <Text style={styles.progressBytes}>
                {formatBytesShort(otaBytesReceived)}
                {' / '}
                {formatBytesShort(otaBytesTotal)}
              </Text>
            ) : (
              <Text style={styles.progressBytes}>
                {Math.round(
                  Math.max(0, Math.min(1, otaProgress)) * 100,
                )}
                %
              </Text>
            )}
            <TouchableOpacity
              onPress={onCancel}
              style={styles.cancelButton}
              accessibilityRole="button"
              accessibilityLabel="Cancel update preparation">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : otaState === 'ready' ? (
          <>
            <View style={styles.readyButton}>
              <Icon name="check-circle" size={18} color="#9E9E9E" />
              <Text style={styles.readyText}>Ready to flash</Text>
            </View>
            <Text style={styles.ctaHelper}>Coming in next update</Text>
            {(() => {
              const hex = getReadyOtaSha256();
              return hex ? (
                <Text style={styles.shaText}>
                  Verified sha256: {hex.slice(0, 8)}…
                </Text>
              ) : null;
            })()}
          </>
        ) : (
          <>
            {otaState === 'error' && otaError ? (
              <Text style={styles.errorText}>{otaError}</Text>
            ) : null}
            <TouchableOpacity
              onPress={startInstall}
              disabled={!hasRelease}
              style={[
                styles.installButton,
                !hasRelease && styles.installButtonDisabledState,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                otaState === 'error' ? 'Try again' : 'Install update'
              }>
              <Icon
                name={otaState === 'error' ? 'refresh' : 'download'}
                size={18}
                color={hasRelease ? '#0D0D0D' : '#666'}
              />
              <Text
                style={[
                  styles.installText,
                  !hasRelease && styles.installTextDisabled,
                ]}>
                {otaState === 'error' ? 'Try again' : 'Install update'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <TouchableOpacity
        onPress={onClose}
        style={styles.secondaryButton}
        accessibilityRole="button"
        accessibilityLabel="Close">
        <Text style={styles.secondaryText}>Close</Text>
      </TouchableOpacity>
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
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#E0E0E0',
  },
  closeButton: {
    padding: 4,
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
  tagText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  value: {
    fontSize: 15,
    color: '#9E9E9E',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A2A2A',
  },
  notesText: {
    fontSize: 14,
    color: '#C0C0C0',
    lineHeight: 20,
    paddingVertical: 12,
  },
  notesEmpty: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    paddingVertical: 12,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2A2A',
  },
  linkIcon: {
    marginRight: 6,
  },
  linkText: {
    color: '#5BA8C4',
    fontSize: 14,
    fontWeight: '500',
  },
  ctaContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#00C853',
    borderRadius: 8,
    minWidth: 200,
    gap: 8,
  },
  installButtonDisabledState: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    opacity: 0.6,
  },
  installText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '600',
  },
  installTextDisabled: {
    color: '#666',
  },
  // "Ready to flash" terminal state — intentionally non-actionable. Phase 5
  // will enable the actual BLE OTA push and replace this with a button.
  readyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 200,
    gap: 8,
    opacity: 0.7,
  },
  readyText: {
    color: '#9E9E9E',
    fontSize: 16,
    fontWeight: '600',
  },
  shaText: {
    color: '#666',
    fontSize: 11,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    color: '#F44336',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  ctaHelper: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  // In-flight progress UI used during 'downloading' / 'verifying'.
  progressCard: {
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  progressLabel: {
    color: '#E0E0E0',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#2A2A2A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#00C853',
    borderRadius: 3,
  },
  progressBytes: {
    color: '#9E9E9E',
    fontSize: 12,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  cancelButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  cancelText: {
    color: '#9E9E9E',
    fontSize: 14,
    fontWeight: '500',
  },
  secondaryButton: {
    marginTop: 24,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  secondaryText: {
    color: '#9E9E9E',
    fontSize: 15,
    fontWeight: '500',
  },
});
