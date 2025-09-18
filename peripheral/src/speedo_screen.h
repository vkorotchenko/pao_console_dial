
#ifndef SPEEDO_SCREEN_H_
#define SPEEDO_SCREEN_H_


#include "screen.h"
#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>


class SpeedometerScreen :public screen {
    public:
    SpeedometerScreen() {};
    bool onClick(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) ;
    void onTouch(int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);

    private :
        ScreenTypes::ScreenType type = ScreenTypes::ScreenType::SPEEDOMETER;
};

#endif /* SPEEDO_SCREEN_H_ */