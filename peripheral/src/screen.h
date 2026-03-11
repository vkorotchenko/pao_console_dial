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

    // Helper method to draw title in standard format
    void drawTitle(TFT_eSprite* sprite, const char* title) {
        sprite->setTextDatum(TC_DATUM);
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->setTextSize(2);
        sprite->drawString(title, 240, 40);
    }
};

#endif /* PAO_SCREEN_H_ */