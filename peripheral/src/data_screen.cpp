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

const DataItem DATA_ITEMS[13] = {
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

    switch(index) {
        // Motor Controller Data
        case 0: return String(state.getMotorTemp());
        case 1: return String(state.getInverterTemp());
        case 2: return String(state.getTorque());
        case 3: return String(state.getDcVoltage());
        case 4: return String(state.getDcCurrent());
        case 5: return getMotorStateString(state.getMotorState());
        case 6: return getMotorStatusString(state);  // Combines flags

        // GPS Data
        case 7: return String(state.getGpsLatitude(), 4);   // 4 decimals
        case 8: return String(state.getGpsLongitude(), 4);
        case 9: return String(state.getGpsSpeed(), 1);      // 1 decimal
        case 10: return String(state.getGpsAltitude(), 1);
        case 11: return String(state.getGpsSatellites());
        case 12: return state.getGpsFixAvailable() ? "AVAILABLE" : "NO FIX";

        default: return "--";
    }
}

// Helper function - not part of DataScreen class interface
uint16_t getValueColorHelper(int index) {
    GlobalState &state = GlobalState::getInstance();

    // Motor status color-coding (index 6)
    if (index == 6) {
        if (state.getIsFaulted()) return TFT_RED;      // Faulted
        if (state.getIsWarning()) return TFT_YELLOW;   // Warning
        if (state.getIsRunning()) return TFT_GREEN;    // Running
        if (state.getIsReady()) return TFT_SKYBLUE;    // Ready
        return TFT_WHITE;                              // Idle
    }

    // GPS fix color-coding (index 12)
    if (index == 12) {
        return state.getGpsFixAvailable() ? TFT_GREEN : TFT_RED;
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
