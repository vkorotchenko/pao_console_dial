#ifndef PAO_SCREEN_H_
#define PAO_SCREEN_H_

#include "../global_state.h"
#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>


class Screen {
    public:

    enum ScreenType
    {
        PRELOAD = 0,
        CHARGE = 1,
        CAN_DATA = 2,
        SPOTIFY = 3,
        SPEEDOMETER = 4,
        SETTINGS = 5,
        GEARS = 6,
    };

    Screen(ScreenType screenType) {type = screenType;};
    virtual void onClick() = 0;
    virtual void onTouch(int x, int y) = 0;
    virtual void onScroll(int x) = 0;
    virtual void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) = 0;
    Screen::ScreenType getType() {return type;};
    protected:
    Screen::ScreenType type;
    
};

#endif /* PAO_SCREEN_H_ */