#include "settings_screen.h"
bool SettingsScreen::onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  return false;
}

void SettingsScreen::onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    sprite->drawString("S", x, y);
    return;
};

void SettingsScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(strtol("cc75cc", NULL, 16));
  sprite->drawString("SETTINGS SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void SettingsScreen::onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    return;
};
