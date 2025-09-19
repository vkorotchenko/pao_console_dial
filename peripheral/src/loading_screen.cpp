#include "loading_screen.h"

bool LoadingScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void LoadingScreen::onTouch(int x, int y, TFT_eSprite *sprite) {
    sprite->drawString("L", x, y);
    return;
};

void LoadingScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

};

void LoadingScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);
  
  sprite->drawBitmap(0, -140, pao_logo, 420, 420, TFT_SKYBLUE);

  sprite->drawString("LOADING SCREEN", 100, 150);

};

void LoadingScreen::onScroll(int x, TFT_eSprite *sprite) {
    return;
};