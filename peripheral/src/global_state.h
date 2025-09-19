#ifndef GLOBAL_STATE_H_
#define GLOBAL_STATE_H_

#include "gear.h"
#include "screenType.h"

#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>

#include "gear_screen.h"
#include "loading_screen.h"
#include "data_screen.h"
#include "charge_screen.h"
#include "settings_screen.h"
#include "speedo_screen.h"
#include "spotify_screen.h"


class GlobalState
{
    public:
        static GlobalState& getInstance()
        {
            static GlobalState    instance;
            return instance;
        }
    private:
        GlobalState() {};

    Gears::Gear gear;
    screen * currentScreen;
    int speed = 0;
    int rpm = 0;
    int batteryLevel = 0;

    public:

    GlobalState(const GlobalState& obj) = delete;

    // Public API
    //gear selection page
    Gears::Gear getGear() { return gear; }
    void setGear(Gears::Gear newGear) { gear = newGear; }

    //speedometer page

    int getSpeed() { return speed; }
    void setSpeed(int newSpeed) { speed = newSpeed; } 
    int getRpm() { return rpm; }
    void setRpm(int newRpm) { rpm = newRpm; }
    int getBatteryLevel() { return batteryLevel; }
    void setBatteryLevel(int newBatteryLevel) { batteryLevel = newBatteryLevel; }

    void setup();
    void getNextScreen();
    screen * getCurrentScreen() { return currentScreen; }
};

#endif /* GLOABAL_STATE_H_ */
