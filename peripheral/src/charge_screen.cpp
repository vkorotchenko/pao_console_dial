#include "charge_screen.h"
#include "global_state.h"
#include "bigFont.h"
#include "midleFont.h"

// Position constants
int X_CHARGE_PERCENT = 240;
int Y_CHARGE_PERCENT = 120;
int X_CHARGE_STATE = 240;
int Y_CHARGE_STATE = 240;
int X_REQUESTED_AMPS = 120;
int Y_REQUESTED_AMPS = 320;
int X_CURRENT_VOLTAGE = 340;
int Y_CURRENT_VOLTAGE = 320;
int X_TARGET_VOLTAGE = 240;
int Y_TARGET_VOLTAGE = 400;

// Font sizes
int CHARGE_PERCENT_FONT_SIZE = 24;
int CHARGE_STATE_FONT_SIZE = 18;
int CHARGE_VALUES_FONT_SIZE = 16;

// Font offsets
int CHARGE_PERCENT_X_OFFSET = -60;
int CHARGE_PERCENT_Y_OFFSET = -60;
int CHARGE_STATE_X_OFFSET = -80;
int CHARGE_STATE_Y_OFFSET = -40;
int REQUESTED_AMPS_X_OFFSET = -40;
int REQUESTED_AMPS_Y_OFFSET = -30;
int CURRENT_VOLTAGE_X_OFFSET = -40;
int CURRENT_VOLTAGE_Y_OFFSET = -30;
int TARGET_VOLTAGE_X_OFFSET = -40;
int TARGET_VOLTAGE_Y_OFFSET = -30;

// Helper functions moved to global_state.cpp (shared with data_screen)

bool ChargeScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void ChargeScreen::onTouch(int x, int y, TFT_eSprite *sprite)
{
  return;
};

void ChargeScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  GlobalState &state = GlobalState::getInstance();

  // Clear dynamic content areas to prevent ghosting
  sprite->fillRect(X_CHARGE_PERCENT - 80, Y_CHARGE_PERCENT - 20, 160, 80, TFT_BLACK);
  sprite->fillRect(X_CHARGE_STATE - 100, Y_CHARGE_STATE - 20, 200, 60, TFT_BLACK);
  sprite->fillRect(X_REQUESTED_AMPS - 60, Y_REQUESTED_AMPS - 20, 120, 50, TFT_BLACK);
  sprite->fillRect(X_CURRENT_VOLTAGE - 60, Y_CURRENT_VOLTAGE - 20, 120, 50, TFT_BLACK);
  sprite->fillRect(X_TARGET_VOLTAGE - 60, Y_TARGET_VOLTAGE - 20, 120, 50, TFT_BLACK);

  // Charge percentage (large, centered at top)
  sprite->loadFont(bigFont);
  sprite->setTextSize(CHARGE_PERCENT_FONT_SIZE);
  sprite->setTextColor(TFT_WHITE, TFT_BLACK);
  sprite->setCursor(X_CHARGE_PERCENT + CHARGE_PERCENT_X_OFFSET, Y_CHARGE_PERCENT + CHARGE_PERCENT_Y_OFFSET);
  sprite->print(state.getChargePercentage());
  sprite->print("%");

  // Charge state (color-coded, centered)
  sprite->loadFont(midleFont);
  sprite->setTextSize(CHARGE_STATE_FONT_SIZE);
  sprite->setTextColor(getChargeStateColor(state.getChargeState()), TFT_BLACK);
  sprite->setCursor(X_CHARGE_STATE + CHARGE_STATE_X_OFFSET, Y_CHARGE_STATE + CHARGE_STATE_Y_OFFSET);
  sprite->print(getChargeStateString(state.getChargeState()));

  // Requested amps (left side)
  sprite->setTextSize(CHARGE_VALUES_FONT_SIZE);
  sprite->setTextColor(TFT_WHITE, TFT_BLACK);
  sprite->setCursor(X_REQUESTED_AMPS + REQUESTED_AMPS_X_OFFSET, Y_REQUESTED_AMPS + REQUESTED_AMPS_Y_OFFSET);
  sprite->print(state.getRequestedAmps(), 1);
  sprite->print("A");

  // Current voltage (right side)
  sprite->setCursor(X_CURRENT_VOLTAGE + CURRENT_VOLTAGE_X_OFFSET, Y_CURRENT_VOLTAGE + CURRENT_VOLTAGE_Y_OFFSET);
  sprite->print(state.getCurrentVoltage(), 1);
  sprite->print("V");

  // Target voltage (bottom center)
  sprite->setCursor(X_TARGET_VOLTAGE + TARGET_VOLTAGE_X_OFFSET, Y_TARGET_VOLTAGE + TARGET_VOLTAGE_Y_OFFSET);
  sprite->print(state.getTargetVoltage(), 1);
  sprite->print("V");
};

void ChargeScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx)
{
  sprite->fillSprite(TFT_BLACK);
  gfx->fillScreen(TFT_BLACK);

  sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  sprite->setTextSize(2);

  // Title
  sprite->drawString("CHARGE", X_CHARGE_PERCENT - 30, 40);

  // Static labels
  sprite->drawString("STATUS", X_CHARGE_STATE - 30, 180);
  sprite->drawString("Requested Amps", X_REQUESTED_AMPS - 60, Y_REQUESTED_AMPS - 50);
  sprite->drawString("Current Voltage", X_CURRENT_VOLTAGE - 70, Y_CURRENT_VOLTAGE - 50);
  sprite->drawString("Target Voltage", X_TARGET_VOLTAGE - 60, Y_TARGET_VOLTAGE - 50);
};

void ChargeScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};
