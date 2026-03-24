#include "gear_screen.h"
#include "global_state.h"
#include "bigFont.h"
#include "midleFont.h"

// Gear data for carousel
const char* GEAR_LABELS[4] = {"PARK", "REVERSE", "NEUTRAL", "DRIVE"};
const char* GEAR_LETTERS[4] = {"P", "R", "N", "D"};
const Gears::Gear GEAR_VALUES[4] = {
    Gears::Gear::PARK,
    Gears::Gear::REVERSE,
    Gears::Gear::NEUTRAL,
    Gears::Gear::DRIVE
};

bool GearScreen::onClick(TFT_eSprite *sprite)
{
    return false;  // Allow button to switch screens
}

void GearScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
    // Only process valid touch (not release)
    if (x < 0 || y < 0) {
        return;
    }

    // Debounce touches
    unsigned long currentTime = millis();
    if (currentTime - lastTouchTime < TOUCH_DEBOUNCE) {
        return;
    }
    lastTouchTime = currentTime;

    // Touch interaction logic:
    // If nothing selected: SELECT current gear
    // If current gear already selected: CONFIRM it
    // If different gear selected: SELECT current gear instead

    if (selectedIndex == -1) {
        // Nothing selected, select current gear (no CAN yet)
        selectedIndex = currentIndex;
    }
    else if (selectedIndex == currentIndex) {
        // Current gear already selected — CONFIRM and send to CAN
        confirmedIndex = currentIndex;
        selectedIndex = -1;  // Clear selection (confirmed takes over)
        GlobalState::getInstance().setGear(GEAR_VALUES[currentIndex]);
    }
    else {
        // Different gear was selected, switch selection (no CAN yet)
        selectedIndex = currentIndex;
        confirmedIndex = -1;  // Clear previous confirmation
    }
}

// Implement virtual methods from Carousel base class
const char* GearScreen::getItemLabel(int index) {
    return GEAR_LABELS[index];
}

String GearScreen::getItemValue(int index) {
    return String(GEAR_LETTERS[index]);  // "P", "R", "N", "D"
}

uint16_t GearScreen::getValueColor(int index) {
    // Confirmed gear: light blue, Selected gear: orange
    if (confirmedIndex == index) return TFT_SKYBLUE;
    if (selectedIndex == index) return TFT_ORANGE;
    return TFT_WHITE;
}

uint16_t GearScreen::getPreviewValueColor(int index) {
    // Confirmed gear: light blue, Selected gear: orange (in preview panels)
    if (confirmedIndex == index) return TFT_SKYBLUE;
    if (selectedIndex == index) return TFT_ORANGE;
    return TFT_SILVER;
}

void GearScreen::drawCenterExtra(TFT_eSprite* sprite, int index) {
    // No circle - selection is shown by orange text color
}

void GearScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    // Call base class onLoad first
    Carousel<4>::onLoad(sprite, gfx);

    // Initialize gear selection state
    selectedIndex = -1;
    confirmedIndex = -1;

    // Set initial gear based on global state
    GlobalState &state = GlobalState::getInstance();
    Gears::Gear currentGear = state.getGear();
    for (int i = 0; i < 4; i++) {
        if (GEAR_VALUES[i] == currentGear) {
            currentIndex = i;
            confirmedIndex = i;  // Start with current gear confirmed
            break;
        }
    }
}
