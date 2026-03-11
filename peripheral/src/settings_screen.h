
#ifndef SETTING_SCREEN_H_
#define SETTING_SCREEN_H_

#include "carousel.h"

enum CalibMode {
    CALIB_NONE,
    CALIB_TOUCH_AWAIT,
    CALIB_TOUCH_RESULT,
    CALIB_DIAL_AWAIT,
    CALIB_DIAL_RESULT
};

class SettingsScreen : public Carousel<7>
{
private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::SETTINGS;

    // Edit mode state
    bool isEditMode = false;
    int editValue = 0;

    // Touch debouncing
    unsigned long lastTouchTime = 0;
    const unsigned long TOUCH_DEBOUNCE = 300;

    // Calibration state
    CalibMode calibMode = CALIB_NONE;
    static const int CALIB_TARGET_X = 240;
    static const int CALIB_TARGET_Y = 270;
    int calibRawX = 0;
    int calibRawY = 0;
    int calibDialPeak = 0;

    void drawCalibScreen(TFT_eSprite* sprite);

protected:
    const char* getItemLabel(int index) override;
    String getItemValue(int index) override;
    const char* getItemUnit(int index) override;
    uint16_t getValueColor(int index) override;
    const char* getTitle() override { return "SETTINGS"; }
    void drawCenterExtra(TFT_eSprite* sprite, int index) override;

public:
    SettingsScreen() {};
    void display(TFT_eSprite* sprite, Arduino_ST7701_RGBPanel* gfx) override;
    void onScroll(int x, TFT_eSprite *sprite) override;
    void onTouch(int x, int y, TFT_eSprite *sprite) override;
    bool onClick(TFT_eSprite *sprite) override;
};

#endif /* SETTING_SCREEN_H_ */