#ifndef GLOABAL_STATE_H_
#define GLOABAL_STATE_H_

#include <Arduino.h>

class State {
public:

    enum Gear {
        NEUTRAL = 0,
        DRIVE = 1,
        REVERSE = 2,
        PARK = 3,
    };
    
    enum Screen
    {
        PRELOAD = 0,
        CHARGING = 1,
        CAN_DATA = 2,
        SPOTIFY = 3,
        SPEEDOMETER = 4,
        SETTINGS = 5,
        GEARS = 6,
    };


    Screen screen;
    Gear gear;
    void setup();

private:
};

#endif /* GLOABAL_STATE_H_ */

