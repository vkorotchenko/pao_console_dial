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

const SettingItem SETTINGS[4] = {
    {"BRIGHTNESS", "%",  0, 0, 100,   1},   // 0: Display Brightness
    {"UNITS",      "",   1, 0, 1,     1},   // 1: Speed Units (0=MPH, 1=KM/H)
    {"CHG ALERT",  "%",  0, 0, 100,   5},   // 2: Charge Alert Threshold
    {"TIMEOUT",    "s",  0, 0, 300,  15},   // 3: Screen Timeout
};

// Get current value for a setting index
int getCurrentValue(int index) {
    GlobalState &state = GlobalState::getInstance();

    switch(index) {
        case 0: return state.getDisplayBrightness();
        case 1: return state.getUseMetricUnits() ? 1 : 0;  // Convert bool to int
        case 2: return state.getChargeAlertThreshold();
        case 3: return state.getScreenTimeout();
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
    // Calculate delta from last position (same as data_screen)
    int delta = x - lastScrollValue;
    lastScrollValue = x;

    // Handle encoder wraparound (359->0 or 0->359)
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (!isEditMode) {
        // NOT EDITING - Navigate between settings (carousel mode)
        scrollAccumulator += delta;

        if (scrollAccumulator >= SCROLL_THRESHOLD) {
            currentIndex = (currentIndex + 1) % 4;  // Next setting, wrap around
            scrollAccumulator = 0;
        }
        else if (scrollAccumulator <= -SCROLL_THRESHOLD) {
            currentIndex = (currentIndex - 1 + 4) % 4;  // Prev setting, wrap around
            scrollAccumulator = 0;
        }
    }
    else {
        // EDITING - Adjust value (no accumulator, direct response)
        const SettingItem &setting = SETTINGS[currentIndex];

        if (delta > 0) {
            // Rotate right - INCREASE value
            editValue += setting.stepSize;
            if (editValue > setting.maxValue) {
                editValue = setting.maxValue;  // Clamp to max
            }
        }
        else if (delta < 0) {
            // Rotate left - DECREASE value
            editValue -= setting.stepSize;
            if (editValue < setting.minValue) {
                editValue = setting.minValue;  // Clamp to min
            }
        }
    }
}

void SettingsScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    // Clear all dynamic content areas to prevent ghosting
    sprite->fillRect(50, 100, 100, 200, TFT_BLACK);   // Left preview
    sprite->fillRect(150, 80, 180, 240, TFT_BLACK);   // Center area
    sprite->fillRect(330, 100, 100, 200, TFT_BLACK);  // Right preview

    // Calculate indices with wrapping (4 settings)
    int prevIndex = (currentIndex - 1 + 4) % 4;
    int nextIndex = (currentIndex + 1) % 4;

    // Get values to display
    int prevValue = getCurrentValue(prevIndex);
    int centerValue = isEditMode ? editValue : getCurrentValue(currentIndex);
    int nextValue = getCurrentValue(nextIndex);

    // Draw LEFT preview (label + value + unit)
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->setTextSize(1);
    sprite->drawString(SETTINGS[prevIndex].label, 100, 140);

    sprite->loadFont(midleFont);
    sprite->setTextSize(10);
    sprite->setTextColor(TFT_SILVER, TFT_BLACK);
    sprite->setCursor(100 - 30, 240 - 25);
    sprite->print(getValueString(prevIndex, prevValue));
    sprite->unloadFont();

    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(SETTINGS[prevIndex].unit, 100, 280);

    // Draw CENTER focus (label + LARGE value + unit)
    sprite->setTextSize(2);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->drawString(SETTINGS[currentIndex].label, 240 - 30, 120);

    // Draw edit mode indicator
    if (isEditMode) {
        sprite->setTextColor(TFT_GREEN, TFT_BLACK);
        sprite->drawString("[EDIT]", 240 - 20, 90);
    }

    sprite->loadFont(bigFont);
    sprite->setTextSize(22);
    sprite->setTextColor(getValueColor(isEditMode), TFT_BLACK);  // GREEN if editing, WHITE otherwise
    sprite->setCursor(240 - 50, 240 - 55);
    sprite->print(getValueString(currentIndex, centerValue));
    sprite->unloadFont();

    sprite->setTextSize(2);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->drawString(SETTINGS[currentIndex].unit, 240 - 10, 300);

    // Draw RIGHT preview (label + value + unit)
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(SETTINGS[nextIndex].label, 380, 140);

    sprite->loadFont(midleFont);
    sprite->setTextSize(10);
    sprite->setTextColor(TFT_SILVER, TFT_BLACK);
    sprite->setCursor(380 - 30, 240 - 25);
    sprite->print(getValueString(nextIndex, nextValue));
    sprite->unloadFont();

    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(SETTINGS[nextIndex].unit, 380, 280);
}

void SettingsScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    // Standard title format
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString("SETTINGS", 200, 40);

    // Draw arrows flanking center (indicate scroll direction)
    sprite->drawString("<<<", 200, 230);
    sprite->drawString(">>>", 280, 230);

    // Initialize state
    lastScrollValue = 0;
    scrollAccumulator = 0;
    currentIndex = 0;
    isEditMode = false;  // Always start in navigation mode
    editValue = 0;
}
