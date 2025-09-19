
#ifndef SETTING_SCREEN_H_
#define SETTING_SCREEN_H_

#include "screen.h"

class SettingsScreen : public screen
{
public:
    SettingsScreen() {};
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::SETTINGS;
};

#endif /* SETTING_SCREEN_H_ */