
#ifndef LOADING_SCREEN_H_
#define LOADING_SCREEN_H_

#include "screen.h"
#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>

class LoadingScreen : public Screen {
    public:
    void onClick() ;
    void onTouch(int x, int y);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x);
    
};

#endif /* LOADING_SCREEN_H_ */