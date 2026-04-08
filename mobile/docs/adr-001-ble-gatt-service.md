# ADR-001: BLE GATT Service Design for PAO Console Dial

**Status:** Accepted  
**Date:** 2025-07-10  
**Author:** Homer (Lead / Architect)  
**Deciders:** Homer, Bart (firmware), Milhouse (mobile)

## Context

The PAO Console Dial ESP32-S3 peripheral currently serves as:
1. A round 540×540 display for EV telemetry (speed, temps, GPS, charge state)
2. A BLE HID keyboard for Spotify media control (via BleKeyboard + NimBLE)

We need to add a BLE GATT service so a React Native mobile app (iOS + Android) can:
- Receive live telemetry at ~2 Hz via BLE notifications
- Send gear commands (PARK / NEUTRAL / DRIVE / REVERSE)
- Read and write charger configuration

The ESP32-S3 already runs NimBLE (`h2zero/NimBLE-Arduino@^1.4.2`, flag `-D USE_NIMBLE`) through the BleKeyboard library. Any new GATT service must coexist with the existing HID service on the same NimBLE server.

### Existing I2C Protocol (actual, 58 bytes)

The controller sends a 58-byte I2C response to the peripheral at address 0x07:

| Offset | Size | Type | Field |
|--------|------|------|-------|
| 0 | 1 | uint8 | Protocol version (0x01) |
| 1 | 1 | uint8 | Message type (0x01 = telemetry) |
| 2–3 | 2 | int16_be | Speed (RPM) |
| 4–5 | 2 | int16_be | Motor temp (°C × 10) |
| 6–7 | 2 | int16_be | Inverter temp (°C × 10) |
| 8–9 | 2 | int16_be | Torque (Nm × 10) |
| 10–11 | 2 | uint16_be | DC Voltage (V × 10) |
| 12–13 | 2 | int16_be | DC Current (A × 10) |
| 14 | 1 | uint8 | Motor state |
| 15 | 1 | uint8 | Status flags (bitfield) |
| 16–19 | 4 | float_be | GPS Latitude (°) |
| 20–23 | 4 | float_be | GPS Longitude (°) |
| 24–27 | 4 | float_be | GPS Speed (km/h) |
| 28–31 | 4 | float_be | GPS Altitude (m) |
| 32 | 1 | uint8 | GPS Satellites |
| 33–38 | 6 | uint8×6 | GPS H, M, S, Day, Mon, Year |
| 39 | 1 | uint8 | Charge percentage |
| 40 | 1 | uint8 | Charge error state |
| 41–42 | 2 | uint16_be | Requested amps (A × 10) |
| 43–44 | 2 | uint16_be | Target voltage (V × 10) |
| 45–46 | 2 | uint16_be | Max charge time (seconds) |
| 47–48 | 2 | uint16_be | Actual voltage (V × 10) |
| 49–50 | 2 | uint16_be | Actual current (A × 10) |
| 51–52 | 2 | uint16_be | Nominal voltage (V × 10) |
| 53–54 | 2 | uint16_be | Max multiplier (× 100) |
| 55 | 1 | uint8 | Min multiplier |
| 56 | 1 | uint8 | Auto nominal flag |
| 57 | 1 | uint8 | XOR checksum (bytes 0–56) |

---

## Decision

### 1. Service UUID

**PAO Telemetry Service:**
```
c909d45a-0560-4725-85e7-c20a9bbb74c2
```

Generated as a random 128-bit UUID per BLE spec §2.5.1. This avoids collision with Bluetooth SIG reserved UUIDs (0x0001–0xFFFF base).

### 2. Characteristic UUIDs

| Characteristic | UUID | Properties | MTU Req |
|----------------|------|------------|---------|
| Telemetry | `c169df83-5127-46df-a18b-066672243018` | Read, Notify | ≥ 39 |
| Gear Command | `b2b08d43-7ec9-40c4-add2-a3a899756607` | Write | — |
| Charger Config | `06ad7ea2-24cc-46fe-b791-78167b76693e` | Read, Write, Notify | — |

Each UUID is independently random. We do not use a shared base UUID because the 16-bit alias optimization only works with the Bluetooth SIG base — for custom services we always transmit full 128-bit UUIDs regardless.

### 3. Telemetry Characteristic — Byte Format (36 bytes)

Notified at ~2 Hz. This is a **purpose-built BLE format**, not a raw passthrough of the I2C packet. Rationale: the I2C packet mixes telemetry and charger config, and its format may change with hardware revisions. Decoupling the BLE API from the wire protocol gives us a stable mobile contract.

| Offset | Size | Type | Field | Unit / Notes |
|--------|------|------|-------|--------------|
| 0 | 1 | uint8 | BLE schema version | `0x01` — bump on breaking changes |
| 1–2 | 2 | int16_be | Speed | RPM (raw from CAN) |
| 3–4 | 2 | int16_be | Motor temp | °C × 10 |
| 5–6 | 2 | int16_be | Inverter temp | °C × 10 |
| 7–8 | 2 | int16_be | Torque | Nm × 10 |
| 9–10 | 2 | uint16_be | DC Voltage | V × 10 |
| 11–12 | 2 | int16_be | DC Current | A × 10 |
| 13 | 1 | uint8 | Motor state | 0=DISABLED, 1=STANDBY, 2=ENABLE, 3=POWERDOWN |
| 14 | 1 | uint8 | Status flags | bit 0=running, 1=fault, 2=warning, 3=ready, 4=GPS fix, 5=pre-charge ready, 6=CAN connected |
| 15 | 1 | uint8 | Gear | 0=NEUTRAL, 1=DRIVE, 2=REVERSE, 3=PARK |
| 16–19 | 4 | float_be | GPS Latitude | degrees |
| 20–23 | 4 | float_be | GPS Longitude | degrees |
| 24–27 | 4 | float_be | GPS Speed | km/h |
| 28–31 | 4 | float_be | GPS Altitude | meters |
| 32 | 1 | uint8 | GPS Satellites | count |
| 33 | 1 | uint8 | Charge percentage | 0–100 % |
| 34 | 1 | uint8 | Charge error state | bitmask from charger |
| 35 | 1 | uint8 | Charge state | 0=Not Charging, 1=Charging, 2=Complete |

**Total: 36 bytes** — requires MTU negotiation (see §8).

**What's excluded from telemetry (and why):**
- GPS time/date: Low priority for real-time telemetry; phone has its own clock
- Charger config fields: Belong in the Charger Config characteristic
- Nominal voltage / multipliers: Charger config, not real-time telemetry

### 4. Gear Command Characteristic — Byte Format (1 byte)

| Offset | Size | Type | Field | Valid Values |
|--------|------|------|-------|-------------|
| 0 | 1 | uint8 | Gear | 0=NEUTRAL, 1=DRIVE, 2=REVERSE, 3=PARK |

**Write type: Write with Response (ATT Write Request, not Write Command)**

Rationale: Gear changes are the most safety-relevant operation over BLE. Write-with-response guarantees the ESP32 received the command and provides an ATT-level acknowledgment. The ESP32 firmware MUST validate the value (0–3) and reject anything else with ATT error `0x80` (Application Error). The firmware then forwards the command to the controller via the existing 4-byte I2C gear command protocol.

The gear enum values (0=NEUTRAL, 1=DRIVE, 2=REVERSE, 3=PARK) match the existing `Gears::Gear` enum and I2C command format.

### 5. Charger Config Characteristic — Byte Format (12 bytes)

Single characteristic with mixed R/W and R-only fields. The mobile app writes only the first 7 bytes; the ESP32 always returns all 12 on read.

| Offset | Size | Type | Field | Access | Unit |
|--------|------|------|-------|--------|------|
| 0–1 | 2 | uint16_be | Target voltage | R/W | V × 10 |
| 2–3 | 2 | uint16_be | Max current | R/W | A × 10 |
| 4 | 1 | uint8 | Target SOC | R/W | 0–100 % |
| 5–6 | 2 | uint16_be | Max charge time | R/W | seconds |
| 7–8 | 2 | uint16_be | Actual voltage | R | V × 10 |
| 9–10 | 2 | uint16_be | Actual current | R | A × 10 |
| 11 | 1 | uint8 | Charge error state | R | bitmask |

**Total: 12 bytes**

**Write behavior:**
- App writes exactly 7 bytes (offsets 0–6, the R/W fields)
- ESP32 validates ranges, then dispatches via the existing `pendingChargeCmd` mechanism → I2C → controller → CAN → ELCON charger
- Writes shorter than 7 bytes are rejected (ATT error `0x0D` Invalid Attribute Length)
- Writes longer than 7 bytes are accepted; extra bytes are ignored (forward compatibility)

**Read behavior:**
- Returns all 12 bytes, including live actual voltage/current from the charger

**Notify:**
- The characteristic also supports Notify. The ESP32 sends notifications when charger state changes (actual voltage/current updates, error state changes). Notification rate: on-change, max 1 Hz.

### 6. Security

**Pairing:** LE Secure Connections with "Just Works" association model.

**Bonding:** Yes — the paired device key is stored in NimBLE's NVS partition. This avoids re-pairing on every connection.

**Encryption:** Required for all write operations. The Gear Command and Charger Config characteristics have the `BLE_GATT_CHR_F_WRITE_ENC` flag set. Read and Notify on Telemetry are open (unauthenticated) to allow the app to display data before pairing completes.

**MITM protection:** Not required in v1. Rationale:
- This is a personal vehicle; attacker must be within ~10m BLE range
- The motor controller independently validates gear transitions (e.g., won't shift to DRIVE at speed from PARK)
- Charger config changes are non-destructive (charger has its own voltage/current limits)
- Adding MITM (numeric comparison) would require UI on the round display — possible but deferred

**Upgrade path:** If MITM is needed later, NimBLE supports numeric comparison. The ESP32-S3's round display can show a 6-digit code. This would require changing `ESP_LE_AUTH_BOND` to `ESP_LE_AUTH_REQ_SC_MITM_BOND` and implementing the `onConfirmPIN` callback.

### 7. BLE Advertising

| Parameter | Value | Notes |
|-----------|-------|-------|
| Device name | `PAO Console` | Changed from `PAO input` to reflect expanded role |
| Advertised service UUIDs | HID Service (0x1812) + PAO Service (c909d45a-...) | Both in scan response data |
| Appearance | 0x03C1 (HID Keyboard) | Unchanged, ensures OS recognizes HID |
| Connectable | Yes | |
| Advertising interval | 100–200 ms (fast) → 1000–1285 ms (slow after 30s) | NimBLE default fast/slow cadence |

The scan response payload carries the PAO service UUID. With two 128-bit UUIDs in advertising data, we approach the 31-byte advertising payload limit. If space is tight, move the PAO service UUID to the scan response data and keep only HID in the primary advertisement — the mobile app can filter on either.

### 8. MTU Negotiation

The telemetry characteristic is 36 bytes, exceeding the default BLE 4.0 ATT payload of 20 bytes. Strategy:

1. **ESP32-S3 side:** NimBLE defaults to MTU 256. No change needed.
2. **Mobile app side:** Call `requestMTU(128)` immediately after connection (both `react-native-ble-plx` and `react-native-ble-manager` support this). iOS negotiates MTU automatically; Android requires explicit request.
3. **Fallback:** If MTU negotiation fails (should not happen on any phone from 2016+), the notification will be truncated by the BLE stack. The schema version byte (offset 0) lets the app detect this.

### 9. Coexistence with BleKeyboard HID Service

**Problem:** BleKeyboard creates the NimBLE server internally in its `begin()` method. We need to add a custom GATT service to the same server.

**Solution:** Subclass BleKeyboard and override the virtual `onStarted(BLEServer* pServer)` callback.

```cpp
class PaoKeyboard : public BleKeyboard {
public:
    PaoKeyboard() : BleKeyboard("PAO Console", "PAO", 100) {}
    
    void onStarted(BLEServer* pServer) override {
        // Add PAO telemetry service here, before advertising starts
        NimBLEService* paoService = pServer->createService(PAO_SERVICE_UUID);
        
        // Create telemetry characteristic (Read + Notify)
        telemetryChar = paoService->createCharacteristic(
            TELEMETRY_CHAR_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
        );
        
        // Create gear characteristic (Write, encrypted)
        gearChar = paoService->createCharacteristic(
            GEAR_CHAR_UUID,
            NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC
        );
        gearChar->setCallbacks(&gearCallbacks);
        
        // Create charger config characteristic (Read + Write encrypted + Notify)
        chargerChar = paoService->createCharacteristic(
            CHARGER_CHAR_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE |
            NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::NOTIFY
        );
        chargerChar->setCallbacks(&chargerCallbacks);
        
        paoService->start();
    }
};
```

**Why this works:**
- `onStarted()` is called after the HID service is created but before advertising begins (line 128 in BleKeyboard.cpp)
- The PAO service gets added to the same GATT server
- BleKeyboard then adds both the HID UUID and (we append) the PAO UUID to advertising
- Both services share the same NimBLE connection — no multi-connection overhead

**Advertising modification:** After `bleKeyboard.begin()`, retrieve the advertising object and add the PAO service UUID:
```cpp
NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
pAdvertising->addServiceUUID(PAO_SERVICE_UUID);
pAdvertising->start();
```

### 10. Trade-offs Considered

#### A. Telemetry format: Raw I2C passthrough vs. purpose-built BLE format

| | Raw I2C passthrough | Purpose-built BLE format ✅ |
|---|---|---|
| ESP32 complexity | Lower (memcpy) | Slightly higher (field mapping) |
| Mobile app coupling | Tight (knows hardware protocol) | Loose (stable BLE contract) |
| Versioning | Hard (I2C changes break app) | Easy (BLE schema version byte) |
| Payload size | 58 bytes (includes charger config) | 36 bytes (telemetry only) |

**Decision:** Purpose-built format. The marginal firmware cost of field mapping is trivial. Decoupling the mobile app from the I2C wire protocol is worth it.

#### B. Single telemetry characteristic vs. multiple (one per field)

| | Single characteristic ✅ | Multiple characteristics |
|---|---|---|
| Notification overhead | 1 notify per update | N notifies per update |
| Atomicity | All fields in one packet | Fields may be from different instants |
| Mobile complexity | Single parse | Multiple subscriptions |
| MTU requirement | 39 bytes | 20 bytes each (default MTU) |

**Decision:** Single characteristic. Modern phones all support MTU negotiation. Atomic snapshots are important for correlated data (voltage + current at same instant).

#### C. Write-with-response vs. write-without-response for gear commands

| | Write-with-response ✅ | Write-without-response |
|---|---|---|
| Reliability | ATT-level ACK | Fire-and-forget |
| Latency | ~1 extra round-trip | Minimal |
| Safety | App knows command was received | App guesses |

**Decision:** Write-with-response. The ~6 ms extra latency is irrelevant for a gear change. Knowing the command was received is critical for UI feedback.

#### D. Separate charger GATT service vs. charger characteristic on PAO service

| | Separate service | Single PAO service ✅ |
|---|---|---|
| GATT complexity | 2 custom services + HID | 1 custom service + HID |
| Advertising payload | Needs 3 UUIDs | Needs 2 UUIDs |
| Discovery | Extra service discovery round | Single discovery |

**Decision:** Single PAO service with three characteristics. Keeps the GATT table compact.

#### E. Security: Just Works vs. Numeric Comparison

| | Just Works ✅ (v1) | Numeric Comparison |
|---|---|---|
| UX friction | Zero | Must confirm 6-digit PIN on both devices |
| MITM protection | None | Yes |
| Implementation | Trivial | Requires display UI on ESP32-S3 |
| Risk context | Personal vehicle, <10m range | Higher security environments |

**Decision:** Just Works with bonding for v1. Numeric comparison can be added in v2 using the round display. The motor controller already validates gear transitions independently.

---

## Implementation Notes

### For Bart (Firmware)

1. **Create `PaoKeyboard` subclass** in a new file `peripheral/src/pao_ble.h/.cpp`. Override `onStarted()` to register the PAO service.
2. **Replace `BleKeyboard bleKeyboard`** in `spotify_screen.cpp` with `PaoKeyboard paoKeyboard`.
3. **Telemetry notify loop:** In `loop()`, every 500 ms, pack the 36-byte telemetry buffer from `GlobalState` fields and call `telemetryChar->notify()`. Only notify if a client has subscribed (check CCCD).
4. **Gear write callback:** Validate value 0–3, set `state.setGear()`, and queue the I2C gear command (existing 4-byte protocol: `0x02, gear, 0x00, XOR`).
5. **Charger write callback:** Parse 7 bytes, validate ranges, dispatch via `pendingChargeCmd` mechanism already in `GlobalState`.
6. **Charger notify:** Trigger notification on charger state change (actual voltage/current or error state change). Rate-limit to 1 Hz.
7. **MTU:** NimBLE defaults to 256. No explicit configuration needed on ESP32 side.
8. **Advertising:** After `paoKeyboard.begin()`, call `NimBLEDevice::getAdvertising()->addServiceUUID(PAO_SERVICE_UUID)` then restart advertising.
9. **Device name:** Change BleKeyboard constructor to `"PAO Console"`.

### For Milhouse (Mobile / React Native)

1. **Scan filter:** Filter by service UUID `c909d45a-0560-4725-85e7-c20a9bbb74c2` during discovery. Do NOT filter by device name (it may change).
2. **MTU:** Call `requestMTU(128)` after connecting (Android). iOS negotiates automatically.
3. **Telemetry subscription:** Subscribe to notifications on `c169df83-5127-46df-a18b-066672243018`. Parse the 36-byte payload per the schema above. Always check byte 0 (schema version = `0x01`).
4. **Gear command:** Write 1 byte to `b2b08d43-7ec9-40c4-add2-a3a899756607` using write-with-response. Handle ATT error `0x80` as "invalid gear value".
5. **Charger config read:** Read `06ad7ea2-24cc-46fe-b791-78167b76693e` for 12-byte payload. Subscribe to notifications for live updates.
6. **Charger config write:** Write exactly 7 bytes to the same characteristic.
7. **Pairing:** Bonding is automatic. First connection triggers Just Works pairing. iOS may show a system pairing dialog.
8. **Reconnection:** Use bonded device info for fast reconnection. NimBLE persists bond keys in NVS.
9. **Byte order:** All multi-byte integers are big-endian. Use `DataView` with big-endian reads in JavaScript.
10. **Recommended BLE library:** `react-native-ble-plx` (better maintained, supports MTU negotiation on both platforms).

---

## Consequences

- The ESP32-S3 firmware grows by ~3 KB flash for the additional GATT service
- NimBLE's RAM usage increases slightly (~1 KB) for the extra service/characteristic handles
- The mobile app can discover and interact with the PAO Console without any knowledge of the I2C or CAN protocols
- Future telemetry fields can be added by bumping the BLE schema version byte
- The charger's existing Adafruit BLE interface (on the SAMD21 Feather M0) remains separate — the mobile app talks to the ESP32-S3, which proxies charger config via I2C → controller → CAN
