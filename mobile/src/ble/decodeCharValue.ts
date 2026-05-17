import {Buffer} from 'buffer';

/**
 * Decode a BLE characteristic value from base64.
 *
 * The NimBLE firmware sends all characteristic values as raw big-endian binary.
 * For example, value 1798 (0x0706) is stored as the bytes [0x07, 0x06].
 */
export function decodeCharValue(base64Value: string): number {
  const bytes = Buffer.from(base64Value, 'base64');
  if (bytes.length === 0) return 0;
  let val = 0;
  for (const b of bytes) {
    val = (val << 8) | b;
  }
  return val;
}
