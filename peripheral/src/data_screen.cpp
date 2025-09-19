#include "data_screen.h"
bool DataScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void DataScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
  sprite->drawString("D", x + TOUCH_X_OFFSET, y + TOUCH_Y_OFFSET);
  return;
};

void DataScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
};

void DataScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{

  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);

  sprite->drawString("DATA SCREEN", 200, 100);
};

void DataScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};