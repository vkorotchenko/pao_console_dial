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

void GearScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    // Clear dynamic content areas to prevent ghosting (moved down 50px)
    sprite->fillRect(40, 150, 120, 250, TFT_BLACK);   // Left preview
    sprite->fillRect(180, 130, 200, 300, TFT_BLACK);  // Center area
    sprite->fillRect(390, 150, 120, 250, TFT_BLACK);  // Right preview

    // Calculate indices with wrapping (4 gears)
    int prevIndex = (currentIndex - 1 + 4) % 4;
    int nextIndex = (currentIndex + 1) % 4;

    // Draw LEFT preview (smaller, gray) - moved down 50px, centered
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->setTextSize(1);
    sprite->drawString(GEAR_LABELS[prevIndex], 60, 190);

    sprite->loadFont(midleFont);
    sprite->setTextSize(14);
    sprite->setTextColor(TFT_SILVER, TFT_BLACK);
    sprite->setCursor(85, 250);
    sprite->print(GEAR_LETTERS[prevIndex]);
    sprite->unloadFont();

    // Draw CENTER gear (large, with state-based styling) - moved down 50px, better centered
    sprite->setTextSize(2);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->drawString(GEAR_LABELS[currentIndex], 230, 170);

    // Determine center gear color based on state
    uint16_t centerColor = TFT_WHITE;  // Default: not selected
    if (confirmedIndex == currentIndex) {
        centerColor = TFT_SKYBLUE;  // Confirmed: sky blue font
    }
    else if (selectedIndex == currentIndex) {
        centerColor = TFT_WHITE;  // Selected: white font with circle below
    }

    // Draw center gear letter - moved down 50px, better centered
    sprite->loadFont(bigFont);
    sprite->setTextSize(28);
    sprite->setTextColor(centerColor, TFT_BLACK);
    sprite->setCursor(255, 250);
    sprite->print(GEAR_LETTERS[currentIndex]);
    sprite->unloadFont();

    // Draw sky blue circle if selected but not confirmed - moved down 50px
    if (selectedIndex == currentIndex && confirmedIndex != currentIndex) {
        sprite->drawCircle(280, 290, 70, TFT_SKYBLUE);
        sprite->drawCircle(280, 290, 71, TFT_SKYBLUE);
        sprite->drawCircle(280, 290, 72, TFT_SKYBLUE);
    }

    // Draw RIGHT preview (smaller, gray) - moved down 50px, centered
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(GEAR_LABELS[nextIndex], 400, 190);

    sprite->loadFont(midleFont);
    sprite->setTextSize(14);
    sprite->setTextColor(TFT_SILVER, TFT_BLACK);
    sprite->setCursor(425, 250);
    sprite->print(GEAR_LETTERS[nextIndex]);
    sprite->unloadFont();
}

void GearScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    // Standard title format
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString("GEAR SELECT", 200, 40);

    // Draw arrows to indicate scroll (moved down slightly)
    sprite->drawString("<<<", 200, 420);
    sprite->drawString(">>>", 280, 420);

    // Initialize state
    lastScrollValue = 0;
    scrollAccumulator = 0;
    currentIndex = 0;
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

void GearScreen::onScroll(int x, TFT_eSprite *sprite)
{
    // Calculate delta from last position
    int delta = x - lastScrollValue;
    lastScrollValue = x;

    // Handle encoder wraparound (359->0 or 0->359)
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    // Accumulate scroll movement
    scrollAccumulator += delta;

    // Check if threshold reached
    if (scrollAccumulator >= SCROLL_THRESHOLD) {
        currentIndex = (currentIndex + 1) % 4;  // Next gear
        scrollAccumulator = 0;
    }
    else if (scrollAccumulator <= -SCROLL_THRESHOLD) {
        currentIndex = (currentIndex - 1 + 4) % 4;  // Previous gear
        scrollAccumulator = 0;
    }
}
