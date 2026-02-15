
#ifndef SETTING_SCREEN_H_
#define SETTING_SCREEN_H_

#include "screen.h"

class SettingsScreen : public screen
{
public:
    SettingsScreen() {};
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::SETTINGS;

    // Carousel navigation state (same as data_screen)
    int currentIndex = 0;           // Currently focused setting (0-3)
    int lastScrollValue = 0;        // Last encoder angle for delta calculation
    int scrollAccumulator = 0;      // Accumulated scroll movement
    const int SCROLL_THRESHOLD = 36; // 36° = 2 encoder clicks (reduced sensitivity)

    // Edit mode state (NEW for settings screen)
    bool isEditMode = false;        // Are we currently editing a value?
    int editValue = 0;              // Temporary value being edited

    // Touch debouncing
    unsigned long lastTouchTime = 0;       // Last touch timestamp in milliseconds
    const unsigned long TOUCH_DEBOUNCE = 300; // 300ms debounce delay
};

#endif /* SETTING_SCREEN_H_ */