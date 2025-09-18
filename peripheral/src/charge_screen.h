
#ifndef CHARGE_SCREEN_H_
#define CHARGE_SCREEN_H_


#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>
#include "screen.h"

class ChargeScreen : public Screen {

    public:
    ChargeScreen() : Screen{Screen::ScreenType::CHARGE}{};
    void onClick() ;
    void onTouch(int x, int y);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x);
};

#endif /* CHARGE_SCREEN_H_ */