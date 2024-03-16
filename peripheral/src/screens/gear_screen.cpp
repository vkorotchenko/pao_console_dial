#include "gear_screen.h"
void GearScreen::onClick()
{
}

void GearScreen::onTouch(int x, int y) {
    return;
};

void GearScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite->fillSprite(strtol("cc75cc", NULL, 16));
//   sprite->loadFont(midleFont);
//   sprite->setTextColor(grays[2],grays[8]);
  sprite->drawString("GEAR SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void Screen::onScroll(int x) {
    return;
};