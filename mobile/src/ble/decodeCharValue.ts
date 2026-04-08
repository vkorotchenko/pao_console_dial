import {Buffer} from 'buffer';

/**
 * Decode a BLE characteristic value from base64.
 *
 * The nRF51822 AT+GATTCHAR command stores values as ASCII hex strings.
 * For example, value 1732 (0x6C4) is stored as the bytes ['6','C','4']
 * (0x36, 0x43, 0x34). Arduino's println(val, HEX) always emits uppercase
 * hex ('0'-'9', 'A'-'F'), so any bytes outside that range are raw binary
 * and must be decoded via big-endian integer fallback.
 *
 * NOTE: Lowercase hex bytes (0x61–0x66, 'a'–'f') are NOT treated as ASCII
 * hex. They can only appear when a binary byte happens to fall in that range
 * (e.g. 0x64 = 100 stored as a single raw byte). Treating them as ASCII hex
 * would silently mis-decode: 0x64 → parseInt("d", 16) = 13 instead of 100.
 * The lowercase range was removed to avoid this.
 */
export function decodeCharValue(base64Value: string): number {
  const bytes = Buffer.from(base64Value, 'base64');
  if (bytes.length === 0) return 0;

  const allAsciiHex = bytes.every(
    b =>
      (b >= 0x30 && b <= 0x39) || // '0'-'9'
      (b >= 0x41 && b <= 0x46),   // 'A'-'F' (uppercase only — Arduino HEX is always uppercase)
  );

  if (allAsciiHex) {
    const ascii = bytes.toString('ascii').trim();
    const parsed = parseInt(ascii, 16);
    if (!isNaN(parsed)) return parsed;
  }

  let val = 0;
  for (const b of bytes) {
    val = (val << 8) | b;
  }
  return val;
}

/* 
function decodeCharValue(base64Value: string): number {
  const bytes = Buffer.from(base64Value, 'base64');
  if (bytes.length === 0) return 0;

  // Check if all bytes are valid ASCII hex characters (0-9, A-F, a-f)
  const allAsciiHex = bytes.every(
    b =>
      (b >= 0x30 && b <= 0x39) || // '0'-'9'
      (b >= 0x41 && b <= 0x46) || // 'A'-'F'
      (b >= 0x61 && b <= 0x66),   // 'a'-'f'
  );

  if (allAsciiHex) {
    // ASCII hex string: "C8" → 200, "0C80" → 3200
    const ascii = bytes.toString('ascii').trim();
    const parsed = parseInt(ascii, 16);
    if (!isNaN(parsed)) return parsed;
  }

  // Raw binary big-endian: [0xC8] → 200, [0x0D, 0x8A] → 3466
  let val = 0;
  for (const b of bytes) {
    val = (val << 8) | b;
  }
  return val;
}
*/
