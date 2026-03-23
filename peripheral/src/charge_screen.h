
#ifndef CHARGE_SCREEN_H_
#define CHARGE_SCREEN_H_

#include "carousel.h"

class ChargeScreen : public Carousel<5>
{
private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::CHARGE;

    // Edit mode state
    bool isEditMode = false;
    int editValue = 0;

    // Touch debouncing
    unsigned long lastTouchTime = 0;
    static const unsigned long TOUCH_DEBOUNCE = 300;

    // Tracks which carousel index has a pending (unconfirmed) command sent to charger
    int pendingConfirmIndex = -1;

    void drawProgressBar(TFT_eSprite* sprite);

protected:
    const char* getItemLabel(int index) override;
    String getItemValue(int index) override;
    const char* getItemUnit(int index) override;
    uint16_t getValueColor(int index) override;
    const char* getTitle() override { return "CHARGING"; }
    void drawCenterExtra(TFT_eSprite* sprite, int index) override;

public:
    ChargeScreen() {};
    void display(TFT_eSprite* sprite, Arduino_ST7701_RGBPanel* gfx) override;
    void onScroll(int x, TFT_eSprite* sprite) override;
    void onTouch(int x, int y, TFT_eSprite* sprite) override;
    bool onClick(TFT_eSprite* sprite) override;
};

#endif /* CHARGE_SCREEN_H_ */
