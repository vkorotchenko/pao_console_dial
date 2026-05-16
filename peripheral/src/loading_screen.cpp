#include "loading_screen.h"
#include "global_state.h"

bool LoadingScreen::onClick(TFT_eSprite *sprite)
{
  if (GlobalState::getInstance().getAutoPreLoadDismiss()) {
    return true;  // block click — pre-charge signal only
  }
  return false;  // allow click to dismiss
}

void LoadingScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
  return;
};

void LoadingScreen::display(TFT_eSprite *sprite, Arduino_RGB_Display *gfx) {
  // Check if precharge is ready - if so, auto-advance to next screen
  GlobalState &state = GlobalState::getInstance();
  if (state.getPreChargeReady()) {
    state.getNextScreen();
    state.getCurrentScreen()->onLoad(sprite, gfx);
  }
};

void LoadingScreen::onLoad(TFT_eSprite *sprite, Arduino_RGB_Display *gfx)
{

  sprite->fillSprite(TFT_CYAN);
  gfx->fillScreen(TFT_BLACK);

  sprite->drawBitmap(30, 30, pao_logo, 420, 420, TFT_BLACK, TFT_SKYBLUE);
};

void LoadingScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};