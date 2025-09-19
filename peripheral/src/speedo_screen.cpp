#include "speedo_screen.h"
#include "global_state.h"
#include "bigFont.h"
#include "midleFont.h"

int X_RPM = 250;
int Y_RPM = 90;
int X_BATTERY = 250;
int Y_BATTERY = 200;
int X_SPEED = 70;
int Y_SPEED = 170;

int RPM_FONT_SIZE = 16;
int BATTERY_FONT_SIZE = 16;
int SPEED_FONT_SIZE = 20;

int RPM_X_OFFSET = 0;
int RPM_Y_OFFSET = -40;
int BATTERY_X_OFFSET = 0;
int BATTERY_Y_OFFSET = -40;
int SPEED_X_OFFSET = 0;
int SPEED_Y_OFFSET = -100;

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

  // speed

  sprite->loadFont(bigFont);
  sprite->setTextSize(SPEED_FONT_SIZE);
  sprite->setCursor(X_SPEED + SPEED_X_OFFSET, Y_SPEED + SPEED_Y_OFFSET);
  sprite->print(state.getSpeed());

  // battery
  sprite->loadFont(midleFont);
  sprite->setTextSize(BATTERY_FONT_SIZE);
  sprite->setCursor(X_BATTERY + BATTERY_X_OFFSET, Y_BATTERY + BATTERY_Y_OFFSET);
  sprite->print(state.getBatteryLevel());

  // rpm
  sprite->setTextSize(RPM_FONT_SIZE);
  sprite->setCursor(X_RPM + RPM_X_OFFSET, Y_RPM + RPM_Y_OFFSET);
  sprite->print(state.getRpm());
};

void SpeedometerScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{

  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);

  // speed
  sprite->drawString("KM/H", X_SPEED, Y_SPEED);

  // battery
  sprite->drawString("Battery (%)", X_BATTERY, Y_BATTERY);

  // rpm
  sprite->drawString("RPM", X_RPM, Y_RPM);
};

void SpeedometerScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};