#include "charge_screen.h"
bool ChargeScreen::onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  return false;
}

void ChargeScreen::onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
 {
    sprite->drawString("C", x, y);
    return;
};

void ChargeScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(strtol("cc75cc", NULL, 16));
  sprite->drawString("CHARGE SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void ChargeScreen::onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    return;
};