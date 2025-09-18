#include "speedo_screen.h"
bool SpeedometerScreen::onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  return false;
}

void SpeedometerScreen::onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
 {
    sprite->drawString("S", x, y);
    return;
};

void SpeedometerScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(strtol("cc75cc", NULL, 16));
  sprite->drawString("SPEEDO SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void SpeedometerScreen::onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    return;
};