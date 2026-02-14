#include "spotify_screen.h"

// PNG decoder globals
PNG png;
Arduino_ST7701_RGBPanel *currentGfx = nullptr;
TFT_eSprite *currentSprite = nullptr;
int pngOffsetX = 0;
int pngOffsetY = 0;

// PNG decoder callbacks for PROGMEM
void *pngOpen(const char *filename, int32_t *size)
{
    // filename is actually a pointer to the PROGMEM array
    return (void *)filename;
}

void pngClose(void *handle)
{
    // Nothing to close for PROGMEM
}

int32_t pngRead(PNGFILE *handle, uint8_t *buffer, int32_t length)
{
    // Read from PROGMEM
    const uint8_t *src = (const uint8_t *)handle->fHandle;
    memcpy_P(buffer, src + handle->iPos, length);
    handle->iPos += length;
    return length;
}

int32_t pngSeek(PNGFILE *handle, int32_t position)
{
    handle->iPos = position;
    return position;
}

// PNG draw callback - renders decoded line to sprite
int pngDraw(PNGDRAW *pDraw)
{
    uint16_t usPixels[pDraw->iWidth];
    png.getLineAsRGB565(pDraw, usPixels, PNG_RGB565_LITTLE_ENDIAN, 0xffffffff);

    if (currentSprite)
    {
        // Draw to sprite
        currentSprite->pushImage(pngOffsetX, pngOffsetY + pDraw->y, pDraw->iWidth, 1, usPixels);
    }
    else if (currentGfx)
    {
        // Draw directly to display
        currentGfx->draw16bitRGBBitmap(pngOffsetX, pngOffsetY + pDraw->y, usPixels, pDraw->iWidth, 1);
    }
    return 1;
}

// Helper function to decode and draw a PNG
bool drawPNG(const unsigned char *pngData, int32_t dataSize, int x, int y, TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
    pngOffsetX = x;
    pngOffsetY = y;
    currentSprite = sprite;
    currentGfx = gfx;

    int rc = png.openFLASH((uint8_t *)pngData, dataSize, pngDraw);
    if (rc == PNG_SUCCESS)
    {
        rc = png.decode(NULL, 0);
        png.close();
        return true;
    }
    return false;
}

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
    // Clear screen
    sprite->fillSprite(TFT_BLACK);
    gfx->fillScreen(TFT_BLACK);

    // Draw Spotify logo as background to sprite (centered on 480x480 screen)
    // Assuming logo will be scaled/positioned to fit nicely
    int logo_x = 40;  // Center a ~400px logo: (480-400)/2 = 40
    int logo_y = 40;
    drawPNG(spotify_logo, sizeof(spotify_logo), logo_x, logo_y, sprite, nullptr);

    // Draw button icons (100x100 pixels each, centered on touch zones)
    // Icon positions: center - 50 to center icon on touch point

    // Play/Pause button (center: 200, 75) -> top-left: (150, 25)
    drawPNG(play_pause_icon, sizeof(play_pause_icon),
            PLAY_PAUSE_BUTTON_X - 50, PLAY_PAUSE_BUTTON_Y - 50,
            sprite, nullptr);

    // Previous button (center: 100, 130) -> top-left: (50, 80)
    drawPNG(prev_icon, sizeof(prev_icon),
            PREV_SONG_BUTTON_X - 50, PREV_SONG_BUTTON_Y - 50,
            sprite, nullptr);

    // Next button (center: 300, 130) -> top-left: (250, 80)
    drawPNG(next_icon, sizeof(next_icon),
            NEXT_SONG_BUTTON_X - 50, NEXT_SONG_BUTTON_Y - 50,
            sprite, nullptr);

    // Mute button (center: 200, 185) -> top-left: (150, 135)
    drawPNG(mute_icon, sizeof(mute_icon),
            MUTE_BUTTON_X - 50, MUTE_BUTTON_Y - 50,
            sprite, nullptr);

    // Push sprite to display
    sprite->pushSprite(0, 0);
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