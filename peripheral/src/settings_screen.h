
#ifndef SETTING_SCREEN_H_
#define SETTING_SCREEN_H_

#include "carousel.h"

class SettingsScreen : public Carousel<5>
{
private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::SETTINGS;

    // Edit mode state (NEW for settings screen)
    bool isEditMode = false;        // Are we currently editing a value?
    int editValue = 0;              // Temporary value being edited

    // Touch debouncing
    unsigned long lastTouchTime = 0;       // Last touch timestamp in milliseconds
    const unsigned long TOUCH_DEBOUNCE = 300; // 300ms debounce delay

protected:
    // Implement required virtual methods
    const char* getItemLabel(int index) override;
    String getItemValue(int index) override;
    const char* getItemUnit(int index) override;
    uint16_t getValueColor(int index) override;
    const char* getTitle() override { return "SETTINGS"; }
    void drawCenterExtra(TFT_eSprite* sprite, int index) override;

public:
    SettingsScreen() {};
    // Override onScroll for edit mode logic
    void onScroll(int x, TFT_eSprite *sprite) override;
    void onTouch(int x, int y, TFT_eSprite *sprite) override;
    bool onClick(TFT_eSprite *sprite) override;
};

#endif /* SETTING_SCREEN_H_ */