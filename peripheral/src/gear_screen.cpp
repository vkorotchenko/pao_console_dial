#include "gear_screen.h"
bool GearScreen::onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  return false;
}

void GearScreen::onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
 {
    sprite->drawString("G", x, y);
    return;
};

void GearScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite->fillSprite(strtol("cc75cc", NULL, 16));
  sprite->drawString("GEAR SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void GearScreen::onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    return;
};