
#ifndef LOADING_SCREEN_H_
#define LOADING_SCREEN_H_

#include "screen.h"
#include "pao_logo.h"

class LoadingScreen : public screen
{
public:
    LoadingScreen() {};
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::PRELOAD;
};

#endif /* LOADING_SCREEN_H_ */