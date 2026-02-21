#include "global_state.h"

void State::setup() {
    // Initialize request/command fields to 0
    data.serviceId = 0;
    data.reqSpeed = 0;
    data.reqState = 0;
    data.reqGear = 0;
    data.reqTorque = 0;
    data.reqLimit = 0;
    data.reqAccel = 0;
    data.reqRegen = 0;

    // Initialize motor response data (CAN) to 0
    data.resMotorTemp = 0;
    data.resInvTemp = 0;
    data.resTorque = 0;
    data.resSpeed = 0;
    data.resState = 0;
    data.resDcVolt = 0;
    data.resDcCurrent = 0;

    // Initialize output flags to false
    data.outMainCon = false;
    data.outPreCon = false;
    data.outBrake = false;
    data.outCooling = false;
    data.outReverseLight = false;

    // Initialize input states
    data.inReverse = false;
    data.inEnable = false;
    data.inThrottle = 0;
    data.inBrake = 0;

    // Initialize status flags to false
    data.isRunning = false;
    data.isFaulted = false;
    data.isWarning = false;
    data.isReady = false;
    data.preChargeReady = false;

    // Initialize configuration fields to 0 (typically loaded from EEPROM later)
    data.configSpeedMax = 0;
    data.configTorqueMax = 0;
    data.configSpeedSlewRate = 0;
    data.configTorqueSlewRate = 0;
    data.configReversePercent = 0;
    data.configKilowattHrs = 0;
    data.configPrechargeR = 0;
    data.configNominalVolt = 0;
    data.configPrechargeRelay = 0;
    data.configMainContactorRelay = 0;
    data.configCoolFan = 0;
    data.configCoolOn = 0;
    data.configCoolOff = 0;
    data.configBrakeLight = 0;
    data.configRevLight = 0;
    data.configEnableIn = 0;
    data.configReverseIn = 0;
    data.configRegenTaperLower = 0;
    data.configRegenTaperUpper = 0;

    // Initialize GPS data to defaults
    data.gpsLatitude = 0.0f;
    data.gpsLongitude = 0.0f;
    data.gpsSpeed = 0.0f;
    data.gpsAltitude = 0.0f;
    data.gpsSatellites = 0;
    data.gpsFixAvailable = false;
    data.gpsHour = 0;
    data.gpsMinute = 0;
    data.gpsSecond = 0;
    data.gpsDay = 0;
    data.gpsMonth = 0;
    data.gpsYear = 0;

    // Initialize gear to PARK
    data.selectedGear = Gear::PARK;

    // Initialize timestamps to 0 (data is stale until first update)
    data.lastCanMessageTime = 0;
    data.lastGpsUpdateTime = 0;
}

bool State::isCanDataStale() {
    // Data is stale if timestamp is 0 or older than CAN_TIMEOUT_MS
    if (data.lastCanMessageTime == 0) {
        return true;
    }
    return (millis() - data.lastCanMessageTime) > CAN_TIMEOUT_MS;
}

bool State::isGpsDataStale() {
    // Data is stale if timestamp is 0 or older than GPS_TIMEOUT_MS
    if (data.lastGpsUpdateTime == 0) {
        return true;
    }
    return (millis() - data.lastGpsUpdateTime) > GPS_TIMEOUT_MS;
}

void State::resetCanData() {
    // Reset all CAN-related motor response fields to defaults
    data.resMotorTemp = 0;
    data.resInvTemp = 0;
    data.resTorque = 0;
    data.resSpeed = 0;
    data.resState = 0;
    data.resDcVolt = 0;
    data.resDcCurrent = 0;

    // Reset status flags
    data.isRunning = false;
    data.isFaulted = false;
    data.isWarning = false;
    data.isReady = false;
    data.preChargeReady = false;

    // Reset timestamp to indicate no valid data
    data.lastCanMessageTime = 0;
}

void State::resetGpsData() {
    // Reset all GPS fields to defaults
    data.gpsLatitude = 0.0f;
    data.gpsLongitude = 0.0f;
    data.gpsSpeed = 0.0f;
    data.gpsAltitude = 0.0f;
    data.gpsSatellites = 0;
    data.gpsFixAvailable = false;
    data.gpsHour = 0;
    data.gpsMinute = 0;
    data.gpsSecond = 0;
    data.gpsDay = 0;
    data.gpsMonth = 0;
    data.gpsYear = 0;

    // Reset timestamp to indicate no valid data
    data.lastGpsUpdateTime = 0;
}