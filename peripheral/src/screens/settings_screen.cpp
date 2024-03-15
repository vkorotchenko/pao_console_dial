#include "settings_screen.h"

void SettingsScreen::onClick(){
    return;
}

void SettingsScreen::onTouch(int x, int y) {
    return;
};

void SettingsScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite.fillSprite(strtol("75a1cc".getString().c_str(), NULL, 16));
  sprite.loadFont(midleFont);
  sprite.setTextColor(grays[2],grays[8]);
  sprite.drawString("SETTIGS SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite.getPointer(),400,240);
};

void SettingsScreen::onScroll(int x) {
    return;
};

virtual ScreenType SettingsScreen::type() {
    return ScreenType::SETTINGS;
};