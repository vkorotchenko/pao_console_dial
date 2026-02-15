#include "speedo_screen.h"
#include "global_state.h"
#include "bigFont.h"
#include "midleFont.h"

// Centered layout for 540x540 display
int X_CENTER = 270;

int X_RPM = 270;
int Y_RPM = 120;
int X_BATTERY = 270;
int Y_BATTERY = 360;
int X_SPEED = 270;
int Y_SPEED = 240;

// Increased font sizes
int RPM_FONT_SIZE = 22;
int BATTERY_FONT_SIZE = 22;
int SPEED_FONT_SIZE = 32;  // Largest for main speed value

// Offsets for centering text
int RPM_X_OFFSET = -60;
int RPM_Y_OFFSET = -50;
int BATTERY_X_OFFSET = -60;
int BATTERY_Y_OFFSET = -50;
int SPEED_X_OFFSET = -80;
int SPEED_Y_OFFSET = -80;

bool SpeedometerScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void SpeedometerScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
  return;
};

void SpeedometerScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  GlobalState &state = GlobalState::getInstance();

  // Clear dynamic content areas to prevent ghosting
  sprite->fillRect(X_RPM - 100, Y_RPM - 20, 200, 80, TFT_BLACK);
  sprite->fillRect(X_BATTERY - 100, Y_BATTERY - 20, 200, 80, TFT_BLACK);
  sprite->fillRect(X_SPEED - 120, Y_SPEED - 40, 240, 120, TFT_BLACK);

  // RPM (top center)
  sprite->loadFont(midleFont);
  sprite->setTextSize(RPM_FONT_SIZE);
  sprite->setTextColor(TFT_WHITE, TFT_BLACK);
  sprite->setCursor(X_RPM + RPM_X_OFFSET, Y_RPM + RPM_Y_OFFSET);
  sprite->print(state.getRpm());

  // Speed (center, largest)
  sprite->loadFont(bigFont);
  sprite->setTextSize(SPEED_FONT_SIZE);
  sprite->setTextColor(TFT_WHITE, TFT_BLACK);
  sprite->setCursor(X_SPEED + SPEED_X_OFFSET, Y_SPEED + SPEED_Y_OFFSET);
  sprite->print(state.getSpeed());

  // Battery (bottom center)
  sprite->loadFont(midleFont);
  sprite->setTextSize(BATTERY_FONT_SIZE);
  sprite->setTextColor(TFT_WHITE, TFT_BLACK);
  sprite->setCursor(X_BATTERY + BATTERY_X_OFFSET, Y_BATTERY + BATTERY_Y_OFFSET);
  sprite->print(state.getBatteryLevel());
  sprite->print("%");
};

void SpeedometerScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);

  GlobalState &state = GlobalState::getInstance();

  // Standard title format
  sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  sprite->setTextSize(2);
  sprite->drawString("SPEEDOMETER", 200, 40);

  // Static labels centered above each value
  sprite->drawString("RPM", X_RPM - 20, Y_RPM - 30);

  // Display speed unit based on metric setting
  const char* speedUnit = state.getUseMetricUnits() ? "KM/H" : "MPH";
  sprite->drawString(speedUnit, X_SPEED - 30, Y_SPEED - 30);

  sprite->drawString("BATTERY", X_BATTERY - 35, Y_BATTERY - 30);
};

void SpeedometerScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};