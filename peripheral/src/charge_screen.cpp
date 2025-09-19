#include "charge_screen.h"
bool ChargeScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void ChargeScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
  sprite->drawString("C", x, y);
  return;
};

void ChargeScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

};
void ChargeScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{

  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);

  sprite->drawString("CHARGE SCREEN", 200, 100);
};

void ChargeScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};