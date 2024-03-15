#ifndef GLOABAL_STATE_H_
#define GLOABAL_STATE_H_

#include <Arduino.h>
#include "screens/data_screen.h"
#include "screens/gear_screen.h"
#include "screens/loading_screen.h"
#include "screens/settings_screen.h"
#include "screens/speedo_screen.h"
#include "screens/spotify_screen.h"
#include "screens/charge_screen.h"

class State {
public:

    enum Gear {
        NEUTRAL = 0,
        DRIVE = 1,
        REVERSE = 2,
        PARK = 3,
    };
    
    enum ScreenType
    {
        PRELOAD = 0,
        CHARGE = 1,
        CAN_DATA = 2,
        SPOTIFY = 3,
        SPEEDOMETER = 4,
        SETTINGS = 5,
        GEARS = 6,
    };
    
    Gear getGear()
    void setGear(Gear newGear);
    void setup();
    void nextScreen();
    Screen getCurrentScreen();

private:
    Screen currentScreen;
    Gear gear;
};

#endif /* GLOABAL_STATE_H_ */

