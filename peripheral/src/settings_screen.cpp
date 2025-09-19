#include "settings_screen.h"
bool SettingsScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void SettingsScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
    sprite->drawString("S", x, y);
    return;
};

void SettingsScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

};

void SettingsScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);
  
  sprite->drawString("SETTINGS SCREEN", 200, 100);

};

void SettingsScreen::onScroll(int x, TFT_eSprite *sprite) {
    return;
};
