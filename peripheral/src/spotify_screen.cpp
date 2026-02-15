#include "spotify_screen.h"

// Button positions - diamond pattern (540x540 screen)
// Center point: (240, 270), spacing: 120px from center
int PLAY_PAUSE_BUTTON_X = 240;
int PLAY_PAUSE_BUTTON_Y = 150;   // 120px above center
int PREV_SONG_BUTTON_X = 120;    // 120px left of center
int PREV_SONG_BUTTON_Y = 270;
int NEXT_SONG_BUTTON_X = 360;    // 120px right of center
int NEXT_SONG_BUTTON_Y = 270;
int MUTE_BUTTON_X = 240;
int MUTE_BUTTON_Y = 390;         // 120px below center

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
    // Clear screen
    sprite->fillSprite(TFT_GREENYELLOW);
    gfx->fillScreen(TFT_GREENYELLOW);

    sprite->drawBitmap(30, 30, spotify_logo, 480, 480, TFT_GREENYELLOW, TFT_LIGHTGREY);    

    // Draw title using helper method
    drawTitle(sprite, "SPOTIFY");

                                     
    sprite->drawBitmap(30, 30, spotify_logo, 480, 480, TFT_GREENYELLOW, TFT_LIGHTGREY);    

    // Draw bitmap icons (128x128 each, centered on button positions)

    // Play/Pause icon (top center)
    sprite->drawBitmap(PLAY_PAUSE_BUTTON_X - 64, PLAY_PAUSE_BUTTON_Y - 64,
                       play_pause_icon, 128, 128,
                       TFT_BLACK, TFT_GREENYELLOW);

    // Previous Song icon (left)
    sprite->drawBitmap(PREV_SONG_BUTTON_X - 64, PREV_SONG_BUTTON_Y - 64,
                       prev_icon, 128, 128,
                       TFT_BLACK, TFT_GREENYELLOW);

    // Next Song icon (right)
    sprite->drawBitmap(NEXT_SONG_BUTTON_X - 64, NEXT_SONG_BUTTON_Y - 64,
                       next_icon, 128, 128,
                       TFT_BLACK, TFT_GREENYELLOW);

    // Mute icon (bottom)
    sprite->drawBitmap(MUTE_BUTTON_X - 64, MUTE_BUTTON_Y - 64,
                       mute_icon, 128, 128,
                       TFT_BLACK, TFT_GREENYELLOW);

};

void SpotifyScreen::onScroll(int x, TFT_eSprite *sprite)
{

    int delta = x - lastScrollX;
    lastScrollX = x;

    if (delta > 0)
    {
        bleKeyboard.write(KEY_MEDIA_VOLUME_UP);
    }
    else if (delta < 0)
    {
        bleKeyboard.write(KEY_MEDIA_VOLUME_DOWN);
    }
};