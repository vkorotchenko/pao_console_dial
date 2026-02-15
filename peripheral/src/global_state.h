#ifndef GLOBAL_STATE_H_
#define GLOBAL_STATE_H_

#include "gear.h"
#include "screenType.h"

#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>
#include <Preferences.h>

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
    static GlobalState &getInstance()
    {
        static GlobalState instance;
        return instance;
    }

private:
    GlobalState() {};

    Gears::Gear gear;
    screen *currentScreen;
    int speed = 0;
    int rpm = 0;
    int batteryLevel = 0;

    // Charge screen data
    int chargePercentage = 0;
    int chargeState = 0;  // 0=Not Charging, 1=Charging, 2=Complete
    float requestedAmps = 0.0f;
    float currentVoltage = 0.0f;
    float targetVoltage = 0.0f;

    // Settings data
    int displayBrightness = 100;      // 0-100%
    bool useMetricUnits = true;       // true=KM/H, false=MPH
    int chargeAlertThreshold = 20;    // 0-100%
    int screenTimeout = 60;           // 0-300 seconds, 0=never

    // EEPROM persistence
    Preferences preferences;

public:
    GlobalState(const GlobalState &obj) = delete;

    // Public API
    // gear selection page
    Gears::Gear getGear() { return gear; }
    void setGear(Gears::Gear newGear) { gear = newGear; }

    // speedometer page

    int getSpeed() { return speed; }
    void setSpeed(int newSpeed) { speed = newSpeed; }
    int getRpm() { return rpm; }
    void setRpm(int newRpm) { rpm = newRpm; }
    int getBatteryLevel() { return batteryLevel; }
    void setBatteryLevel(int newBatteryLevel) { batteryLevel = newBatteryLevel; }

    // Charge screen page
    int getChargePercentage() { return chargePercentage; }
    void setChargePercentage(int newPercentage) { chargePercentage = newPercentage; }

    int getChargeState() { return chargeState; }
    void setChargeState(int newState) { chargeState = newState; }

    float getRequestedAmps() { return requestedAmps; }
    void setRequestedAmps(float newAmps) { requestedAmps = newAmps; }

    float getCurrentVoltage() { return currentVoltage; }
    void setCurrentVoltage(float newVoltage) { currentVoltage = newVoltage; }

    float getTargetVoltage() { return targetVoltage; }
    void setTargetVoltage(float newVoltage) { targetVoltage = newVoltage; }

    // Settings page (with EEPROM persistence)
    int getDisplayBrightness() { return displayBrightness; }
    void setDisplayBrightness(int value) {
        displayBrightness = value;
        saveSettings();
    }

    bool getUseMetricUnits() { return useMetricUnits; }
    void setUseMetricUnits(bool value) {
        useMetricUnits = value;
        saveSettings();
    }

    int getChargeAlertThreshold() { return chargeAlertThreshold; }
    void setChargeAlertThreshold(int value) {
        chargeAlertThreshold = value;
        saveSettings();
    }

    int getScreenTimeout() { return screenTimeout; }
    void setScreenTimeout(int value) {
        screenTimeout = value;
        saveSettings();
    }

    // EEPROM persistence methods
    void saveSettings();
    void loadSettings();

    void setup();
    void getNextScreen();
    screen *getCurrentScreen() { return currentScreen; }
};

// Charge state helper functions (shared by charge_screen and data_screen)
uint16_t getChargeStateColor(int chargeState);
const char* getChargeStateString(int chargeState);

#endif /* GLOABAL_STATE_H_ */
