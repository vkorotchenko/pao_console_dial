
#ifndef LOADING_SCREEN_H_
#define LOADING_SCREEN_H_

#include "screen.h"
#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>

class LoadingScreen : public screen {
    public:
    LoadingScreen() {};
    bool onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) ;
    void onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    private :
        ScreenTypes::ScreenType type = ScreenTypes::ScreenType::PRELOAD;

    
};

#endif /* LOADING_SCREEN_H_ */