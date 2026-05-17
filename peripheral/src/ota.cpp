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
//   Phase 2 (install, in end()): BLE streaming is done. All flash ops go
//     through the official IDF OTA API: esp_ota_begin (pre-erases partition),
//     esp_ota_write in 64 KB chunks (handles CRC, magic-bytes-last ordering),
//     esp_ota_end (validates CRC), esp_ota_set_boot_partition (commits).
//     Earlier approaches (esp_partition_erase_range, esp_flash_erase_region)
//     hung on the first erase regardless of PSRAM cache flush pre-ambles or
//     IWDT state. The high-level IDF OTA API uses a different cache-management
//     path and is the final untried code route.
//   Tradeoffs:
//     - PSRAM footprint: up to 3 MB allocated for the duration of a session.
//       PSRAM is 8 MB on the dial, so this is fine (Decision #XX).
//     - Brief "frozen display" window during install -- existing behavior since
//       isInFlight() already pauses the main loop.
//       TODO: drive LVGL progress bar via a separate low-priority task during install.
//     - Partial-write risk (power loss) is now ONLY during the install phase,
//       not during the stream phase. Much smaller window. esp_ota_write's
//       internal magic-bytes guard limits the blast radius of a partial write.
//
// UpdateClass is kept for abort() only (to reset internal state if a prior
// session left it dirty). It is NOT used for begin/write/end in the new path.

#include "ota.h"

#include <Arduino.h>
#include <esp_log.h>
#include <Update.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <soc/timer_group_reg.h>
#include <soc/wdt_periph.h>
#include <soc/rtc_cntl_reg.h>

// PSRAM writeback before flash ops — forces any pending PSRAM cache writes to
// drain, freeing the OPI bus for the flash erase/write that immediately follows.
//
// Preferred API: esp_psram_extram_writeback_cache() (IDF 5.x).
// Problem: the symbol is only compiled into the prebuilt libs when PSRAM support
// is enabled in the SDK's sdkconfig blob. The pioarduino 53.03.13 qio_opi variant
// does NOT export it in libpsram.a, so the linker rejects any direct call.
//
// Fallback: manual page-walk of our own PSRAM buffer. Reading every 4 KB page
// forces the L1 cache controller to resolve all pending write-back lines for
// that address range before returning. Heavy (O(image_size/4KB) loads) but
// reliable — every byte read guarantees the cache line is coherent. We only
// do this three times (once per erase sector at the start, once per write page,
// once for the magic bytes), so the total extra cost is well inside the install
// timeout budget.
//
// The macro is guarded by CONFIG_SPIRAM so it compiles away completely on any
// future non-PSRAM target.
#ifdef CONFIG_SPIRAM
static inline void flushPsramCache(const volatile uint8_t* buf, size_t len) {
    // Touch one byte per page. The volatile qualifier prevents the compiler
    // from eliding the reads as dead code. 'buf' must be in PSRAM; on DRAM
    // this is a no-op (cache is unified/write-through for internal RAM).
    for (size_t i = 0; i < len; i += 4096) {
        (void)buf[i];
    }
}
#define FLUSH_PSRAM_CACHE()  flushPsramCache((volatile uint8_t*)s_image_buf, g_total_size)
#else
#define FLUSH_PSRAM_CACHE()  do {} while (0)
#endif

#include "pao_ble.h"  // for notifyOtaStatus()

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

// PSRAM image buffer (Option C). Allocated in begin(), freed in end() or
// resetSession(). All chunk data is memcpy'd here; no flash ops during streaming.
static uint8_t* s_image_buf = nullptr;

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

    // Record wall-clock entry time BEFORE any BLE calls so the pre-erase
    // watchdog can catch hangs in the notify/deinit sequence itself.
    const uint32_t end_entered_ms = millis();
    constexpr uint32_t kPreEraseTimeoutMs = 30 * 1000;  // 30 s backstop

    g_state = State::COMMITTING;

    // --- Attempt STATUS_COMMITTING notify (best-effort) ---
    // By the time mobile sends cmd=11, the link may already be half-dead
    // (we've seen GATT_ERROR 133 arrive 178 ms after OTA_END, far faster than
    // the 5 s LSTO, meaning the connection state was trashed before end() ran).
    // Per Decision #64, mobile treats any post-cmd=11 disconnect as expected
    // and falls through to reconnect + verify — it does NOT require this notify.
    //
    // We still try, but we bracket it so we can see exactly where we are in
    // serial output if the call hangs.
    OTA_LOGLN("OTA install: about to notify STATUS_COMMITTING");
    notify(STATUS_COMMITTING, g_bytes_received);
    OTA_LOGLN("OTA install: STATUS_COMMITTING notify returned");

    // We intentionally do NOT call NimBLEDevice::deinit() here. After the 3+
    // minute streaming phase, the NimBLE host task has accumulated TX queue
    // state that prevents clean shutdown — deinit() blocks waiting for the host
    // task to exit and never returns (confirmed hang: serial output stops at
    // "about to deinit", never reaches "deinit returned"). We let the host task
    // keep running; the eventual ESP.restart() at the end of install() kills it
    // cleanly. The flash erase and write operations naturally serialize against
    // BLE activity via the cache-disable window — BLE traffic during install
    // will be jittery but not fatal. See Decision #65 (moe-dial-ota-skip-deinit-safety-task).

    // --- esp_timer safety watchdog ---
    // Replaces the earlier xTaskCreatePinnedToCore approach (Decision #65).
    // The FreeRTOS max-priority task on core 1 triggered a coprocessor (FPU)
    // exception: the context switch to that task attempted FPU state save/restore
    // while cache was disabled mid-flash-op on core 0, and _xt_coproc_exc could
    // not complete (cache still disabled) → IWDT fired → TG1WDT_SYS_RST.
    //
    // esp_timer uses a single shared IDF dispatcher thread that is already running.
    // No new task is created, no cross-core FPU state dance, no max-priority
    // preemption. The callback fires after 120 s of wall-clock time and forces a
    // clean reboot into the old image. The install success path calls ESP.restart()
    // well within 90 s, so the timer is effectively never reached on a healthy run.
    // The handle is intentionally NOT canceled — we want the timer to fire
    // regardless of what happens downstream.
    //
    // Lambda captures nothing → converts to function pointer cleanly.
    esp_timer_handle_t safety_timer = nullptr;
    const esp_timer_create_args_t safety_args = {
        .callback = [](void*) {
            OTA_LOGLN("OTA safety timer: 120s elapsed — forcing reboot into old image");
            vTaskDelay(pdMS_TO_TICKS(50));
            ESP.restart();
        },
        .arg = nullptr,
        .dispatch_method = ESP_TIMER_TASK,
        .name = "ota_safety",
        .skip_unhandled_events = false,
    };
    esp_err_t timer_err = esp_timer_create(&safety_args, &safety_timer);
    if (timer_err == ESP_OK) {
        esp_timer_start_once(safety_timer, 120ULL * 1000 * 1000);  // microseconds
        OTA_LOGLN("OTA install: safety timer armed (120s, esp_timer)");
    } else {
        OTA_LOG("OTA install: WARN safety timer create failed (err=%d)\n", (int)timer_err);
    }

    // --- Pre-erase phase watchdog ---
    // If the notify or deinit calls above blocked for an absurd amount of time
    // (e.g. notify hung waiting for TX confirmation on a dead link), the install
    // timeout in the erase/write loops would never fire because we'd never reach
    // them. This backstop catches that case and forces a clean reboot into the
    // old image.
    if (millis() - end_entered_ms > kPreEraseTimeoutMs) {
        OTA_LOG("OTA end: pre-erase phase exceeded %us — restarting\n",
                (unsigned)(kPreEraseTimeoutMs / 1000));
        delay(50);
        ESP.restart();
        // unreachable
    }
    OTA_LOGLN("OTA install: pre-erase phase OK, entering erase loop");

    // ── Disable IWDT for the install phase ─────────────────────────────────
    // Flash erase on the S3 OPI configuration disables the instruction cache
    // for 300ms+ per 4KB sector. This exceeds the IDF default 300ms IWDT
    // timeout baked into the pioarduino sdkconfig blob, causing TG1WDT_SYS_RST
    // before the first sector erase completes. esp_int_wdt_pause() /
    // esp_int_wdt_resume() are IDF symbols not exposed in the pioarduino blob,
    // so we disable the TIMG1 watchdog directly via memory-mapped register
    // writes. We do NOT re-enable it — the install path ends in ESP.restart()
    // which resets all watchdogs to their boot-time defaults. The 120s
    // esp_timer remains as the catch-all if install itself hangs.
    //
    // Register addresses (ESP32-S3, TIMG1 base = 0x60020000):
    //   TIMG_WDTWPROTECT_REG(1) = base + 0x64 = 0x60020064  (write-protect)
    //   TIMG_WDTCONFIG0_REG(1)  = base + 0x48 = 0x60020048  (config0 / enable)
    //   TIMG_WDT_WKEY_VALUE     = 0x50D83AA1               (unlock magic)
    // Verified against:
    //   framework-arduinoespressif32-libs/esp32s3/include/soc/esp32s3/include/soc/
    //   timer_group_reg.h (offsets), soc.h (REG_TIMG_BASE), reg_base.h (base addr),
    //   soc/include/soc/wdt_periph.h (TIMG_WDT_WKEY_VALUE).
    // Note: the WPROTECT offset on S3 is 0x64, NOT 0x5C (which is the ESP32
    // classic offset). Always use the macro — it resolves per-SoC correctly.
    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(1), TIMG_WDT_WKEY_VALUE);  // unlock
    WRITE_PERI_REG(TIMG_WDTCONFIG0_REG(1), 0);                      // disable WDT
    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(1), 0);                     // re-lock
    OTA_LOGLN("OTA install: IWDT disabled (TIMG1 register write, offset 0x64)");

    // Disable TIMG0 watchdog (MWDT0 / task watchdog). Same register layout as
    // TIMG1 above — TIMG_WDTWPROTECT_REG(0) and TIMG_WDTCONFIG0_REG(0) resolve
    // to the TIMG0 base + the same offsets. The task watchdog supervisor on
    // MWDT0 fires (rst:0x7, TG0WDT_SYS_RST) when the long flash erase blocks
    // the task watchdog feed mechanism. We do NOT re-enable after install — the
    // ESP.restart() at the end of this function resets all watchdogs to their
    // boot-time defaults. The 120 s esp_timer remains the catch-all backstop.
    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(0), TIMG_WDT_WKEY_VALUE);  // unlock
    WRITE_PERI_REG(TIMG_WDTCONFIG0_REG(0), 0);                      // disable WDT
    WRITE_PERI_REG(TIMG_WDTWPROTECT_REG(0), 0);                     // re-lock
    OTA_LOGLN("OTA install: TIMG0 watchdog disabled (MWDT0)");

    // Disable RTC watchdog (RWDT). Third independent watchdog on the S3. Defensive
    // write — if the RTC WDT is not armed by the bootloader / IDF at this point
    // the writes are no-ops. Unlock key 0x50D83AA1 matches RWDT_LL_WDT_WKEY_VALUE
    // in hal/esp32s3/include/hal/rwdt_ll.h. We use the literal here to avoid
    // pulling in the IDF HAL header chain.
    WRITE_PERI_REG(RTC_CNTL_WDTWPROTECT_REG, 0x50D83AA1U);         // unlock
    WRITE_PERI_REG(RTC_CNTL_WDTCONFIG0_REG, 0);                     // disable WDT
    WRITE_PERI_REG(RTC_CNTL_WDTWPROTECT_REG, 0);                    // re-lock
    OTA_LOGLN("OTA install: RTC watchdog disabled");

    // --- INSTALL PHASE (IDF OTA API path) ---
    // BLE streaming is done. The PSRAM buffer holds the complete image.
    // All flash ops happen here via the official esp_ota_begin / esp_ota_write /
    // esp_ota_end pipeline. This replaces the earlier sector-by-sector
    // esp_flash_erase_region + esp_flash_write approach (Decisions #62/#63/#65)
    // which hung on the first erase call on S3 OPI flash regardless of PSRAM
    // cache flush pre-ambles, raw vs partition-API selection, or IWDT state.
    //
    // esp_ota_begin pre-erases the partition internally using its own sector
    // strategy and cache management, which differs from our direct
    // esp_flash_erase_region calls. esp_ota_write handles CRC, magic-bytes-last
    // ordering, and internal chunking. esp_ota_end validates the image CRC.
    //
    // We call esp_ota_write in 64 KB chunks so serial output gives visibility
    // if a hang occurs partway through the write phase. If install hangs entirely
    // the 120 s esp_timer safety timer fires and reboots into the old image.
    //
    // Note: s_image_buf is in PSRAM (heap_caps_malloc MALLOC_CAP_SPIRAM). IDF
    // reads from this buffer during esp_ota_write; the PSRAM bus must remain
    // active throughout. This is the same PSRAM contention we suspect caused the
    // earlier hangs — but esp_ota_write may have different cache-disable semantics
    // than the raw spi_flash path. If esp_ota_write also hangs on the S3 OPI
    // configuration, PSRAM bus contention is confirmed and the image must be
    // copied to internal RAM before flash operations.

    OTA_LOG("OTA install: calling esp_ota_begin (pre-erases partition %s)",
            s_ota_partition->label);
    esp_ota_handle_t ota_handle = 0;
    uint32_t t_begin = millis();
    esp_err_t err = esp_ota_begin(s_ota_partition, g_total_size, &ota_handle);
    uint32_t dt_begin = millis() - t_begin;

    if (err != ESP_OK) {
        OTA_LOG("OTA: esp_ota_begin failed err=0x%x dt=%ums", (unsigned)err, (unsigned)dt_begin);
        free(s_image_buf);
        s_image_buf = nullptr;
        notify(STATUS_ERR_BEGIN_FAILED, g_bytes_received);
        resetSession();
        return;
    }
    OTA_LOG("OTA: esp_ota_begin OK dt=%ums (partition pre-erased)", (unsigned)dt_begin);

    // Write the image in 64 KB chunks for serial visibility.
    // esp_ota_write handles internal CRC accumulation, magic-bytes-last guard,
    // and any required alignment padding.
    constexpr size_t kWriteChunkSize = 64 * 1024;
    OTA_LOG("OTA install: writing %u bytes in %u-KB chunks via esp_ota_write",
            (unsigned)g_total_size, (unsigned)(kWriteChunkSize / 1024));

    feedWatchdog();
    for (size_t off = 0; off < (size_t)g_total_size; off += kWriteChunkSize) {
        size_t this_chunk = kWriteChunkSize;
        if (this_chunk > (size_t)(g_total_size - off)) {
            this_chunk = (size_t)(g_total_size - off);
        }

        uint32_t t_chunk = millis();
        err = esp_ota_write(ota_handle, s_image_buf + off, this_chunk);
        uint32_t dt_chunk = millis() - t_chunk;

        if (err != ESP_OK) {
            OTA_LOG("OTA: esp_ota_write failed at off=%u size=%u err=0x%x dt=%ums",
                    (unsigned)off, (unsigned)this_chunk, (unsigned)err, (unsigned)dt_chunk);
            esp_ota_abort(ota_handle);
            free(s_image_buf);
            s_image_buf = nullptr;
            notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
            resetSession();
            return;
        }
        OTA_LOG("OTA: esp_ota_write chunk off=%u size=%u OK dt=%ums",
                (unsigned)off, (unsigned)this_chunk, (unsigned)dt_chunk);
        feedWatchdog();
    }
    OTA_LOGLN("OTA install: esp_ota_write complete");

    // Finalize — validates accumulated CRC and marks image ready in otadata.
    OTA_LOGLN("OTA install: calling esp_ota_end");
    uint32_t t_end_api = millis();
    err = esp_ota_end(ota_handle);
    uint32_t dt_end_api = millis() - t_end_api;

    if (err != ESP_OK) {
        OTA_LOG("OTA: esp_ota_end failed err=0x%x dt=%ums", (unsigned)err, (unsigned)dt_end_api);
        free(s_image_buf);
        s_image_buf = nullptr;
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }
    OTA_LOG("OTA install: esp_ota_end OK dt=%ums — image validated", (unsigned)dt_end_api);

    // PSRAM buffer is no longer needed. Free before marking partition bootable.
    free(s_image_buf);
    s_image_buf = nullptr;

    // --- Mark partition as boot target ---
    // esp_ota_set_boot_partition() updates otadata to point to the new partition
    // on the next boot. esp_ota_end already validated the image; this commits it.
    OTA_LOGLN("OTA install: calling esp_ota_set_boot_partition");
    esp_err_t boot_err = esp_ota_set_boot_partition(s_ota_partition);
    if (boot_err != ESP_OK) {
        OTA_LOG("OTA: esp_ota_set_boot_partition failed err=0x%x\n",
                (unsigned)boot_err);
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        // s_ota_partition is still valid here but image was written; reset cleanly.
        s_ota_partition = nullptr;
        g_state = State::IDLE;
        return;
    }

    OTA_LOG("OTA: partition %s set as next boot target\n",
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
            OTA_LOG("OTA: armed manual rollback (prev_part subtype=0x%02x)\n",
                    prev_subtype);
        } else {
            // New image is still bootable but auto-rollback safety net is
            // disabled. USB reflash remains the recovery of last resort.
            OTA_LOGLN("OTA: failed to arm manual rollback (NVS begin rw failed)");
        }
    }

    OTA_LOGLN("OTA: image committed, rebooting now");
    // NimBLE is still running at this point (deinit was skipped — see Decision
    // #65). STATUS_REBOOTING could technically be notified, but the connection
    // state may be degraded after the long install phase. Mobile handles the
    // connection loss as an expected post-reboot disconnect per Decision #64.
    // The safety timer (armed above) will also fire at 120s if ESP.restart()
    // somehow stalls, but that is not expected — restart() is synchronous.
    // g_state = REBOOTING is recorded for completeness; the restart follows
    // immediately so isInFlight() will never be polled again this boot.
    g_state = State::REBOOTING;
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
