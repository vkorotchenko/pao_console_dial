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

    GearCallbacks _gearCallbacks;
    ChargerCallbacks _chargerCallbacks;
    SpeedUnitCallbacks _speedUnitCallbacks;

    void packTelemetry(uint8_t* buffer);
    void packChargerConfig(uint8_t* buffer);
};

// Convenience singleton accessor
inline PaoBleService& paoBle() { return PaoBleService::getInstance(); }

#endif // PAO_BLE_H
