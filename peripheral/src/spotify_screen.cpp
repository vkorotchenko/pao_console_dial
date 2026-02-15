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

// Button positions - diamond pattern centered on screen (540x540)
// Center point: (270, 270)
int PLAY_PAUSE_BUTTON_X = 270;
int PLAY_PAUSE_BUTTON_Y = 170;
int PREV_SONG_BUTTON_X = 170;
int PREV_SONG_BUTTON_Y = 270;
int NEXT_SONG_BUTTON_X = 370;
int NEXT_SONG_BUTTON_Y = 270;
int MUTE_BUTTON_X = 270;
int MUTE_BUTTON_Y = 370;

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
    sprite->fillSprite(TFT_GREENYELLOW);
    gfx->fillScreen(TFT_GREENYELLOW);

    // Draw title
    sprite->setTextColor(TFT_BLACK, TFT_BLACK);
    sprite->setTextSize(2);
    sprite->drawString("SPOTIFY", 200, 40);

    // Draw bitmap icons (100x100 each, centered on button positions)
    // Note: play_pause and mute are bitmap format, next/prev are PNG (fallback to circles)

    // Play/Pause icon (top center) - BITMAP
    sprite->drawBitmap(PLAY_PAUSE_BUTTON_X - 64, PLAY_PAUSE_BUTTON_Y - 64,
                       play_pause_icon, 128, 128,
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