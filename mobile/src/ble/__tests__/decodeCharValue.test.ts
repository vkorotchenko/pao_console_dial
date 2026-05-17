import {Buffer} from 'buffer';
import {decodeCharValue} from '../decodeCharValue';

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Simulate raw binary big-endian encoding (NimBLE firmware path). */
function binaryEncode(val: number, byteCount = 1): string {
  const buf = Buffer.alloc(byteCount);
  for (let i = byteCount - 1; i >= 0; i--) {
    buf[i] = val & 0xff;
    val >>>= 8;
  }
  return buf.toString('base64');
}

/** C++ (uint8_t) cast — truncate to 8 bits. */
const uint8 = (v: number) => v & 0xff;

/** C++ (uint16_t) cast — truncate to 16 bits. */
const uint16 = (v: number) => v & 0xffff;

// ---------------------------------------------------------------------------
// Firmware default constants (mirrors config.h)
// ---------------------------------------------------------------------------
const NOMINAL_VOLTAGE   = 1600;  // 160.0 V × 10
const MAX_AMPS          = 100;   // 10.0 A × 10
const MAX_CHARGE_TIME   = 43200; // 12 h in seconds
const NOM_MAX_MULT_X100 = 114;   // 1.14 × 100
const NOM_MIN_MULT_X100 = 81;    // 0.81 × 100
const TARGET_PCT_X1000  = 950;   // 0.95 × 1000

// Computed values (mirrors Config.cpp)
const nomMaxMult  = NOM_MAX_MULT_X100 / 100;                                    // 1.14
const nomMinMult  = NOM_MIN_MULT_X100 / 100;                                    // 0.81
const absMaxV     = uint16(Math.round(NOMINAL_VOLTAGE * nomMaxMult));           // 1824
const absMinV     = uint16(Math.round(NOMINAL_VOLTAGE * nomMinMult));           // 1296
const targetPct   = TARGET_PCT_X1000 / 1000;                                    // 0.95
const targetV     = Math.round(absMinV + targetPct * (absMaxV - absMinV));      // 1798

// ---------------------------------------------------------------------------
// Parameterized: all integers 0–5000
// ---------------------------------------------------------------------------
const allValues: [number][] = Array.from({length: 5001}, (_, i) => [i]);

test.each(allValues)(
  'binaryEncode(%i) round-trips to %i',
  val => {
    expect(decodeCharValue(binaryEncode(val, val > 255 ? 2 : 1))).toBe(val);
  },
);

// ---------------------------------------------------------------------------
// Per-characteristic tests using actual firmware default values
//
// Columns:
//   charName    — BLE characteristic name (UUID in ble.cpp)
//   firmwareInt — the C++ integer value sent as raw binary big-endian
//   divisor     — mobile divides decoded by this to get human-readable units
//   expected    — expected human-readable value
// ---------------------------------------------------------------------------
type CharCase = [charName: string, firmwareInt: number, divisor: number, expected: number];

const characteristicCases: CharCase[] = [
  // --- Config / seed values (static, from EEPROM defaults) ---
  ['targetVoltage  0x2A1B', targetV,                       10,  179.8], // 1798 → 179.8 V
  ['targetAmps     0x2A1A', MAX_AMPS,                      10,  10.0 ], // 100  → 10.0 A
  ['nominalVolt    0xFF20', uint16(NOMINAL_VOLTAGE),        10,  160.0], // 1600 → 160.0 V
  ['maxMultiplier  0xFF21', uint8(NOM_MAX_MULT_X100),      100,  1.14 ], // 114  → 1.14
  ['minMultiplier  0xFF22', uint8(NOM_MIN_MULT_X100),      100,  0.81 ], // 81   → 0.81
  ['absMaxVoltage  0xFF23', absMaxV,                        10,  182.4], // 1824 → 182.4 V
  ['absMinVoltage  0xFF24', absMinV,                        10,  129.6], // 1296 → 129.6 V
  ['cfgMaxCurrent  0xFF01', MAX_AMPS,                       10,  10.0 ], // 100  → 10.0 A
  ['cfgTargetPct   0xFF02', TARGET_PCT_X1000,               10,  95.0 ], // 950  → 95.0 %
  ['cfgMaxTime     0xFF03', MAX_CHARGE_TIME,                 1,  43200], // 43200 s
  ['cfgOnOff       0xFF06', 1,                               1,  1    ], // seed: always 1 (enabled)

  // --- Live telemetry (example measured values) ---
  ['currentVoltage 0x2BED — typical charging',   1540,  10,  154.0], // 154.0 V
  ['currentVoltage 0x2BED — full charge',        absMaxV, 10, 182.4], // at absMaxV
  ['currentAmps    0x2BF0 — mid charge',         64,    10,  6.4  ], // 6.4 A (CV taper)
  ['currentAmps    0x2BF0 — max (=MAX_AMPS)',    MAX_AMPS, 10, 10.0], // 10.0 A
  ['currentAmps    0x2BF0 — idle (0)',           0,     10,  0    ], // 0 A
  ['runningTime    0x2BEE — 1 hour',             3600,   1,  3600 ], // 3600 s
  ['runningTime    0x2BEE — max charge time',    MAX_CHARGE_TIME, 1, 43200],

  // --- Status values ---
  ['chargeState    0xFF10 — charging (0)',        0,      1,  0    ], // 0 = active
  ['chargeState    0xFF10 — stopped  (1)',        1,      1,  1    ], // 1 = stopped
  ['socPercent     0xFF11 — level 1 (0–20 %)',   25,     1,  25   ], // soc=1 → 25
  ['socPercent     0xFF11 — level 2 (20–50 %)',  50,     1,  50   ], // soc=2 → 50
  ['socPercent     0xFF11 — level 3 (50–90 %)',  75,     1,  75   ], // soc=3 → 75
  ['socPercent     0xFF11 — level 4 (90–100 %)', 100,    1,  100  ], // soc=4 → 100
  ['errorState     0xFF12 — no error',           0,      1,  0    ], // clean
  ['errorState     0xFF12 — overheating (bit1)', 0x02,   1,  2    ], // bit 1
  ['errorState     0xFF12 — all bits set',       0x1f,   1,  31   ], // bits 0-4
];

test.each(characteristicCases)(
  '%s: firmware sends %i → decoded÷%i = %f',
  (_, firmwareInt, divisor, expected) => {
    const decoded = decodeCharValue(binaryEncode(firmwareInt, 2));
    expect(decoded / divisor).toBeCloseTo(expected, 5);
  },
);

// ---------------------------------------------------------------------------
// Binary bytes in the 'a'-'f' ASCII range decode correctly (no hex mis-decode)
// ---------------------------------------------------------------------------
const binaryByteCases: [number, number][] = [
  [0x61, 97],   // 'a'
  [0x62, 98],   // 'b'
  [0x63, 99],   // 'c'
  [0x64, 100],  // 'd' — MAX_AMPS=100 as raw byte
  [0x65, 101],  // 'e'
  [0x66, 102],  // 'f'
];

test.each(binaryByteCases)(
  'raw binary byte 0x%s decodes to %i',
  (byte, expected) => {
    expect(decodeCharValue(binaryEncode(byte))).toBe(expected);
  },
);
