#ifndef GEAR_SCREEN_H_
#define GEAR_SCREEN_H_

#include "screen.h"
#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>

class GearScreen :public Screen {
    public:
    void onClick() ;
    void onTouch(int x, int y);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x);
    
};

#endif /* GEAR_SCREEN_H_ */