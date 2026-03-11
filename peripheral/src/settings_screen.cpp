#include "settings_screen.h"
#include "global_state.h"
#include "banner_utils.h"
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

const SettingItem SETTINGS[7] = {
    {"BRIGHTNESS", "%",  0, 0, 100,   1},   // 0: Display Brightness
    {"UNITS",      "",   1, 0, 1,     1},   // 1: Speed Units (0=MPH, 1=KM/H)
    {"CHG ALERT",  "%",  0, 0, 100,   5},   // 2: Charge Alert Threshold
    {"TIMEOUT",    "s",  0, 0, 300,  15},   // 3: Screen Timeout
    {"TIME FMT",   "",   1, 0, 1,     1},   // 4: Time Format (0=12hr, 1=24hr)
    {"TOUCH CAL",  "",   2, 0, 0,     0},   // 5: Touch calibration wizard
    {"DIAL CAL",   "",   2, 0, 0,     0},   // 6: Dial calibration wizard
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
    if (x < 0 || y < 0) return;

    // Handle calibration wizard taps first
    if (calibMode == CALIB_TOUCH_AWAIT) {
        calibRawX = x;
        calibRawY = y;
        calibMode = CALIB_TOUCH_RESULT;
        return;
    }
    if (calibMode == CALIB_TOUCH_RESULT) {
        GlobalState::getInstance().setTouchXOffset(CALIB_TARGET_X - calibRawX);
        GlobalState::getInstance().setTouchYOffset(CALIB_TARGET_Y - calibRawY);
        calibMode = CALIB_NONE;
        return;
    }
    if (calibMode == CALIB_DIAL_AWAIT) {
        calibMode = CALIB_DIAL_RESULT;
        return;
    }
    if (calibMode == CALIB_DIAL_RESULT) {
        if (calibDialPeak > 0) {
            GlobalState::getInstance().setScrollThreshold(calibDialPeak);
        }
        calibMode = CALIB_NONE;
        return;
    }

    // Debounce for normal settings interaction
    unsigned long currentTime = millis();
    if (currentTime - lastTouchTime < TOUCH_DEBOUNCE) return;
    lastTouchTime = currentTime;

    // Launch calibration wizards for type-2 items
    if (!isEditMode && SETTINGS[currentIndex].settingType == 2) {
        if (currentIndex == 5) {
            calibMode = CALIB_TOUCH_AWAIT;
        } else if (currentIndex == 6) {
            calibDialPeak = 0;
            calibMode = CALIB_DIAL_AWAIT;
        }
        return;
    }

    // Normal edit mode toggle
    if (!isEditMode) {
        isEditMode = true;
        editValue = getCurrentValue(currentIndex);
    } else {
        saveValue(currentIndex, editValue);
        isEditMode = false;
    }
}

void SettingsScreen::onScroll(int x, TFT_eSprite *sprite) {
    // During dial calibration: track max abs delta
    if (calibMode == CALIB_DIAL_AWAIT) {
        int delta = x - lastScrollValue;
        lastScrollValue = x;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        int absDelta = abs(delta);
        if (absDelta > calibDialPeak) calibDialPeak = absDelta;
        return;
    }
    // Block all scroll during other calibration states
    if (calibMode != CALIB_NONE) return;

    if (!isEditMode) {
        // NOT EDITING - Use base class carousel navigation
        Carousel<7>::onScroll(x, sprite);
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
        const int THRESHOLD = GlobalState::getInstance().getScrollThreshold();
        const int MAX_ACCUM = THRESHOLD + THRESHOLD / 2;
        const int RESET_THRESHOLD = THRESHOLD / 2;
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
    if (SETTINGS[index].settingType == 2) {
        return (index == 5) ? "TAP" : "TURN";
    }
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
        sprite->unloadFont();
        sprite->setTextDatum(TC_DATUM);
        sprite->setTextSize(1);
        sprite->setTextColor(TFT_GREEN, TFT_BLACK);
        sprite->drawString("[EDIT]", CENTER_X, CENTER_Y + 55);
    }
}

// ── Calibration wizard display ────────────────────────────────────────────────

void SettingsScreen::drawCalibScreen(TFT_eSprite* sprite) {
    sprite->unloadFont();
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextSize(2);

    if (calibMode == CALIB_TOUCH_AWAIT) {
        // Draw crosshair at target position
        sprite->drawLine(CALIB_TARGET_X - 20, CALIB_TARGET_Y,
                         CALIB_TARGET_X + 20, CALIB_TARGET_Y, TFT_WHITE);
        sprite->drawLine(CALIB_TARGET_X, CALIB_TARGET_Y - 20,
                         CALIB_TARGET_X, CALIB_TARGET_Y + 20, TFT_WHITE);
        sprite->fillCircle(CALIB_TARGET_X, CALIB_TARGET_Y, 4, TFT_GREEN);
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->drawString("Tap the crosshair", CALIB_TARGET_X, CALIB_TARGET_Y + 40);
    }
    else if (calibMode == CALIB_TOUCH_RESULT) {
        int newX = CALIB_TARGET_X - calibRawX;
        int newY = CALIB_TARGET_Y - calibRawY;
        char buf[32];
        sprite->setTextColor(TFT_GREEN, TFT_BLACK);
        sprintf(buf, "X: %+d  Y: %+d", newX, newY);
        sprite->drawString(buf, 240, 230);
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->drawString("Tap to save", 240, 270);
    }
    else if (calibMode == CALIB_DIAL_AWAIT) {
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->drawString("Rotate one click,", 240, 210);
        sprite->drawString("then tap", 240, 248);
        char buf[16];
        sprintf(buf, "Peak: %d deg", calibDialPeak);
        sprite->setTextColor(TFT_GREEN, TFT_BLACK);
        sprite->drawString(buf, 240, 300);
    }
    else if (calibMode == CALIB_DIAL_RESULT) {
        char buf[24];
        sprite->setTextColor(TFT_GREEN, TFT_BLACK);
        sprintf(buf, "Threshold: %d deg", calibDialPeak);
        sprite->drawString(buf, 240, 230);
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->drawString("Tap to save", 240, 270);
    }
}

void SettingsScreen::display(TFT_eSprite* sprite, Arduino_ST7701_RGBPanel* gfx) {
    if (calibMode != CALIB_NONE) {
        sprite->fillSprite(TFT_BLACK);
        GlobalState &state = GlobalState::getInstance();
        drawBanner(sprite, state);
        drawCalibScreen(sprite);
        return;
    }
    Carousel<7>::display(sprite, gfx);
}
