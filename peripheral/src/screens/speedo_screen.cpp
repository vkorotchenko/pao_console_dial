#include "speedo_screen.h"

void SpeedometerScreen::onClick(){
    return;
}

void SpeedometerScreen::onTouch(int x, int y) {
    return;
};

void SpeedometerScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite->fillSprite(strtol("c1251c", NULL, 16));
//   sprite->loadFont(midleFont);
//   sprite->setTextColor(grays[2],grays[8]);
  sprite->drawString("SPEEDO SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite,400,240);
};

void SpeedometerScreen::onScroll(int x) {
    return;
};