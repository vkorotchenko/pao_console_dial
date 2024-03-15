#include "loading_screen.h"
void LoadingScreen::onClick()
{
}

void LoadingScreen::onTouch(int x, int y) {
    return;
};

void LoadingScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite.fillSprite(strtol("75cccc".getString().c_str(), NULL, 16));
  sprite.loadFont(midleFont);
  sprite.setTextColor(grays[2],grays[8]);
  sprite.drawString("LOADING SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite.getPointer(),400,240);
};

void LoadingScreen::onScroll(int x) {
    return;
};

virtual ScreenType LoadingScreen::type() {
    return ScreenType::PRELOAD;
}