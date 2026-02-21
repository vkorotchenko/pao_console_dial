#include "settings_screen.h"
#include "global_state.h"
#include "bigFont.h"
#include "midleFont.h"

// Settings structure definition
struct SettingItem {
    const char* label;      // Display label (e.g., "BRIGHTNESS")
    const char* unit;       // Unit string (e.g., "%")
    uint8_t settingType;    // 0=int range, 1=boolean (on/off)
    int minValue;           // Minimum value (for int ranges)
    int maxValue;           // Maximum value (for int ranges)
    int stepSize;           // Increment/decrement step
};

const SettingItem SETTINGS[5] = {
    {"BRIGHTNESS", "%",  0, 0, 100,   1},   // 0: Display Brightness
    {"UNITS",      "",   1, 0, 1,     1},   // 1: Speed Units (0=MPH, 1=KM/H)
    {"CHG ALERT",  "%",  0, 0, 100,   5},   // 2: Charge Alert Threshold
    {"TIMEOUT",    "s",  0, 0, 300,  15},   // 3: Screen Timeout
    {"TIME FMT",   "",   1, 0, 1,     1},   // 4: Time Format (0=12hr, 1=24hr)
};

// Get current value for a setting index
int getCurrentValue(int index) {
    GlobalState &state = GlobalState::getInstance();

    switch(index) {
        case 0: return state.getDisplayBrightness();
        case 1: return state.getUseMetricUnits() ? 1 : 0;  // Convert bool to int
        case 2: return state.getChargeAlertThreshold();
        case 3: return state.getScreenTimeout();
        case 4: return state.getTimeFormat24Hr() ? 1 : 0;  // Convert bool to int
        default: return 0;
    }
}

// Save value to GlobalState for a setting index
void saveValue(int index, int value) {
    GlobalState &state = GlobalState::getInstance();

    switch(index) {
        case 0: state.setDisplayBrightness(value); break;
        case 1: state.setUseMetricUnits(value == 1); break;  // Convert int to bool
        case 2: state.setChargeAlertThreshold(value); break;
        case 3: state.setScreenTimeout(value); break;
        case 4: state.setTimeFormat24Hr(value == 1); break;  // Convert int to bool
    }
}

// Format value as string for display
String getValueString(int index, int value) {
    const SettingItem &setting = SETTINGS[index];

    if (setting.settingType == 1) {
        // Boolean setting - show text instead of number
        if (index == 1) {  // Units setting
            return (value == 1) ? "KM/H" : "MPH";
        }
        if (index == 4) {  // Time format setting
            return (value == 1) ? "24 HR" : "12 HR";
        }
        return (value == 1) ? "ON" : "OFF";
    }
    else {
        // Numeric setting
        if (index == 3 && value == 0) {  // Timeout special case
            return "NEVER";
        }
        return String(value);
    }
}

// Get display color based on edit mode
uint16_t getValueColor(bool inEditMode) {
    return inEditMode ? TFT_GREEN : TFT_WHITE;
}

bool SettingsScreen::onClick(TFT_eSprite *sprite) {
    return false;  
}

void SettingsScreen::onTouch(int x, int y, TFT_eSprite *sprite) {
    // Only toggle on valid touch (not on touch release)
    if (x < 0 || y < 0) {
        return;  // Ignore touch release events
    }

    // Debounce - ignore touches that are too close together
    unsigned long currentTime = millis();
    if (currentTime - lastTouchTime < TOUCH_DEBOUNCE) {
        return;  // Too soon, ignore this touch
    }
    lastTouchTime = currentTime;

    // Toggle between edit and navigation mode on any screen touch
    if (!isEditMode) {
        // ENTER edit mode
        isEditMode = true;
        editValue = getCurrentValue(currentIndex);  // Copy current value
        // Visual feedback will happen in display() via color change
    }
    else {
        // EXIT edit mode - SAVE value
        saveValue(currentIndex, editValue);  // Save to GlobalState
        isEditMode = false;
    }
}

void SettingsScreen::onScroll(int x, TFT_eSprite *sprite) {
    if (!isEditMode) {
        // NOT EDITING - Use base class carousel navigation
        Carousel<5>::onScroll(x, sprite);
    }
    else {
        // EDITING - Use accumulator with lockout for consistent behavior
        int delta = x - lastScrollValue;
        lastScrollValue = x;

        // Handle encoder wraparound (359->0 or 0->359)
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        // Accumulate scroll movement
        scrollAccumulator += delta;

        // Clamp accumulator to single click range
        const int THRESHOLD = 15;
        const int MAX_ACCUM = 22;
        const int RESET_THRESHOLD = 8;
        if (scrollAccumulator > MAX_ACCUM) scrollAccumulator = MAX_ACCUM;
        if (scrollAccumulator < -MAX_ACCUM) scrollAccumulator = -MAX_ACCUM;

        // Clear lockout when accumulator drops below reset threshold
        if (abs(scrollAccumulator) < RESET_THRESHOLD) {
            scrollLockout = false;
        }

        const SettingItem &setting = SETTINGS[currentIndex];

        // Increment value when threshold reached (with lockout to prevent double-trigger)
        if (scrollAccumulator >= THRESHOLD && !scrollLockout) {
            editValue += setting.stepSize;
            if (editValue > setting.maxValue) {
                editValue = setting.maxValue;  // Clamp to max
            }
            scrollAccumulator = 0;
            scrollLockout = true;
        }
        else if (scrollAccumulator <= -THRESHOLD && !scrollLockout) {
            editValue -= setting.stepSize;
            if (editValue < setting.minValue) {
                editValue = setting.minValue;  // Clamp to min
            }
            scrollAccumulator = 0;
            scrollLockout = true;
        }
    }
}

// Implement virtual methods from Carousel base class
const char* SettingsScreen::getItemLabel(int index) {
    return SETTINGS[index].label;
}

String SettingsScreen::getItemValue(int index) {
    int value = isEditMode && index == currentIndex ? editValue : getCurrentValue(index);
    return getValueString(index, value);
}

const char* SettingsScreen::getItemUnit(int index) {
    return SETTINGS[index].unit;
}

uint16_t SettingsScreen::getValueColor(int index) {
    return isEditMode && index == currentIndex ? TFT_GREEN : TFT_WHITE;
}

void SettingsScreen::drawCenterExtra(TFT_eSprite* sprite, int index) {
    if (isEditMode) {
        sprite->setTextDatum(TC_DATUM);  // Top Center alignment
        sprite->setTextSize(1);
        sprite->setTextColor(TFT_GREEN, TFT_BLACK);
        sprite->drawString("[EDIT]", 240, 90);  // Centered at x=240
    }
}
