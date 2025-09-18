#include "global_state.h"

GearScreen gears;
LoadingScreen loading;

Screen* currentScreen;

void State::setup() {
    gear = Gear::PARK;
    currentScreen = &loading;
}

void State::getNextScreen()
{
    Screen::ScreenType currentType = currentScreen->getType();
    switch(currentType) {
        case Screen::ScreenType::PRELOAD:
            currentScreen = &gears;
            break;
        case Screen::ScreenType::GEARS:
            currentScreen = &loading;
            break;
        // case Screen::ScreenType::CAN_DATA:
        //     currentScreen = &charge;
        //     break;
        // case Screen::ScreenType::CHARGE:
        //     currentScreen = &settings;
        //     break;
        // case Screen::ScreenType::SETTINGS:
        //     currentScreen = &gears;
        //     break;
        default:
            // this should never happen 
            currentScreen = &loading;
    }
}
Screen* State::getCurrentScreen()
{
            // this should never happen 
            currentScreen = &loading;
    
}

{
    gear = newGear;
}

State::Gear State::getGear()
{
    return gear;
}