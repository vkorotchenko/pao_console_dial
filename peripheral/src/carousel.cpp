#include "carousel.h"
#include "bigFont.h"
#include "midleFont.h"
#include "text_utils.h"

// Maximum text widths for overflow prevention
// Increased to allow 3-4 characters in preview, 8-10 in center
const int PREVIEW_VALUE_MAX_WIDTH = 140;  // Preview panels (allows 3-4 chars)
const int CENTER_VALUE_MAX_WIDTH = 350;   // Center panel (allows 3-4 chars at larger font)

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::drawPreviewPanel(TFT_eSprite* sprite, int index, int xPos, int yPos) {
    // Draw label (center-aligned, moved down 40px total)
    sprite->setTextDatum(TC_DATUM);  // Top Center alignment
    sprite->setTextSize(1);
    sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
    sprite->drawString(getItemLabel(index), xPos, yPos + LABEL_Y_OFFSET + 40);

    // Draw value with truncation (center-aligned)
    String value = truncateToWidth(getItemValue(index), PREVIEW_TEXT_SIZE, PREVIEW_VALUE_MAX_WIDTH);
    sprite->loadFont(midleFont);
    sprite->setTextSize(PREVIEW_TEXT_SIZE);
    sprite->setTextColor(getPreviewValueColor(index), TFT_BLACK);
    sprite->setTextDatum(MC_DATUM);  // Middle Center alignment for custom fonts
    sprite->drawString(value, xPos, yPos);

    // Draw unit 10px after the value (if it exists)
    const char* unit = getItemUnit(index);
    if (unit && strlen(unit) > 0) {
        // Calculate unit position: right edge of value + 10px gap
        int valueWidth = estimateTextWidth(value, PREVIEW_TEXT_SIZE);
        int unitX = xPos + (valueWidth / 2) + 10;  // 10px after value

        sprite->unloadFont();
        sprite->setTextDatum(ML_DATUM);  // Middle Left alignment
        sprite->setTextSize(1);
        sprite->setTextColor(TFT_DARKGREY, TFT_BLACK);
        sprite->drawString(unit, unitX, yPos);
    } else {
        sprite->unloadFont();
    }
}

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::drawCenterPanel(TFT_eSprite* sprite, int index) {
    // Draw label (center-aligned, moved up 10px more)
    sprite->setTextDatum(TC_DATUM);  // Top Center alignment
    sprite->setTextSize(2);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->drawString(getItemLabel(index), CENTER_X, CENTER_Y - 87);

    // Draw value with truncation (center-aligned)
    String value = truncateToWidth(getItemValue(index), CENTER_TEXT_SIZE, CENTER_VALUE_MAX_WIDTH);
    sprite->loadFont(bigFont);
    sprite->setTextSize(CENTER_TEXT_SIZE);
    sprite->setTextColor(getValueColor(index), TFT_BLACK);
    sprite->setTextDatum(MC_DATUM);  // Middle Center alignment for custom fonts
    sprite->drawString(value, CENTER_X, CENTER_Y);

    // Draw unit 10px after the value (if it exists)
    const char* unit = getItemUnit(index);
    if (unit && strlen(unit) > 0) {
        // Calculate unit position: right edge of value + 10px gap
        int valueWidth = estimateTextWidth(value, CENTER_TEXT_SIZE);
        int unitX = CENTER_X + (valueWidth / 2) + 10;  // 10px after value

        sprite->unloadFont();
        sprite->setTextDatum(ML_DATUM);  // Middle Left alignment
        sprite->setTextSize(2);
        sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        sprite->drawString(unit, unitX, CENTER_Y);
    } else {
        sprite->unloadFont();
    }

    // Allow subclass to draw extra decorations (selection circles, edit indicators, etc.)
    drawCenterExtra(sprite, index);
}

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    // Clear entire sprite to prevent artifacts from previous renders
    sprite->fillSprite(TFT_BLACK);

    // Redraw static elements that were on onLoad
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString(getTitle(), 240, 40);

    // Calculate indices with wrapping
    int prevIndex = getPrevIndex();
    int nextIndex = getNextIndex();

    // Draw three panels
    drawPreviewPanel(sprite, prevIndex, LEFT_X, PREVIEW_Y);
    drawCenterPanel(sprite, currentIndex);
    drawPreviewPanel(sprite, nextIndex, RIGHT_X, PREVIEW_Y);
}

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::onScroll(int x, TFT_eSprite *sprite) {
    // Calculate delta from last position
    int delta = x - lastScrollValue;
    lastScrollValue = x;

    // Handle encoder wraparound (359->0 or 0->359)
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    // Accumulate scroll movement
    scrollAccumulator += delta;

    // Clamp accumulator to single click range
    if (scrollAccumulator > SCROLL_MAX_ACCUMULATION) {
        scrollAccumulator = SCROLL_MAX_ACCUMULATION;
    }
    if (scrollAccumulator < -SCROLL_MAX_ACCUMULATION) {
        scrollAccumulator = -SCROLL_MAX_ACCUMULATION;
    }

    // Clear lockout when accumulator drops below reset threshold
    // This ensures we're ready for the next distinct physical click
    if (abs(scrollAccumulator) < SCROLL_RESET_THRESHOLD) {
        scrollLockout = false;
    }

    // Check if threshold reached for item change
    // Lockout prevents same physical click from triggering twice
    if (scrollAccumulator >= SCROLL_THRESHOLD && !scrollLockout) {
        int oldIndex = currentIndex;
        currentIndex = getNextIndex();
        scrollAccumulator = 0;
        scrollLockout = true;  // Lock out until accumulator drops below reset threshold
        onIndexChanged(oldIndex, currentIndex);
    }
    else if (scrollAccumulator <= -SCROLL_THRESHOLD && !scrollLockout) {
        int oldIndex = currentIndex;
        currentIndex = getPrevIndex();
        scrollAccumulator = 0;
        scrollLockout = true;  // Lock out until accumulator drops below reset threshold
        onIndexChanged(oldIndex, currentIndex);
    }
}

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    // Draw title (center-aligned)
    sprite->setTextDatum(TC_DATUM);  // Top Center alignment
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString(getTitle(), 240, 40);  // Centered at x=240

    // Initialize state
    lastScrollValue = 0;
    scrollAccumulator = 0;
    currentIndex = 0;
    scrollLockout = false;
}

// Explicit template instantiations for the three carousels we use
template class Carousel<4>;   // GearScreen and SettingsScreen
template class Carousel<13>;  // DataScreen
