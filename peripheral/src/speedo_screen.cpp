#include "speedo_screen.h"
#include "global_state.h"

// Dial positions (3 dials across, evenly spaced)
const int DIAL_Y = 200;           // Vertical center for all dials
const int DIAL_RADIUS = 60;       // Radius of each dial
const int DIAL_THICKNESS = 15;    // Arc thickness

const int RPM_DIAL_X = 115;       // Left dial
const int SPEED_DIAL_X = 245;     // Center dial
const int TORQUE_DIAL_X = 375;    // Right dial

// Battery bar position
const int BATTERY_BAR_X = 100;    // Moved 20px left
const int BATTERY_BAR_Y = 300;    // Moved 100px up
const int BATTERY_BAR_WIDTH = 300;
const int BATTERY_BAR_HEIGHT = 40;

// Angle ranges for semi-circular dials (degrees)
const int DIAL_START_ANGLE = 30;   // Bottom-left (30° from bottom)
const int DIAL_END_ANGLE = 330;    // Bottom-right (330° from bottom)
const int DIAL_ANGLE_RANGE = 300;  // Total arc span

// Maximum values for each metric
const int MAX_RPM = 6000;          // Typical motor max RPM
const int MAX_SPEED_KMH = 200;     // km/h
const int MAX_SPEED_MPH = 120;     // mph
const int MAX_TORQUE = 150;        // Nm

bool SpeedometerScreen::onClick(TFT_eSprite *sprite)
{
    return false;  // Allow button to switch screens
}

void SpeedometerScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
    return;  // No touch interaction
}

void SpeedometerScreen::onScroll(int x, TFT_eSprite *sprite)
{
    return;  // No scroll interaction
}

// Helper: Color gradient based on value percentage
uint16_t SpeedometerScreen::getDialColor(int value, int maxValue) {
    if (maxValue == 0) return TFT_GREEN;  // Avoid division by zero

    int percent = (value * 100) / maxValue;
    if (percent < 50) return TFT_GREEN;
    if (percent < 75) return TFT_YELLOW;
    return TFT_RED;
}

void SpeedometerScreen::drawSemiCircularDial(
    TFT_eSprite* sprite,
    int centerX,
    int centerY,
    int radius,
    int value,
    int maxValue,
    const char* label,
    const char* unit)
{
    int innerRadius = radius - DIAL_THICKNESS;

    // Constrain value to valid range
    if (value < 0) value = 0;
    if (value > maxValue) value = maxValue;

    // 1. Draw background arc (gray, full range)
    sprite->drawArc(centerX, centerY, radius, innerRadius,
                    DIAL_START_ANGLE, DIAL_END_ANGLE,
                    TFT_DARKGREY, TFT_BLACK, true);

    // 2. Calculate value angle
    int valueAngle = DIAL_START_ANGLE;
    if (maxValue > 0) {
        valueAngle = DIAL_START_ANGLE + (value * DIAL_ANGLE_RANGE) / maxValue;
    }

    // Constrain to valid range
    if (valueAngle < DIAL_START_ANGLE) valueAngle = DIAL_START_ANGLE;
    if (valueAngle > DIAL_END_ANGLE) valueAngle = DIAL_END_ANGLE;

    // 3. Draw foreground arc (colored, current value)
    uint16_t color = getDialColor(value, maxValue);
    if (valueAngle > DIAL_START_ANGLE) {
        sprite->drawArc(centerX, centerY, radius, innerRadius,
                        DIAL_START_ANGLE, valueAngle,
                        color, TFT_BLACK, true);
    }

    // 4. Draw label above dial
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->drawString(label, centerX, centerY - radius - 15);

    // 5. Draw value text (large, centered)
    sprite->setTextSize(2);
    sprite->setTextColor(TFT_WHITE, TFT_BLACK);
    char valueStr[16];
    sprintf(valueStr, "%d", value);
    sprite->drawString(valueStr, centerX, centerY - 10);

    // 6. Draw unit below value (if provided)
    if (unit != nullptr && strlen(unit) > 0) {
        sprite->setTextSize(1);
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->drawString(unit, centerX, centerY + 15);
    }
}

void SpeedometerScreen::drawBatteryBar(TFT_eSprite* sprite) {
    GlobalState &state = GlobalState::getInstance();
    int batteryPercent = state.getBatteryLevel();

    // Constrain to valid range
    if (batteryPercent < 0) batteryPercent = 0;
    if (batteryPercent > 100) batteryPercent = 100;

    // 1. Draw white outline (3 pixels thick)
    sprite->drawRect(BATTERY_BAR_X, BATTERY_BAR_Y,
                     BATTERY_BAR_WIDTH, BATTERY_BAR_HEIGHT, TFT_WHITE);
    sprite->drawRect(BATTERY_BAR_X + 1, BATTERY_BAR_Y + 1,
                     BATTERY_BAR_WIDTH - 2, BATTERY_BAR_HEIGHT - 2, TFT_WHITE);
    sprite->drawRect(BATTERY_BAR_X + 2, BATTERY_BAR_Y + 2,
                     BATTERY_BAR_WIDTH - 4, BATTERY_BAR_HEIGHT - 4, TFT_WHITE);

    // 2. Fill with color based on battery level
    int fillWidth = ((BATTERY_BAR_WIDTH - 6) * batteryPercent) / 100;
    uint16_t fillColor = batteryPercent > 20 ? TFT_GREEN : TFT_RED;

    if (fillWidth > 0) {
        sprite->fillRect(BATTERY_BAR_X + 3, BATTERY_BAR_Y + 3,
                         fillWidth, BATTERY_BAR_HEIGHT - 6, fillColor);
    }

    // 3. Draw percentage text centered in bar
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextSize(2);
    sprite->setTextColor(TFT_WHITE, TFT_BLACK);
    char percentStr[24];
    sprintf(percentStr, "BATTERY: %d%%", batteryPercent);
    sprite->drawString(percentStr,
                      BATTERY_BAR_X + (BATTERY_BAR_WIDTH / 2),
                      BATTERY_BAR_Y + 10);
}

void SpeedometerScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    GlobalState &state = GlobalState::getInstance();

    // Clear entire sprite to prevent artifacts
    sprite->fillSprite(TFT_BLACK);

    // Draw title
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString("SPEEDOMETER", 250, 40);

    // Get current values from global state
    int currentSpeed = state.getSpeed();
    int currentRPM = state.getRpm();
    int currentTorque = state.getTorque();

    // Determine speed unit and max value
    const char* speedUnit = state.getUseMetricUnits() ? "km/h" : "mph";
    int maxSpeed = state.getUseMetricUnits() ? MAX_SPEED_KMH : MAX_SPEED_MPH;

    // Draw three semi-circular dials
    drawSemiCircularDial(sprite, RPM_DIAL_X, DIAL_Y, DIAL_RADIUS,
                         currentRPM, MAX_RPM, "RPM", "");

    drawSemiCircularDial(sprite, SPEED_DIAL_X, DIAL_Y, DIAL_RADIUS,
                         currentSpeed, maxSpeed, "SPEED", speedUnit);

    drawSemiCircularDial(sprite, TORQUE_DIAL_X, DIAL_Y, DIAL_RADIUS,
                         currentTorque, MAX_TORQUE, "TORQUE", "Nm");

    // Draw battery range status bar
    drawBatteryBar(sprite);
}

void SpeedometerScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    // Title and all elements are drawn in display() since we clear every frame
}
