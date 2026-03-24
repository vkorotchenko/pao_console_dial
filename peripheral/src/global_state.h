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
    float speed = 0.0f;  // stored in knots
    int rpm = 0;
    int batteryLevel = 0;

    // Charge screen data
    int chargePercentage = 0;
    int chargeState = 0;  // 0=Not Charging, 1=Charging, 2=Complete
    float requestedAmps = 0.0f;
    float currentVoltage = 0.0f;
    float targetVoltage = 0.0f;
    uint8_t chargeErrorState = 0;      // error bitmask from charger
    uint16_t chargeMaxTime = 0;        // max charge time in seconds (from 0x18FFA1E5)

    // Pending charge config command — held until charger confirms via CAN broadcast
    uint8_t pendingChargeCmd = 0;      // 0=none, 1=set_max_time, 2=set_target_pct, 3=set_amps
    uint16_t pendingChargeValue = 0;
    unsigned long pendingChargeSentTime = 0;  // millis() when command was first queued

    // Settings data
    int displayBrightness = 100;      // 0-100%
    bool useMetricUnits = true;       // true=KM/H, false=MPH
    int chargeAlertThreshold = 20;    // 0-100%
    int screenTimeout = 60;           // 0-300 seconds, 0=never
    bool timeFormat24Hr = true;       // true=24hr, false=12hr
    bool autoPreLoadDismiss = true;  // true = block manual click on loading screen, pre-charge only

    // Charger config settings (dispatched via CAN cmds 0x04-0x07)
    int chargerNominalVoltage = 3200;  // 1/10th V (320.0V default)
    int chargerMaxMultiplier  = 114;   // ×100 (1.14 default)
    int chargerMinMultiplier  = 81;    // ×100 (0.81 default)
    bool chargerAutoNominal   = false;

    // Calibration data
    int touchXOffset    = -10;        // touch X correction (pixels)
    int touchYOffset    = -10;        // touch Y correction (pixels)
    int scrollThreshold = 15;         // encoder degrees per carousel click

    // Timezone
    int timezoneOffsetHours = 0;      // UTC offset, e.g. -5 for EST, +1 for CET

    // CAN motor controller data
    int motorTemp = 0;
    int inverterTemp = 0;
    int torque = 0;
    int dcVoltage = 0;
    int dcCurrent = 0;
    int motorState = 0;  // 0=DISABLED, 1=STANDBY, 2=ENABLE, 3=POWERDOWN
    bool isRunning = false;
    bool isFaulted = false;
    bool isWarning = false;
    bool isReady = false;
    bool preChargeReady = false;
    bool canConnected = false;

    // GPS data
    float gpsLatitude = 0.0f;
    float gpsLongitude = 0.0f;
    float gpsSpeed = 0.0f;
    float gpsAltitude = 0.0f;
    int gpsSatellites = 0;
    bool gpsFixAvailable = false;
    uint8_t gpsHour = 0;
    uint8_t gpsMinute = 0;
    uint8_t gpsSecond = 0;
    uint8_t gpsDay = 0;
    uint8_t gpsMonth = 0;
    uint8_t gpsYear = 0;

    // EEPROM persistence
    Preferences preferences;

public:
    GlobalState(const GlobalState &obj) = delete;

    // Public API
    // gear selection page
    Gears::Gear getGear() { return gear; }
    void setGear(Gears::Gear newGear) { gear = newGear; }

    // speedometer page

    // Returns speed converted from knots to mph or km/h based on units setting
    int getSpeed() {
        if (useMetricUnits) {
            return (int)(speed * 1.852f + 0.5f);   // knots → km/h
        } else {
            return (int)(speed * 1.15078f + 0.5f); // knots → mph
        }
    }
    void setSpeed(float newSpeed) { speed = newSpeed; }
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

    uint8_t getChargeErrorState() { return chargeErrorState; }
    void setChargeErrorState(uint8_t state) { chargeErrorState = state; }

    uint16_t getChargeMaxTime() { return chargeMaxTime; }
    void setChargeMaxTime(uint16_t seconds) { chargeMaxTime = seconds; }

    // Estimated SOC from live voltage vs target voltage.
    // Returns 0-100; falls back to chargePercentage (target %) if no voltage data.
    int getEstimatedSOC() {
        if (targetVoltage <= 0.0f || currentVoltage <= 0.0f) return chargePercentage;
        int soc = (int)((currentVoltage / targetVoltage) * chargePercentage);
        if (soc < 0) soc = 0;
        if (soc > 100) soc = 100;
        return soc;
    }

    uint8_t getPendingChargeCmd() { return pendingChargeCmd; }
    uint16_t getPendingChargeValue() { return pendingChargeValue; }
    void setPendingChargeCmd(uint8_t cmd, uint16_t value) {
        pendingChargeCmd = cmd;
        pendingChargeValue = value;
        pendingChargeSentTime = millis();
    }
    void clearPendingChargeCmd() {
        pendingChargeCmd = 0;
        pendingChargeValue = 0;
        pendingChargeSentTime = 0;
    }
    // Returns true if pending command has not been confirmed within 30 seconds
    bool isPendingChargeExpired() {
        return pendingChargeCmd != 0 &&
               (millis() - pendingChargeSentTime) > 30000UL;
    }

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

    bool getTimeFormat24Hr() { return timeFormat24Hr; }
    void setTimeFormat24Hr(bool value) {
        timeFormat24Hr = value;
        saveSettings();
    }

    int getTouchXOffset() { return touchXOffset; }
    void setTouchXOffset(int value) { touchXOffset = value; saveSettings(); }

    int getTouchYOffset() { return touchYOffset; }
    void setTouchYOffset(int value) { touchYOffset = value; saveSettings(); }

    int getScrollThreshold() { return scrollThreshold; }
    void setScrollThreshold(int value) { scrollThreshold = value; saveSettings(); }

    int getTimezoneOffsetHours() { return timezoneOffsetHours; }
    void setTimezoneOffsetHours(int value) { timezoneOffsetHours = value; saveSettings(); }

    bool getAutoPreLoadDismiss() { return autoPreLoadDismiss; }
    void setAutoPreLoadDismiss(bool value) { autoPreLoadDismiss = value; saveSettings(); }

    int  getChargerNominalVoltage() { return chargerNominalVoltage; }
    void setChargerNominalVoltage(int v) { chargerNominalVoltage = v; saveSettings(); }
    void updateChargerNominalVoltage(int v) { chargerNominalVoltage = v; }  // no EEPROM write

    int  getChargerMaxMultiplier() { return chargerMaxMultiplier; }
    void setChargerMaxMultiplier(int v) { chargerMaxMultiplier = v; saveSettings(); }
    void updateChargerMaxMultiplier(int v) { chargerMaxMultiplier = v; }

    int  getChargerMinMultiplier() { return chargerMinMultiplier; }
    void setChargerMinMultiplier(int v) { chargerMinMultiplier = v; saveSettings(); }
    void updateChargerMinMultiplier(int v) { chargerMinMultiplier = v; }

    bool getChargerAutoNominal() { return chargerAutoNominal; }
    void setChargerAutoNominal(bool v) { chargerAutoNominal = v; saveSettings(); }
    void updateChargerAutoNominal(bool v) { chargerAutoNominal = v; }

    // Local time/date with timezone applied
    int getLocalHour() {
        int h = (int)gpsHour + timezoneOffsetHours;
        if (h >= 24) h -= 24;
        if (h < 0)   h += 24;
        return h;
    }
    int getLocalDay() {
        int h = (int)gpsHour + timezoneOffsetHours;
        if (h >= 24) return gpsDay + 1;  // day rolled forward
        if (h < 0)   return gpsDay - 1;  // day rolled back
        return gpsDay;
    }
    int getLocalMonth() {
        int h = (int)gpsHour + timezoneOffsetHours;
        // Only adjust month if day rolled past month boundary
        if (h >= 24) {
            // day rolled forward — check if past end of month
            static const int dim[] = {0,31,28,31,30,31,30,31,31,30,31,30,31};
            int maxDay = (gpsMonth == 2 && (2000 + gpsYear) % 4 == 0) ? 29 : dim[gpsMonth];
            if (gpsDay >= maxDay) return gpsMonth + 1 > 12 ? 1 : gpsMonth + 1;
        } else if (h < 0) {
            // day rolled back — check if before start of month
            if (gpsDay <= 1) return gpsMonth - 1 < 1 ? 12 : gpsMonth - 1;
        }
        return gpsMonth;
    }

    // CAN motor controller data getters/setters
    int getMotorTemp() { return motorTemp; }
    void setMotorTemp(int temp) { motorTemp = temp; }

    int getInverterTemp() { return inverterTemp; }
    void setInverterTemp(int temp) { inverterTemp = temp; }

    int getTorque() { return torque; }
    void setTorque(int value) { torque = value; }

    int getDcVoltage() { return dcVoltage; }
    void setDcVoltage(int voltage) { dcVoltage = voltage; }

    int getDcCurrent() { return dcCurrent; }
    void setDcCurrent(int current) { dcCurrent = current; }

    int getMotorState() { return motorState; }
    void setMotorState(int state) { motorState = state; }

    bool getIsRunning() { return isRunning; }
    void setIsRunning(bool value) { isRunning = value; }

    bool getIsFaulted() { return isFaulted; }
    void setIsFaulted(bool value) { isFaulted = value; }

    bool getIsWarning() { return isWarning; }
    void setIsWarning(bool value) { isWarning = value; }

    bool getIsReady() { return isReady; }
    void setIsReady(bool value) { isReady = value; }

    bool getPreChargeReady() { return preChargeReady; }
    void setPreChargeReady(bool value) { preChargeReady = value; }

    bool getCanConnected() { return canConnected; }
    void setCanConnected(bool value) { canConnected = value; }

    // GPS data getters/setters
    float getGpsLatitude() { return gpsLatitude; }
    void setGpsLatitude(float lat) { gpsLatitude = lat; }

    float getGpsLongitude() { return gpsLongitude; }
    void setGpsLongitude(float lon) { gpsLongitude = lon; }

    float getGpsSpeed() { return gpsSpeed; }
    void setGpsSpeed(float speed) { gpsSpeed = speed; }

    float getGpsAltitude() { return gpsAltitude; }
    void setGpsAltitude(float alt) { gpsAltitude = alt; }

    int getGpsSatellites() { return gpsSatellites; }
    void setGpsSatellites(int sats) { gpsSatellites = sats; }

    bool getGpsFixAvailable() { return gpsFixAvailable; }
    void setGpsFixAvailable(bool available) { gpsFixAvailable = available; }

    uint8_t getGpsHour() { return gpsHour; }
    void setGpsHour(uint8_t hour) { gpsHour = hour; }

    uint8_t getGpsMinute() { return gpsMinute; }
    void setGpsMinute(uint8_t minute) { gpsMinute = minute; }

    uint8_t getGpsSecond() { return gpsSecond; }
    void setGpsSecond(uint8_t second) { gpsSecond = second; }

    uint8_t getGpsDay() { return gpsDay; }
    void setGpsDay(uint8_t day) { gpsDay = day; }

    uint8_t getGpsMonth() { return gpsMonth; }
    void setGpsMonth(uint8_t month) { gpsMonth = month; }

    uint8_t getGpsYear() { return gpsYear; }
    void setGpsYear(uint8_t year) { gpsYear = year; }

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
