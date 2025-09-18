#include "global_state.h"

screen * gears = new GearScreen;
screen * loading = new LoadingScreen;


void GlobalState::setup() {
    // gear = Gears::Gear::PARK;
    gears->setup(ScreenTypes::ScreenType::GEARS);
    loading->setup(ScreenTypes::ScreenType::PRELOAD);
    currentScreen = loading;
}

void GlobalState::getNextScreen()
{

    ScreenTypes::ScreenType currentType = currentScreen->getType();

    switch(currentType) {
        case ScreenTypes::ScreenType::PRELOAD:
            currentScreen = gears;
            break;
        case ScreenTypes::ScreenType::GEARS:
            currentScreen = loading;
            break;
        // case Screen::ScreenType::CAN_DATA:
        //     currentScreen = &charge;
        //     break;
        // case Screen::ScreenType::CHARGE:
        //     currentScreen = &settings;
        //     break;
        // case Screen::ScreenType::SETTINGS:
        //     currentScreen = &gears;
        //     break;
        default:
            // this should never happen
            currentScreen = loading;
    }
}