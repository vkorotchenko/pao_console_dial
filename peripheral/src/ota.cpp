// ota.cpp — Dial OTA state machine. See ota.h for the protocol contract.
//
// This is a near-clone of `charger/src/ota.cpp` (Decision #52) with three
// deltas:
//
//   1. NO force-disable / chargerEnabled shim. The dial doesn't drive an
//      Elcon (no high-power output to mute). Instead, `isInFlight()` returns
//      true while flashing so the main loop can pause LVGL / I²C / GPS work.
//   2. Aggressive task-watchdog feed inside `writeChunk()` — flash erase /
//      write on ESP32-S3 can stall a few hundred ms; we reset the watchdog
//      around the Update.write call so TWDT doesn't trip if it's enabled.
//   3. Logging goes through Serial.printf (no Logger module on the dial).
//
// Why no SHA256 verification on the firmware side: mobile is responsible for
// hashing the binary before transfer. Update's internal CRC catches in-
// transit corruption, and the dual-bank rollback (manual NVS path) catches a
// bricked image. Adding sha256 in firmware would just double the cost.
//
// --- ESP32-S3 OPI FLASH + IWDT ROOT CAUSE (Decision #62) ---
//
// The crash pattern (TG1WDT_SYS_RST + _DoubleExceptionVector) occurs because
// arduino-esp32's UpdateClass::_writeBuffer() erases a FULL 64 KB block
// (SPI_FLASH_BLOCK_SIZE = 16 x 4 KB) whenever the write offset lands on a
// 64 KB boundary -- which happens on the VERY FIRST write call since both OTA
// partitions (app0=0x20000, app1=0x320000) are 64 KB-aligned. On the ESP32-S3
// with OPI PSRAM sharing the same flash bus, a 64 KB block erase disables the
// instruction cache for ~400-600 ms -- well above the 300 ms IWDT ceiling
// baked into arduino-esp32 3.x sdkconfig. The panic handler itself faults
// (double exception) because it also needs to fetch code from the now-disabled
// cache.
//
// FIX (Option D, Decision #62): bypass UpdateClass::write() entirely.
// We manage the flash write pipeline ourselves using IDF primitives:
//   - esp_partition_erase_range(partition, sector_offset, 4096) -- one 4 KB
//     sector at a time, JIT before each write, with feedWatchdog() +
//     vTaskDelay(1) between sectors. Each 4 KB erase is ~50-80 ms, well
//     inside the 300 ms IWDT window.
//   - esp_partition_write(partition, offset, data, len) -- page-aligned writes.
//     Cache is disabled only for the write duration (~100 us per page).
//   - esp_ota_set_boot_partition() at end() -- same semantic as Update.end().
//   - First-bytes magic guard replicated: first 16 bytes are written last, so
//     a partially-written image cannot appear bootable (matches UpdateClass
//     behavior via its _skipBuffer mechanism).
//
// UpdateClass is kept for abort() only (to reset internal state if a prior
// session left it dirty). It is NOT used for begin/write/end in the new path.

#include "ota.h"

#include <Arduino.h>
#include <Update.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "pao_ble.h"  // for notifyOtaStatus()

// IDF partition write requires 32-bit alignment. Verified: esp_partition_write()
// on non-encrypted partitions accepts any alignment; we satisfy this naturally
// because chunk data arrives as-is from the BLE characteristic value.

namespace ota {

namespace {

// Each OTA app slot is 3 MB per partitions.csv (Decision #58).
constexpr uint32_t kMaxImageSize = 3 * 1024 * 1024;

// Flash geometry (SPI NOR standard).
constexpr size_t kSectorSize = 4096;  // 4 KB erase granularity -- IWDT-safe duration

State    g_state = State::IDLE;
uint32_t g_total_size = 0;
uint32_t g_bytes_received = 0;
uint32_t g_chunk_count_in_window = 0;
uint8_t  g_expected_sha256[32] = {0};

// Direct-write state (Decision #62 bypass path).
// The target OTA partition handle, resolved once in begin() and held for
// the duration of the transfer. NULL means no session is active.
static const esp_partition_t* s_ota_partition = nullptr;

// Highest byte offset (exclusive) within the OTA partition that has already
// been erased by our JIT sector loop. Starts at 0 per session. Monotonically
// increasing -- we never re-erase an already-erased sector.
static size_t s_erased_up_to = 0;

// First 16 bytes of the firmware image are stashed and written LAST so that a
// partially-written image cannot appear bootable (matches UpdateClass behavior).
// Valid only while g_bytes_received >= 16. Written to flash in end().
static uint8_t s_magic_bytes[16] = {0};
static bool    s_magic_written = false;

// Stale-transfer watchdog: timestamp of the most recent successful writeChunk.
// Used by tickWatchdog() to abort sessions where the mobile side stopped
// sending chunks mid-transfer.
static uint32_t s_ota_last_chunk_millis = 0;
constexpr uint32_t kWatchdogTimeoutMs = 10000;

// "ota" namespace — bookkeeping flag indicating that the next boot is the
// first boot of a pending OTA image awaiting cmd=13 verify().
constexpr const char* kNvsNamespace = "ota";
constexpr const char* kNvsKeyPending = "pending";

// "ota_recovery" namespace — manual rollback state. Separate from "ota" so
// future migration of the pending flag doesn't conflict with recovery state.
constexpr const char* kRecoveryNvsNamespace = "ota_recovery";
constexpr const char* kRecoveryKeyPending   = "pending";    // bool: image is awaiting verify()
constexpr const char* kRecoveryKeyAttempts  = "attempts";   // uint32: boot attempts of pending image
constexpr const char* kRecoveryKeyPrevPart  = "prev_part";  // uint8: subtype of the safe partition

constexpr uint32_t kRollbackTriggerAttempts = 3;
constexpr uint32_t kRollbackGiveUpAttempts  = 5;

void resetSession() {
    g_state = State::IDLE;
    g_total_size = 0;
    g_bytes_received = 0;
    g_chunk_count_in_window = 0;
    memset(g_expected_sha256, 0, sizeof(g_expected_sha256));
    // Direct-write path state (Decision #62).
    s_ota_partition = nullptr;
    s_erased_up_to  = 0;
    s_magic_written  = false;
    memset(s_magic_bytes, 0, sizeof(s_magic_bytes));
}

void notify(uint8_t code, uint32_t bytes) {
    notifyOtaStatus(code, bytes);
}

void setOtaPendingFlag(bool value) {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, /*readOnly=*/false)) {
        Serial.println("OTA: NVS begin (rw) failed for ota_pending");
        return;
    }
    prefs.putBool(kNvsKeyPending, value);
    prefs.end();
}

bool readOtaPendingFlag() {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, /*readOnly=*/true)) {
        return false;
    }
    bool v = prefs.getBool(kNvsKeyPending, false);
    prefs.end();
    return v;
}

// Best-effort task-watchdog feed. Gated on TWDT subscription state because
// on arduino-esp32 2.x (see Decision #59 for the framework-pin context),
// esp_task_wdt_reset() called from a task that is NOT subscribed to TWDT
// logs `task_wdt: esp_task_wdt_reset(N): task not found` to Serial on every
// invocation. writeChunk() runs on the NimBLE callback task — which is not
// TWDT-subscribed — so feeding it twice per chunk floods the UART and ends
// with a TG1WDT system reset mid-OTA. Gate the reset so unsubscribed tasks
// are a true no-op. On arduino-esp32 3.x the bare reset returns
// ESP_ERR_NOT_FOUND silently, so this guard is harmless there.
inline void feedWatchdog() {
    if (esp_task_wdt_status(NULL) == ESP_OK) {
        esp_task_wdt_reset();
    }
}

}  // namespace

State currentState() { return g_state; }

bool isInFlight() {
    // REBOOTING is not "in flight" — Update.end() has already committed and
    // ESP.restart() is imminent, so the main loop being paused or not doesn't
    // matter. IDLE is the common case. READY/RECEIVING/COMMITTING are the
    // states where flash is being actively written and we want the main loop
    // to step aside.
    switch (g_state) {
        case State::READY:
        case State::RECEIVING:
        case State::COMMITTING:
            return true;
        default:
            return false;
    }
}

void begin(const uint8_t* payload, size_t len) {
    // ENTRY BREADCRUMB — must appear first, before any code that could crash.
    // If even this line is missing from serial output, the BLE callback path
    // is not reaching ota::begin() at all (stack overflow, fault in caller, etc.)
    Serial.println("OTA: begin() ENTERED");
    Serial.flush();
    delay(2);  // give UART hardware time to physically drain the TX FIFO

    Serial.printf("OTA BEGIN: payload_len=%u state=%d\n",
                  (unsigned)len, (int)g_state);
    Serial.flush();

    if (payload == nullptr || len != 36) {
        Serial.printf("OTA: bad payload length %u (want 36)\n", (unsigned)len);
        Serial.flush();
        notify(STATUS_ERR_BAD_PAYLOAD, 0);
        return;
    }

    // Abandon any prior session.
    if (g_state == State::RECEIVING || g_state == State::READY) {
        Serial.println("OTA: dropping previous session before new BEGIN");
        Serial.flush();
        Update.abort();
        resetSession();
    }

    // Parse: 4-byte LE total_size, 32 bytes sha256.
    uint32_t total = (uint32_t)payload[0]
                   | ((uint32_t)payload[1] << 8)
                   | ((uint32_t)payload[2] << 16)
                   | ((uint32_t)payload[3] << 24);

    Serial.printf("OTA: parsed total_size=%u\n", (unsigned)total);
    Serial.flush();

    if (total == 0 || total > kMaxImageSize) {
        Serial.printf("OTA: rejected total_size=%u (max=%u)\n",
                      (unsigned)total, (unsigned)kMaxImageSize);
        Serial.flush();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        return;
    }

    g_total_size = total;
    g_bytes_received = 0;
    g_chunk_count_in_window = 0;
    memcpy(g_expected_sha256, payload + 4, sizeof(g_expected_sha256));

    // Resolve the inactive OTA partition directly via IDF rather than via
    // Update.begin(). We do NOT call Update.begin() because UpdateClass's
    // _writeBuffer() triggers a 64 KB block erase on the very first write
    // (the OTA partition base address is 64 KB-aligned), which holds the
    // ESP32-S3 instruction cache disabled for ~400-600 ms and trips the
    // 300 ms Interrupt Watchdog (IWDT). See Decision #62 for full root cause.
    Serial.println("OTA: calling esp_ota_get_next_update_partition...");
    Serial.flush();
    s_ota_partition = esp_ota_get_next_update_partition(NULL);
    if (s_ota_partition == nullptr) {
        Serial.println("OTA: esp_ota_get_next_update_partition returned NULL");
        Serial.flush();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }

    Serial.printf("OTA: target partition=%s addr=0x%06x size=%u\n",
                  s_ota_partition->label,
                  (unsigned)s_ota_partition->address,
                  (unsigned)s_ota_partition->size);
    Serial.flush();

    if (total > s_ota_partition->size) {
        Serial.printf("OTA: image too large (%u > partition %u)\n",
                      (unsigned)total, (unsigned)s_ota_partition->size);
        Serial.flush();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }

    // s_erased_up_to starts at 0 -- no sectors erased yet. The JIT sector
    // loop in writeChunk() erases one 4 KB sector at a time just ahead of
    // each write call, keeping every cache-disable window under ~80 ms.
    // s_magic_written tracks whether the deferred first-16-bytes write has
    // been committed to flash yet (it happens in end(), not writeChunk()).
    s_erased_up_to  = 0;
    s_magic_written = false;

    g_state = State::READY;
    s_ota_last_chunk_millis = millis();  // grace for a slow first chunk
    Serial.printf("OTA: READY -- expecting %u bytes, ack window=%d chunks\n",
                  (unsigned)g_total_size, OTA_ACK_WINDOW_CHUNKS);
    Serial.flush();
    notify(STATUS_READY, 0);
}

void writeChunk(const uint8_t* data, size_t len) {
    // ENTRY BREADCRUMB — first chunk receipt confirms BLE data path is alive.
    // If begin() ENTERED appeared but this never does, STATUS_READY notify was
    // lost or mobile never started sending chunks.
    if (g_bytes_received == 0) {
        Serial.println("OTA: writeChunk() ENTERED (first chunk)");
        Serial.flush();
    }

    if (len == 0) return;

    if (g_state != State::READY && g_state != State::RECEIVING) {
        // Stray chunk before BEGIN or after END/ABORT -- silently drop to
        // avoid amplifying state mismatches into a notify storm.
        return;
    }

    if (s_ota_partition == nullptr) {
        // Should not happen: partition is set in begin() before READY.
        Serial.println("OTA: writeChunk called with null partition handle");
        Serial.flush();
        notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
        resetSession();
        return;
    }

    g_state = State::RECEIVING;
    s_ota_last_chunk_millis = millis();

    // TIMING INSTRUMENTATION -- always on; remove after OTA is stable.
    // These Serial.printf calls are fast (<1 ms) and do NOT hold the cache
    // disabled. They let Vadim confirm write timing per chunk.
    //
    // IWDT ROOT CAUSE NOTE (preserved for history, resolved by Decision #62):
    //   The previous code called Update.write() which internally calls
    //   _writeBuffer() -> ESP.partitionEraseRange(). On the first write, the
    //   OTA partition base address is 64 KB-aligned, so UpdateClass chose a
    //   FULL 64 KB block erase. On ESP32-S3 with OPI PSRAM sharing the flash
    //   bus, this disables the instruction cache for ~400-600 ms, tripping the
    //   300 ms IWDT. The panic handler itself faulted (DoubleExceptionVector)
    //   because it also fetches code from the now-disabled cache.
    //
    //   The fix bypasses UpdateClass entirely. We call esp_partition_erase_range
    //   one 4 KB sector at a time (JIT, just before each write), with
    //   feedWatchdog() + vTaskDelay(1) between sectors. Each 4 KB erase is
    //   ~50-80 ms -- well inside the 300 ms IWDT window.
    uint32_t t0 = millis();
    Serial.printf("OTA chunk: off=%u len=%u\n",
                  (unsigned)g_bytes_received, (unsigned)len);

    // --- First-bytes magic guard ---
    // The first 16 bytes of the firmware image contain the ESP image magic
    // header byte (0xE9). We stash them and write them LAST (in end()) so
    // that a partially-written image cannot appear bootable. This mirrors
    // UpdateClass's _skipBuffer mechanism.
    //
    // chunk_write_offset: where in the partition this chunk's payload goes.
    // chunk_data / chunk_len: what actually gets written to flash this call
    //   (may differ from data/len if we're handling the deferred magic bytes).
    size_t chunk_write_offset = g_bytes_received;
    const uint8_t* chunk_data = data;
    size_t chunk_len = len;
    bool skip_flash_write = false;

    if (g_bytes_received == 0) {
        // Very first chunk. Stash leading 16 bytes; skip them in the write.
        size_t stash_bytes = (len >= 16) ? 16 : len;
        memcpy(s_magic_bytes, data, stash_bytes);
        if (len <= 16) {
            // Entire chunk is the magic header; nothing to write to flash yet.
            // Just advance the receive counter and ACK as usual.
            skip_flash_write = true;
            Serial.printf("OTA wrote: dt=0ms total=%u (magic stashed, no flash write)\n",
                          (unsigned)(g_bytes_received + len));
        } else {
            chunk_write_offset = 16;
            chunk_data = data + 16;
            chunk_len  = len - 16;
        }
    }

    if (!skip_flash_write) {
        // --- JIT sector erase (Decision #62 fix) ---
        // Erase every 4 KB sector this chunk will touch that has not yet been
        // erased. s_erased_up_to tracks the exclusive high-water mark of
        // erased bytes in the partition. Sectors are erased in order from low
        // to high; we never re-erase.
        //
        // Worst case per chunk: the chunk crosses a single sector boundary
        // -> one 4 KB erase (~50-80 ms). Typical case: chunk lands within an
        // already-erased sector -> zero erases (the hot path).
        size_t write_end = chunk_write_offset + chunk_len;
        while (s_erased_up_to < write_end) {
            feedWatchdog();
            uint32_t te0 = millis();
            esp_err_t err = esp_partition_erase_range(
                s_ota_partition, s_erased_up_to, kSectorSize);
            uint32_t te_dt = millis() - te0;
            if (err != ESP_OK) {
                Serial.printf("OTA: sector erase failed at offset=%u err=0x%x dt=%ums\n",
                              (unsigned)s_erased_up_to, (unsigned)err,
                              (unsigned)te_dt);
                notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
                resetSession();
                return;
            }
            Serial.printf("OTA erase: sector_off=%u dt=%ums\n",
                          (unsigned)s_erased_up_to, (unsigned)te_dt);
            s_erased_up_to += kSectorSize;
            // Yield between sector erases so BLE host task stays alive.
            // vTaskDelay(1) releases the CPU for one FreeRTOS tick (~1 ms).
            feedWatchdog();
            vTaskDelay(1);
        }

        // --- Direct partition write ---
        // esp_partition_write() on non-encrypted partitions (our case) handles
        // byte-unaligned offsets via the IDF spi_flash HAL. The S3 write
        // granularity for plain (non-encrypted) flash is 1 byte.
        feedWatchdog();
        uint32_t tw0 = millis();
        esp_err_t werr = esp_partition_write(
            s_ota_partition, chunk_write_offset,
            chunk_data, chunk_len);
        uint32_t tw_dt = millis() - tw0;

        feedWatchdog();

        Serial.printf("OTA wrote: dt=%ums total=%u (erase+write)\n",
                      (unsigned)(millis() - t0),
                      (unsigned)(g_bytes_received + len));

        if (werr != ESP_OK) {
            Serial.printf("OTA: esp_partition_write failed at offset=%u len=%u err=0x%x dt=%ums\n",
                          (unsigned)chunk_write_offset, (unsigned)chunk_len,
                          (unsigned)werr, (unsigned)tw_dt);
            notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
            resetSession();
            return;
        }

        // Yield so the NimBLE host task can service link-layer events between
        // writes. vTaskDelay(1) gives the scheduler one tick (~1 ms).
        vTaskDelay(1);
    }

    g_bytes_received += (uint32_t)len;
    g_chunk_count_in_window++;

    // Emit ACK every window OR when the transfer is complete (so the tail
    // partial-window doesn't strand mobile waiting for one last ACK).
    {
        bool window_full = (g_chunk_count_in_window >= OTA_ACK_WINDOW_CHUNKS);
        bool transfer_complete = (g_bytes_received >= g_total_size);

        if (window_full || transfer_complete) {
            g_chunk_count_in_window = 0;
            Serial.printf("OTA: ACK at %u / %u%s\n",
                          (unsigned)g_bytes_received, (unsigned)g_total_size,
                          transfer_complete ? " (final)" : "");
            notify(STATUS_ACK, g_bytes_received);
        }
    }
}

void end() {
    // ENTRY BREADCRUMB — confirms mobile sent the END command and callback fired.
    Serial.println("OTA: end() ENTERED");
    Serial.flush();

    Serial.printf("OTA END: state=%d bytes=%u total=%u\n",
                  (int)g_state, (unsigned)g_bytes_received,
                  (unsigned)g_total_size);
    Serial.flush();

    if (g_state != State::RECEIVING && g_state != State::READY) {
        Serial.printf("OTA: END in unexpected state %d\n", (int)g_state);
        Serial.flush();
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        return;
    }

    if (s_ota_partition == nullptr) {
        Serial.println("OTA: end() called with null partition handle");
        Serial.flush();
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }

    if (g_bytes_received != g_total_size) {
        Serial.printf("OTA: size mismatch -- got %u, expected %u\n",
                      (unsigned)g_bytes_received, (unsigned)g_total_size);
        Serial.flush();
        notify(STATUS_ERR_SIZE_MISMATCH, g_bytes_received);
        resetSession();
        return;
    }

    g_state = State::COMMITTING;
    notify(STATUS_COMMITTING, g_bytes_received);

    // --- Write deferred magic bytes (Decision #62 first-bytes guard) ---
    // The first 16 bytes were stashed in s_magic_bytes during the first chunk
    // and skipped during writeChunk() writes. Now that the full image body is
    // committed to flash and integrity is confirmed by size match, write them.
    // This is the last thing written before marking the partition bootable,
    // matching UpdateClass's _enablePartition() + _skipBuffer pattern.
    //
    // The sector containing offset 0 was already erased by the JIT loop in
    // writeChunk() during the first chunk, so no erase is needed here.
    if (!s_magic_written) {
        Serial.printf("OTA: writing deferred magic bytes (first 16 bytes) to offset 0\n");
        feedWatchdog();
        esp_err_t merr = esp_partition_write(
            s_ota_partition, 0, s_magic_bytes, sizeof(s_magic_bytes));
        feedWatchdog();
        if (merr != ESP_OK) {
            Serial.printf("OTA: magic bytes write failed err=0x%x\n", (unsigned)merr);
            notify(STATUS_ERR_END_FAILED, g_bytes_received);
            resetSession();
            return;
        }
        s_magic_written = true;
        Serial.printf("OTA: magic bytes written OK\n");
    }

    // --- Mark partition as boot target ---
    // esp_ota_set_boot_partition() updates otadata to point to the new
    // partition on the next boot. Equivalent to what Update.end(true) does
    // internally via _verifyEnd() -> esp_ota_set_boot_partition().
    esp_err_t boot_err = esp_ota_set_boot_partition(s_ota_partition);
    if (boot_err != ESP_OK) {
        Serial.printf("OTA: esp_ota_set_boot_partition failed err=0x%x\n",
                      (unsigned)boot_err);
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }

    Serial.printf("OTA: partition %s set as next boot target\n",
                  s_ota_partition->label);

    setOtaPendingFlag(true);

    // Arm manual NVS rollback. Records the currently-running partition (the
    // "safe" image to swap back to) and resets the boot-attempt counter.
    // checkBootRecovery() will increment attempts on every subsequent boot
    // and swap back if it hits kRollbackTriggerAttempts.
    {
        Preferences nvs;
        if (nvs.begin(kRecoveryNvsNamespace, /*readOnly=*/false)) {
            const esp_partition_t* running = esp_ota_get_running_partition();
            uint8_t prev_subtype = running ? (uint8_t)running->subtype : 0xFF;
            nvs.putBool(kRecoveryKeyPending, true);
            nvs.putUInt(kRecoveryKeyAttempts, 0);
            nvs.putUChar(kRecoveryKeyPrevPart, prev_subtype);
            nvs.end();
            Serial.printf("OTA: armed manual rollback (prev_part subtype=0x%02x)\n",
                          prev_subtype);
        } else {
            // New image is still bootable but auto-rollback safety net is
            // disabled. USB reflash remains the recovery of last resort.
            Serial.println("OTA: failed to arm manual rollback (NVS begin rw failed)");
        }
    }

    Serial.println("OTA: image committed, rebooting in 100 ms");
    notify(STATUS_REBOOTING, g_bytes_received);

    g_state = State::REBOOTING;

    // Give NimBLE a moment to push REBOOTING before we vanish.
    delay(100);
    ESP.restart();
}

void abort(uint8_t reason) {
    Serial.printf("OTA ABORT: state=%d bytes=%u reason=0x%02x\n",
                  (int)g_state, (unsigned)g_bytes_received, (unsigned)reason);
    bool wasActive = (g_state == State::RECEIVING || g_state == State::READY);
    if (wasActive) {
        Update.abort();
    }
    resetSession();
    notify(reason, 0);
}

void tickWatchdog() {
    // Only fires while we're actively receiving chunks. READY is intentionally
    // excluded — the first chunk will set s_ota_last_chunk_millis again.
    if (g_state != State::RECEIVING) return;
    uint32_t now = millis();
    if ((now - s_ota_last_chunk_millis) > kWatchdogTimeoutMs) {
        Serial.printf("OTA: watchdog — no chunk for >%u ms, aborting\n",
                      (unsigned)kWatchdogTimeoutMs);
        abort();
    }
}

void verify() {
    if (!readOtaPendingFlag()) {
        Serial.println("OTA VERIFY: no pending flag — no-op");
        notify(STATUS_NOT_PENDING, 0);
        return;
    }

    esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
    if (err != ESP_OK) {
        // Rare. If this fails the manual-rollback NVS path will still kick in
        // on the next reboot. Surface so mobile knows verification didn't take.
        Serial.printf("OTA: mark_app_valid_cancel_rollback err=%d\n", (int)err);
        notify(STATUS_ERR_END_FAILED, 0);
        return;
    }

    setOtaPendingFlag(false);

    // Clear manual-rollback state. From this point future boots are no-ops in
    // checkBootRecovery().
    {
        Preferences nvs;
        if (nvs.begin(kRecoveryNvsNamespace, /*readOnly=*/false)) {
            nvs.clear();
            nvs.end();
            Serial.println("OTA: cleared manual rollback state");
        } else {
            Serial.println("OTA: verify could not clear recovery NVS (begin rw failed)");
        }
    }

    Serial.println("OTA: image verified — rollback cancelled");
    notify(STATUS_VERIFIED, 0);
}

void checkBootRecovery() {
    // Output goes through Serial.printf (not any logger) so a recovery
    // decision is visible regardless of log-level configuration.
    Preferences nvs;
    if (!nvs.begin(kRecoveryNvsNamespace, /*readOnly=*/false)) {
        // Namespace doesn't exist (clean device, first boot, or never OTA'd).
        return;
    }

    bool pending = nvs.getBool(kRecoveryKeyPending, false);
    if (!pending) {
        nvs.end();
        return;
    }

    // Increment unconditionally so a power-cycle without cmd=13 still trips
    // rollback after the threshold. cmd=13 is the only way to clear the count.
    uint32_t attempts = nvs.getUInt(kRecoveryKeyAttempts, 0) + 1;

    if (attempts >= kRollbackGiveUpAttempts) {
        Serial.printf("[ota-recovery] %u attempts exhausted, giving up; clearing state. USB reflash required.\n",
                      (unsigned)attempts);
        Serial.flush();
        nvs.clear();
        nvs.end();
        return;
    }

    if (attempts >= kRollbackTriggerAttempts) {
        uint8_t prev_subtype = nvs.getUChar(kRecoveryKeyPrevPart, 0xFF);
        Serial.printf("[ota-recovery] %u failed boots; rolling back to partition subtype 0x%02x\n",
                      (unsigned)attempts, prev_subtype);
        Serial.flush();

        const esp_partition_t* safe = esp_partition_find_first(
            ESP_PARTITION_TYPE_APP,
            (esp_partition_subtype_t)prev_subtype,
            NULL);

        if (safe) {
            esp_err_t err = esp_ota_set_boot_partition(safe);
            if (err == ESP_OK) {
                Serial.printf("[ota-recovery] boot partition set to %s, clearing state and rebooting\n",
                              safe->label);
                Serial.flush();
                nvs.clear();
                nvs.end();
                delay(100);
                ESP.restart();
                // unreachable
            }
            Serial.printf("[ota-recovery] esp_ota_set_boot_partition failed err=%d; clearing state and proceeding\n",
                          (int)err);
            Serial.flush();
            nvs.clear();
            nvs.end();
            return;
        }

        Serial.println("[ota-recovery] could not locate safe partition; clearing state and proceeding");
        Serial.flush();
        nvs.clear();
        nvs.end();
        return;
    }

    nvs.putUInt(kRecoveryKeyAttempts, attempts);
    nvs.end();
    Serial.printf("[ota-recovery] pending image, boot attempt %u/%u\n",
                  (unsigned)attempts, (unsigned)kRollbackTriggerAttempts);
    Serial.flush();
}

void logBootStatus() {
    bool pending = readOtaPendingFlag();
    const esp_partition_t* running = esp_ota_get_running_partition();
    Serial.printf("OTA boot: running=%s pending_flag=%d\n",
                  running ? running->label : "?", (int)pending);
    if (pending) {
        Serial.println("OTA: booted into pending image — awaiting verify() from mobile");
    }
}

}  // namespace ota
