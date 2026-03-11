
#ifndef SPEEDO_SCREEN_H_
#define SPEEDO_SCREEN_H_

#include "screen.h"

class SpeedometerScreen : public screen
{
public:
    SpeedometerScreen() {};
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::SPEEDOMETER;

    uint16_t getDialColor(int value, int maxValue);
    void drawConcentricDial(TFT_eSprite* sprite, int radius, int value, int maxValue, uint16_t fgColor);
    void drawTorqueDial(TFT_eSprite* sprite, int torque);
    void drawBatteryDial(TFT_eSprite* sprite, int battery);
    void drawLegend(TFT_eSprite* sprite, int torque, int battery, bool isStale);
    void drawValueBar(TFT_eSprite* sprite, int speed, const char* speedUnit, int battery, int rpm, bool isStale);
};

#endif /* SPEEDO_SCREEN_H_ */
