#ifndef GEAR_SCREEN_H_
#define GEAR_SCREEN_H_

#include "carousel.h"
#include "gear.h"

class GearScreen : public Carousel<4>
{
private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::GEARS;

    // Selection state
    int selectedIndex = -1;         // Selected but not confirmed (-1 = none)
    int confirmedIndex = -1;        // Confirmed gear (-1 = none)

    // Touch debouncing
    unsigned long lastTouchTime = 0;
    const unsigned long TOUCH_DEBOUNCE = 300; // 300ms

protected:
    // Implement required virtual methods
    const char* getItemLabel(int index) override;
    String getItemValue(int index) override;
    uint16_t getValueColor(int index) override;
    uint16_t getPreviewValueColor(int index) override;
    const char* getTitle() override { return "GEAR SELECT"; }
    void drawCenterExtra(TFT_eSprite* sprite, int index) override;

public:
    GearScreen() {};
    void onTouch(int x, int y, TFT_eSprite *sprite) override;
    bool onClick(TFT_eSprite *sprite) override;
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) override;
};

#endif /* GEAR_SCREEN_H_ */