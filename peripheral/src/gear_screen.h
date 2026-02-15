#ifndef GEAR_SCREEN_H_
#define GEAR_SCREEN_H_

#include "screen.h"
#include "gear.h"

class GearScreen : public screen
{
public:
    GearScreen() {};
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::GEARS;

    // Carousel navigation state
    int currentIndex = 0;           // Currently focused gear (0-3: P, R, N, D)
    int lastScrollValue = 0;        // Last encoder angle for delta calculation
    int scrollAccumulator = 0;      // Accumulated scroll movement
    const int SCROLL_THRESHOLD = 36; // 36° = 2 encoder clicks

    // Selection state
    int selectedIndex = -1;         // Selected but not confirmed (-1 = none)
    int confirmedIndex = -1;        // Confirmed gear (-1 = none)

    // Touch debouncing
    unsigned long lastTouchTime = 0;
    const unsigned long TOUCH_DEBOUNCE = 300; // 300ms
};

#endif /* GEAR_SCREEN_H_ */