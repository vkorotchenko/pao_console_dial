#ifndef CAROUSEL_H
#define CAROUSEL_H

#include "screen.h"
#include "Arduino_GFX_Library.h"
#include "TFT_eSPI.h"

// Template base class for carousel screens
// ITEM_COUNT: Number of items in the carousel (e.g., 13 for data, 4 for gears)
template<int ITEM_COUNT>
class Carousel : public screen {
protected:
    // Common carousel state
    int currentIndex = 0;
    int lastScrollValue = 0;
    int scrollAccumulator = 0;
    bool scrollLockout = false;  // Prevents double-triggering from single click
    bool isFirstScroll = true;   // Ignore first scroll after load to prevent unwanted animation

    // Animation state
    float animationProgress = 0.0f;      // 0.0 = start, 1.0 = complete
    int animationDirection = 0;          // -1 = left, 1 = right, 0 = at rest
    bool isAnimating = false;            // True during time-based animation
    unsigned long animationStartTime = 0;  // millis() when animation started
    int targetIndex = 0;                 // Index to transition to

    // Animation configuration
    unsigned long animationDuration = 250;  // Animation duration in milliseconds (configurable)

    // Carousel configuration
    // 24-position encoder: each click registers 12-18° due to mechanical variance
    static const int SCROLL_THRESHOLD = 15;  // Trigger threshold (average click)
    static const int SCROLL_MAX_ACCUMULATION = 22;  // Max single click accumulation
    static const int SCROLL_RESET_THRESHOLD = 8;  // Must drop below this to clear lockout

    // Layout constants (can be overridden in derived classes if needed)
    static const int LEFT_X = 100;
    static const int CENTER_X = 240;
    static const int RIGHT_X = 380;
    static const int PREVIEW_Y = 295;      // Moved down 80px from 215
    static const int CENTER_Y = 265;       // Moved down 80px from 185
    static const int LABEL_Y_OFFSET = -75;
    static const int UNIT_Y_OFFSET = 65;

    // Font sizes
    static const int PREVIEW_TEXT_SIZE = 10;
    static const int CENTER_TEXT_SIZE = 22;

    // Pure virtual interface - subclasses MUST implement these
    virtual const char* getItemLabel(int index) = 0;
    virtual String getItemValue(int index) = 0;

    // Optional virtual methods with defaults
    virtual const char* getItemUnit(int index) { return ""; }
    virtual uint16_t getValueColor(int index) { return TFT_WHITE; }
    virtual uint16_t getPreviewValueColor(int index) { return TFT_SILVER; }
    virtual void drawCenterExtra(TFT_eSprite* sprite, int index) {}
    virtual void onIndexChanged(int oldIndex, int newIndex) {}
    virtual const char* getTitle() = 0;

    // Helper methods
    int getPrevIndex() const { return (currentIndex - 1 + ITEM_COUNT) % ITEM_COUNT; }
    int getNextIndex() const { return (currentIndex + 1) % ITEM_COUNT; }

    // Panel rendering methods
    void drawPreviewPanel(TFT_eSprite* sprite, int index, int xPos, int yPos);
    void drawCenterPanel(TFT_eSprite* sprite, int index);

    // Animation rendering methods
    void renderAnimatedPanels(TFT_eSprite* sprite);
    void drawInterpolatedPanel(TFT_eSprite* sprite, int index, int xPos, int yPos,
                              int textSize, uint16_t valueColor);

public:
    // Implemented in base class (common behavior)
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) override;
    void onScroll(int x, TFT_eSprite *sprite) override;
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) override;
};

#endif // CAROUSEL_H
