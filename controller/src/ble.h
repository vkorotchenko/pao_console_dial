#ifndef BLE_H_
#define BLE_H_

// ble.h — BLE service for the PAO Controller firmware.
//
// Service UUID: 0x27B1.
//   Deliberately distinct from the charger's 0x27B0 so the two devices
//   advertise different services when both are powered on near the mobile app.
//   Mobile can identify which device it is connecting to by service UUID alone.
//
// Characteristics (OTA-only subset — no runtime telemetry):
//   0xFF25  firmware version  READ | NOTIFY   4 bytes LE [major, minor, patch, build]
//   0xFF05  OTA dispatcher    WRITE           cmd 10=OTA_BEGIN  11=OTA_END  12=OTA_ABORT  13=OTA_VERIFY
//   0xFF26  OTA chunk         WRITE_NR        raw firmware bytes, one chunk per write
//   0xFF27  OTA status        NOTIFY          5 bytes: [code:u8][bytes_received:u32 LE]
//
// Controller telemetry (motor state, GPS, CAN) is routed over I²C to the dial,
// not exposed directly over BLE. A future stream may add BLE telemetry chars;
// that is explicitly out of scope for Stream 3.

#include <Arduino.h>
#include <NimBLEDevice.h>
#include "global_state.h"

// 0xFF27 OTA status notify. ota.cpp calls this; ble.cpp owns the
// characteristic. Always emits exactly 5 bytes: [code:u8][bytes:u32 LE].
// Safe to call before any client subscribes — falls through quietly when the
// characteristic doesn't exist yet (BLE not initialised).
void notifyOtaStatus(uint8_t code, uint32_t bytesReceived);

class Ble {
public:
    void setup();
    void poll();  // no-op: NimBLE runs on its own FreeRTOS task

    // Seed firmware version characteristic on every connect so the mobile app
    // reads the current version as soon as the GATT service is up.
    void seedReadableChars();

private:
    NimBLECharacteristic* pFwVer   = nullptr;  // 0xFF25  firmware version  READ | NOTIFY
    NimBLECharacteristic* pCfgCmd  = nullptr;  // 0xFF05  OTA dispatcher    WRITE
    NimBLECharacteristic* pOtaData = nullptr;  // 0xFF26  OTA chunk          WRITE_NR
    NimBLECharacteristic* pOtaStat = nullptr;  // 0xFF27  OTA status         NOTIFY

    static void setFwVersion(NimBLECharacteristic* c, bool notify = false);
};

#endif /* BLE_H_ */
