
#ifndef CHARGE_SCREEN_H_
#define CHARGE_SCREEN_H_

#include "screen.h"

class ChargeScreen :public screen {
    public:
    ChargeScreen() {};
    bool onClick(TFT_eSprite *sprite) ;
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

    private :
        ScreenTypes::ScreenType type = ScreenTypes::ScreenType::CHARGE;
};

#endif /* CHARGE_SCREEN_H_ */