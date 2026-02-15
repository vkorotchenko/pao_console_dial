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
    // Update animation progress based on elapsed time
    if (isAnimating) {
        unsigned long elapsed = millis() - animationStartTime;
        animationProgress = elapsed / (float)animationDuration;

        // Check if animation is complete
        if (animationProgress >= 1.0f) {
            // Animation complete - finalize transition
            animationProgress = 1.0f;
            int oldIndex = currentIndex;
            currentIndex = targetIndex;
            isAnimating = false;
            animationDirection = 0;
            scrollLockout = false;  // Re-enable scroll input
            onIndexChanged(oldIndex, currentIndex);
        }
    }

    // Clear entire sprite to prevent artifacts from previous renders
    sprite->fillSprite(TFT_BLACK);

    // Redraw static elements that were on onLoad
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString(getTitle(), 240, 40);

    if (!isAnimating) {
        // Static rendering: 3 panels at fixed positions
        int prevIndex = getPrevIndex();
        int nextIndex = getNextIndex();
        drawPreviewPanel(sprite, prevIndex, LEFT_X, PREVIEW_Y);
        drawCenterPanel(sprite, currentIndex);
        drawPreviewPanel(sprite, nextIndex, RIGHT_X, PREVIEW_Y);
    } else {
        // Animated rendering: panels with time-based interpolation
        renderAnimatedPanels(sprite);
    }
}

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::onScroll(int x, TFT_eSprite *sprite) {
    // First scroll after load: just update baseline without triggering animation
    if (isFirstScroll) {
        lastScrollValue = x;
        isFirstScroll = false;
        return;
    }

    // Block scroll input while animation is in progress (debounce)
    if (isAnimating) {
        return;
    }

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

    // Check if threshold reached to START animation
    // Lockout prevents same physical click from triggering twice
    if (scrollAccumulator >= SCROLL_THRESHOLD && !scrollLockout) {
        // Start animation to next item
        animationDirection = 1;  // Scrolling right
        targetIndex = getNextIndex();
        isAnimating = true;
        animationStartTime = millis();
        animationProgress = 0.0f;
        scrollLockout = true;
        scrollAccumulator = 0;
    }
    else if (scrollAccumulator <= -SCROLL_THRESHOLD && !scrollLockout) {
        // Start animation to previous item
        animationDirection = -1;  // Scrolling left
        targetIndex = getPrevIndex();
        isAnimating = true;
        animationStartTime = millis();
        animationProgress = 0.0f;
        scrollLockout = true;
        scrollAccumulator = 0;
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
    isFirstScroll = true;  // Ignore first scroll to prevent unwanted animation on load
    isAnimating = false;   // Ensure animation state is reset
}

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::renderAnimatedPanels(TFT_eSprite *sprite) {
    float progress = animationProgress;

    // Determine discrete animation step (0, 1, 2, 3, or 4)
    int step = 0;
    if (progress < 0.2f) {
        step = 0;
    } else if (progress < 0.4f) {
        step = 1;
    } else if (progress < 0.6f) {
        step = 2;
    } else if (progress < 0.8f) {
        step = 3;
    } else {
        step = 4;
    }

    // Calculate step-based interpolation values (divide into 5 equal steps)
    const int PANEL_DISTANCE = CENTER_X - LEFT_X;  // 140 pixels
    const int STEP_DISTANCE = PANEL_DISTANCE / 5;  // 28 pixels per step
    const int SIZE_DIFF = CENTER_TEXT_SIZE - PREVIEW_TEXT_SIZE;  // 12
    const int STEP_SIZE = SIZE_DIFF / 5;  // 2-3 per step
    const int Y_DIFF = PREVIEW_Y - CENTER_Y;  // 30 pixels
    const int STEP_Y = Y_DIFF / 5;  // 6 pixels per step

    int prevIndex = getPrevIndex();
    int nextIndex = getNextIndex();

    if (animationDirection > 0) {
        // Scrolling RIGHT: next item moving toward center

        // Left panel: only show on first step (step 0), then disappear
        if (step == 0) {
            drawPreviewPanel(sprite, prevIndex, LEFT_X, PREVIEW_Y);
        }

        // Center panel: shrinking and moving to left position (in steps)
        int centerX = CENTER_X - (STEP_DISTANCE * (step + 1));
        int centerSize = CENTER_TEXT_SIZE - (STEP_SIZE * (step + 1));
        int centerY = CENTER_Y + (STEP_Y * (step + 1));
        drawInterpolatedPanel(sprite, currentIndex, centerX, centerY,
                             centerSize, getValueColor(currentIndex));

        // Right panel: growing and moving to center position (in steps)
        int rightX = RIGHT_X - (STEP_DISTANCE * (step + 1));
        int rightSize = PREVIEW_TEXT_SIZE + (STEP_SIZE * (step + 1));
        int rightY = PREVIEW_Y - (STEP_Y * (step + 1));
        drawInterpolatedPanel(sprite, nextIndex, rightX, rightY,
                             rightSize, getValueColor(nextIndex));

    } else {
        // Scrolling LEFT: prev item moving toward center

        // Right panel: only show on first step (step 0), then disappear
        if (step == 0) {
            drawPreviewPanel(sprite, nextIndex, RIGHT_X, PREVIEW_Y);
        }

        // Center panel: shrinking and moving to right position (in steps)
        int centerX = CENTER_X + (STEP_DISTANCE * (step + 1));
        int centerSize = CENTER_TEXT_SIZE - (STEP_SIZE * (step + 1));
        int centerY = CENTER_Y + (STEP_Y * (step + 1));
        drawInterpolatedPanel(sprite, currentIndex, centerX, centerY,
                             centerSize, getValueColor(currentIndex));

        // Left panel: growing and moving to center position (in steps)
        int leftX = LEFT_X + (STEP_DISTANCE * (step + 1));
        int leftSize = PREVIEW_TEXT_SIZE + (STEP_SIZE * (step + 1));
        int leftY = PREVIEW_Y - (STEP_Y * (step + 1));
        drawInterpolatedPanel(sprite, prevIndex, leftX, leftY,
                             leftSize, getValueColor(prevIndex));
    }
}

template<int ITEM_COUNT>
void Carousel<ITEM_COUNT>::drawInterpolatedPanel(TFT_eSprite* sprite, int index,
                                                  int xPos, int yPos, int textSize,
                                                  uint16_t valueColor) {
    // Determine which rendering style to use based on size
    // Use center style when size is >= 16 (midpoint between 10 and 22)
    bool isCenterStyle = (textSize >= 16);

    // Draw label
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextSize(isCenterStyle ? 2 : 1);
    sprite->setTextColor(isCenterStyle ? TFT_LIGHTGREY : TFT_DARKGREY, TFT_BLACK);

    // Position label appropriately
    int labelY = isCenterStyle ? (CENTER_Y - 87) : (yPos + LABEL_Y_OFFSET + 40);
    sprite->drawString(getItemLabel(index), xPos, labelY);

    // Draw value with appropriate font and size
    String value = getItemValue(index);
    sprite->loadFont(isCenterStyle ? bigFont : midleFont);
    sprite->setTextSize(textSize);
    sprite->setTextColor(valueColor, TFT_BLACK);
    sprite->setTextDatum(MC_DATUM);
    sprite->drawString(value, xPos, yPos);

    // Draw unit if exists
    const char* unit = getItemUnit(index);
    if (unit && strlen(unit) > 0) {
        int valueWidth = estimateTextWidth(value, textSize);
        int unitX = xPos + (valueWidth / 2) + 10;
        sprite->unloadFont();
        sprite->setTextDatum(ML_DATUM);
        sprite->setTextSize(isCenterStyle ? 2 : 1);
        sprite->setTextColor(isCenterStyle ? TFT_LIGHTGREY : TFT_DARKGREY, TFT_BLACK);
        sprite->drawString(unit, unitX, yPos);
    } else {
        sprite->unloadFont();
    }

    // Draw center decorations only for center-styled items
    if (isCenterStyle) {
        drawCenterExtra(sprite, index);
    }
}

// Explicit template instantiations for the three carousels we use
template class Carousel<4>;   // GearScreen and SettingsScreen
template class Carousel<13>;  // DataScreen
