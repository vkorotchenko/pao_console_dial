// Pure-JS semver helpers. No deps.
//
// What this handles:
//   - "0.1.0"                      → release
//   - "0.1.0+12"                   → release with build metadata (build is preserved
//                                    on the parsed object but IGNORED in `compare`,
//                                    per https://semver.org §10)
//   - "0.1.0-rc.1" / "0.1.0-beta.3"→ prerelease (rc/beta/alpha/dev/etc.)
//   - "0.0.0-dev"                  → the dev sentinel emitted when the firmware
//                                    is built outside a tagged commit. Treated as
//                                    a prerelease of 0.0.0 with tag "dev", num 0.
//   - "MAJOR.MINOR.PATCH+BUILD"    → what Bart's firmware emits between tags
//                                    (e.g. "0.0.0+12"). Build metadata after `+`
//                                    is preserved on the parsed object but ignored
//                                    in compare.
//
// What this does NOT handle:
//   - Multi-identifier prerelease tags (e.g. "1.0.0-alpha.1.beta") — we treat the
//     prerelease part as a single {tag, num} pair. The firmware never emits this
//     shape, and GitHub release tags from `charger-release.yml` use the strict
//     regex `^charger-v(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$`. Anything more
//     complex returns null from parse().
//   - Numeric-only prerelease tags (e.g. "1.0.0-1"). Spec-compliant but unused.
//
// Comparison rules (per semver.org):
//   1. Compare major, then minor, then patch (numeric).
//   2. If equal, a version WITHOUT a prerelease > version WITH a prerelease.
//      (i.e. "1.0.0" > "1.0.0-rc.1")
//   3. If both have prereleases, compare the tag strings (ASCII), then the nums.
//   4. Build metadata (the "+N" suffix) MUST be ignored.

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: {tag: string; num: number};
  // Preserved for display, never used in compare().
  build?: number;
}

// Prerelease shapes accepted:
//   -rc.1    → tag="rc", num=1
//   -beta.3  → tag="beta", num=3
//   -dev     → tag="dev", num=0  (the firmware sentinel for "untagged build";
//                                 num defaults to 0 when absent)
const VERSION_REGEX =
  /^(\d+)\.(\d+)\.(\d+)(?:-([a-z][a-z0-9]*)(?:\.(\d+))?)?(?:\+(\d+))?$/i;

/**
 * Parse a version string. Returns null for anything that doesn't match.
 * Strips a leading "v" if present (e.g. "v0.1.0" works), but does NOT strip
 * a "charger-v" prefix — that's the GitHub tag shape and the caller must
 * strip it before calling parse.
 */
export function parse(version: string): ParsedVersion | null {
  if (!version) {
    return null;
  }
  const cleaned = version.startsWith('v') ? version.slice(1) : version;
  const m = VERSION_REGEX.exec(cleaned);
  if (!m) {
    return null;
  }
  const [, major, minor, patch, preTag, preNum, build] = m;
  const result: ParsedVersion = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
  if (preTag !== undefined) {
    result.prerelease = {
      tag: preTag.toLowerCase(),
      num: preNum !== undefined ? Number(preNum) : 0,
    };
  }
  if (build !== undefined) {
    result.build = Number(build);
  }
  return result;
}

/**
 * Compare two semver-ish version strings. Build metadata is ignored.
 * Returns:
 *   -1 if a < b
 *    0 if a == b (build metadata differences count as equal)
 *    1 if a > b
 *
 * If either input is unparseable, the parseable one wins. If both are
 * unparseable, returns 0. (This is a deliberate "best effort" for comparing
 * a firmware-emitted string against a GitHub tag — we'd rather show a banner
 * conservatively than crash.)
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) {
    return 0;
  }
  if (!pa) {
    return -1;
  }
  if (!pb) {
    return 1;
  }

  if (pa.major !== pb.major) {
    return pa.major < pb.major ? -1 : 1;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor < pb.minor ? -1 : 1;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch < pb.patch ? -1 : 1;
  }

  // Major.minor.patch equal. Prerelease handling per semver §11.4:
  // - No prerelease > has prerelease
  // - Both prerelease: compare tag, then num
  const aPre = pa.prerelease;
  const bPre = pb.prerelease;
  if (!aPre && !bPre) {
    return 0;
  }
  if (!aPre && bPre) {
    return 1;
  }
  if (aPre && !bPre) {
    return -1;
  }
  // Both have prereleases.
  if (aPre!.tag !== bPre!.tag) {
    return aPre!.tag < bPre!.tag ? -1 : 1;
  }
  if (aPre!.num !== bPre!.num) {
    return aPre!.num < bPre!.num ? -1 : 1;
  }
  return 0;
}

/**
 * Format a canonical bare version string for display by prepending exactly one
 * "v". This is the single source of truth for user-visible version rendering —
 * UI sites should call this helper rather than concatenating "v" themselves,
 * which is what produced the "vv0.0.0" double-prefix bug.
 *
 * Inputs:
 *   - "0.0.0"     → "v0.0.0"
 *   - "0.1.0+12"  → "v0.1.0+12"  (build metadata preserved for human display)
 *   - "v0.1.0"    → "v0.1.0"     (defensive: tolerate an already-prefixed string)
 *   - null/""     → "Unknown"    (matches the existing UpdateScreen fallback;
 *                                 SettingsScreen's "—" callers should branch
 *                                 on null themselves before invoking this)
 */
export function formatVersion(version: string | null | undefined): string {
  if (!version) {
    return 'Unknown';
  }
  if (version.startsWith('v') || version.startsWith('V')) {
    return version;
  }
  return `v${version}`;
}

// ---------------------------------------------------------------------------
// Smoke checks (for human review — NOT a test framework)
// ---------------------------------------------------------------------------
//
//   compare("0.1.0", "0.0.0+12") === 1     // patch wins; build ignored
//   compare("0.1.0+0", "0.1.0") === 0      // build metadata ignored
//   compare("0.1.0", "0.1.0-rc.1") === 1   // release > prerelease
//   compare("0.1.0-rc.2", "0.1.0-rc.1") === 1
//   compare("0.1.0-beta.5", "0.1.0-rc.1") === -1   // "beta" < "rc" lexicographic
//   compare("1.0.0", "0.99.99") === 1
//   compare("0.0.0-dev", "0.0.0+12") === -1 // prerelease (dev) < release (build)
//   compare("0.0.0-dev", "0.1.0") === -1
//   parse("0.0.0-dev") -> {major:0, minor:0, patch:0, prerelease:{tag:"dev",num:0}}
//   parse("0.0.0+12")  -> {major:0, minor:0, patch:0, build:12}
//   parse("garbage")   -> null
//

