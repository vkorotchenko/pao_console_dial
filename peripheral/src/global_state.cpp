#include "global_state.h"

GearScreen gears;
SpeedometerScreen speedometer;
LoadingScreen loading;
SpotifyScreen spotify;
DataScreen canData;
ChargeScreen charge;
SettingsScreen settings;

void State::setup() {
    gear = Gear::PARK;
    currentScreen = &loading;
};

void State::nextScreen()
{
    Screen::ScreenType currentType = currentScreen->getType();
    switch(currentType) {
        case Screen::ScreenType::PRELOAD:
            currentScreen = &gears;
            break;
        case Screen::ScreenType::GEARS:
            currentScreen = &speedometer;
            break;
        case Screen::ScreenType::SPEEDOMETER:
            currentScreen = &spotify;
            break;
        case Screen::ScreenType::SPOTIFY:
            currentScreen = &canData;
            break;
        case Screen::ScreenType::CAN_DATA:
            currentScreen = &charge;
            break;
        case Screen::ScreenType::CHARGE:
            currentScreen = &settings;
            break;
        case Screen::ScreenType::SETTINGS:
            currentScreen = &gears;
            break;
        default:
            // this should never happen 
            currentScreen = &loading;
    }
}
Screen* State::getCurrentScreen()
{
    return currentScreen;
};

void State::setGear(Gear newGear)
{
    gear = newGear;
}

State::Gear State::getGear()
{
    return gear;
}