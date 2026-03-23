#include "charge_screen.h"
#include "global_state.h"
#include "banner_utils.h"
#include "bigFont.h"
#include "midleFont.h"

// ── Charge item definitions ───────────────────────────────────────────────────
// Indices 0-2 are editable (scroll to adjust, tap to confirm).
// Indices 3-4 are read-only telemetry.
struct ChargeItem {
    const char* label;
    const char* unit;
    bool editable;
    uint8_t canCmd;   // 1=set_max_time, 2=set_target_pct, 3=set_amps
    int minValue;
    int maxValue;
    int stepSize;
};

static const ChargeItem CHARGE_ITEMS[5] = {
    {"MAX AMPS",  "A",   true,  3, 0, 200, 5},   // 0: max charge current (1/10th A stored, display as A)
    {"TARGET %",  "%",   true,  2, 50, 100, 5},  // 1: target charge percentage (0-100)
    {"MAX TIME",  "min", true,  1, 0, 720, 15},  // 2: max charge time (minutes; sent as seconds)
    {"MAX TIME",  "min", false, 0, 0, 0,   0},   // 3: current max time display (read-only)
    {"TARGET V",  "V",   false, 0, 0, 0,   0},   // 4: target voltage (read-only)
};

// ── Progress bar ──────────────────────────────────────────────────────────────
static const int PB_X = 120;
static const int PB_Y = 133;
static const int PB_W = 300;
static const int PB_H = 28;

void ChargeScreen::drawProgressBar(TFT_eSprite* sprite) {
    GlobalState &state = GlobalState::getInstance();
    // Use voltage-derived SOC estimate; falls back to target% when no voltage data
    int pct = constrain(state.getEstimatedSOC(), 0, 100);

    // White 2px border
    sprite->drawRect(PB_X, PB_Y, PB_W, PB_H, TFT_WHITE);
    sprite->drawRect(PB_X + 1, PB_Y + 1, PB_W - 2, PB_H - 2, TFT_WHITE);

    // Sky blue fill
    int fillW = ((PB_W - 4) * pct) / 100;
    if (fillW > 0) {
        sprite->fillRect(PB_X + 2, PB_Y + 2, fillW, PB_H - 4, TFT_SKYBLUE);
    }

    // Percentage text centered in bar
    sprite->unloadFont();
    sprite->setTextDatum(MC_DATUM);
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_WHITE, TFT_BLACK);
    char buf[8];
    sprintf(buf, "%d%%", pct);
    sprite->drawString(buf, PB_X + PB_W / 2, PB_Y + PB_H / 2);
}

// ── display() override ────────────────────────────────────────────────────────
void ChargeScreen::display(TFT_eSprite* sprite, Arduino_ST7701_RGBPanel* gfx) {
    // Auto-clear pending indicator once charger confirms (GlobalState.pendingChargeCmd cleared)
    if (pendingConfirmIndex >= 0 && GlobalState::getInstance().getPendingChargeCmd() == 0) {
        pendingConfirmIndex = -1;
    }
    Carousel<5>::display(sprite, gfx);  // clears, draws banner + carousel panels
    drawProgressBar(sprite);            // overlay progress bar between banner and carousel
}

// ── Carousel virtual methods ──────────────────────────────────────────────────
const char* ChargeScreen::getItemLabel(int index) {
    return CHARGE_ITEMS[index].label;
}

String ChargeScreen::getItemValue(int index) {
    GlobalState &state = GlobalState::getInstance();

    if (isEditMode && index == currentIndex) {
        // Show the live edit value
        if (index == 0) {
            // MAX AMPS: editValue is in 1/10th A, display as A.A
            char buf[8];
            sprintf(buf, "%.1f", editValue / 10.0f);
            return String(buf);
        }
        return String(editValue);
    }

    switch (index) {
        case 0: {
            // requestedAmps is already in amps (float)
            char buf[8];
            sprintf(buf, "%.1f", state.getRequestedAmps());
            return String(buf);
        }
        case 1:
            return String(state.getChargePercentage());
        case 2: {
            // Max time: stored as seconds, display in minutes
            return String(state.getChargeMaxTime() / 60);
        }
        case 3: {
            // Read-only display of current max time in minutes
            return String(state.getChargeMaxTime() / 60);
        }
        case 4: {
            char buf[8];
            sprintf(buf, "%.1f", state.getTargetVoltage());
            return String(buf);
        }
        default: return String("--");
    }
}

const char* ChargeScreen::getItemUnit(int index) {
    return CHARGE_ITEMS[index].unit;
}

uint16_t ChargeScreen::getValueColor(int index) {
    if (isEditMode && index == currentIndex) return TFT_GREEN;
    if (index == pendingConfirmIndex && GlobalState::getInstance().getPendingChargeCmd() != 0)
        return TFT_ORANGE;
    if (!CHARGE_ITEMS[index].editable) return TFT_SKYBLUE;
    return TFT_WHITE;
}

void ChargeScreen::drawCenterExtra(TFT_eSprite* sprite, int index) {
    sprite->unloadFont();
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextSize(1);

    if (isEditMode) {
        sprite->setTextColor(TFT_GREEN, TFT_BLACK);
        sprite->drawString("[EDIT]", CENTER_X, CENTER_Y + 55);
    } else if (index == pendingConfirmIndex && GlobalState::getInstance().getPendingChargeCmd() != 0) {
        sprite->setTextColor(TFT_ORANGE, TFT_BLACK);
        sprite->drawString("[PEND]", CENTER_X, CENTER_Y + 55);
    } else if (CHARGE_ITEMS[index].editable) {
        sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
        sprite->drawString("[TAP]", CENTER_X, CENTER_Y + 55);
    }
}

// ── Touch: toggle edit mode ───────────────────────────────────────────────────
void ChargeScreen::onTouch(int x, int y, TFT_eSprite* sprite) {
    if (x < 0 || y < 0) return;

    unsigned long now = millis();
    if (now - lastTouchTime < TOUCH_DEBOUNCE) return;
    lastTouchTime = now;

    if (!CHARGE_ITEMS[currentIndex].editable) return;

    if (!isEditMode) {
        // Enter edit mode — seed with current value
        isEditMode = true;
        GlobalState &state = GlobalState::getInstance();
        switch (currentIndex) {
            case 0: editValue = (int)(state.getRequestedAmps() * 10.0f); break;
            case 1: editValue = state.getChargePercentage(); break;
            case 2: editValue = state.getChargeMaxTime() / 60; break;
            default: break;
        }
    } else {
        // Confirm edit — store pending command
        GlobalState &state = GlobalState::getInstance();
        uint8_t cmd = CHARGE_ITEMS[currentIndex].canCmd;
        uint16_t val = 0;
        switch (currentIndex) {
            case 0: val = (uint16_t)editValue; break;           // already in 1/10th A
            case 1: val = (uint16_t)(editValue * 10);  break;   // pct × 10 as per charger protocol
            case 2: val = (uint16_t)(editValue * 60);  break;   // minutes → seconds
            default: break;
        }
        state.setPendingChargeCmd(cmd, val);
        pendingConfirmIndex = currentIndex;
        isEditMode = false;
    }
}

bool ChargeScreen::onClick(TFT_eSprite* sprite) {
    return false;
}

// ── Scroll: carousel navigation or value editing ──────────────────────────────
void ChargeScreen::onScroll(int x, TFT_eSprite* sprite) {
    if (!isEditMode) {
        Carousel<5>::onScroll(x, sprite);
        return;
    }

    // Edit mode: use accumulator to change editValue
    int delta = x - lastScrollValue;
    lastScrollValue = x;

    if (delta > 180)  delta -= 360;
    if (delta < -180) delta += 360;

    scrollAccumulator += delta;

    const int THRESHOLD = GlobalState::getInstance().getScrollThreshold();
    const int MAX_ACCUM = THRESHOLD + THRESHOLD / 2;
    if (scrollAccumulator >  MAX_ACCUM) scrollAccumulator =  MAX_ACCUM;
    if (scrollAccumulator < -MAX_ACCUM) scrollAccumulator = -MAX_ACCUM;

    const ChargeItem &item = CHARGE_ITEMS[currentIndex];
    if (scrollAccumulator >= THRESHOLD) {
        editValue += item.stepSize;
        if (editValue > item.maxValue) editValue = item.maxValue;
        scrollAccumulator = 0;
    } else if (scrollAccumulator <= -THRESHOLD) {
        editValue -= item.stepSize;
        if (editValue < item.minValue) editValue = item.minValue;
        scrollAccumulator = 0;
    }
}
