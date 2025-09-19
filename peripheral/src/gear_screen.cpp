#include "gear_screen.h"
bool GearScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void GearScreen::onTouch(int x, int y, TFT_eSprite *sprite)
 {
    sprite->drawString("G", x, y);
    return;
};

void GearScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
};
void GearScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);
  
  sprite->drawString("GEAR SCREEN", 200, 100);

};

void GearScreen::onScroll(int x, TFT_eSprite *sprite) {
    return;
};