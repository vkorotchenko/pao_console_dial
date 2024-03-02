#ifndef PAO_GPS_HANDLER_H
#define PAO_GPS_HANDLER_H

#include <Arduino.h>
#include <Adafruit_GPS.h>
#include "global_state.h"

class GPSHandler {

  public:
    void setup();
    void loop(State::Data *data);
};
#endif