
#ifndef DATA_SCREEN_H_
#define DATA_SCREEN_H_

#include "carousel.h"

class DataScreen : public Carousel<14>
{
private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::CAN_DATA;

protected:
    // Implement required virtual methods
    const char* getItemLabel(int index) override;
    String getItemValue(int index) override;
    const char* getItemUnit(int index) override;
    uint16_t getValueColor(int index) override;
    const char* getTitle() override { return "DATA CAROUSEL"; }

public:
    DataScreen() {};
    // Only need to override if special behavior needed
    bool onClick(TFT_eSprite *sprite) override;
    void onTouch(int x, int y, TFT_eSprite *sprite) override;
};

#endif /* DATA_SCREEN_H_ */