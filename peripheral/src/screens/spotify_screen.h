
#ifndef SPOTIFY_SCREEN_H_
#define SPOTIFY_SCREEN_H_

#include "screen.h"

class SpotifyScreen :public Screen {
    public:
    virtual void onClick() ;
    virtual void onTouch(int x, int y);
    virtual void display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx);
    virtual void onScroll(int x);
    virtual ScreenType type() = 0;
    protected:
};

#endif /* SPOTIFY_SCREEN_H_ */