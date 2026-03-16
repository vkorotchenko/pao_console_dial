#include "data_screen.h"
#include "global_state.h"
#include "bigFont.h"
#include "midleFont.h"

// Data structure for carousel items
struct DataItem {
    const char* label;      // Display label (e.g., "SPEED")
    const char* unit;       // Unit string (e.g., "KM/H")
    uint8_t dataType;       // 0=int, 1=float, 2=enum(gear), 3=color-coded int (charge state)
    uint8_t decimalPlaces;  // For floats only
};

const DataItem DATA_ITEMS[14] = {
    // Motor Controller Data (7 items)
    {"MOTOR TEMP", "C", 0, 0},                  // 0: motorTemp (int)
    {"INVERTER TEMP", "C", 0, 0},               // 1: inverterTemp (int)
    {"TORQUE", "Nm", 0, 0},                     // 2: torque (int)
    {"DC VOLTAGE", "V", 0, 0},                  // 3: dcVoltage (int)
    {"DC CURRENT", "A", 0, 0},                  // 4: dcCurrent (int)
    {"MOTOR STATE", "", 2, 0},                  // 5: motorState (enum)
    {"MOTOR STATUS", "", 3, 0},                 // 6: combined flags (color-coded)

    // GPS Data (6 items)
    {"GPS LAT", "", 1, 4},                      // 7: gpsLatitude (float, 4 decimals)
    {"GPS LON", "", 1, 4},                      // 8: gpsLongitude (float, 4 decimals)
    {"GPS SPEED", "km/h", 1, 1},                // 9: gpsSpeed (float, 1 decimal)
    {"GPS ALT", "m", 1, 1},                     // 10: gpsAltitude (float, 1 decimal)
    {"SATELLITES", "", 0, 0},                   // 11: gpsSatellites (int)
    {"GPS FIX", "", 4, 0},                      // 12: gpsFixAvailable (bool/status)

    // Bus status
    {"CAN BUS", "", 4, 0},                      // 13: CAN bus connection status
};

// Charge state helper functions moved to global_state.cpp (shared with charge_screen)

String getGearString(Gears::Gear gear) {
    switch(gear) {
        case Gears::Gear::PARK: return "PARK";
        case Gears::Gear::DRIVE: return "DRIVE";
        case Gears::Gear::REVERSE: return "REV";
        case Gears::Gear::NEUTRAL: return "NEUTRAL";
        default: return "?";
    }
}

// Motor state string conversion
String getMotorStateString(int motorState) {
    switch(motorState) {
        case 0: return "DISABLED";
        case 1: return "STANDBY";
        case 2: return "ENABLE";
        case 3: return "POWERDOWN";
        default: return "UNKNOWN";
    }
}

// Motor status combines running/faulted/warning/ready flags
String getMotorStatusString(GlobalState &state) {
    if (state.getIsFaulted()) return "FAULTED";
    if (state.getIsWarning()) return "WARNING";
    if (state.getIsRunning()) return "RUNNING";
    if (state.getIsReady()) return "READY";
    return "IDLE";
}

// Get unit string from DATA_ITEMS array
const char* getUnitString(int index) {
    return DATA_ITEMS[index].unit;
}

String getValueString(int index) {
    GlobalState &state = GlobalState::getInstance();

    bool canConnected = state.getCanConnected();

    // Check for GPS fix availability
    bool gpsFixAvailable = state.getGpsFixAvailable();

    switch(index) {
        // Motor Controller Data (indices 0-4)
        case 0: return canConnected ? String(state.getMotorTemp()) : "N/A";
        case 1: return canConnected ? String(state.getInverterTemp()) : "N/A";
        case 2: return canConnected ? String(state.getTorque()) : "N/A";
        case 3: return canConnected ? String(state.getDcVoltage()) : "N/A";
        case 4: return canConnected ? String(state.getDcCurrent()) : "N/A";
        case 5: return getMotorStateString(state.getMotorState());
        case 6: return getMotorStatusString(state);  // Combines flags

        // GPS Data (indices 7-11)
        case 7: return gpsFixAvailable ? String(state.getGpsLatitude(), 4) : "--";
        case 8: return gpsFixAvailable ? String(state.getGpsLongitude(), 4) : "--";
        case 9: return gpsFixAvailable ? String(state.getGpsSpeed(), 1) : "--";
        case 10: return gpsFixAvailable ? String(state.getGpsAltitude(), 1) : "--";
        case 11: return gpsFixAvailable ? String(state.getGpsSatellites()) : "--";
        case 12: return gpsFixAvailable ? "AVAILABLE" : "NO FIX";
        case 13: return canConnected ? "CONNECTED" : "NO CONNECTION";

        default: return "--";
    }
}

// Helper function - not part of DataScreen class interface
uint16_t getValueColorHelper(int index) {
    GlobalState &state = GlobalState::getInstance();

    bool canConnected = state.getCanConnected();

    // Check for GPS fix availability
    bool gpsFixAvailable = state.getGpsFixAvailable();

    // CAN motor data (indices 0-4) - show grey if not connected
    if (index >= 0 && index <= 4) {
        return canConnected ? TFT_WHITE : TFT_DARKGREY;
    }

    // Motor status color-coding (index 6)
    if (index == 6) {
        if (state.getIsFaulted()) return TFT_RED;      // Faulted
        if (state.getIsWarning()) return TFT_YELLOW;   // Warning
        if (state.getIsRunning()) return TFT_GREEN;    // Running
        if (state.getIsReady()) return TFT_SKYBLUE;    // Ready
        return TFT_WHITE;                              // Idle
    }

    // GPS data (indices 7-11) - show grey if no fix
    if (index >= 7 && index <= 11) {
        return gpsFixAvailable ? TFT_WHITE : TFT_DARKGREY;
    }

    // GPS fix color-coding (index 12)
    if (index == 12) {
        return gpsFixAvailable ? TFT_GREEN : TFT_RED;
    }

    // CAN bus connection color-coding (index 13)
    if (index == 13) {
        return canConnected ? TFT_GREEN : TFT_RED;
    }

    // All other values: white
    return TFT_WHITE;
}

bool DataScreen::onClick(TFT_eSprite *sprite)
{
    return false;  // Allow button to switch screens
}

void DataScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
    return;  // No touch interaction needed
}

// Implement virtual methods from Carousel base class
const char* DataScreen::getItemLabel(int index) {
    return DATA_ITEMS[index].label;
}

String DataScreen::getItemValue(int index) {
    return getValueString(index);
}

const char* DataScreen::getItemUnit(int index) {
    return getUnitString(index);
}

uint16_t DataScreen::getValueColor(int index) {
    return getValueColorHelper(index);
}
