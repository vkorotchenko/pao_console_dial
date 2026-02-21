#include <Arduino.h>
#include <Adafruit_GPS.h>
#include "gps_handler.h"
#include "can_handler.h"
#include "global_state.h"
#include "i2c_handler.h"
#include "io_handler.h"

GPSHandler gpsHandler; 
CanHandler canHandler;
I2CHandler i2cHandler;
State globalState;
IOHandler ioHandler;

void setup() {
  Serial.begin(115200);
  globalState.setup();  // Initialize all data fields to defaults
  gpsHandler.setup();
  canHandler.setup();
  i2cHandler.setup(&globalState.data);
  ioHandler.setup();
}

void loop() {
  gpsHandler.loop(&globalState.data);
  canHandler.process(&globalState.data);
  i2cHandler.process(&globalState.data);
  ioHandler.process(&globalState.data);

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