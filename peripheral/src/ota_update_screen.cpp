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

void drawOtaUpdateScreen(TFT_eSprite *sprite, Arduino_RGB_Display *gfx)
{
    // ── Background ────────────────────────────────────────────────────────────
    // Black fill matches loading_screen and the rest of the dial's dark theme.
    sprite->fillSprite(TFT_BLACK);

    // ── Title: "Updating" ─────────────────────────────────────────────────────
    // Uses the built-in GFX font at size 5 (~40×50 px glyphs) to avoid pulling
    // in an additional PROGMEM font array. The PROGMEM font headers have no
    // include guards — including bigFont.h here would emit a second copy of the
    // 518 KB font array alongside the one already in carousel.cpp, wasting flash.
    // The built-in font renders cleanly for this single-purpose static screen.
    sprite->unloadFont();   // ensure no VLW font is loaded (sprite retains last loaded font)
    sprite->setTextDatum(TC_DATUM);
    sprite->setTextColor(TFT_WHITE, TFT_BLACK);
    sprite->setTextSize(5);
    sprite->drawString("Updating", CENTER_X, 185);

    // ── Subtitle: "Do not power off" ─────────────────────────────────────────
    // Size 2 (~16×20 px) for the secondary line — readable but clearly smaller
    // than the title to establish visual hierarchy.
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString("Do not power off", CENTER_X, 260);

    // ── Static progress dots ──────────────────────────────────────────────────
    // Three filled circles: first two lit in sky-blue (stages done / current),
    // third dimmed in dark-grey (stage pending). Gives a "1 of 3" feel without
    // requiring animation or state tracking.
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
