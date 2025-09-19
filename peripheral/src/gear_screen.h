#ifndef GEAR_SCREEN_H_
#define GEAR_SCREEN_H_

#include "screen.h"
#include "gear.h"

class GearScreen : public screen
{
public:
    GearScreen() {};
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);
    void draw(TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::GEARS;
};

#endif /* GEAR_SCREEN_H_ */