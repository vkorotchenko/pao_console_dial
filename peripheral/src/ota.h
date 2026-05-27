// ota.h — Over-the-air firmware update state machine for the dial (ESP32-S3
// peripheral). Mirrors the charger's Phase 5 OTA pipeline (Decision #52)
// byte-for-byte on the wire so the mobile decoder is reusable across both
// targets.
//
// Mobile drives the protocol; firmware receives chunks on the OTA chunk
// characteristic (`ff260001-…`, WRITE_NR), notifies status on the OTA status
// characteristic (`ff270001-…`, NOTIFY, 5-byte payload `[code:u8][bytes:u32 LE]`),
// and honours commands 10 / 11 / 12 / 13 on the OTA dispatcher characteristic
// (`ff050001-…`, WRITE).
//
// Differences from the charger:
//   - 128-bit UUIDs throughout; the charger uses 16-bit.
//   - NO force-disable shim. The dial has no high-power TCC stream to mute;
//     non-OTA loop work (LVGL render, I²C, GPS) is gated behind
//     `Ota::isInFlight()` while flash writes are in progress.
//   - Otherwise the state machine, status codes, payload formats, and NVS-
//     based manual rollback are identical to the charger's Phase 5 firmware.
//
// SAFETY GATES (firmware-side):
//   1. Main loop work is paused while OTA is mid-flight (`isInFlight()` true).
//      The display freezes; mobile shows progress.
//   2. The task watchdog is fed aggressively inside `writeChunk()` so flash
//      erase / write stalls don't trip TWDT.
//   3. `Update.end(true)` is called only after bytes_received == total_size.
//   4. `esp_ota_mark_app_valid_cancel_rollback()` is called ONLY from
//      `verify()` (mobile-driven, cmd=13). If verify never fires, the
//      manual NVS recovery (`checkBootRecovery()`) rolls back after 3 boots.
//
// SHA256: mobile verifies the binary before transfer; firmware does NOT
// re-verify the hash. The 32 bytes from OTA_BEGIN are kept for logging only.
// Image integrity comes from Update's internal CRC + dual-bank rollback.
#ifndef OTA_H_
#define OTA_H_

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

// ---------------------------------------------------------------------------
// RTC deferred-install pending flag (Option D, Decision #66).
//
// Lives in RTC slow memory (survives soft reset). Written by end() when the
// streaming phase completes; read by runDeferredOtaInstall() at the very top
// of setup() before any PSRAM-backed subsystem initialises.
//
// Declared here so main.cpp can read s_ota_pending.magic directly for the
// early-boot guard without including ota.cpp internals.
// ---------------------------------------------------------------------------
struct OtaPendingRtc {
    uint32_t magic;       // kOtaPendingMagic sentinel
    uint32_t image_size;
    uint8_t  sha256[32];
    uint32_t attempts;
};
extern OtaPendingRtc s_ota_pending;
constexpr uint32_t kOtaPendingMagic = 0xA0B0C0D0U;

namespace ota {

// Status codes — wire-compatible with charger 0xFF27 (Decision #52). Same
// integer values so the mobile decoder maps both targets through one table.
enum StatusCode : uint8_t {
    STATUS_IDLE              = 0x00,
    STATUS_READY             = 0x01,
    STATUS_ACK               = 0x02,
    STATUS_COMMITTING        = 0x03,
    STATUS_REBOOTING         = 0x04,
    STATUS_VERIFIED          = 0x05,
    STATUS_ERR_BUSY          = 0x10,  // reserved — never emitted on the dial (no busy gate)
    STATUS_ERR_BEGIN_FAILED  = 0x11,
    STATUS_ERR_WRITE_FAILED  = 0x12,
    STATUS_ERR_SIZE_MISMATCH = 0x13,
    STATUS_ERR_END_FAILED    = 0x14,
    STATUS_ERR_BAD_PAYLOAD   = 0x15,
    STATUS_ABORTED           = 0x16,
    STATUS_NOT_PENDING       = 0x17,
};

enum class State {
    IDLE,
    READY,
    RECEIVING,
    COMMITTING,
    REBOOTING,
};

// One ACK every N chunks.  Reduced from 16 → 4 (IWDT fix, Option B):
// the ESP32-S3's OPI flash at 80 MHz can hold the cache disabled for
// 30–200 ms per sector erase inside Update.write().  With 16 chunks per
// window mobile saturates the BLE TX queue and the device accumulates up
// to ~640 ms of flash-write latency before the NimBLE host task can
// service link-layer events.  Android's 5 s BLE supervision timeout fires
// during that burst, and the IWDT (interrupt-level, unaffected by
// vTaskDelay) resets the device on any individual write that crosses a
// 64 KB block boundary (block erase ≈ 100–500 ms on OPI).
//
// Reducing to 4 forces mobile to pause and wait for an ACK every ~1 KB
// (4 × ~244 B MTU chunks).  Each Update.write() still carries the same
// IWDT risk individually, but there are far fewer consecutive writes
// before the BLE host task gets a scheduling turn, so the device can
// maintain the link.
//
// If OTA still crashes after this change escalate to Option C: move
// Update.write() to a dedicated FreeRTOS writer task (priority 1, below
// the NimBLE host task) so flash latency is fully decoupled from BLE.
//
// The charger (ESP32 Feather V2, non-S3, non-OPI) is unaffected and keeps
// OTA_ACK_WINDOW_CHUNKS=16.
#ifndef OTA_ACK_WINDOW_CHUNKS
#define OTA_ACK_WINDOW_CHUNKS 16
#endif

// Early-boot deferred installer (Option D, Decision #66).
// Called from the very top of setup() BEFORE any PSRAM-backed subsystem
// initialises. Checks s_ota_pending.magic; if set, reads /ota_stage.bin from
// SPIFFS and installs via the IDF OTA API. Never returns on success —
// calls ESP.restart(). On failure, clears/decrements the RTC flag and
// returns so normal boot continues on the old image.
void runDeferredOtaInstall();

// Called from cmd dispatcher (cmd=10). Validates the 38-byte payload (cmd
// byte already stripped → 36 bytes here: 4-byte LE total_size + 32-byte
// sha256). Opens /ota_stage.bin on SPIFFS and emits STATUS_READY on success.
void begin(const uint8_t* payload, size_t len);

// Called from the OTA chunk write callback for each WRITE_NR. Forwards to
// `Update.write()`. Emits STATUS_ACK every OTA_ACK_WINDOW_CHUNKS chunks or
// when bytes_received == total_size. Feeds the task watchdog so flash erase
// / write stalls don't trip TWDT.
void writeChunk(const uint8_t* data, size_t len);

// Called from cmd dispatcher (cmd=11). Verifies size, calls Update.end(true),
// sets NVS ota_pending, arms manual rollback, notifies REBOOTING, restarts.
void end();

// Called from cmd dispatcher (cmd=12), the BLE disconnect callback, and the
// stale-transfer watchdog. Calls `Update.abort()` and notifies ABORTED.
void abort(uint8_t reason = STATUS_ABORTED);

// Called from main loop. If state is RECEIVING and no chunks have arrived for
// >10 s, calls abort() to free Update state. No-op outside RECEIVING.
void tickWatchdog();

// Called from cmd dispatcher (cmd=13). If the NVS ota_pending flag is set,
// calls esp_ota_mark_app_valid_cancel_rollback() and clears NVS state.
// Notifies VERIFIED (or NOT_PENDING).
void verify();

// Called once at boot, after BLE init. Logs whether we booted into a pending
// image — informational only. verify() commits or NVS recovery rolls back.
void logBootStatus();

// Manual NVS-based rollback. Called as the very first action in setup() —
// BEFORE display init / BLE / I²C — so a bricked image is caught before any
// subsystem can panic.
//
// WHY: Arduino-ESP32's `Update.end(true)` marks the new partition VALID
// directly, so the IDF bootloader's PENDING_VERIFY auto-rollback never
// engages. We count boot attempts of an unverified image in a dedicated NVS
// namespace ("ota_recovery") and, after 3 failed attempts, swap the boot
// partition back to the one that was running when the OTA committed.
//
// Contract:
//   - Idempotent. Safe to call exactly once per boot. No-op if no OTA pending.
//   - May call ESP.restart() and never return (after a rollback swap).
//   - Touches its own NVS namespace only.
//
// Lifecycle:
//   end()    -> writes pending=1, attempts=0, prev_part=<running subtype>
//   boot 1   -> attempts becomes 1, proceed (may panic and reboot)
//   boot 2   -> attempts becomes 2, proceed
//   boot 3   -> attempts becomes 3, swap to prev_part, clear state, reboot
//   boot 4   -> in safe partition, no state, no-op
//   verify() -> clears all keys; future boots are no-ops
void checkBootRecovery();

// Current state.
State currentState();

// True while OTA is actively flashing (READY / RECEIVING / COMMITTING). The
// main loop reads this to pause LVGL / I²C / GPS work so flash writes get
// the CPU and don't starve other tasks into a watchdog reset. False during
// IDLE and REBOOTING (after Update.end the device is about to restart).
bool isInFlight();

}  // namespace ota

#endif  // OTA_H_
