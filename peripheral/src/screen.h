#ifndef PAO_SCREEN_H_
#define PAO_SCREEN_H_

#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>
#include "screenType.h"

class screen
{
public:
    virtual void setup(ScreenTypes::ScreenType type) { this->type = type; };
    virtual bool onClick(TFT_eSprite *sprite) = 0;
    virtual void onTouch(int x, int y, TFT_eSprite *sprite) = 0;
    virtual void onScroll(int x, TFT_eSprite *sprite) = 0;
    virtual void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) = 0;
    virtual void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) = 0;
    ScreenTypes::ScreenType getType() { return type; };

protected:
    ScreenTypes::ScreenType type;
    int TOUCH_X_OFFSET = -50;
    int TOUCH_Y_OFFSET = -130;

    String SCROLL_THRESHOLD = "5";
};

#endif /* PAO_SCREEN_H_ */