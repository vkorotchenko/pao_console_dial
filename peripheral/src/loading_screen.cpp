#include "loading_screen.h"
#include "global_state.h"

bool LoadingScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void LoadingScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
  return;
};

void LoadingScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  // Check if precharge is ready - if so, auto-advance to next screen
  GlobalState &state = GlobalState::getInstance();
  if (state.getPreChargeReady()) {
    state.getNextScreen();
    state.getCurrentScreen()->onLoad(sprite, gfx);
  }
};

void LoadingScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{

  // sprite->fillSprite(TFT_SKYBLUE); 
  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_SKYBLUE);

  sprite->drawBitmap(30, 30, pao_logo, 420, 420, TFT_SKYBLUE);
};

void LoadingScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};