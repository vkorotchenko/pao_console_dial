#include "spotify_screen.h"
#include "global_state.h"
#include "banner_utils.h"

// Button positions — prev/play/next inline, mute centred below
// Visual centre of this display is x=240 (consistent with carousel CENTER_X)
int PLAY_PAUSE_BUTTON_X = 240;
int PLAY_PAUSE_BUTTON_Y = 245;   // lowered 15px
int PREV_SONG_BUTTON_X = 95;     // spread wider (was 120)
int PREV_SONG_BUTTON_Y = 245;    // lowered 15px
int NEXT_SONG_BUTTON_X = 385;    // spread wider (was 360)
int NEXT_SONG_BUTTON_Y = 245;    // lowered 15px
int MUTE_BUTTON_X = 240;
int MUTE_BUTTON_Y = 405;         // lowered 15px

int SPOTIFY_BUTTON_RADIUS = 64;

int lastScrollX = 0;

void SpotifyScreen::setup(ScreenTypes::ScreenType type)
{
    this->type = type;
};

bool SpotifyScreen::onClick(TFT_eSprite *sprite)
{
    return false;
}

void SpotifyScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
    if (x < 0 || y < 0) {
        _touchActive = false;
        return;
    }
    if (_touchActive) return;   // already handled this press
    _touchActive = true;

    auto inRange = [](int tx, int ty, int cx, int cy) {
        int dx = tx - cx, dy = ty - cy;
        return (dx*dx + dy*dy) <= (64*64);
    };

    uint8_t cmd = 0;
    if      (inRange(x, y, 240, 245)) cmd = 0x01; // play/pause
    else if (inRange(x, y,  95, 245)) cmd = 0x03; // prev
    else if (inRange(x, y, 385, 245)) cmd = 0x02; // next
    else if (inRange(x, y, 240, 405)) cmd = 0x06; // mute

    if (cmd != 0) paoBle().notifyMediaCommand(cmd);
};

void SpotifyScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
    // Spotify screen is static - just need to ensure sprite is displayed
    // Content is drawn once in onLoad() and doesn't need per-frame updates
    // The main loop handles pushing the sprite to the display
};
void SpotifyScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    // Clear screen with black background
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    // Draw banner
    GlobalState &state = GlobalState::getInstance();
    drawBanner(sprite, state);

    // Draw bitmap icons (128x128 each, centered on button positions)
    // Sky blue icons on black background

    // Play/Pause icon (top center)
    sprite->drawBitmap(PLAY_PAUSE_BUTTON_X - 64, PLAY_PAUSE_BUTTON_Y - 64,
                       play_pause_icon, 128, 128,
                       TFT_SKYBLUE, TFT_BLACK);

    // Previous Song icon (left)
    sprite->drawBitmap(PREV_SONG_BUTTON_X - 64, PREV_SONG_BUTTON_Y - 64,
                       prev_icon, 128, 128,
                       TFT_SKYBLUE, TFT_BLACK);

    // Next Song icon (right)
    sprite->drawBitmap(NEXT_SONG_BUTTON_X - 64, NEXT_SONG_BUTTON_Y - 64,
                       next_icon, 128, 128,
                       TFT_SKYBLUE, TFT_BLACK);

    // Mute icon (bottom)
    sprite->drawBitmap(MUTE_BUTTON_X - 64, MUTE_BUTTON_Y - 64,
                       mute_icon, 128, 128,
                       TFT_SKYBLUE, TFT_BLACK);

};

void SpotifyScreen::onScroll(int x, TFT_eSprite *sprite)
{
    unsigned long now = millis();
    if (now - lastVolumeKeyTime < VOLUME_RATE_LIMIT_MS) return;

    int delta = x - lastScrollX;
    lastScrollX = x;
    if (delta == 0) return;

    lastVolumeKeyTime = now;
    uint8_t cmd = (delta > 0) ? 0x04 : 0x05;  // 0x04=vol_up, 0x05=vol_down
    paoBle().notifyMediaCommand(cmd);
};