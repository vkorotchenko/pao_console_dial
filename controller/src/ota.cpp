// ota.cpp — Controller OTA state machine. See ota.h for the protocol contract.
//
// Cloned from charger/src/ota.cpp. Key differences:
//
//   SAFETY GATE — charger force-disables charging before flashing. Controller
//   cannot force-un-energize the motor (the inverter is driven by the driver
//   pedal / throttle, not a firmware flag). Instead, OTA_BEGIN is hard-refused
//   when the motor is energized. The signal is globalState.data.resState,
//   updated from CAN frame 0x23B by handle_23B(). Value 2 (MotorState::ENABLE)
//   means the inverter is actively driving; any other value is safe to flash.
//
//   NO FORCE-DISABLE — because we hard-refuse rather than force-disable, there
//   is no s_ota_saved_* state to restore on abort(). Abort just cleans up
//   Update state and resets the session.
//
//   STATUS CODES — identical to charger (#52) and dial (#63) so the mobile
//   decoder is reusable across all three targets without modification.

#include "ota.h"

#include <Arduino.h>
#include <Update.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "ble.h"
#include "global_state.h"

// globalState is declared in main.cpp. ota.cpp reads resState to implement the
// motor-energized safety gate in begin(). MotorState::ENABLE == 2 means the
// inverter is actively driving (CAN frame 0x23B, byte[6] >> 4 == 3, mapped to
// ENABLE in handle_23B's local enum). globalState.data.resState carries that
// value as a plain int.
extern State globalState;

// Motor-energized sentinel value. Matches the ENABLE enumerator inside
// handle_23B() in can_handler.cpp (value = 2). Defined here to avoid pulling
// the pragma-guarded local enum out of its translation unit.
static constexpr int kMotorStateEnable = 2;

namespace ota {

namespace {

constexpr uint32_t kMaxImageSize = 3 * 1024 * 1024;  // matches ota_0/ota_1 slot in partitions.csv

State    g_state = State::IDLE;
uint32_t g_total_size = 0;
uint32_t g_bytes_received = 0;
uint32_t g_chunk_count_in_window = 0;
uint8_t  g_expected_sha256[32] = {0};

// Stale-transfer watchdog: last time writeChunk() ran. Used by tickWatchdog()
// to abort a half-stalled session.
static uint32_t s_ota_last_chunk_millis = 0;
constexpr uint32_t kWatchdogTimeoutMs = 10000;

// Persisted across reboots — set in end() right before ESP.restart(), cleared
// in verify(). Used by logBootStatus() to log whether the post-reboot run is
// a pending OTA image awaiting verification.
constexpr const char* kNvsNamespace = "ota";
constexpr const char* kNvsKeyPending = "pending";

// Manual NVS-based rollback. Dedicated namespace so we don't collide with
// the "ota" namespace above.
constexpr const char* kRecoveryNvsNamespace = "ota_recovery";
constexpr const char* kRecoveryKeyPending   = "pending";    // bool: OTA image awaiting verify()
constexpr const char* kRecoveryKeyAttempts  = "attempts";   // uint32: boot attempts of pending image
constexpr const char* kRecoveryKeyPrevPart  = "prev_part";  // uint8: subtype of safe partition

// After N failed boots of a pending image, swap to the previously-running
// partition. Mobile cmd=13 OTA_VERIFY on a healthy boot clears the counter
// before this fires.
constexpr uint32_t kRollbackTriggerAttempts = 3;

// Defensive ceiling. If the rollback partition is also unbootable, stop looping
// after this many attempts and let the user USB-reflash.
constexpr uint32_t kRollbackGiveUpAttempts = 5;

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
        Serial.println("[ota] NVS begin (rw) failed for ota_pending");
        return;
    }
    prefs.putBool(kNvsKeyPending, value);
    prefs.end();
}

bool readOtaPendingFlag() {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, /*readOnly=*/true)) {
        // Namespace doesn't exist yet — treat as not pending.
        return false;
    }
    bool v = prefs.getBool(kNvsKeyPending, false);
    prefs.end();
    return v;
}

}  // namespace

State currentState() { return g_state; }

void begin(const uint8_t* payload, size_t len) {
    Serial.printf("[ota] BEGIN: payload_len=%u state=%d motorState=%d\n",
                  (unsigned)len, (int)g_state,
                  (int)globalState.data.resState);

    if (len != 36) {
        Serial.printf("[ota] bad payload length %u (want 36)\n", (unsigned)len);
        notify(STATUS_ERR_BAD_PAYLOAD, 0);
        return;
    }

    // SAFETY GATE: refuse OTA if the motor is energized.
    //
    // globalState.data.resState is set by handle_23B() in can_handler.cpp from
    // CAN frame 0x23B byte[6] >> 4. Value 2 (ENABLE in that file's local enum,
    // matching kMotorStateEnable here) means the inverter is actively driving
    // the motor. Flashing firmware while the vehicle is moving is unsafe.
    //
    // Unlike the charger, we have no way to force-un-energize the motor from
    // firmware — that's controlled by the driver pedal and the traction
    // controller. So we hard-refuse here instead of force-disabling.
    if (globalState.data.resState == kMotorStateEnable) {
        Serial.println("[ota] REFUSED — motor is energized (resState=ENABLE). Stop the vehicle first.");
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        return;
    }

    // If a previous session was in flight, abandon it before starting a new one.
    if (g_state == State::RECEIVING || g_state == State::READY) {
        Serial.println("[ota] dropping previous session before new BEGIN");
        Update.abort();
        resetSession();
    }

    // Parse: 4-byte LE total_size, 32 bytes sha256.
    uint32_t total = (uint32_t)payload[0]
                   | ((uint32_t)payload[1] << 8)
                   | ((uint32_t)payload[2] << 16)
                   | ((uint32_t)payload[3] << 24);

    if (total == 0 || total > kMaxImageSize) {
        Serial.printf("[ota] rejected total_size=%u (max=%u)\n",
                      (unsigned)total, (unsigned)kMaxImageSize);
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        return;
    }

    g_total_size = total;
    g_bytes_received = 0;
    g_chunk_count_in_window = 0;
    memcpy(g_expected_sha256, payload + 4, sizeof(g_expected_sha256));

    // Update.begin() picks the inactive ota_X slot via esp_ota_get_next_update_partition.
    if (!Update.begin(g_total_size, U_FLASH)) {
        Serial.printf("[ota] Update.begin failed (err=%d, total=%u)\n",
                      (int)Update.getError(), (unsigned)g_total_size);
        notify(STATUS_ERR_BEGIN_FAILED, 0);
        resetSession();
        return;
    }

    g_state = State::READY;
    // Reset the watchdog so a slow first chunk doesn't trip it instantly.
    s_ota_last_chunk_millis = millis();
    Serial.printf("[ota] READY — expecting %u bytes, ack window=%d chunks\n",
                  (unsigned)g_total_size, OTA_ACK_WINDOW_CHUNKS);
    notify(STATUS_READY, 0);
}

void writeChunk(const uint8_t* data, size_t len) {
    if (len == 0) return;

    if (g_state != State::READY && g_state != State::RECEIVING) {
        // Stray chunk before BEGIN or after END/ABORT — silently drop.
        return;
    }

    g_state = State::RECEIVING;
    s_ota_last_chunk_millis = millis();

    size_t written = Update.write(const_cast<uint8_t*>(data), len);
    if (written != len) {
        Serial.printf("[ota] Update.write short (%u of %u, err=%d) at offset=%u\n",
                      (unsigned)written, (unsigned)len, (int)Update.getError(),
                      (unsigned)g_bytes_received);
        notify(STATUS_ERR_WRITE_FAILED, g_bytes_received);
        Update.abort();
        resetSession();
        return;
    }

    g_bytes_received += (uint32_t)len;
    g_chunk_count_in_window++;

    // Emit ACK when a full window has been received OR when the transfer is
    // complete. Without the transfer-complete branch, a partial final window
    // would never be acknowledged and mobile would time out waiting for the
    // last ACK before sending END.
    bool window_full = (g_chunk_count_in_window >= OTA_ACK_WINDOW_CHUNKS);
    bool transfer_complete = (g_bytes_received >= g_total_size);

    if (window_full || transfer_complete) {
        g_chunk_count_in_window = 0;
        Serial.printf("[ota] ACK at %u / %u%s\n",
                      (unsigned)g_bytes_received, (unsigned)g_total_size,
                      transfer_complete ? " (final)" : "");
        notify(STATUS_ACK, g_bytes_received);
    }
}

void end() {
    Serial.printf("[ota] END: state=%d bytes=%u total=%u\n",
                  (int)g_state, (unsigned)g_bytes_received, (unsigned)g_total_size);

    if (g_state != State::RECEIVING && g_state != State::READY) {
        Serial.printf("[ota] END in unexpected state %d\n", (int)g_state);
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        return;
    }

    if (g_bytes_received != g_total_size) {
        Serial.printf("[ota] size mismatch — got %u, expected %u\n",
                      (unsigned)g_bytes_received, (unsigned)g_total_size);
        Update.abort();
        notify(STATUS_ERR_SIZE_MISMATCH, g_bytes_received);
        resetSession();
        return;
    }

    g_state = State::COMMITTING;
    notify(STATUS_COMMITTING, g_bytes_received);

    // true = set the new partition as the boot partition.
    if (!Update.end(true)) {
        Serial.printf("[ota] Update.end failed (err=%d)\n", (int)Update.getError());
        notify(STATUS_ERR_END_FAILED, g_bytes_received);
        resetSession();
        return;
    }

    setOtaPendingFlag(true);

    // Manual rollback bookkeeping: remember the partition that just delivered
    // the OTA (it's the "safe" image to roll back to) and reset the boot-
    // attempt counter. checkBootRecovery() will increment attempts on every
    // subsequent boot and swap back if it hits kRollbackTriggerAttempts.
    {
        Preferences nvs;
        if (nvs.begin(kRecoveryNvsNamespace, /*readOnly=*/false)) {
            const esp_partition_t* running = esp_ota_get_running_partition();
            uint8_t prev_subtype = running ? (uint8_t)running->subtype : 0xFF;
            nvs.putBool(kRecoveryKeyPending, true);
            nvs.putUInt(kRecoveryKeyAttempts, 0);
            nvs.putUChar(kRecoveryKeyPrevPart, prev_subtype);
            nvs.end();
            Serial.printf("[ota] armed manual rollback (prev_part subtype=0x%02x)\n",
                          prev_subtype);
        } else {
            Serial.println("[ota] failed to arm manual rollback (NVS begin rw failed)");
        }
    }

    Serial.println("[ota] image committed, rebooting in 100ms");
    notify(STATUS_REBOOTING, g_bytes_received);

    g_state = State::REBOOTING;

    // Give NimBLE a moment to push the REBOOTING notification before we vanish.
    delay(100);
    ESP.restart();
}

void abort() {
    Serial.printf("[ota] ABORT: state=%d bytes=%u\n",
                  (int)g_state, (unsigned)g_bytes_received);
    bool wasActive = (g_state == State::RECEIVING || g_state == State::READY);
    if (wasActive) {
        Update.abort();
    }
    // No chargerEnabled equivalent to restore — controller hard-refused when
    // motor was energized, so there's no saved state to undo here.
    resetSession();
    notify(STATUS_ABORTED, 0);
}

void tickWatchdog() {
    // Only fires while we're actively receiving chunks. READY is intentionally
    // excluded — it's a transient state right after begin(); the first chunk
    // sets s_ota_last_chunk_millis again. If chunks never arrive, the user can
    // disconnect (which auto-aborts) or send cmd=12.
    if (g_state != State::RECEIVING) return;
    uint32_t now = millis();
    if ((now - s_ota_last_chunk_millis) > kWatchdogTimeoutMs) {
        Serial.printf("[ota] watchdog — no chunk for >%u ms, aborting\n",
                      (unsigned)kWatchdogTimeoutMs);
        abort();
    }
}

void verify() {
    if (!readOtaPendingFlag()) {
        Serial.println("[ota] VERIFY: no pending flag — no-op");
        notify(STATUS_NOT_PENDING, 0);
        return;
    }

    esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
    if (err != ESP_OK) {
        Serial.printf("[ota] mark_app_valid_cancel_rollback err=%d\n", (int)err);
        notify(STATUS_ERR_END_FAILED, 0);
        return;
    }

    setOtaPendingFlag(false);

    // Clear the manual-rollback recovery state too. From this point on, boot
    // failures of this image are NOT counted toward an auto-swap — the user
    // has explicitly confirmed the image is healthy.
    {
        Preferences nvs;
        if (nvs.begin(kRecoveryNvsNamespace, /*readOnly=*/false)) {
            nvs.clear();
            nvs.end();
            Serial.println("[ota] cleared manual rollback state");
        } else {
            Serial.println("[ota] verify could not clear recovery NVS (begin rw failed)");
        }
    }

    Serial.println("[ota] image verified — rollback cancelled");
    notify(STATUS_VERIFIED, 0);
}

void checkBootRecovery() {
    // Called from setup() as the very first action after Serial.begin(),
    // before BLE/CAN/I2C/GPS setup. Running early means we detect a bricked
    // image BEFORE the panic-prone subsystems initialise.
    //
    // Output goes through Serial.printf (not Logger) because Logger is not
    // part of the controller firmware — recovery must be visible unconditionally.
    Preferences nvs;
    if (!nvs.begin(kRecoveryNvsNamespace, /*readOnly=*/false)) {
        // Namespace doesn't exist yet (clean device or never OTA'd). Nothing to do.
        return;
    }

    bool pending = nvs.getBool(kRecoveryKeyPending, false);
    if (!pending) {
        nvs.end();
        return;
    }

    // Increment unconditionally. Even if this boot ends up succeeding, we want
    // the counter to reflect "another reboot of an unverified image" so that
    // power-cycling without cmd=13 still trips rollback after kRollbackTriggerAttempts.
    uint32_t attempts = nvs.getUInt(kRecoveryKeyAttempts, 0) + 1;

    // Defensive ceiling: stop looping and let the user USB-reflash if even
    // the rollback path can't get into a working image.
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

        Serial.println(F("[ota-recovery] could not locate safe partition; clearing state and proceeding"));
        Serial.flush();
        nvs.clear();
        nvs.end();
        return;
    }

    // Persist the bumped counter and let setup() continue. If this boot ends
    // up panicking, the next boot will see the higher counter and may trip
    // rollback. If this boot ends up calling cmd=13 / verify(), the counter
    // and pending flag will be cleared.
    nvs.putUInt(kRecoveryKeyAttempts, attempts);
    nvs.end();
    Serial.printf("[ota-recovery] pending image, boot attempt %u/%u\n",
                  (unsigned)attempts, (unsigned)kRollbackTriggerAttempts);
    Serial.flush();
}

void logBootStatus() {
    bool pending = readOtaPendingFlag();
    const esp_partition_t* running = esp_ota_get_running_partition();
    Serial.printf("[ota] boot: running=%s pending_flag=%d\n",
                  running ? running->label : "?", (int)pending);
    if (pending) {
        Serial.println("[ota] booted into pending image — awaiting verify() from mobile");
    }
}

}  // namespace ota
