#ifndef GLOABAL_STATE_H_
#define GLOABAL_STATE_H_

#include <Arduino.h>

#include "screen.h"
#include "data_screen.h"
#include "gear_screen.h"
#include "loading_screen.h"
#include "settings_screen.h"
#include "speedo_screen.h"
#include "spotify_screen.h"
#include "charge_screen.h"

class State {
public:

    enum Gear {
        NEUTRAL = 0,
        DRIVE = 1,
        REVERSE = 2,
        PARK = 3,
    };
    
    Gear getGear();
    void setGear(Gear newGear);
    void setup();
    void getNextScreen();
    Screen* getCurrentScreen();

private:
    Screen *currentScreen;
    Screen *nextScreen;    State::Gear gear;
};

#endif /* GLOABAL_STATE_H_ */

