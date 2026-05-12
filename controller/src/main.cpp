#include <Arduino.h>
#include <Adafruit_GPS.h>
#include "gps_handler.h"
#include "can_handler.h"
#include "global_state.h"
#include "i2c_handler.h"
#include "io_handler.h"
#include "ble.h"
#include "ota.h"

GPSHandler gpsHandler;
CanHandler canHandler;
I2CHandler i2cHandler;
State globalState;
IOHandler ioHandler;
Ble ble;

void setup() {
  Serial.begin(115200);

  // OTA boot recovery MUST be the first call after Serial.begin().
  // It detects a bricked OTA image before any other subsystem (CAN, I2C, GPS,
  // BLE) initialises. On a third-consecutive failed boot it swaps the boot
  // partition back to the last-known-good image and reboots. Safe to call on
  // every boot — no-op when no OTA is pending.
  ota::checkBootRecovery();

  globalState.setup();  // Initialize all data fields to defaults
  gpsHandler.setup();

  // BLE setup after pin config, before CAN init. OTA can still proceed even
  // if the CAN bus is absent (e.g. powertrain off during bench flash).
  ble.setup();

  // Log OTA boot status AFTER BLE init so Serial output is unambiguously
  // sequenced after the "[ble] advertising started" line.
  ota::logBootStatus();

  canHandler.setup();
  i2cHandler.setup(&globalState.data);
  ioHandler.setup();
}

void loop() {
  // OTA in-flight gate: while a firmware image is being written, pause all
  // normal work to avoid contending with the flash writes and ensure the
  // watchdog is fed. This mirrors the charger/dial pattern.
  if (ota::isInFlight()) {
    ota::tickWatchdog();
    delay(10);
    return;
  }

  gpsHandler.loop(&globalState.data);
  canHandler.process(&globalState.data);
  i2cHandler.process(&globalState.data);
  ioHandler.process(&globalState.data);

  // Feed the OTA stale-transfer watchdog on every normal loop iteration.
  // Cheap no-op outside RECEIVING state.
  ota::tickWatchdog();

  // Periodic staleness checking (every 1 second)
  static unsigned long lastStalenessCheck = 0;
  if (millis() - lastStalenessCheck > 1000) {
    lastStalenessCheck = millis();

    if (globalState.isCanDataStale()) {
      Serial.println("CAN data stale - resetting to defaults");
      globalState.resetCanData();
    }

    if (globalState.isGpsDataStale()) {
      Serial.println("GPS data stale - resetting to defaults");
      globalState.resetGpsData();
    }
  }
}