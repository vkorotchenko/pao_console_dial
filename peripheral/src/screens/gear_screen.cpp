#include "gear_screen.h"
void GearScreen::onClick()
{
}

void GearScreen::onTouch(int x, int y) {
    return;
};

void GearScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite.fillSprite(strtol("cc75cc".getString().c_str(), NULL, 16));
  sprite.loadFont(midleFont);
  sprite.setTextColor(grays[2],grays[8]);
  sprite.drawString("GEAR SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite.getPointer(),400,240);
};

void GearScreen::onScroll(int x) {
    return;
};

virtual ScreenType GearScreen::type() {
    return ScreenType::GEARS;
}