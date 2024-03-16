
#ifndef SPEEDO_SCREEN_H_
#define SPEEDO_SCREEN_H_

#include "screen.h"
#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>

class SpeedometerScreen :public Screen {
    public:
    void onClick() ;
    void onTouch(int x, int y);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x);
    
};

#endif /* SPEEDO_SCREEN_H_ */