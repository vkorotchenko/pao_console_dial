
#ifndef SPOTIFY_SCREEN_H_
#define SPOTIFY_SCREEN_H_

#include <BleKeyboard.h>
#include <PNGdec.h>
#include "screen.h"

// Spotify image assets (PNG format)
#include "spotify_logo.h"
#include "play_pause.h"
#include "mute.h"
#include "next.h"
#include "prev.h"

class SpotifyScreen : public screen
{
public:
    SpotifyScreen() {};
    void setup(ScreenTypes::ScreenType type) override;
    bool onClick(TFT_eSprite *sprite);
    void onTouch(int x, int y, TFT_eSprite *sprite);
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    void onScroll(int x, TFT_eSprite *sprite);

private:
    ScreenTypes::ScreenType type = ScreenTypes::ScreenType::SPOTIFY;
};

#endif /* SPOTIFY_SCREEN_H_ */