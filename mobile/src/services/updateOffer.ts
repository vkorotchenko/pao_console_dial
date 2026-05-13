/**
 * updateOffer.ts — Discriminated union describing what the firmware/app update
 * UI should offer the user, given the currently-running version (which may be
 * null/unknown) and the latest fetched release version.
 *
 * Used by all four OTA targets: charger, dial, controller, and mobile self-update.
 *
 * The key semantic change vs. the prior `hasUpdateAvailable` boolean pattern:
 *   - When `currentVersion` is null but a `latestVersion` exists, we now return
 *     `unknown-current` instead of `none`. This surfaces an install affordance
 *     even on freshly-acquired devices that have never been Phase-1-flashed and
 *     therefore have no version characteristic readable over BLE.
 *
 * Design decision (Milhouse, 2026-05-13):
 *   Placed here as a shared module rather than inlined per-row because all four
 *   targets share identical gate logic and inlining would produce four near-copies
 *   of the same discriminated union. This module has no RN imports and is trivially
 *   unit-testable.
 */

import {compare, parse} from './semver';

// ---------------------------------------------------------------------------
// The UpdateOffer discriminated union
// ---------------------------------------------------------------------------

/** No latest release has been fetched yet. Show "Check for updates". */
export interface UpdateOfferNone {
  kind: 'none';
}

/** The running version is current (running >= latest). Show "Up to date". */
export interface UpdateOfferUpToDate {
  kind: 'up-to-date';
  current: string;
  latest: string;
}

/** A newer release is available. Show "Update to vX.Y.Z". */
export interface UpdateOfferUpdate {
  kind: 'update';
  current: string;
  latest: string;
}

/**
 * Latest release is known but the running version could not be read (null,
 * failed BLE read, or unrecognized version string). Show "Install latest"
 * with a confirmation dialog before proceeding.
 */
export interface UpdateOfferUnknownCurrent {
  kind: 'unknown-current';
  latest: string;
}

export type UpdateOffer =
  | UpdateOfferNone
  | UpdateOfferUpToDate
  | UpdateOfferUpdate
  | UpdateOfferUnknownCurrent;

// ---------------------------------------------------------------------------
// Compute function
// ---------------------------------------------------------------------------

/**
 * Compute the update offer for a single target given its current and latest
 * version strings (either of which may be null).
 *
 * Rules:
 *   1. No latest release → `none`  (can't offer anything without a release)
 *   2. Latest exists, current null OR unparseable → `unknown-current`
 *      (bootstrap case: device not yet Phase-1-flashed, or version char unreadable)
 *   3. Latest exists, current parseable, current < latest → `update`
 *   4. Latest exists, current parseable, current >= latest → `up-to-date`
 */
export function computeUpdateOffer(
  currentVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): UpdateOffer {
  if (!latestVersion) {
    return {kind: 'none'};
  }

  // Treat null, empty string, and unparseable version strings all as
  // "unknown current". The firmware's own semver regex is strict; a
  // garbled version char is just as unknown as a missing one from the
  // user's perspective.
  if (!currentVersion || !parse(currentVersion)) {
    return {kind: 'unknown-current', latest: latestVersion};
  }

  if (compare(latestVersion, currentVersion) === 1) {
    return {kind: 'update', current: currentVersion, latest: latestVersion};
  }

  return {kind: 'up-to-date', current: currentVersion, latest: latestVersion};
}
