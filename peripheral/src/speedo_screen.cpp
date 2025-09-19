#include "speedo_screen.h"
bool SpeedometerScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void SpeedometerScreen::onTouch(int x, int y, TFT_eSprite *sprite)
 {
    sprite->drawString("S", x+TOUCH_X_OFFSET, y+TOUCH_Y_OFFSET);
    return;
};

void SpeedometerScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

};

void SpeedometerScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);
  
  sprite->drawString("SPEEDO SCREEN", 200, 100);

};

void SpeedometerScreen::onScroll(int x, TFT_eSprite *sprite) {
    return;
};