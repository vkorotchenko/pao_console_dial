#include "gear_screen.h"
#include "global_state.h"

int PARK_X = 70;
int PARK_Y = 100;
int NEUTRAL_X = 200;
int NEUTRAL_Y = 100;
int DRIVE_X = 330;
int DRIVE_Y = 100;

int LABEL_FONT_SIZE = 20;
int LABEL_X_OFFSET = 0;
int LABEL_Y_OFFSET = -1 * (LABEL_FONT_SIZE / 2);

int BUTTON_RADIUS = 50;

int lastX = -1;
int lastY = -1;

bool GearScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void GearScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
  lastX = x + TOUCH_X_OFFSET;
  lastY = y + TOUCH_Y_OFFSET;

  GlobalState &state = GlobalState::getInstance();

  if (lastX > PARK_X - BUTTON_RADIUS &&
      lastX < PARK_X + BUTTON_RADIUS &&
      lastY > PARK_Y - BUTTON_RADIUS &&
      lastY < PARK_Y + BUTTON_RADIUS)
  {
    state.setGear(Gears::Gear::PARK);
    sprite->fillScreen(TFT_CASET);
    draw(sprite);
  }

  if (lastX > NEUTRAL_X - BUTTON_RADIUS &&
      lastX < NEUTRAL_X + BUTTON_RADIUS &&
      lastY > NEUTRAL_Y - BUTTON_RADIUS &&
      lastY < NEUTRAL_Y + BUTTON_RADIUS)
  {
    state.setGear(Gears::Gear::NEUTRAL);
    sprite->fillScreen(TFT_DARKGREEN);
    draw(sprite);
  }

  if (lastX > DRIVE_X - BUTTON_RADIUS && // x > 280
      lastX < DRIVE_X + BUTTON_RADIUS && // x < 380
      lastY > DRIVE_Y - BUTTON_RADIUS && // y > 50
      lastY < DRIVE_Y + BUTTON_RADIUS)
  { // y < 150
    state.setGear(Gears::Gear::DRIVE);
    sprite->fillScreen(TFT_CYAN);
    draw(sprite);
  }
};

void GearScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

};

void GearScreen::draw(TFT_eSprite *sprite)
{
  GlobalState &state = GlobalState::getInstance();

  sprite->fillSprite(TFT_BLACK);
  sprite->drawCircleHelper(PARK_X, PARK_Y, BUTTON_RADIUS, 0b1111, TFT_LIGHTGREY);
  if (state.getGear() == Gears::Gear::PARK)
  {
    sprite->drawCircleHelper(PARK_X, PARK_Y, BUTTON_RADIUS + 5, 0b1111, TFT_SKYBLUE);
    sprite->fillCircle(PARK_X, PARK_Y, BUTTON_RADIUS - 10, TFT_SKYBLUE);
  }
  sprite->drawCentreString("P", PARK_X + LABEL_X_OFFSET, PARK_Y + LABEL_Y_OFFSET, LABEL_FONT_SIZE);

  sprite->drawCircleHelper(NEUTRAL_X, NEUTRAL_Y, BUTTON_RADIUS, 0b1111, TFT_LIGHTGREY);
  if (state.getGear() == Gears::Gear::NEUTRAL)
  {
    sprite->drawCircleHelper(NEUTRAL_X, NEUTRAL_Y, BUTTON_RADIUS + 5, 0b1111, TFT_SKYBLUE);
    sprite->fillCircle(NEUTRAL_X, NEUTRAL_Y, BUTTON_RADIUS - 10, TFT_SKYBLUE);
  }
  sprite->drawCentreString("N", NEUTRAL_X + LABEL_X_OFFSET, NEUTRAL_Y + LABEL_Y_OFFSET, LABEL_FONT_SIZE);

  sprite->drawCircleHelper(DRIVE_X, DRIVE_Y, BUTTON_RADIUS, 0b1111, TFT_LIGHTGREY);
  if (state.getGear() == Gears::Gear::DRIVE)
  {
    sprite->drawCircleHelper(DRIVE_X, DRIVE_Y, BUTTON_RADIUS + 5, 0b1111, TFT_SKYBLUE);
    sprite->fillCircle(DRIVE_X, DRIVE_Y, BUTTON_RADIUS - 10, TFT_SKYBLUE);
  }
  sprite->drawCentreString("D", DRIVE_X + LABEL_X_OFFSET, DRIVE_Y + LABEL_Y_OFFSET, LABEL_FONT_SIZE);
}

void GearScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  gfx->fillScreen(TFT_BLACK);
  draw(sprite);
};

void GearScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};