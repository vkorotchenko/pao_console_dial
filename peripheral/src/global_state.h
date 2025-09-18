#ifndef GLOBAL_STATE_H_
#define GLOBAL_STATE_H_

#include "gear.h"
#include "screen.h"
#include "global_state.h"
#include "gear_screen.h"
#include "loading_screen.h"
#include "data_screen.h"
#include "charge_screen.h"
#include "settings_screen.h"
#include "speedo_screen.h"
#include "spotify_screen.h"
#include "screenType.h"

class GlobalState {
public:
    // Gears::Gear getGear() { return gear; };
    // void setGear(Gears::Gear newGear) { gear = newGear; };
    void setup();
    void getNextScreen();
    screen * getCurrentScreen(){ return currentScreen; };

private: 
    // Gears::Gear gear;
    screen * currentScreen;
};

#endif /* GLOABAL_STATE_H_ */

