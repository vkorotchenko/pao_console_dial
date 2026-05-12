import {Buffer} from 'buffer';

/**
 * Decode the 4-byte firmware version payload (little-endian) to the canonical
 * bare semver string (no "v" prefix — the prefix is a display-time concern,
 * applied by `formatVersion()` at render time).
 *
 * Format: [major, minor, patch, build] → "MAJOR.MINOR.PATCH+BUILD"
 *         When build == 0, render as "MAJOR.MINOR.PATCH".
 *
 * Returns null if the payload is missing or shorter than 4 bytes.
 *
 * Wire contract — characteristic-agnostic:
 *   This decoder is shared across BLE characteristics that emit the
 *   byte-identical 4-byte LE version payload:
 *     - Charger 0xFF25 (Decision #43 / #44)
 *     - Dial     ff250001-5127-46df-a18b-066672243018 (Decision #58 / #61 B-3)
 *   Both are clamped uint8 [major, minor, patch, build] stamped by the
 *   firmware's gen_version.py. Any future target with the same wire shape
 *   can reuse this without modification.
 *
 * History: previously returned "vMAJOR.MINOR.PATCH..." which produced the
 * "vv0.0.0" double-prefix bug when UI sites also prepended "v" at render
 * time. Storage is bare so that `compare()` in semver.ts works directly
 * against `latestReleaseVersion` (also bare, e.g. "0.1.0").
 */
export function decodeFirmwareVersion(
  base64Value: string | null | undefined,
): string | null {
  if (!base64Value) return null;
  const bytes = Buffer.from(base64Value, 'base64');
  if (bytes.length < 4) return null;
  const major = bytes[0];
  const minor = bytes[1];
  const patch = bytes[2];
  const build = bytes[3];
  const base = `${major}.${minor}.${patch}`;
  return build === 0 ? base : `${base}+${build}`;
}
