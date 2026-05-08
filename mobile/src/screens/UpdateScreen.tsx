import React, {useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Modal,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppStore} from '../store/useAppStore';
import {
  prepareOtaPayload,
  cancelOtaPreparation,
  getReadyOtaSha256,
} from '../services/otaController';
import {flashChargerFirmware} from '../services/otaOrchestrator';
import {formatVersion} from '../services/semver';
import {activateKeepAwake, deactivateKeepAwake} from '../utils/keepAwake';

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
  const chargerBleStatus = useAppStore(s => s.chargerBleStatus);

  // Phase 4 — OTA flow state.
  const otaState = useAppStore(s => s.otaState);
  const otaError = useAppStore(s => s.otaError);
  const otaProgress = useAppStore(s => s.otaProgress);
  const otaBytesReceived = useAppStore(s => s.otaBytesReceived);
  const otaBytesTotal = useAppStore(s => s.otaBytesTotal);

  // Phase 5 — pre-flight modal + abort controller for the flash flow.
  // The flash AbortController is owned by the screen so the user can cancel
  // mid-transfer. Recreated for each flash attempt.
  const [showPreflight, setShowPreflight] = React.useState(false);
  const flashAbortRef = useRef<AbortController | null>(null);

  const hasRelease = !!latestReleaseVersion;
  const isInFlight =
    otaState === 'checking' ||
    otaState === 'downloading' ||
    otaState === 'verifying';

  // Phase 5 in-flight: any state where a flash is actively running. Determines
  // whether the screen shows transfer/reboot/etc UI vs. the install button.
  const isFlashing =
    otaState === 'transferring' ||
    otaState === 'rebooting' ||
    otaState === 'reconnecting' ||
    otaState === 'finalizing';

  const startInstall = () => {
    // prepareOtaPayload swallows its own errors into the store. Don't await.
    prepareOtaPayload();
  };

  const onCancel = () => {
    cancelOtaPreparation();
  };

  // ── Phase 5 — flash flow handlers ───────────────────────────────────────
  // The flash flow is gated behind a pre-flight modal that confirms the user
  // wants to proceed and reminds them of the stay-foreground requirement.
  // Charging is force-paused by firmware during OTA and resumed on completion,
  // so the user no longer needs to manually disable it. Tapping the primary
  // modal action kicks off the orchestrator.

  const onFlashRequest = () => {
    setShowPreflight(true);
  };

  const onPreflightCancel = () => {
    setShowPreflight(false);
  };

  const onPreflightConfirm = () => {
    setShowPreflight(false);
    // Abort any prior run defensively; create a fresh controller.
    flashAbortRef.current?.abort();
    const controller = new AbortController();
    flashAbortRef.current = controller;

    // Wake-lock for the duration. Released in the finally below + on unmount.
    activateKeepAwake();

    // Errors already routed to otaState='error' + otaError by the
    // orchestrator — we just need to drop the wake-lock either way.
    // (Skipping `.finally` because TS lib is targeting es2017.)
    const releaseWakeLock = () => deactivateKeepAwake();
    flashChargerFirmware({
      signal: controller.signal,
      // Progress + phase already pushed into the store by the orchestrator —
      // we don't need to wire them through the screen.
    }).then(releaseWakeLock, releaseWakeLock);
    // Don't clear flashAbortRef — we want signal.aborted to remain true
    // for any late callbacks from the orchestrator. The next flash
    // attempt creates a fresh controller anyway.
  };

  const onFlashCancel = () => {
    flashAbortRef.current?.abort();
  };

  // Auto-clear `done` → `idle` after a few seconds so the success UI doesn't
  // stick around forever. Releases wake-lock too in case it slipped past.
  useEffect(() => {
    if (otaState === 'done') {
      const t = setTimeout(() => {
        const s = useAppStore.getState();
        // Only revert if we're still in 'done' — guard against rapid fire.
        if (s.otaState === 'done') {
          s.setOtaState('idle');
        }
      }, 3000);
      return () => clearTimeout(t);
    }
    // Defensive: if the screen rerenders into idle/error after a flash,
    // make sure the wake-lock was released.
    if (otaState === 'idle' || otaState === 'error') {
      deactivateKeepAwake();
    }
    return undefined;
  }, [otaState]);

  // On unmount, drop wake-lock and abort any in-flight flash. Backstops the
  // happy-path cleanup above.
  useEffect(() => {
    return () => {
      deactivateKeepAwake();
      flashAbortRef.current?.abort();
    };
  }, []);

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

      {/* Install CTA area — Phase 5.
          Pipeline:
            (no payload)            → "Install update" — runs prepareOtaPayload
            checking/downloading/   → progress card with cancel
              verifying
            ready                   → "Flash now" CTA (gated behind preflight modal)
            transferring/rebooting/ → flash progress card (cancel in transferring only)
              reconnecting/finalizing
            done                    → success card (auto-dismisses to idle)
            error                   → error message + "Try again" / "Close"
      */}
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
        ) : isFlashing ? (
          <View style={styles.progressCard}>
            <Text style={styles.progressLabel}>
              {otaState === 'transferring'
                ? 'Sending firmware…'
                : otaState === 'rebooting'
                ? 'Charger restarting…'
                : otaState === 'reconnecting'
                ? 'Reconnecting (this can take up to 30 seconds)…'
                : 'Verifying update…'}
            </Text>

            {otaState === 'transferring' ? (
              <>
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
                {otaBytesReceived !== null &&
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
                  onPress={onFlashCancel}
                  style={styles.cancelButton}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel flash">
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              // rebooting / reconnecting / finalizing — spinner + caption.
              // Cancel is intentionally NOT offered here: once the OTA_END
              // is sent, aborting on the mobile side does nothing useful;
              // the bootloader will roll back if anything's off.
              <View style={styles.spinnerWrapper}>
                <ActivityIndicator size="large" color="#00C853" />
              </View>
            )}
          </View>
        ) : otaState === 'done' ? (
          <View style={styles.doneCard}>
            <Icon name="check-circle" size={32} color="#00C853" />
            <Text style={styles.doneText}>
              Updated to{' '}
              {chargerFirmwareVersion
                ? formatVersion(chargerFirmwareVersion)
                : ''}
            </Text>
          </View>
        ) : otaState === 'ready' ? (
          <>
            <TouchableOpacity
              onPress={onFlashRequest}
              disabled={chargerBleStatus !== 'connected'}
              style={[
                styles.installButton,
                chargerBleStatus !== 'connected' &&
                  styles.installButtonDisabledState,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Flash firmware now">
              <Icon
                name="flash"
                size={18}
                color={chargerBleStatus === 'connected' ? '#0D0D0D' : '#666'}
              />
              <Text
                style={[
                  styles.installText,
                  chargerBleStatus !== 'connected' && styles.installTextDisabled,
                ]}>
                Flash now
              </Text>
            </TouchableOpacity>
            {chargerBleStatus !== 'connected' ? (
              <Text style={styles.ctaHelper}>
                Connect to the charger to flash
              </Text>
            ) : null}
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

      {/* Pre-flight modal — shown before kicking off the flash flow. */}
      <Modal
        visible={showPreflight}
        transparent
        animationType="fade"
        onRequestClose={onPreflightCancel}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Icon
              name="alert-circle-outline"
              size={32}
              color="#F4A340"
              style={styles.modalIcon}
            />
            <Text style={styles.modalTitle}>Update charger firmware?</Text>
            <Text style={styles.modalBody}>
              Charging will pause during the update and resume when it's done.
              Make sure the vehicle is parked. Keep the app open and don't lock
              the screen — the update takes about a minute.
            </Text>
            <Text style={styles.modalBody}>
              The charger will restart and reconnect automatically. If anything
              goes wrong the bootloader will roll back to the previous version
              on the next power cycle.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={onPreflightCancel}
                style={styles.modalCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancel flash">
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onPreflightConfirm}
                style={styles.modalConfirm}
                accessibilityRole="button"
                accessibilityLabel="Start flashing">
                <Text style={styles.modalConfirmText}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  // Phase 5 — flash-flow UI styles.
  spinnerWrapper: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneCard: {
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00C853',
  },
  doneText: {
    color: '#E0E0E0',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalIcon: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    color: '#E0E0E0',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  modalBody: {
    color: '#C0C0C0',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  modalBold: {
    color: '#F4A340',
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  modalCancel: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  modalCancelText: {
    color: '#9E9E9E',
    fontSize: 15,
    fontWeight: '600',
  },
  modalConfirm: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#00C853',
    borderRadius: 6,
  },
  modalConfirmText: {
    color: '#0D0D0D',
    fontSize: 15,
    fontWeight: '700',
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
