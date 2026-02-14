
#ifndef DATA_SCREEN_H_
#define DATA_SCREEN_H_

#include "screen.h"

class DataScreen : public screen
{
public:
    DataScreen() {};
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::CAN_DATA;

    // Carousel navigation state
    int currentIndex = 0;           // Currently focused item (0-8)
    int lastScrollValue = 0;        // Last encoder angle for delta calculation
    int scrollAccumulator = 0;      // Accumulated scroll movement
    const int SCROLL_THRESHOLD = 18; // 18° = ~5 encoder clicks (faster response)
};

#endif /* DATA_SCREEN_H_ */