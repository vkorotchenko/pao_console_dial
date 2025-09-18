#include "data_screen.h"

void DataScreen::onClick()
{
}

void DataScreen::onTouch(int x, int y) {
    return;
};

void DataScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite->fillSprite(strtol("cc75a1", NULL, 16));
//   sprite->loadFont(midleFont);
//   sprite->setTextColor(grays[2],grays[8]);
  sprite->drawString("DATA SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void DataScreen::onScroll(int x) {
    return;
};