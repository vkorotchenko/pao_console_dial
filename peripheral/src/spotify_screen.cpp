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

BleKeyboard bleKeyboard;

void SpotifyScreen::setup(ScreenTypes::ScreenType type)
{
    this->type = type;

    bleKeyboard.setName("PAO input");
    bleKeyboard.begin();
};

bool SpotifyScreen::onClick(TFT_eSprite *sprite)
{
    return false;
}

void SpotifyScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
    if (!bleKeyboard.isConnected()) return;

    int lastX = x + TOUCH_X_OFFSET;
    int lastY = y + TOUCH_Y_OFFSET;

    if (lastX > NEXT_SONG_BUTTON_X - SPOTIFY_BUTTON_RADIUS &&
        lastX < NEXT_SONG_BUTTON_X + SPOTIFY_BUTTON_RADIUS &&
        lastY > NEXT_SONG_BUTTON_Y - SPOTIFY_BUTTON_RADIUS &&
        lastY < NEXT_SONG_BUTTON_Y + SPOTIFY_BUTTON_RADIUS)
    {
        bleKeyboard.write(KEY_MEDIA_NEXT_TRACK);
    }
    else if (lastX > PREV_SONG_BUTTON_X - SPOTIFY_BUTTON_RADIUS &&
        lastX < PREV_SONG_BUTTON_X + SPOTIFY_BUTTON_RADIUS &&
        lastY > PREV_SONG_BUTTON_Y - SPOTIFY_BUTTON_RADIUS &&
        lastY < PREV_SONG_BUTTON_Y + SPOTIFY_BUTTON_RADIUS)
    {
        bleKeyboard.write(KEY_MEDIA_PREVIOUS_TRACK);
    }
    else if (lastX > PLAY_PAUSE_BUTTON_X - SPOTIFY_BUTTON_RADIUS &&
        lastX < PLAY_PAUSE_BUTTON_X + SPOTIFY_BUTTON_RADIUS &&
        lastY > PLAY_PAUSE_BUTTON_Y - SPOTIFY_BUTTON_RADIUS &&
        lastY < PLAY_PAUSE_BUTTON_Y + SPOTIFY_BUTTON_RADIUS)
    {
        bleKeyboard.write(KEY_MEDIA_PLAY_PAUSE);
    }
    else if (lastX > MUTE_BUTTON_X - SPOTIFY_BUTTON_RADIUS &&
        lastX < MUTE_BUTTON_X + SPOTIFY_BUTTON_RADIUS &&
        lastY > MUTE_BUTTON_Y - SPOTIFY_BUTTON_RADIUS &&
        lastY < MUTE_BUTTON_Y + SPOTIFY_BUTTON_RADIUS)
    {
        bleKeyboard.write(KEY_MEDIA_MUTE);
    }
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
    if (!bleKeyboard.isConnected()) return;

    int delta = x - lastScrollX;
    lastScrollX = x;

    // Handle encoder wraparound (359->0 or 0->359)
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (delta == 0) return;

    // Rate-limit volume keys to avoid flooding the BLE notification queue
    unsigned long now = millis();
    if (now - lastVolumeKeyTime < VOLUME_RATE_LIMIT_MS) return;
    lastVolumeKeyTime = now;

    if (delta > 0)
    {
        bleKeyboard.write(KEY_MEDIA_VOLUME_UP);
    }
    else
    {
        bleKeyboard.write(KEY_MEDIA_VOLUME_DOWN);
    }
};