#include "speedo_screen.h"
#include "global_state.h"
#include "banner_utils.h"

// ── Concentric dial geometry ──────────────────────────────────────────────────
const int DIAL_CENTER_X  = 240;
const int DIAL_CENTER_Y  = 240;   // moved up to give more space below arcs for labels
const int DIAL_THICKNESS = 12;
const int DIAL_GAP       = 5;

const int R_BATTERY = 45;                              // innermost
const int R_RPM     = R_BATTERY + DIAL_THICKNESS + DIAL_GAP;   // 62
const int R_SPEED   = R_RPM     + DIAL_THICKNESS + DIAL_GAP;   // 79
const int R_TORQUE  = R_SPEED   + DIAL_THICKNESS + DIAL_GAP;   // 96 (outermost)

// ── Arc angle range (shared by all dials) ────────────────────────────────────
const int DIAL_START_ANGLE = 30;
const int DIAL_END_ANGLE   = 330;
const int DIAL_ANGLE_RANGE = 300;

// ── Metric maxima ─────────────────────────────────────────────────────────────
const int MAX_RPM       = 6000;
const int MAX_SPEED_KMH = 200;
const int MAX_SPEED_MPH = 120;

// ── Torque range (configurable) ───────────────────────────────────────────────
const int MIN_TORQUE = -20;   // Nm  negative limit
const int MAX_TORQUE = 100;   // Nm  positive limit

// ─────────────────────────────────────────────────────────────────────────────

bool SpeedometerScreen::onClick(TFT_eSprite *sprite)
{
    return false;
}

void SpeedometerScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
    return;
}

void SpeedometerScreen::onScroll(int x, TFT_eSprite *sprite)
{
    return;
}

// Green → Yellow → Red based on fill percentage
uint16_t SpeedometerScreen::getDialColor(int value, int maxValue) {
    if (maxValue == 0) return TFT_GREEN;
    int pct = (value * 100) / maxValue;
    if (pct < 50) return TFT_GREEN;
    if (pct < 75) return TFT_YELLOW;
    return TFT_RED;
}

// Draw one concentric arc ring (background + proportional foreground)
void SpeedometerScreen::drawConcentricDial(
    TFT_eSprite* sprite, int radius,
    int value, int maxValue, uint16_t fgColor)
{
    int inner = radius - DIAL_THICKNESS;

    // Background arc
    sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, radius, inner,
                    DIAL_START_ANGLE, DIAL_END_ANGLE,
                    TFT_DARKGREY, TFT_BLACK, true);

    if (maxValue <= 0) return;

    // Clamp value
    if (value < 0) value = 0;
    if (value > maxValue) value = maxValue;

    int valueAngle = DIAL_START_ANGLE + (value * DIAL_ANGLE_RANGE) / maxValue;
    if (valueAngle <= DIAL_START_ANGLE) return;

    sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, radius, inner,
                    DIAL_START_ANGLE, valueAngle,
                    fgColor, TFT_BLACK, true);
}

// Torque dial — handles negative (orange) and positive (green) halves
void SpeedometerScreen::drawTorqueDial(TFT_eSprite* sprite, int torque)
{
    int inner      = R_TORQUE - DIAL_THICKNESS;
    int totalRange = MAX_TORQUE - MIN_TORQUE;  // e.g. 120

    // Background (full arc, dark grey)
    sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, R_TORQUE, inner,
                    DIAL_START_ANGLE, DIAL_END_ANGLE,
                    TFT_DARKGREY, TFT_BLACK, true);

    // Angle at which torque == 0
    int zeroAngle = DIAL_START_ANGLE + ((-MIN_TORQUE) * DIAL_ANGLE_RANGE) / totalRange;

    // Clamp torque to configured range
    if (torque < MIN_TORQUE) torque = MIN_TORQUE;
    if (torque > MAX_TORQUE) torque = MAX_TORQUE;

    // Map torque value to angle
    int torqueAngle = DIAL_START_ANGLE + ((torque - MIN_TORQUE) * DIAL_ANGLE_RANGE) / totalRange;

    if (torque < 0) {
        // Negative: fill from torqueAngle → zeroAngle in orange
        if (torqueAngle < zeroAngle) {
            sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, R_TORQUE, inner,
                            torqueAngle, zeroAngle,
                            TFT_ORANGE, TFT_BLACK, true);
        }
    } else if (torque > 0) {
        // Positive: fill from zeroAngle → torqueAngle in green
        if (torqueAngle > zeroAngle) {
            sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, R_TORQUE, inner,
                            zeroAngle, torqueAngle,
                            TFT_GREEN, TFT_BLACK, true);
        }
    }
    // torque == 0: nothing filled — only dark grey background visible
}

// Battery innermost ring — green above 20%, red at or below
void SpeedometerScreen::drawBatteryDial(TFT_eSprite* sprite, int battery)
{
    if (battery < 0)   battery = 0;
    if (battery > 100) battery = 100;
    uint16_t color = (battery > 20) ? TFT_GREEN : TFT_RED;
    drawConcentricDial(sprite, R_BATTERY, battery, 100, color);
}

// Labels sit in the gap at the bottom of each arc, centred at x=240.
// Each label's y = DIAL_CENTER_Y + r * cos(30°) = DIAL_CENTER_Y + r * 0.866,
// which is the height of that arc's two gap-edge endpoints.
void SpeedometerScreen::drawLegend(TFT_eSprite* sprite, int torque, int battery, bool isStale)
{
    sprite->unloadFont();

    uint16_t torqueColor  = isStale ? TFT_DARKGREY : (torque < 0 ? TFT_ORANGE : TFT_GREEN);
    uint16_t batteryColor = isStale ? TFT_DARKGREY : (battery > 20 ? TFT_GREEN : TFT_RED);

    struct LegendItem { int radius; uint16_t color; const char* label; };
    // Listed innermost first so they stack BAT→RPM→SPD→TRQ top-to-bottom
    LegendItem items[4] = {
        { R_BATTERY, batteryColor,                            "BAT" },
        { R_RPM,     isStale ? TFT_DARKGREY : TFT_SKYBLUE,   "RPM" },
        { R_SPEED,   isStale ? TFT_DARKGREY : TFT_SKYBLUE,   "SPD" },
        { R_TORQUE,  torqueColor,                             "TRQ" },
    };

    sprite->setTextSize(1);
    sprite->setTextDatum(TL_DATUM);

    for (int i = 0; i < 4; i++) {
        // y aligned with this arc's gap endpoints
        int y = DIAL_CENTER_Y + (int)(items[i].radius * 0.866f);
        // dot + "XYZ" grouped and centred around x=240
        sprite->fillCircle(229, y + 4, 3, items[i].color);
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->drawString(items[i].label, 234, y);
    }
}

// Value text below legend — 3 fixed columns, each centred on its own x anchor
// Column x positions: speed=120, battery=240, rpm=360
void SpeedometerScreen::drawValueBar(
    TFT_eSprite* sprite,
    int speed, const char* speedUnit,
    int battery, int rpm,
    bool isSpeedStale, bool isCanStale)
{
    sprite->unloadFont();
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextSize(3);
    sprite->setTextColor(TFT_WHITE, TFT_BLACK);

    int lineY = DIAL_CENTER_Y + (int)(R_TORQUE * 0.866f) + 20;

    char col1[16], col2[12], col3[12];
    if (isSpeedStale) {
        sprintf(col1, " -- %s", speedUnit);
    } else {
        sprintf(col1, "%3d%s", speed, speedUnit);
    }
    if (isCanStale) {
        sprintf(col2, " --%%");
        sprintf(col3, " ---RPM");
    } else {
        sprintf(col2, "%3d%%",  battery);
        sprintf(col3, "%4dRPM", rpm);
    }

    sprite->drawString(col1, 120,           lineY);
    sprite->drawString(col2, DIAL_CENTER_X, lineY);
    sprite->drawString(col3, 360,           lineY);
}

// ── Main draw loop ────────────────────────────────────────────────────────────

void SpeedometerScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    GlobalState &state = GlobalState::getInstance();

    sprite->fillSprite(TFT_BLACK);
    drawBanner(sprite, state);

    bool isCanStale   = (state.getDcVoltage() == 0);
    bool isGpsStale   = !state.getGpsFixAvailable();
    int  currentSpeed  = state.getSpeed();
    int  currentRPM    = state.getRpm();
    int  currentTorque = state.getTorque();
    int  currentBat    = state.getBatteryLevel();

    const char* speedUnit = state.getUseMetricUnits() ? "km/h" : "mph";
    int maxSpeed = state.getUseMetricUnits() ? MAX_SPEED_KMH : MAX_SPEED_MPH;

    // CAN-sourced dials (torque, RPM, battery)
    if (!isCanStale) {
        drawTorqueDial(sprite, currentTorque);
        drawConcentricDial(sprite, R_RPM, currentRPM, MAX_RPM, getDialColor(currentRPM, MAX_RPM));
        drawBatteryDial(sprite, currentBat);
    } else {
        sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, R_TORQUE,  R_TORQUE  - DIAL_THICKNESS, DIAL_START_ANGLE, DIAL_END_ANGLE, TFT_DARKGREY, TFT_BLACK, true);
        sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, R_RPM,     R_RPM     - DIAL_THICKNESS, DIAL_START_ANGLE, DIAL_END_ANGLE, TFT_DARKGREY, TFT_BLACK, true);
        sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, R_BATTERY, R_BATTERY - DIAL_THICKNESS, DIAL_START_ANGLE, DIAL_END_ANGLE, TFT_DARKGREY, TFT_BLACK, true);
    }

    // GPS-sourced dial (speed)
    if (!isGpsStale) {
        drawConcentricDial(sprite, R_SPEED, currentSpeed, maxSpeed, getDialColor(currentSpeed, maxSpeed));
    } else {
        sprite->drawArc(DIAL_CENTER_X, DIAL_CENTER_Y, R_SPEED, R_SPEED - DIAL_THICKNESS, DIAL_START_ANGLE, DIAL_END_ANGLE, TFT_DARKGREY, TFT_BLACK, true);
    }

    drawLegend(sprite, currentTorque, currentBat, isCanStale);
    drawValueBar(sprite, currentSpeed, speedUnit, currentBat, currentRPM, isGpsStale, isCanStale);
}

void SpeedometerScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    GlobalState &state = GlobalState::getInstance();
    drawBanner(sprite, state);
}
