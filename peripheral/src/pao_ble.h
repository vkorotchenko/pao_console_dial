#ifndef PAO_BLE_H
#define PAO_BLE_H

#include <NimBLEDevice.h>
#include "global_state.h"

#define PAO_SERVICE_UUID        "c909d45a-0560-4725-85e7-c20a9bbb74c2"
#define PAO_TELEMETRY_CHAR_UUID "c169df83-5127-46df-a18b-066672243018"
#define PAO_GEAR_CHAR_UUID      "b2b08d43-7ec9-40c4-add2-a3a899756607"
#define PAO_CHARGER_CHAR_UUID   "06ad7ea2-24cc-46fe-b791-78167b76693e"
#define PAO_SPEED_UNIT_CHAR_UUID "d3b4f172-9e8a-4c0b-a1d2-7f3e8c5b2a91"
#define PAO_MEDIA_CMD_CHAR_UUID  "a1b2c3d4-e5f6-7890-abcd-ef1234567891"
// Firmware version (READ + NOTIFY). 4 bytes little-endian:
// [major, minor, patch, build] (each uint8, clamped at 255).
// Matches charger 0xFF25 encoding exactly so the mobile decoder is reusable
// (Decision #43). Suffix `ff25` is a deliberate nod to the charger's 16-bit
// UUID; the rest of the bytes match the existing PAO 128-bit UUID family
// shape (see PAO_TELEMETRY_CHAR_UUID).
#define PAO_FW_VERSION_CHAR_UUID "ff250001-5127-46df-a18b-066672243018"

// OTA characteristics (Phase 5, mirrors charger Decision #52). 128-bit UUIDs
// using the same `ffXX` easter-egg prefix scheme as PAO_FW_VERSION_CHAR_UUID
// (`ff25` mirrors charger 0xFF25, etc.).
//
//   PAO_OTA_DISPATCH — WRITE. cmd byte + payload. Mirrors charger 0xFF05 OTA
//     cmd codes (10=BEGIN, 11=END, 12=ABORT, 13=VERIFY). OTA_BEGIN payload
//     is 37 bytes total after the cmd byte: [cmd:u8][size:u32 LE][sha256:32].
//     NOTE: this is a NEW dedicated OTA dispatcher characteristic — the dial
//     has no equivalent of charger's reused 0xFF05 config dispatcher.
//   PAO_OTA_DATA — WRITE_NR only. OTA chunk receiver. Up to (MTU-3) bytes
//     per write.
//   PAO_OTA_STATUS — NOTIFY only. 5-byte payload `[code:u8][bytes:u32 LE]`.
//     Wire-identical to charger 0xFF27 so the mobile decoder is reusable.
#define PAO_OTA_DISPATCH_CHAR_UUID "ff050001-5127-46df-a18b-066672243018"
#define PAO_OTA_DATA_CHAR_UUID     "ff260001-5127-46df-a18b-066672243018"
#define PAO_OTA_STATUS_CHAR_UUID   "ff270001-5127-46df-a18b-066672243018"

// File-static handle into pao_ble.cpp; ota.cpp calls this to push the 5-byte
// status payload over the OTA status characteristic. Always emits exactly
// 5 bytes: [code:u8][bytesReceived:u32 LE]. Safe to call before any client
// subscribes — falls through quietly when the characteristic doesn't exist.
void notifyOtaStatus(uint8_t code, uint32_t bytesReceived);

class PaoBleService : public NimBLEServerCallbacks {
public:
    static PaoBleService& getInstance();

    void begin();           // Initialize NimBLE, create service, start advertising
    void notifyTelemetry(); // Pack and notify 36-byte telemetry (call in loop ~2Hz)
    void notifyChargerIfChanged(); // Notify charger char if actuals changed
    void notifySpeedUnit(); // Notify speed unit characteristic with current GlobalState value
    void notifyMediaCommand(uint8_t cmd); // Notify media command characteristic (0x01-0x06)

    bool isConnected() const;

    // NimBLEServerCallbacks
    void onConnect(NimBLEServer* pServer) override;
    void onDisconnect(NimBLEServer* pServer) override;

private:
    PaoBleService() = default;

    NimBLEServer* _pServer = nullptr;
    NimBLECharacteristic* _telemetryChar = nullptr;
    NimBLECharacteristic* _gearChar = nullptr;
    NimBLECharacteristic* _chargerChar = nullptr;
    NimBLECharacteristic* _speedUnitChar = nullptr;
    NimBLECharacteristic* _mediaCmdChar = nullptr;
    NimBLECharacteristic* _fwVersionChar = nullptr;  // 4 bytes LE: maj,min,patch,build
    NimBLECharacteristic* _otaDispatchChar = nullptr;  // WRITE — cmd dispatcher
    NimBLECharacteristic* _otaDataChar = nullptr;      // WRITE_NR — OTA chunk receiver
    NimBLECharacteristic* _otaStatusChar = nullptr;    // NOTIFY — 5-byte status payload
    bool _connected = false;

    uint16_t _lastChargerActualV = 0;
    uint16_t _lastChargerActualA = 0;
    uint8_t  _lastChargerError = 0;
    bool     _chargerNotifyInitialized = false;

    class GearCallbacks : public NimBLECharacteristicCallbacks {
        void onWrite(NimBLECharacteristic* pCharacteristic) override;
    };
    class ChargerCallbacks : public NimBLECharacteristicCallbacks {
        void onRead(NimBLECharacteristic* pCharacteristic) override;
        void onWrite(NimBLECharacteristic* pCharacteristic) override;
    };
    class SpeedUnitCallbacks : public NimBLECharacteristicCallbacks {
        void onRead(NimBLECharacteristic* pCharacteristic) override;
        void onWrite(NimBLECharacteristic* pCharacteristic) override;
    };
    // OTA dispatcher — single WRITE characteristic that demultiplexes
    // cmd=10/11/12/13 into ota::begin/end/abort/verify. The OTA_BEGIN payload
    // (cmd=10) carries 36 bytes of [size:u32 LE][sha256:32] after the cmd byte.
    class OtaDispatchCallbacks : public NimBLECharacteristicCallbacks {
        void onWrite(NimBLECharacteristic* pCharacteristic) override;
    };
    // OTA chunk receiver — WRITE_WITHOUT_RESPONSE. Each invocation = one chunk
    // forwarded straight to ota::writeChunk. ACK windowing lives in ota.cpp.
    class OtaDataCallbacks : public NimBLECharacteristicCallbacks {
        void onWrite(NimBLECharacteristic* pCharacteristic) override;
    };

    GearCallbacks _gearCallbacks;
    ChargerCallbacks _chargerCallbacks;
    SpeedUnitCallbacks _speedUnitCallbacks;
    OtaDispatchCallbacks _otaDispatchCallbacks;
    OtaDataCallbacks _otaDataCallbacks;

    void packTelemetry(uint8_t* buffer);
    void packChargerConfig(uint8_t* buffer);
    void setFwVersion(bool notify);  // Pack FW_VERSION_* macros into _fwVersionChar
};

// Convenience singleton accessor
inline PaoBleService& paoBle() { return PaoBleService::getInstance(); }

#endif // PAO_BLE_H
