#ifndef SCREEN_H_
#define SCREEN_H_

#include "../global_state.h"
#include <TFT_eSPI.h>

class Screen {
    public:
    virtual void onClick() = 0;
    virtual void onTouch(int x, int y) = 0;
    virtual void onScroll(int x) = 0;
    virtual void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) = 0;
    virtual ScreenType type() = 0;
    protected:
};

#endif /* SCREEN_H_ */