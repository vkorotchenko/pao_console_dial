#include "global_state.h"

screen *gears = new GearScreen;
screen *loading = new LoadingScreen;
screen *data = new DataScreen;
screen *charge = new ChargeScreen;
screen *settings = new SettingsScreen;
screen *speedo = new SpeedometerScreen;
screen *spotify = new SpotifyScreen;

void GlobalState::setup()
{
    // gear = Gears::Gear::PARK;
    gears->setup(ScreenTypes::ScreenType::GEARS);
    loading->setup(ScreenTypes::ScreenType::PRELOAD);
    data->setup(ScreenTypes::ScreenType::CAN_DATA);
    charge->setup(ScreenTypes::ScreenType::CHARGE);
    settings->setup(ScreenTypes::ScreenType::SETTINGS);
    speedo->setup(ScreenTypes::ScreenType::SPEEDOMETER);
    spotify->setup(ScreenTypes::ScreenType::SPOTIFY);

    currentScreen = loading;
}

// Charge state helper functions (shared by charge_screen and data_screen)
uint16_t getChargeStateColor(int chargeState) {
    switch(chargeState) {
        case 0: return TFT_RED;      // Not Charging
        case 1: return TFT_GREEN;    // Charging
        case 2: return TFT_SKYBLUE;  // Complete
        default: return TFT_WHITE;
    }
}

const char* getChargeStateString(int chargeState) {
    switch(chargeState) {
        case 0: return "Not Charging";
        case 1: return "Charging";
        case 2: return "Complete";
        default: return "Unknown";
    }
}

void GlobalState::getNextScreen()
{

    ScreenTypes::ScreenType currentType = currentScreen->getType();

    switch (currentType)
    {
    case ScreenTypes::ScreenType::PRELOAD:
        currentScreen = gears;
        break;
    case ScreenTypes::ScreenType::GEARS:
        currentScreen = data;
        break;
    case ScreenTypes::ScreenType::CAN_DATA:
        currentScreen = charge;
        break;
    case ScreenTypes::ScreenType::CHARGE:
        currentScreen = settings;
        break;
    case ScreenTypes::ScreenType::SETTINGS:
        currentScreen = speedo;
        break;
    case ScreenTypes::ScreenType::SPEEDOMETER:
        currentScreen = spotify;
        break;
    case ScreenTypes::ScreenType::SPOTIFY:
        currentScreen = gears;
        break;
    default:
        // this should never happen
        currentScreen = loading;
    }
}