// ble.cpp — BLE GATT server for PAO Controller.
//
// Cloned from charger/src/ble.{cpp,h} and stripped of all non-OTA
// characteristics. The charger exposes ~15 telemetry/config chars because
// mobile reads charger state over BLE. The controller routes all runtime
// telemetry to the dial over I²C — BLE is OTA-delivery-only in v1.
//
// Key divergences from charger/src/ble.cpp:
//   - Service UUID 0x27B1 (charger is 0x27B0) — intentional. See ble.h.
//   - Device name "Pao Controller" (charger is "Pao Charger").
//   - Only 4 characteristics: 0xFF25, 0xFF05, 0xFF26, 0xFF27.
//   - No 0xFF06 (on/off) lockout — controller has no equivalent user toggle.
//   - No OnOffWriteCallback, AmpWriteCallback, etc.
//   - No Ble::loop() — controller has no BLE telemetry update cycle.
//   - OTA safety gate in cmd=10 dispatcher: refuses if motor is energized
//     (globalState.data.resState == 2, i.e. ENABLE from CAN frame 0x23B).

#include "ble.h"
#include "version.h"
#include "ota.h"

// globalState is declared in main.cpp. ble.cpp reads resState for the OTA
// motor-energized safety gate check (same pattern as charger's extern bool
// chargerEnabled). The gate lives in ota::begin() — see ota.cpp.
extern State globalState;

// File-static handle to 0xFF27 used by notifyOtaStatus(). Set inside
// Ble::setup() once the characteristic is created. nullptr-safe — calls
// before setup() finishes are a no-op.
static NimBLECharacteristic* s_pOtaStat = nullptr;

void notifyOtaStatus(uint8_t code, uint32_t bytesReceived) {
    if (!s_pOtaStat) return;
    uint8_t buf[5] = {
        code,
        (uint8_t)(bytesReceived & 0xFF),
        (uint8_t)((bytesReceived >> 8) & 0xFF),
        (uint8_t)((bytesReceived >> 16) & 0xFF),
        (uint8_t)((bytesReceived >> 24) & 0xFF),
    };
    s_pOtaStat->setValue(buf, sizeof(buf));
    s_pOtaStat->notify();
}

// ---------------------------------------------------------------------------
// Compile-time clamp: each FW_VERSION_* field is packed as a single uint8.
// If we ever cross 255 in a field, take the cap and keep going.
// ---------------------------------------------------------------------------
static inline uint8_t clampU8(int v) {
    if (v < 0)   return 0;
    if (v > 255) return 255;
    return (uint8_t)v;
}

// 0xFF25 firmware version: 4 bytes little-endian — [major, minor, patch, build].
// Each field is clamped to 255 (uint8 wire width). build = commits-since-tag,
// 0 for a clean tag.
void Ble::setFwVersion(NimBLECharacteristic* c, bool notify) {
    uint8_t buf[4] = {
        clampU8(FW_VERSION_MAJOR),
        clampU8(FW_VERSION_MINOR),
        clampU8(FW_VERSION_PATCH),
        clampU8(FW_VERSION_BUILD),
    };
    c->setValue(buf, 4);
    if (notify) c->notify();
}

// ---------------------------------------------------------------------------
// Write callbacks
// ---------------------------------------------------------------------------

// 0xFF05 OTA dispatcher.
// Wire format: [cmdId, ...payload].
// OTA commands only — no config-reset (cmd=5), no on/off (cmd=6) as the
// controller has no charger enable toggle or stored config equivalent.
//   cmd 10 = OTA_BEGIN  — payload: 4-byte LE total_size + 32-byte sha256
//   cmd 11 = OTA_END    — no payload
//   cmd 12 = OTA_ABORT  — no payload
//   cmd 13 = OTA_VERIFY — no payload
class CtrlConfigCmdWriteCallback : public NimBLECharacteristicCallbacks {
public:
    void onWrite(NimBLECharacteristic* pChar) override {
        auto val = pChar->getValue();
        if (val.size() < 1) return;
        uint8_t cmd = val[0];
        Serial.printf("[ble] CMD cmd=%d (len=%d)\n", (int)cmd, (int)val.size());
        switch (cmd) {
            case 10: {
                // OTA_BEGIN — payload starts at byte 1, expect 36 bytes of meta.
                const uint8_t* payload = (val.size() > 1) ? (val.data() + 1) : nullptr;
                size_t payload_len = (val.size() > 1) ? (val.size() - 1) : 0;
                ota::begin(payload, payload_len);
                break;
            }
            case 11:
                ota::end();
                break;
            case 12:
                ota::abort();
                break;
            case 13:
                ota::verify();
                break;
            default:
                Serial.printf("[ble] CMD: unknown cmd %d — ignored\n", (int)cmd);
                break;
        }
    }
};

// 0xFF26 OTA chunk receiver. WRITE_WITHOUT_RESPONSE only: each callback
// invocation = one chunk. Forwards directly to ota::writeChunk(); the ACK
// window is managed inside ota.cpp.
class OtaDataWriteCallback : public NimBLECharacteristicCallbacks {
public:
    void onWrite(NimBLECharacteristic* pChar) override {
        auto val = pChar->getValue();
        if (val.size() == 0) return;
        ota::writeChunk(val.data(), val.size());
    }
};

// ---------------------------------------------------------------------------
// Server callbacks — seed version char on connect, restart adv on disconnect
// ---------------------------------------------------------------------------

class BleServerCallbacks : public NimBLEServerCallbacks {
    Ble* _ble;
public:
    BleServerCallbacks(Ble* ble) : _ble(ble) {}

    void onConnect(NimBLEServer* pServer) override {
        Serial.println("[ble] client connected");
        _ble->seedReadableChars();
    }

    void onDisconnect(NimBLEServer* pServer) override {
        Serial.println("[ble] client disconnected, restarting advertising");
        // If a client disconnects mid-OTA the controller would be stuck in a
        // non-IDLE OTA state. Auto-abort so abort() cleans up Update state.
        // Skip if we're already past the point of no return (REBOOTING) —
        // Update.end() already committed and ESP.restart() is imminent.
        // IDLE is the common case and is a no-op in abort().
        ota::State otaState = ota::currentState();
        if (otaState != ota::State::IDLE && otaState != ota::State::REBOOTING) {
            Serial.printf("[ble] disconnect during OTA (state=%d) — auto-aborting\n",
                          (int)otaState);
            ota::abort();
        }
        NimBLEDevice::startAdvertising();
    }
};

// ---------------------------------------------------------------------------
// Ble::seedReadableChars — populate the firmware version characteristic
// ---------------------------------------------------------------------------

void Ble::seedReadableChars() {
    // Firmware version — seed AND notify subscribers (if any) on every connect,
    // so the mobile app sees the current controller version as soon as the
    // GATT service is up.
    setFwVersion(pFwVer, /*notify=*/true);
    Serial.printf("[ble] firmware version: %s (sha=%s)\n",
                  FW_VERSION_STRING, FW_VERSION_GIT_SHA);
}

// ---------------------------------------------------------------------------
// Ble::setup — initialise NimBLE GATT server and start advertising
// ---------------------------------------------------------------------------

void Ble::setup() {
    // init() MUST come first — it brings up the NimBLE stack and creates the
    // mutexes that setMTU touches. Calling setMTU before init triggers a boot
    // panic (npl_freertos_mutex_pend with null handle).
    // Mobile negotiates MTU down on connect — effective per-chunk payload =
    // (negotiated MTU) - 3. 517 is the BLE 5.0 maximum.
    NimBLEDevice::init("Pao Controller");
    NimBLEDevice::setMTU(517);

    NimBLEServer* pServer = NimBLEDevice::createServer();
    pServer->setCallbacks(new BleServerCallbacks(this));

    // Service UUID 0x27B1 — controller service.
    // Charger uses 0x27B0. Both devices may be powered and visible at the same
    // time in the pit / garage; distinct UUIDs let mobile identify each device
    // by service without reading any characteristic.
    NimBLEService* pSvc = pServer->createService("27B1");

    // Firmware version (read + notify) — 4 bytes little-endian: maj,min,patch,build.
    pFwVer  = pSvc->createCharacteristic("FF25",
                  NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

    // OTA dispatcher — WRITE only (cmd 10/11/12/13).
    pCfgCmd = pSvc->createCharacteristic("FF05", NIMBLE_PROPERTY::WRITE);
    pCfgCmd->setCallbacks(new CtrlConfigCmdWriteCallback());

    // OTA chunk receiver — WRITE_NR only (raw binary, no echo, no notify).
    pOtaData = pSvc->createCharacteristic("FF26", NIMBLE_PROPERTY::WRITE_NR);
    pOtaData->setCallbacks(new OtaDataWriteCallback());

    // OTA status notify — 5 bytes: [code:u8][bytes_received:u32 LE].
    pOtaStat = pSvc->createCharacteristic("FF27", NIMBLE_PROPERTY::NOTIFY);
    s_pOtaStat = pOtaStat;

    seedReadableChars();

    pSvc->start();

    NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
    pAdv->addServiceUUID("27B1");
    pAdv->setScanResponse(true);
    NimBLEDevice::startAdvertising();

    Serial.println("[ble] advertising started as 'Pao Controller'");
}

// ---------------------------------------------------------------------------
// Ble::poll — no-op: NimBLE runs on its own FreeRTOS task
// ---------------------------------------------------------------------------

void Ble::poll() {}
