
#ifndef SPOTIFY_SCREEN_H_
#define SPOTIFY_SCREEN_H_

#include <BleKeyboard.h>
#include "screen.h"

// Spotify image assets (bitmap format)
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
    bool onClick(TFT_eSprite *sprite) override;
    void onTouch(int x, int y, TFT_eSprite *sprite) override;
    void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) override;
    void onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) override;
    void onScroll(int x, TFT_eSprite *sprite) override;

private:
    // Note: type is inherited from base screen class, no need to redeclare
};

#endif /* SPOTIFY_SCREEN_H_ */