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
        // Nothing selected, select current gear
        selectedIndex = currentIndex;
        GlobalState::getInstance().setGear(GEAR_VALUES[currentIndex]);
    }
    else if (selectedIndex == currentIndex) {
        // Current gear already selected, CONFIRM it
        confirmedIndex = currentIndex;
        selectedIndex = -1;  // Clear selection (confirmed takes over)
    }
    else {
        // Different gear was selected, switch selection to current
        selectedIndex = currentIndex;
        confirmedIndex = -1;  // Clear previous confirmation
        GlobalState::getInstance().setGear(GEAR_VALUES[currentIndex]);
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
    // Highlight both selected and confirmed gears in sky blue
    if (confirmedIndex == index || selectedIndex == index) return TFT_SKYBLUE;
    return TFT_WHITE;
}

uint16_t GearScreen::getPreviewValueColor(int index) {
    // Highlight selected/confirmed gears in sky blue even in preview panels
    if (confirmedIndex == index || selectedIndex == index) return TFT_SKYBLUE;
    return TFT_SILVER;
}

void GearScreen::drawCenterExtra(TFT_eSprite* sprite, int index) {
    // Calculate circle center (centered on the gear letter at CENTER_Y = 265)
    int circleX = 240;  // CENTER_X from carousel.h
    int circleY = 265;  // CENTER_Y - properly centered on text
    int radius = 70;

    // Draw sky blue circle ONLY for selected (not confirmed)
    if (selectedIndex == index && confirmedIndex != index) {
        // Draw 6 concentric circles for thick sky blue outline
        for (int i = 0; i < 6; i++) {
            sprite->drawCircle(circleX, circleY, radius + i, TFT_SKYBLUE);
        }
    }
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
