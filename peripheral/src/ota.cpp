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

State    g_state = State::IDLE;
uint32_t g_total_size = 0;
uint32_t g_bytes_received = 0;
uint32_t g_chunk_count_in_window = 0;
uint8_t  g_expected_sha256[32] = {0};

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
    Serial.printf("OTA BEGIN: payload_len=%u state=%d\n",
                  (unsigned)len, (int)g_state);

    if (payload == nullptr || len != 36) {
        Serial.printf("OTA: bad payload length %u (want 36)\n", (unsigned)len);
        notify(STATUS_ERR_BAD_PAYLOAD, 0);
        return;
    }

    // Abandon any prior session.
    if (g_state == State::RECEIVING || g_state == State::READY) {
        Serial.println("OTA: dropping previous session before new BEGIN");
        Update.abort();
        resetSession();
    }

    // Parse: 4-byte LE total_size, 32 bytes sha256.
    uint32_t total = (uint32_t)payload[0]
                   | ((uint32_t)payload[1] << 8)
                   | ((uint32_t)payload[2] << 16)
                   | ((uint32_t)payload[3] << 24);

    if (total == 0 || total > kMaxImageSize) {
        Serial.printf("OTA: rejected total_size=%u (max=%u)\n",
                      (unsigned)total, (unsigned)kMaxImageSize);
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        return;
    }

    g_total_size = total;
    g_bytes_received = 0;
    g_chunk_count_in_window = 0;
    memcpy(g_expected_sha256, payload + 4, sizeof(g_expected_sha256));

    // Update.begin() picks the inactive ota_X slot via
    // esp_ota_get_next_update_partition under the hood.
    if (!Update.begin(g_total_size, U_FLASH)) {
        Serial.printf("OTA: Update.begin failed (err=%d, total=%u)\n",
                      (int)Update.getError(), (unsigned)g_total_size);
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }

    g_state = State::READY;
    s_ota_last_chunk_millis = millis();  // grace for a slow first chunk
    Serial.printf("OTA: READY — expecting %u bytes, ack window=%d chunks\n",
                  (unsigned)g_total_size, OTA_ACK_WINDOW_CHUNKS);
    notify(STATUS_READY, 0);
}

void writeChunk(const uint8_t* data, size_t len) {
    if (len == 0) return;

    if (g_state != State::READY && g_state != State::RECEIVING) {
        // Stray chunk before BEGIN or after END/ABORT — silently drop to
        // avoid amplifying state mismatches into a notify storm.
        return;
    }

    g_state = State::RECEIVING;
    s_ota_last_chunk_millis = millis();

    // Feed the watchdog around the flash write. ESP32-S3 NOR flash erase can
    // stall for hundreds of ms on the first write to a freshly-erased sector
    // (Arduino-ESP32 Update lazily-erases ahead of writes). The main loop is
    // already paused via isInFlight() but the IDLE task watchdog can still
    // fire if the OTA work hogs the BLE callback task.
#ifdef OTA_DEBUG_TIMING
    uint32_t t0 = millis();
#endif

    feedWatchdog();

    size_t written = Update.write(const_cast<uint8_t*>(data), len);

    feedWatchdog();

    // Yield to the NimBLE host task so it can service link-layer events
    // between flash writes. Without this, 16 back-to-back writes on the
    // ESP32-S3's OPI flash bus block the host task ~1.6s/window and Android's
    // 5s BLE supervision timeout fires. Costs ~16ms per window — negligible.
    vTaskDelay(1);

#ifdef OTA_DEBUG_TIMING
    Serial.printf("OTA write: offset=%u len=%u dur=%ums\n",
                  (unsigned)(g_bytes_received), (unsigned)len,
                  (unsigned)(millis() - t0));
#endif

    if (written != len) {
        Serial.printf("OTA: Update.write short (%u of %u, err=%d) at offset=%u\n",
                      (unsigned)written, (unsigned)len,
                      (int)Update.getError(), (unsigned)g_bytes_received);
        notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
        Update.abort();
        resetSession();
        return;
    }

    g_bytes_received += (uint32_t)len;
    g_chunk_count_in_window++;

    // Emit ACK every window OR when the transfer is complete (so the tail
    // partial-window doesn't strand mobile waiting for one last ACK).
    bool window_full = (g_chunk_count_in_window >= OTA_ACK_WINDOW_CHUNKS);
    bool transfer_complete = (g_bytes_received >= g_total_size);

    if (window_full || transfer_complete) {
        g_chunk_count_in_window = 0;
#ifdef OTA_DEBUG_TIMING
        Serial.printf("OTA: ACK at %u / %u%s (window_end_ms=%u)\n",
                      (unsigned)g_bytes_received, (unsigned)g_total_size,
                      transfer_complete ? " (final)" : "",
                      (unsigned)millis());
#else
        Serial.printf("OTA: ACK at %u / %u%s\n",
                      (unsigned)g_bytes_received, (unsigned)g_total_size,
                      transfer_complete ? " (final)" : "");
#endif
        notify(STATUS_ACK, g_bytes_received);
    }
}

void end() {
    Serial.printf("OTA END: state=%d bytes=%u total=%u\n",
                  (int)g_state, (unsigned)g_bytes_received,
                  (unsigned)g_total_size);

    if (g_state != State::RECEIVING && g_state != State::READY) {
        Serial.printf("OTA: END in unexpected state %d\n", (int)g_state);
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        return;
    }

    if (g_bytes_received != g_total_size) {
        Serial.printf("OTA: size mismatch — got %u, expected %u\n",
                      (unsigned)g_bytes_received, (unsigned)g_total_size);
        Update.abort();
        notify(STATUS_ERR_SIZE_MISMATCH, g_bytes_received);
        resetSession();
        return;
    }

    g_state = State::COMMITTING;
    notify(STATUS_COMMITTING, g_bytes_received);

    // true = set the new partition as the boot partition. Update.end() returns
    // true on full success (CRC valid, partition marked).
    if (!Update.end(true)) {
        Serial.printf("OTA: Update.end failed (err=%d)\n",
                      (int)Update.getError());
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }

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
