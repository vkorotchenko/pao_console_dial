// ota.cpp — Dial OTA state machine. See ota.h for the protocol contract.
//
// This is a near-clone of `charger/src/ota.cpp` (Decision #52) with three
// deltas:
//
//   1. NO force-disable / chargerEnabled shim. The dial doesn't drive an
//      Elcon (no high-power output to mute). Instead, `isInFlight()` returns
//      true while flashing so the main loop can pause LVGL / I²C / GPS work.
//   2. Streaming phase writes to SPIFFS, not PSRAM. Flash ops are deferred to
//      early boot (before any PSRAM-dependent subsystem initialises).
//   3. Logging goes through Serial.printf (no Logger module on the dial).
//
// Why no SHA256 verification on the firmware side: mobile is responsible for
// hashing the binary before transfer. The dual-bank rollback (manual NVS path)
// catches a bricked image. Adding sha256 in firmware would just double the cost.
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
// FIX Option C (PSRAM-buffered, Decision #62) also hung at esp_ota_begin on
// the S3 OPI config. The PSRAM bus is actively cached by the time install()
// runs, and the combined flash-bus / OPI-PSRAM-bus contention under
// cache-disable causes the SPI controller to deadlock.
//
// FIX Option D (deferred-install via SPIFFS, Decision #66):
//   Phase 1 (streaming): chunk callbacks write bytes to /ota_stage.bin on
//     SPIFFS. ZERO flash erase operations against the OTA partition.
//     IWDT risk: zero. PSRAM is NOT involved in the streaming path.
//   Phase 2 (flag + reboot): end() validates the staged file, sets an
//     RTC_NOINIT_ATTR pending flag, notifies mobile, and calls ESP.restart().
//   Phase 3 (early-boot install, runDeferredOtaInstall()): called from the
//     very top of setup() BEFORE display, BLE, or PSRAM-backed subsystems
//     initialise. PSRAM bus is quiet. Flash erase should proceed cleanly.
//     Image is read from SPIFFS in 4 KB internal-SRAM chunks, written via
//     the IDF OTA API (esp_ota_begin / esp_ota_write / esp_ota_end).
//
// UpdateClass is kept for abort() only (to reset internal state if a prior
// session left it dirty). It is NOT used for begin/write/end in the new path.

#include "ota.h"

#include <Arduino.h>
#include <esp_log.h>
#include <Update.h>
#include <Preferences.h>
#include <SPIFFS.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <soc/timer_group_reg.h>
#include <soc/wdt_periph.h>
#include <soc/rtc_cntl_reg.h>
#include <algorithm>

#include "pao_ble.h"  // for notifyOtaStatus()

// --- RTC slow memory: deferred-install pending flag (Option D) ---
//
// RTC_NOINIT_ATTR: placed in RTC slow memory, which survives a software reset
// (ESP.restart()) but is cleared on power-on reset and deep-sleep wakeup. The
// magic sentinel guards against reading garbage after a power-cycle. Attempts
// is bumped on every early-boot install attempt so an infinite reboot loop is
// capped at 3 tries before clearing the flag and proceeding to normal boot on
// the old image.
//
// OtaPendingRtc struct and kOtaPendingMagic constant are declared in ota.h so
// main.cpp can read the magic field directly for the early-boot guard without
// coupling to ota.cpp internals.
RTC_NOINIT_ATTR OtaPendingRtc s_ota_pending;

constexpr uint32_t kOtaMaxInstallAttempts = 3;

// SPIFFS staging file path.
static const char* kOtaStagePath = "/ota_stage.bin";

namespace ota {

// Route OTA install-phase breadcrumbs through the IDF esp_log subsystem
// (ESP_LOGI) instead of Serial.printf. During cache-disable windows that
// occur on every flash erase, the USB-CDC HW path stalls — bytes written
// via Serial.printf sit in the TX FIFO and never drain. ESP_LOGI routes
// through the IDF console (CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG=1
// in the sdkconfig blob), which uses the same USB Serial JTAG peripheral
// but via a separate IDF-managed path that buffers internally and is
// observed to flush reliably even during/after flash ops. This is the same
// path that delivers Preferences.cpp [E] lines during the install phase.
//
// Streaming-phase logs (ACK at NNN) still use Serial.printf — those run
// before any flash ops and arrive fine on USB-CDC.
static const char* TAG = "ota";

#define OTA_LOG(fmt, ...)   ESP_LOGI(TAG, fmt, ##__VA_ARGS__)
#define OTA_LOGLN(s)        ESP_LOGI(TAG, "%s", s)

namespace {

// Each OTA app slot is 3 MB per partitions.csv (Decision #58).
constexpr uint32_t kMaxImageSize = 3 * 1024 * 1024;

State    g_state = State::IDLE;
uint32_t g_total_size = 0;
uint32_t g_bytes_received = 0;
uint32_t g_chunk_count_in_window = 0;
uint8_t  g_expected_sha256[32] = {0};

// Target OTA partition handle, resolved once in begin() and held for the
// duration of the session. NULL means no session is active.
static const esp_partition_t* s_ota_partition = nullptr;

// SPIFFS staging file handle. Opened for write in begin(), written in
// writeChunk(), closed in end() or resetSession().
static File s_stage_file;

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
    // Close the SPIFFS staging file if it was opened. Guard against double-close.
    if (s_stage_file) {
        s_stage_file.close();
    }
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

    // Resolve the inactive OTA partition via IDF so we can bounds-check the
    // image size early. The actual flash ops are deferred to early-boot
    // runDeferredOtaInstall() (Option D, Decision #66).
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

    // --- SPIFFS staging file (Option D) ---
    // Mount SPIFFS in read-write mode. formatOnFail=false: if SPIFFS is
    // unformatted this returns false and we refuse the OTA rather than wiping
    // user data (unlikely on a factory device but safe).
    if (!SPIFFS.begin(/*formatOnFail=*/false)) {
        Serial.println("OTA: SPIFFS mount failed — cannot stage image");
        Serial.flush();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }

    // Remove any leftover staging file from a previous failed attempt.
    if (SPIFFS.exists(kOtaStagePath)) {
        SPIFFS.remove(kOtaStagePath);
        Serial.println("OTA: removed stale staging file");
    }

    // Check available space. SPIFFS partition is 9.81 MB (Decision #62); the
    // image is at most 3 MB. Should always fit, but defend against corruption.
    size_t spiffs_free = SPIFFS.totalBytes() - SPIFFS.usedBytes();
    Serial.printf("OTA: SPIFFS free=%u bytes, image needs=%u bytes\n",
                  (unsigned)spiffs_free, (unsigned)total);
    Serial.flush();
    if (spiffs_free < total) {
        Serial.println("OTA: insufficient SPIFFS space — cannot stage image");
        SPIFFS.end();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }

    s_stage_file = SPIFFS.open(kOtaStagePath, FILE_WRITE);
    if (!s_stage_file) {
        Serial.println("OTA: failed to open staging file for write");
        SPIFFS.end();
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }
    Serial.printf("OTA: staging file opened (%s)\n", kOtaStagePath);
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

    if (!s_stage_file) {
        Serial.println("OTA: writeChunk called with no staging file open");
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

    // --- SPIFFS write (Option D streaming phase) ---
    // No flash ops against the OTA partition. No cache-disable window on the
    // partition bus. SPIFFS writes go to the SPIFFS partition region, not the
    // OTA app partition, so the OPI contention path is not triggered here.
    // IWDT risk: zero for the OTA partition erase path.
    size_t written = s_stage_file.write(data, len);
    if (written != len) {
        Serial.printf("OTA: SPIFFS write short at offset %u (wrote %u of %u)\n",
                      (unsigned)g_bytes_received, (unsigned)written, (unsigned)len);
        Serial.flush();
        notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
        resetSession();
        return;
    }
    g_bytes_received += (uint32_t)len;
    g_chunk_count_in_window++;

    bool window_full = (g_chunk_count_in_window >= OTA_ACK_WINDOW_CHUNKS);
    bool transfer_complete = (g_bytes_received >= g_total_size);

    // Flush periodically to avoid large dirty-page accumulation in the SPIFFS
    // write cache. Every 16 chunks keeps the flush overhead modest (~1 extra
    // SPIFFS write per 16 × 244 B = ~3.9 KB window). The final flush happens
    // in end() just before closing the file.
    if (window_full || transfer_complete) {
        s_stage_file.flush();
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
    delay(2);  // drain UART TX FIFO

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

    if (!s_stage_file) {
        Serial.println("OTA: end() called with no staging file open");
        Serial.flush();
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }

    if (g_bytes_received != g_total_size) {
        Serial.printf("OTA: size mismatch -- got %u, expected %u\n",
                      (unsigned)g_bytes_received, (unsigned)g_total_size);
        Serial.flush();
        s_stage_file.close();
        notify(STATUS_ERR_SIZE_MISMATCH, g_bytes_received);
        resetSession();
        return;
    }

    // Final flush and close the staging file.
    s_stage_file.flush();
    s_stage_file.close();
    Serial.println("OTA: staging file closed");
    Serial.flush();

    // Verify the file landed on SPIFFS with the right size.
    File verify_f = SPIFFS.open(kOtaStagePath, FILE_READ);
    if (!verify_f || (uint32_t)verify_f.size() != g_total_size) {
        Serial.printf("OTA: staging file verify failed (file=%u expected=%u)\n",
                      (unsigned)(verify_f ? verify_f.size() : 0),
                      (unsigned)g_total_size);
        if (verify_f) verify_f.close();
        SPIFFS.remove(kOtaStagePath);
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }
    verify_f.close();
    Serial.printf("OTA: staging file verified (%u bytes)\n", (unsigned)g_total_size);
    Serial.flush();

    g_state = State::COMMITTING;

    // --- Set RTC deferred-install flag (Option D) ---
    // RTC slow memory survives ESP.restart(). The early-boot check in
    // runDeferredOtaInstall() reads this flag before any subsystem initialises.
    // Storing image_size and sha256 here for cross-check and logging on boot.
    s_ota_pending.image_size = g_total_size;
    memcpy(s_ota_pending.sha256, g_expected_sha256, sizeof(s_ota_pending.sha256));
    s_ota_pending.attempts  = 0;
    s_ota_pending.magic     = kOtaPendingMagic;  // write magic LAST — atomic intent signal
    Serial.printf("OTA: RTC pending flag set (magic=0x%08x size=%u)\n",
                  (unsigned)kOtaPendingMagic, (unsigned)g_total_size);
    Serial.flush();

    // STATUS_COMMITTING: tells mobile streaming phase is done and a reboot is
    // imminent. Mobile treats the following disconnect as expected and will
    // reconnect to verify (Decision #64 contract preserved — same as before,
    // just the install happens on the NEXT boot instead of this one).
    OTA_LOGLN("OTA: notifying STATUS_COMMITTING before reboot");
    notify(STATUS_COMMITTING, g_bytes_received);
    OTA_LOGLN("OTA: STATUS_COMMITTING sent — rebooting into install mode");

    delay(100);  // let notify drain over BLE before we kill the radio

    g_state = State::REBOOTING;
    ESP.restart();
    // unreachable
}

// ---------------------------------------------------------------------------
// runDeferredOtaInstall — early-boot flash installer (Option D, Decision #66)
//
// Called from the very top of setup() BEFORE Serial is fully up, BEFORE any
// PSRAM-backed subsystem (display, BLE, LVGL, I²C) has initialised. At this
// point the PSRAM bus is idle — the OPI contention that caused esp_ota_begin
// to hang during Option C (in-session install) should not be present.
//
// Flow:
//   1. Check s_ota_pending.magic. If not kOtaPendingMagic → return immediately
//      (no-op normal boot path).
//   2. Bump s_ota_pending.attempts. If >= kOtaMaxInstallAttempts → clear magic
//      and return (allows normal boot on old image; user can retry OTA).
//   3. Mount SPIFFS, open /ota_stage.bin, verify size.
//   4. Disable all watchdogs (same TIMG1/TIMG0/RTC register sequence as the
//      old end() path).
//   5. esp_ota_begin → esp_ota_write in 4 KB internal-SRAM chunks →
//      esp_ota_end → esp_ota_set_boot_partition.
//   6. Remove staging file, clear RTC magic, set NVS pending flag, arm
//      manual rollback, reboot into new image.
//
// On any failure: log the error, clear magic, return. Normal boot continues
// on the old image. The staging file is left for post-mortem unless the
// failure happens after a successful write (then we attempt cleanup).
//
// This function NEVER returns on success — it calls ESP.restart().
// ---------------------------------------------------------------------------
void runDeferredOtaInstall() {
    // Guard: magic must be valid and attempt budget must not be exhausted.
    if (s_ota_pending.magic != kOtaPendingMagic) {
        return;  // no pending install — fast path, no SPIFFS mount
    }

    s_ota_pending.attempts++;
    Serial.printf("OTA deferred: attempt %u / %u (size=%u)\n",
                  (unsigned)s_ota_pending.attempts,
                  (unsigned)kOtaMaxInstallAttempts,
                  (unsigned)s_ota_pending.image_size);
    Serial.flush();

    if (s_ota_pending.attempts > kOtaMaxInstallAttempts) {
        Serial.println("OTA deferred: attempt budget exhausted — clearing flag, booting old image");
        Serial.flush();
        s_ota_pending.magic = 0;
        return;
    }

    // Mount SPIFFS read-only for install (we only need to read the staged file).
    if (!SPIFFS.begin(/*formatOnFail=*/false)) {
        Serial.println("OTA deferred: SPIFFS mount failed");
        Serial.flush();
        // Do NOT clear magic — let attempts bump protect us if this is transient.
        return;
    }

    File f = SPIFFS.open(kOtaStagePath, FILE_READ);
    if (!f) {
        Serial.printf("OTA deferred: staging file not found at %s\n", kOtaStagePath);
        Serial.flush();
        SPIFFS.end();
        s_ota_pending.magic = 0;  // file gone — no point retrying
        return;
    }

    uint32_t file_size = (uint32_t)f.size();
    if (file_size != s_ota_pending.image_size) {
        Serial.printf("OTA deferred: size mismatch (file=%u rtc=%u) — aborting\n",
                      (unsigned)file_size, (unsigned)s_ota_pending.image_size);
        Serial.flush();
        f.close();
        SPIFFS.end();
        s_ota_pending.magic = 0;
        return;
    }
    Serial.printf("OTA deferred: staging file OK (%u bytes)\n", (unsigned)file_size);
    Serial.flush();

    const esp_partition_t* part = esp_ota_get_next_update_partition(NULL);
    if (!part) {
        Serial.println("OTA deferred: no OTA update partition found");
        Serial.flush();
        f.close();
        SPIFFS.end();
        return;
    }
    Serial.printf("OTA deferred: target partition=%s addr=0x%06x\n",
                  part->label, (unsigned)part->address);
    Serial.flush();

    // --- Disable all watchdogs before first flash erase ---
    // Same register sequence as the old end() path. See comments there for
    // the full rationale. These writes are safe before FreeRTOS starts because
    // we're still in single-threaded Arduino setup() context.
    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(1), TIMG_WDT_WKEY_VALUE);
    WRITE_PERI_REG(TIMG_WDTCONFIG0_REG(1), 0);
    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(1), 0);

    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(0), TIMG_WDT_WKEY_VALUE);
    WRITE_PERI_REG(TIMG_WDTCONFIG0_REG(0), 0);
    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(0), 0);

    WRITE_PERI_REG(RTC_CNTL_WDTWPROTECT_REG, 0x50D83AA1U);
    WRITE_PERI_REG(RTC_CNTL_WDTCONFIG0_REG, 0);
    WRITE_PERI_REG(RTC_CNTL_WDTWPROTECT_REG, 0);

    Serial.println("OTA deferred: watchdogs disabled");
    Serial.flush();

    // --- esp_ota_begin ---
    // Pre-erases the target partition. With PSRAM idle this should not deadlock.
    esp_ota_handle_t handle = 0;
    Serial.printf("OTA deferred: calling esp_ota_begin (partition=%s size=%u)\n",
                  part->label, (unsigned)file_size);
    Serial.flush();

    uint32_t t0 = millis();
    esp_err_t err = esp_ota_begin(part, file_size, &handle);
    Serial.printf("OTA deferred: esp_ota_begin returned err=0x%x dt=%ums\n",
                  (unsigned)err, (unsigned)(millis() - t0));
    Serial.flush();

    if (err != ESP_OK) {
        Serial.printf("OTA deferred: esp_ota_begin FAILED err=0x%x\n", (unsigned)err);
        f.close();
        SPIFFS.end();
        return;  // magic stays set — retry on next boot up to kOtaMaxInstallAttempts
    }
    Serial.println("OTA deferred: esp_ota_begin OK — partition erased");
    Serial.flush();

    // --- Stream from SPIFFS → esp_ota_write in 4 KB internal-SRAM chunks ---
    // Internal SRAM only — NO heap_caps_malloc(PSRAM). This is the key
    // difference from Option C: the source buffer lives in internal RAM so the
    // PSRAM OPI bus is never accessed during the flash write path.
    uint8_t buf[4096];
    size_t total_written = 0;

    while (total_written < (size_t)file_size) {
        size_t want = std::min(sizeof(buf), (size_t)(file_size - total_written));
        size_t got  = f.read(buf, want);
        if (got != want) {
            Serial.printf("OTA deferred: SPIFFS read short at off=%u (got=%u want=%u)\n",
                          (unsigned)total_written, (unsigned)got, (unsigned)want);
            Serial.flush();
            esp_ota_abort(handle);
            f.close();
            SPIFFS.end();
            return;
        }

        err = esp_ota_write(handle, buf, got);
        if (err != ESP_OK) {
            Serial.printf("OTA deferred: esp_ota_write FAILED at off=%u err=0x%x\n",
                          (unsigned)total_written, (unsigned)err);
            Serial.flush();
            esp_ota_abort(handle);
            f.close();
            SPIFFS.end();
            return;
        }

        total_written += got;

        // Progress log every 64 KB.
        if ((total_written % (64 * 1024)) == 0 || total_written == (size_t)file_size) {
            Serial.printf("OTA deferred: wrote %u / %u (%u%%)\n",
                          (unsigned)total_written, (unsigned)file_size,
                          (unsigned)((total_written * 100) / file_size));
            Serial.flush();
        }
    }

    f.close();
    Serial.println("OTA deferred: esp_ota_write complete");
    Serial.flush();

    // --- esp_ota_end: validate CRC, seal the image ---
    err = esp_ota_end(handle);
    if (err != ESP_OK) {
        Serial.printf("OTA deferred: esp_ota_end FAILED err=0x%x\n", (unsigned)err);
        Serial.flush();
        SPIFFS.end();
        return;
    }
    Serial.println("OTA deferred: esp_ota_end OK — image validated");
    Serial.flush();

    // --- Commit: set boot partition ---
    err = esp_ota_set_boot_partition(part);
    if (err != ESP_OK) {
        Serial.printf("OTA deferred: esp_ota_set_boot_partition FAILED err=0x%x\n", (unsigned)err);
        Serial.flush();
        SPIFFS.end();
        return;
    }
    Serial.printf("OTA deferred: boot partition set to %s\n", part->label);
    Serial.flush();

    // Clean up staging file — install succeeded, no longer needed.
    SPIFFS.remove(kOtaStagePath);
    SPIFFS.end();

    // Arm NVS pending flag (rollback infrastructure expects this).
    setOtaPendingFlag(true);

    // Arm manual NVS rollback (same as end() used to do before deferral).
    {
        Preferences nvs;
        if (nvs.begin(kRecoveryNvsNamespace, /*readOnly=*/false)) {
            const esp_partition_t* running = esp_ota_get_running_partition();
            uint8_t prev_subtype = running ? (uint8_t)running->subtype : 0xFF;
            nvs.putBool(kRecoveryKeyPending, true);
            nvs.putUInt(kRecoveryKeyAttempts, 0);
            nvs.putUChar(kRecoveryKeyPrevPart, prev_subtype);
            nvs.end();
            Serial.printf("OTA deferred: manual rollback armed (prev_part=0x%02x)\n",
                          prev_subtype);
        } else {
            Serial.println("OTA deferred: WARN — could not arm manual rollback (NVS begin rw failed)");
        }
    }

    // Clear RTC pending flag — install succeeded, don't retry on next boot.
    s_ota_pending.magic = 0;

    Serial.println("OTA deferred: SUCCESS — rebooting into new image");
    Serial.flush();
    delay(100);
    ESP.restart();
    // unreachable on success
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
