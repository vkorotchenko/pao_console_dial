#include "loading_screen.h"

bool LoadingScreen::onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  return false;
}

void LoadingScreen::onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  gfx->fillScreen(DARKCYAN);
    sprite->drawString("L", x, y);
  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
    return;
};

void LoadingScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite->fillSprite(strtol("75cccc", NULL, 16));
//   sprite->loadFont(midleFont);
//   sprite->setTextColor(grays[2],grays[8]);
  sprite->drawString("LOADING SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void LoadingScreen::onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    return;
};