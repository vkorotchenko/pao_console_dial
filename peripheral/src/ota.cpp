// ota.cpp — Dial OTA state machine. See ota.h for the protocol contract.
//
// This is a near-clone of `charger/src/ota.cpp` (Decision #52) with three
// deltas:
//
//   1. NO force-disable / chargerEnabled shim. The dial doesn't drive an
//      Elcon (no high-power output to mute). Instead, `isInFlight()` returns
//      true while flashing so the main loop can pause LVGL / I²C / GPS work.
//   2. Task-watchdog feed around flash ops in end() -- streaming phase (chunks)
//      never touches flash at all under Option C (PSRAM-buffered OTA).
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
// any synchronous flash op on the BLE host task during OTA can trip the IWDT
// on the S3 OPI flash. The 300 ms IWDT ceiling is baked into the pre-compiled
// arduino-esp32 3.x sdkconfig blob and cannot be raised without rebuilding IDF
// from source. A 64 KB block erase on an OPI flash takes ~400-600 ms while
// disabling the instruction cache, which is well above that ceiling. Even JIT
// 4 KB sector erases interleaved with BLE traffic proved unreliable.
//
// FIX (Option C, Decision #62): PSRAM-buffered OTA.
//   Phase 1 (streaming): chunk callbacks copy bytes into a PSRAM buffer.
//     ZERO flash operations. Cache-disable windows: none. IWDT risk: zero.
//     This phase can run for 10-30 s without any watchdog concern.
//   Phase 2 (install, in end()): BLE streaming is done. All flash ops happen
//     here: erase all sectors one at a time with vTaskDelay() between, then
//     write the image from PSRAM page by page. Since BLE isn't streaming during
//     install, IWDT triggers can't kill us mid-stream. And if IWDT DOES fire
//     during install, the manual NVS rollback path in checkBootRecovery() catches
//     it on the next boot.
//   Tradeoffs:
//     - PSRAM footprint: up to 3 MB allocated for the duration of a session.
//       PSRAM is 8 MB on the dial, so this is fine (Decision #XX).
//     - Brief "frozen display" window during install (~5-15 s depending on image
//       size) -- existing behavior since isInFlight() already pauses the main loop.
//       TODO: drive LVGL progress bar via a separate low-priority task during install.
//     - Partial-write risk (power loss) is now ONLY during the install phase
//       (~5-15 s), not during the stream phase (~10-30 s). Much smaller window.
//       The magic-bytes guard (first 16 bytes written last) limits the blast
//       radius of a partial write.
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

namespace ota {

namespace {

// Each OTA app slot is 3 MB per partitions.csv (Decision #58).
constexpr uint32_t kMaxImageSize = 3 * 1024 * 1024;

// Flash geometry (SPI NOR standard).
constexpr size_t kSectorSize = 4096;  // 4 KB erase granularity -- IWDT-safe duration

// During install (end()), yield every N bytes to keep BLE alive and feed the
// watchdog. 256 KB gives ~50-80 ms of continuous flash work per interval at
// 80 MHz OPI, which is safely inside the 300 ms IWDT window.
constexpr size_t kInstallYieldInterval = 256 * 1024;

State    g_state = State::IDLE;
uint32_t g_total_size = 0;
uint32_t g_bytes_received = 0;
uint32_t g_chunk_count_in_window = 0;
uint8_t  g_expected_sha256[32] = {0};

// Target OTA partition handle, resolved once in begin() and held for the
// duration of the session. NULL means no session is active.
static const esp_partition_t* s_ota_partition = nullptr;

// PSRAM image buffer (Option C). Allocated in begin(), freed in end() or
// resetSession(). All chunk data is memcpy'd here; no flash ops during streaming.
static uint8_t* s_image_buf = nullptr;

// First 16 bytes of the firmware image are stashed and written LAST so that a
// partially-written image cannot appear bootable (matches UpdateClass behavior
// via its _skipBuffer mechanism). Valid once g_bytes_received >= 16.
// Written to flash in end(), not writeChunk().
static uint8_t s_magic_bytes[16] = {0};

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
    s_ota_partition = nullptr;
    // Free the PSRAM image buffer if it was allocated (Option C). Guard against
    // double-free: callers may resetSession() from both error paths and end().
    if (s_image_buf != nullptr) {
        free(s_image_buf);
        s_image_buf = nullptr;
    }
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
// on arduino-esp32 2.x, esp_task_wdt_reset() called from a task that is NOT
// subscribed to TWDT logs a warning and can trigger TG1WDT mid-OTA.
// On arduino-esp32 3.x the bare reset returns ESP_ERR_NOT_FOUND silently,
// so this guard is harmless there.
inline void feedWatchdog() {
    if (esp_task_wdt_status(NULL) == ESP_OK) {
        esp_task_wdt_reset();
    }
}

}  // namespace

State currentState() { return g_state; }

bool isInFlight() {
    // REBOOTING is not "in flight" — install has already committed and
    // ESP.restart() is imminent, so the main loop being paused or not doesn't
    // matter. IDLE is the common case. READY/RECEIVING/COMMITTING are the
    // states where we want the main loop to step aside.
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

    // Resolve the inactive OTA partition via IDF. We do NOT call Update.begin()
    // because UpdateClass triggers flash ops that can trip the IWDT on S3 OPI.
    // See Decision #62 for full root cause analysis.
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

    // --- PSRAM buffer allocation (Option C) ---
    // Verify PSRAM is available before allocating. If PSRAM reports 0 size,
    // BOARD_HAS_PSRAM is set but PSRAM did not initialise (timing, hardware
    // fault, etc.). Refuse the OTA rather than crashing with a null deref later.
    size_t psram_size = ESP.getPsramSize();
    Serial.printf("OTA: PSRAM size reported by ESP.getPsramSize() = %u bytes\n",
                  (unsigned)psram_size);
    Serial.flush();
    if (psram_size == 0) {
        Serial.println("OTA: PSRAM not available -- refusing OTA (BOARD_HAS_PSRAM set but PSRAM init failed)");
        Serial.flush();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }

    s_image_buf = (uint8_t*)heap_caps_malloc(total, MALLOC_CAP_SPIRAM);
    if (s_image_buf == nullptr) {
        Serial.printf("OTA: PSRAM alloc failed for %u bytes (free PSRAM: %u)\n",
                      (unsigned)total, (unsigned)ESP.getFreePsram());
        Serial.flush();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }
    Serial.printf("OTA: allocated %u bytes in PSRAM at %p\n",
                  (unsigned)total, (void*)s_image_buf);
    Serial.flush();

    g_state = State::READY;
    s_ota_last_chunk_millis = millis();  // grace for a slow first chunk
    Serial.printf("OTA: READY -- expecting %u bytes, ack window=%d chunks\n",
                  (unsigned)g_total_size, OTA_ACK_WINDOW_CHUNKS);
    Serial.flush();
    notify(STATUS_READY, 0);
}

void writeChunk(const uint8_t* data, size_t len) {
    // ENTRY BREADCRUMB — first chunk receipt confirms BLE data path is alive.
    if (g_bytes_received == 0) {
        Serial.println("OTA: writeChunk() ENTERED (first chunk)");
        Serial.flush();
    }

    if (len == 0) return;

    if (g_state != State::READY && g_state != State::RECEIVING) {
        // Stray chunk before BEGIN or after END/ABORT -- silently drop.
        return;
    }

    if (s_image_buf == nullptr) {
        Serial.println("OTA: writeChunk called with null PSRAM buffer");
        Serial.flush();
        notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
        resetSession();
        return;
    }

    if (g_bytes_received + len > g_total_size) {
        Serial.printf("OTA: chunk overflow -- received %u + %u > total %u\n",
                      (unsigned)g_bytes_received, (unsigned)len,
                      (unsigned)g_total_size);
        Serial.flush();
        notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
        resetSession();
        return;
    }

    g_state = State::RECEIVING;
    s_ota_last_chunk_millis = millis();

    // --- PSRAM copy (Option C streaming phase) ---
    // No flash operations. No erase. No write. No cache-disable window.
    // IWDT risk: zero. This is why Option C ends the IWDT loop.
    memcpy(s_image_buf + g_bytes_received, data, len);
    g_bytes_received += (uint32_t)len;
    g_chunk_count_in_window++;

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

void end() {
    // ENTRY BREADCRUMB — confirms mobile sent the END command and callback fired.
    Serial.println("OTA: end() ENTERED");
    Serial.flush();
    delay(2);  // drain UART TX FIFO before flash ops begin

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

    if (s_image_buf == nullptr) {
        Serial.println("OTA: end() called with null PSRAM buffer");
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

    // --- INSTALL PHASE (Option C) ---
    // BLE streaming is done. No more chunks are coming. The main loop is paused
    // (isInFlight() == true). All flash ops happen here, serially. If IWDT does
    // fire during install and the device resets, the manual NVS rollback path
    // in checkBootRecovery() will catch it on the next boot.
    //
    // The PSRAM buffer contains the complete, validated image. We erase the OTA
    // partition one sector at a time (yielding between sectors) then write the
    // image page-by-page from PSRAM. Each individual flash op is well inside the
    // 300 ms IWDT window since we yield between them.
    //
    // First-bytes magic guard: stash the first 16 bytes (ESP image magic header)
    // and write them LAST, matching UpdateClass's _skipBuffer behavior. A partial
    // write cannot produce a bootable-looking image because the magic byte is absent.
    // With PSRAM buffering, a partial write can only happen during this install
    // phase (~5-15 s), not during the stream phase (~10-30 s) -- much smaller risk.
    size_t total = (size_t)g_total_size;
    size_t magic_len = (total >= 16) ? 16 : total;
    memcpy(s_magic_bytes, s_image_buf, magic_len);

    // --- Sector erase: full partition, one 4 KB sector at a time ---
    size_t sectors_total = (total + kSectorSize - 1) / kSectorSize;
    Serial.printf("OTA install: erasing %u sectors (%u KB) in partition %s\n",
                  (unsigned)sectors_total,
                  (unsigned)(sectors_total * kSectorSize / 1024),
                  s_ota_partition->label);
    Serial.flush();

    for (size_t off = 0; off < total; off += kSectorSize) {
        size_t erase_size = ((total - off) < kSectorSize) ? (total - off) : kSectorSize;
        // Round up to sector boundary as required by esp_partition_erase_range.
        erase_size = (erase_size + kSectorSize - 1) & ~(kSectorSize - 1);

        feedWatchdog();
        esp_err_t err = esp_partition_erase_range(s_ota_partition, off, erase_size);
        if (err != ESP_OK) {
            Serial.printf("OTA: erase failed at offset=%u err=0x%x\n",
                          (unsigned)off, (unsigned)err);
            Serial.flush();
            notify(STATUS_ERR_END_FAILED, g_bytes_received);
            resetSession();
            return;
        }
        feedWatchdog();

        // Yield every kInstallYieldInterval bytes so BLE host task can service
        // link-layer events (keep-alive) and so we avoid sustained cache-disable
        // bursts that could approach the IWDT window.
        if ((off & (kInstallYieldInterval - 1)) == 0 && off > 0) {
            vTaskDelay(1);
            Serial.printf("OTA install (erase): %u / %u bytes\n",
                          (unsigned)off, (unsigned)total);
            Serial.flush();
        }
    }
    Serial.println("OTA install: erase complete");
    Serial.flush();

    // --- Page write: image body (bytes 16..end) from PSRAM ---
    // Skip the first 16 bytes (magic). We write them last.
    Serial.printf("OTA install: writing image body (%u bytes from offset 16)\n",
                  (unsigned)(total - magic_len));
    Serial.flush();

    for (size_t off = magic_len; off < total; off += kSectorSize) {
        size_t chunk = ((total - off) < kSectorSize) ? (total - off) : kSectorSize;

        feedWatchdog();
        esp_err_t err = esp_partition_write(
            s_ota_partition, off, s_image_buf + off, chunk);
        if (err != ESP_OK) {
            Serial.printf("OTA: write failed at offset=%u len=%u err=0x%x\n",
                          (unsigned)off, (unsigned)chunk, (unsigned)err);
            Serial.flush();
            notify(STATUS_ERR_END_FAILED, g_bytes_received);
            resetSession();
            return;
        }
        feedWatchdog();

        if ((off & (kInstallYieldInterval - 1)) == 0 && off > magic_len) {
            vTaskDelay(1);
            Serial.printf("OTA install (write): %u / %u bytes\n",
                          (unsigned)off, (unsigned)total);
            Serial.flush();
        }
    }

    // --- Write magic bytes last (first-bytes guard) ---
    Serial.printf("OTA install: writing magic bytes (first %u bytes) to offset 0\n",
                  (unsigned)magic_len);
    Serial.flush();
    feedWatchdog();
    esp_err_t merr = esp_partition_write(
        s_ota_partition, 0, s_magic_bytes, magic_len);
    feedWatchdog();
    if (merr != ESP_OK) {
        Serial.printf("OTA: magic bytes write failed err=0x%x\n", (unsigned)merr);
        Serial.flush();
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }
    Serial.println("OTA install: image write complete");
    Serial.flush();

    // PSRAM buffer is no longer needed. Free before marking partition bootable.
    free(s_image_buf);
    s_image_buf = nullptr;

    // --- Mark partition as boot target ---
    // esp_ota_set_boot_partition() updates otadata to point to the new partition
    // on the next boot. Equivalent to what Update.end(true) does internally.
    esp_err_t boot_err = esp_ota_set_boot_partition(s_ota_partition);
    if (boot_err != ESP_OK) {
        Serial.printf("OTA: esp_ota_set_boot_partition failed err=0x%x\n",
                      (unsigned)boot_err);
        Serial.flush();
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        // s_ota_partition is still valid here but image was written; reset cleanly.
        s_ota_partition = nullptr;
        g_state = State::IDLE;
        return;
    }

    Serial.printf("OTA: partition %s set as next boot target\n",
                  s_ota_partition->label);
    Serial.flush();

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
            Serial.flush();
        } else {
            // New image is still bootable but auto-rollback safety net is
            // disabled. USB reflash remains the recovery of last resort.
            Serial.println("OTA: failed to arm manual rollback (NVS begin rw failed)");
            Serial.flush();
        }
    }

    Serial.println("OTA: image committed, rebooting in 100 ms");
    Serial.flush();
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
        Serial.printf("OTA: watchdog -- no chunk for >%u ms, aborting\n",
                      (unsigned)kWatchdogTimeoutMs);
        abort();
    }
}

void verify() {
    if (!readOtaPendingFlag()) {
        Serial.println("OTA VERIFY: no pending flag -- no-op");
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

    Serial.println("OTA: image verified -- rollback cancelled");
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
        Serial.println("OTA: booted into pending image -- awaiting verify() from mobile");
    }
}

}  // namespace ota
