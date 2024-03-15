#include "global_state.h"

GearScreen gears = new GearScreen();
SpeedometerScreen speedometer = new SpeedometerScreen();
LoadingScreen loading = new LoadingScreen();
SpotifyScreen spotify = new SpotifyScreen();
DataScreen canData = new DataScreen();
ChargeScreen charge = new ChargeScreen();
SettingsScreen settings = new SettingsScreen();


void State::setup() {
    gear = Gear::PARK;
    currentScreen = loading;
};

void State::nextScreen()
{
    ScreenType currentType = currentScreen.type(); // TODO check if we want to change this to pointer
    switch(currentType) {
        case ScreenType::PRELOAD:
            currentScreen = gears;
            break;
        case ScreenType::GEARS:
            currentScreen = speedometer;
            break;
        case ScreenType::SPEEDOMETER:
            currentScreen = spotify;
            break;
        case ScreenType::SPOTIFY:
            currentScreen = canData;
            break;
        case ScreenType::CAN_DATA:
            currentScreen = charge;
            break;
        case ScreenType::CHARGE:
            currentScreen = settings;
            break;
        case ScreenType::SETTINGS:
            currentScreen = gears;
            break;
        default:
            // this should never happen 
            currentScreen = loading;
    }
}
Screen State::getCurrentScreen()
{
    return &currentScreen;
};

void State::setGear(Gear newGear)
{
    gear = newGear;
}

Gear State::getGear()
{
    return gear;
}