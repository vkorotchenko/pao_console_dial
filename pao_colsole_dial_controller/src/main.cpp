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
  gpsHandler.setup(); 
  canHandler.setup();
  i2cHandler.setup();
  ioHandler.setup();
}

void loop() {
  gpsHandler.loop(&globalState.data); 
  canHandler.process(&globalState.data);
  i2cHandler.process(&globalState.data);
  ioHandler.process(&globalState.data);
}