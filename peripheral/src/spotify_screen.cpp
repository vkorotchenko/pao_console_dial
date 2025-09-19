#include "spotify_screen.h"

int NEXT_SONG_BUTTON_X = 300;
int NEXT_SONG_BUTTON_Y = 130;
int PREV_SONG_BUTTON_X = 100;
int PREV_SONG_BUTTON_Y = 130;
int PLAY_PAUSE_BUTTON_X = 200;
int PLAY_PAUSE_BUTTON_Y = 75;
int MUTE_BUTTON_X = 200;
int MUTE_BUTTON_Y = 185;

int SPOTIFY_BUTTON_RADIUS = 50;

int lastScrollX = 0;

BleKeyboard bleKeyboard;

void SpotifyScreen::setup(ScreenTypes::ScreenType type)
{
    this->type = type;

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
    if (lastX > PREV_SONG_BUTTON_X - SPOTIFY_BUTTON_RADIUS &&
        lastX < PREV_SONG_BUTTON_X + SPOTIFY_BUTTON_RADIUS &&
        lastY > PREV_SONG_BUTTON_Y - SPOTIFY_BUTTON_RADIUS &&
        lastY < PREV_SONG_BUTTON_Y + SPOTIFY_BUTTON_RADIUS)
    {
        bleKeyboard.write(KEY_MEDIA_PREVIOUS_TRACK);
    }
    if (lastX > PLAY_PAUSE_BUTTON_X - SPOTIFY_BUTTON_RADIUS &&
        lastX < PLAY_PAUSE_BUTTON_X + SPOTIFY_BUTTON_RADIUS &&
        lastY > PLAY_PAUSE_BUTTON_Y - SPOTIFY_BUTTON_RADIUS &&
        lastY < PLAY_PAUSE_BUTTON_Y + SPOTIFY_BUTTON_RADIUS)
    {
        bleKeyboard.write(KEY_MEDIA_PLAY_PAUSE);
    }
    if (lastX > MUTE_BUTTON_X - SPOTIFY_BUTTON_RADIUS &&
        lastX < MUTE_BUTTON_X + SPOTIFY_BUTTON_RADIUS &&
        lastY > MUTE_BUTTON_Y - SPOTIFY_BUTTON_RADIUS &&
        lastY < MUTE_BUTTON_Y + SPOTIFY_BUTTON_RADIUS)
    {
        bleKeyboard.write(KEY_MEDIA_MUTE);
    }
};

void SpotifyScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

};
void SpotifyScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{

    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    sprite->drawCircle(NEXT_SONG_BUTTON_X, NEXT_SONG_BUTTON_Y, SPOTIFY_BUTTON_RADIUS, TFT_GREEN);
    sprite->drawString(">>", NEXT_SONG_BUTTON_X - 15, NEXT_SONG_BUTTON_Y - 10);
    sprite->drawCircle(PREV_SONG_BUTTON_X, PREV_SONG_BUTTON_Y, SPOTIFY_BUTTON_RADIUS, TFT_GREEN);
    sprite->drawString("<<", PREV_SONG_BUTTON_X - 15, PREV_SONG_BUTTON_Y - 10);
    sprite->drawCircle(PLAY_PAUSE_BUTTON_X, PLAY_PAUSE_BUTTON_Y, SPOTIFY_BUTTON_RADIUS, TFT_GREEN);
    sprite->drawString("|>", PLAY_PAUSE_BUTTON_X - 10, PLAY_PAUSE_BUTTON_Y - 15);
    sprite->drawCircle(MUTE_BUTTON_X, MUTE_BUTTON_Y, SPOTIFY_BUTTON_RADIUS, TFT_GREEN);
    sprite->drawString("M", MUTE_BUTTON_X - 10, MUTE_BUTTON_Y - 15);
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