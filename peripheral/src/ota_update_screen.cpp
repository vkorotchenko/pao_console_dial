#include "ota_update_screen.h"

// 540×540 round panel — horizontal centre
static const int CENTER_X = 270;

// ── Progress indicator geometry ───────────────────────────────────────────────
// Three static dots below the subtitle to suggest staged progress (READY /
// RECEIVING / COMMITTING). They cannot animate because the main loop is paused,
// but visually they communicate "multi-step process in progress."
static const int DOT_Y     = 340;
static const int DOT_R     = 10;
static const int DOT_GAP   = 36;   // centre-to-centre spacing
static const int DOT_COUNT = 3;

void drawOtaUpdateScreen(TFT_eSprite *sprite, Arduino_RGB_Display *gfx,
                         const uint8_t *bigFontData, const uint8_t *midleFontData)
{
    // ── Background ────────────────────────────────────────────────────────────
    // Black fill matches loading_screen and the rest of the dial's dark theme.
    sprite->fillSprite(TFT_BLACK);

    // ── Title: "Updating" ─────────────────────────────────────────────────────
    // bigFont — the largest of the three dial fonts, used for prominent labels.
    // setTextSize(1) with a loaded font gives the native glyph size.
    // TC_DATUM centres the string horizontally on CENTER_X.
    sprite->loadFont(bigFontData);
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextColor(TFT_WHITE, TFT_BLACK);
    sprite->setTextSize(1);
    sprite->drawString("Updating", CENTER_X, 195);

    // ── Subtitle: "Do not power off" ─────────────────────────────────────────
    // midleFont is the mid-scale font used for secondary labels across screens.
    // Placed ~55 px below the title baseline for clear visual hierarchy.
    sprite->loadFont(midleFontData);
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(1);
    sprite->drawString("Do not power off", CENTER_X, 265);

    // ── Static progress dots ──────────────────────────────────────────────────
    // Three filled circles: first two lit in sky-blue (stages done / current),
    // third dimmed in dark-grey (stage pending). Gives a "1 of 3" feel without
    // requiring animation or state tracking.
    sprite->unloadFont();   // release font memory before drawing shapes

    int totalWidth = (DOT_COUNT - 1) * DOT_GAP;
    int startX = CENTER_X - totalWidth / 2;

    for (int i = 0; i < DOT_COUNT; i++) {
        int dotX = startX + i * DOT_GAP;
        uint16_t color = (i < 2) ? TFT_SKYBLUE : TFT_DARKGREY;
        sprite->fillCircle(dotX, DOT_Y, DOT_R, color);
    }

    // ── Push to panel ─────────────────────────────────────────────────────────
    // Normal loop end calls gfx->draw16bitBeRGBBitmap() after display(), but
    // the OTA gate returns early — so we push the frame here ourselves.
    // The display will hold this static image for the entire OTA duration
    // (~30–60 s) until the device reboots into the new firmware.
    gfx->draw16bitBeRGBBitmap(0, 0, (uint16_t *)sprite->getPointer(), 540, 540);
}
