
#ifndef LOADING_SCREEN_H_
#define LOADING_SCREEN_H_

#include "screen.h"
#include "pao_logo.h"

class LoadingScreen : public screen
{
public:
    LoadingScreen() {};
    bool onClick(TFT_eSprite *sprite) override;
    void onTouch(int x, int y, TFT_eSprite *sprite) override;
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) override;
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) override;
    void onScroll(int x, TFT_eSprite *sprite) override;

private:
    // Note: type is inherited from base screen class
};

#endif /* LOADING_SCREEN_H_ */