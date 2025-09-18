#include "charge_screen.h"


void ChargeScreen::onClick()
{
}

void ChargeScreen::onTouch(int x, int y) {
    return;
};

void ChargeScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite->fillSprite(strtol("7575cc", NULL, 16));
//   sprite->loadFont(midleFont);
//   sprite->setTextColor(grays[2],grays[8]);
  sprite->drawString("CHARGE SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40, 120, (uint16_t*)sprite, 400,240);
};

void ChargeScreen::onScroll(int x) {
    return;
};