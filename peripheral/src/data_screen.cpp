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

const DataItem DATA_ITEMS[9] = {
    {"SPEED", "KM/H", 0, 0},                    // 0: Speed
    {"RPM", "", 0, 0},                          // 1: RPM
    {"BATTERY", "%", 0, 0},                     // 2: Battery Level
    {"CHARGE", "%", 0, 0},                      // 3: Charge Percentage
    {"STATUS", "", 3, 0},                       // 4: Charge State (color-coded)
    {"REQ AMPS", "A", 1, 1},                    // 5: Requested Amps
    {"CURRENT V", "V", 1, 1},                   // 6: Current Voltage
    {"TARGET V", "V", 1, 1},                    // 7: Target Voltage
    {"GEAR", "", 2, 0},                         // 8: Gear (enum)
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

// Get unit string with dynamic handling for speed (metric/imperial)
const char* getUnitString(int index) {
    GlobalState &state = GlobalState::getInstance();

    // Special case for speed (index 0) - use metric setting
    if (index == 0) {
        return state.getUseMetricUnits() ? "KM/H" : "MPH";
    }

    // For all other items, use default unit from array
    return DATA_ITEMS[index].unit;
}

String getValueString(int index) {
    GlobalState &state = GlobalState::getInstance();

    switch(index) {
        case 0: return String(state.getSpeed());
        case 1: return String(state.getRpm());
        case 2: return String(state.getBatteryLevel());
        case 3: return String(state.getChargePercentage());
        case 4: return String(getChargeStateString(state.getChargeState()));
        case 5: return String(state.getRequestedAmps(), 1);  // 1 decimal
        case 6: return String(state.getCurrentVoltage(), 1);
        case 7: return String(state.getTargetVoltage(), 1);
        case 8: return getGearString(state.getGear());
        default: return "--";
    }
}

uint16_t getValueColor(int index) {
    // Special color for charge state, white for everything else
    if (index == 4) {
        GlobalState &state = GlobalState::getInstance();
        return getChargeStateColor(state.getChargeState());
    }
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

void DataScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    // Clear all dynamic content areas to prevent ghosting
    // Left preview area
    sprite->fillRect(50, 100, 100, 200, TFT_BLACK);
    // Center area
    sprite->fillRect(150, 80, 180, 240, TFT_BLACK);
    // Right preview area
    sprite->fillRect(330, 100, 100, 200, TFT_BLACK);

    // Calculate indices with wrapping
    int prevIndex = (currentIndex - 1 + 9) % 9;
    int nextIndex = (currentIndex + 1) % 9;

    // Draw LEFT preview (label + value + unit)
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->setTextSize(1);
    sprite->drawString(DATA_ITEMS[prevIndex].label, 100, 140);

    sprite->loadFont(midleFont);
    sprite->setTextSize(10);
    sprite->setTextColor(TFT_SILVER, TFT_BLACK);
    sprite->setCursor(100 - 30, 240 - 25);
    sprite->print(getValueString(prevIndex));

    sprite->unloadFont();
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(getUnitString(prevIndex), 100, 280);

    // Draw CENTER focus (label + LARGE value + unit)
    sprite->setTextSize(2);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->drawString(DATA_ITEMS[currentIndex].label, 240 - 30, 120);

    sprite->loadFont(bigFont);
    sprite->setTextSize(22);
    sprite->setTextColor(getValueColor(currentIndex), TFT_BLACK);
    sprite->setCursor(240 - 50, 240 - 55);
    sprite->print(getValueString(currentIndex));

    sprite->unloadFont();
    sprite->setTextSize(2);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->drawString(getUnitString(currentIndex), 240 - 10, 300);

    // Draw RIGHT preview (label + value + unit)
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(DATA_ITEMS[nextIndex].label, 380, 140);

    sprite->loadFont(midleFont);
    sprite->setTextSize(10);
    sprite->setTextColor(TFT_SILVER, TFT_BLACK);
    sprite->setCursor(380 - 30, 240 - 25);
    sprite->print(getValueString(nextIndex));

    sprite->unloadFont();
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(getUnitString(nextIndex), 380, 280);
}

void DataScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    // Standard title format
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString("DATA CAROUSEL", 200, 40);

    // Draw arrows flanking center
    sprite->drawString("<<<", 200, 230);
    sprite->drawString(">>>", 280, 230);

    // Initialize encoder position
    lastScrollValue = 0;
    scrollAccumulator = 0;
    currentIndex = 0;
}

void DataScreen::onScroll(int x, TFT_eSprite *sprite)
{
    // Calculate delta from last position
    int delta = x - lastScrollValue;
    lastScrollValue = x;

    // Handle encoder wraparound (359->0 or 0->359)
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    // Accumulate scroll movement
    scrollAccumulator += delta;

    // Check if threshold reached for item change
    if (scrollAccumulator >= SCROLL_THRESHOLD) {
        currentIndex = (currentIndex + 1) % 9;  // Next item, wrap around
        scrollAccumulator = 0;
    }
    else if (scrollAccumulator <= -SCROLL_THRESHOLD) {
        currentIndex = (currentIndex - 1 + 9) % 9;  // Prev item, wrap around
        scrollAccumulator = 0;
    }
}
