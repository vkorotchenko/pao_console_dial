#include "data_screen.h"
bool DataScreen::onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  return false;
}

void DataScreen::onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
 {
    sprite->drawString("D", x, y);
    return;
};

void DataScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(strtol("cc75cc", NULL, 16));
  sprite->drawString("DATA SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void DataScreen::onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    return;
};