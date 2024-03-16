
#ifndef DATA_SCREEN_H_
#define DATA_SCREEN_H_

#include "screen.h"
#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>

class DataScreen : public Screen {
    public:

    DataScreen() : Screen{Screen::ScreenType::CAN_DATA} {};

    void onClick() ;
    void onTouch(int x, int y);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x);    
};

#endif /* DATA_SCREEN_H_ */