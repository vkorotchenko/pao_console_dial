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
    // Load settings from EEPROM
    loadSettings();

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

// EEPROM persistence implementation
void GlobalState::saveSettings()
{
    preferences.begin("pao-settings", false);  // false = read/write mode

    preferences.putInt("brightness", displayBrightness);
    preferences.putBool("metric", useMetricUnits);
    preferences.putInt("chargeAlert", chargeAlertThreshold);
    preferences.putInt("timeout", screenTimeout);

    preferences.end();
}

void GlobalState::loadSettings()
{
    preferences.begin("pao-settings", true);  // true = read-only mode

    // Load with default values if not found
    displayBrightness = preferences.getInt("brightness", 100);
    useMetricUnits = preferences.getBool("metric", true);
    chargeAlertThreshold = preferences.getInt("chargeAlert", 20);
    screenTimeout = preferences.getInt("timeout", 60);

    preferences.end();
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
        currentScreen = spotify;
        break;
    case ScreenTypes::ScreenType::SPOTIFY:
        currentScreen = speedo;
        break;
    case ScreenTypes::ScreenType::SPEEDOMETER:
        currentScreen = data;
        break;
    case ScreenTypes::ScreenType::CAN_DATA:
        currentScreen = charge;
        break;
    case ScreenTypes::ScreenType::CHARGE:
        currentScreen = settings;
        break;
    case ScreenTypes::ScreenType::SETTINGS:
        currentScreen = gears;  // Loop back to gears
        break;
    default:
        // Fallback to gears instead of loading to prevent getting stuck
        currentScreen = gears;
    }
}