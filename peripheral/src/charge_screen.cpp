#include "charge_screen.h"
#include "global_state.h"
#include "bigFont.h"
#include "midleFont.h"

// Position constants
int X_PROGRESS_BAR = 100;     // Progress bar left edge (moved 20px left)
int Y_PROGRESS_BAR = 140;     // Progress bar top edge
int PROGRESS_BAR_WIDTH = 300; // Total width
int PROGRESS_BAR_HEIGHT = 40; // Total height
int X_REQUESTED_AMPS = 150;   // Moved 30px right
int Y_REQUESTED_AMPS = 320;
int X_CURRENT_VOLTAGE = 370;  // Moved 30px right
int Y_CURRENT_VOLTAGE = 320;
int X_TARGET_VOLTAGE = 270;   // Moved 30px right
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
  sprite->fillRect(X_PROGRESS_BAR - 5, Y_PROGRESS_BAR - 5, PROGRESS_BAR_WIDTH + 10, PROGRESS_BAR_HEIGHT + 10, TFT_BLACK);
  sprite->fillRect(X_REQUESTED_AMPS - 60, Y_REQUESTED_AMPS - 20, 120, 50, TFT_BLACK);
  sprite->fillRect(X_CURRENT_VOLTAGE - 60, Y_CURRENT_VOLTAGE - 20, 120, 50, TFT_BLACK);
  sprite->fillRect(X_TARGET_VOLTAGE - 60, Y_TARGET_VOLTAGE - 20, 120, 50, TFT_BLACK);

  // Draw progress bar for charge percentage
  int chargePercent = state.getChargePercentage();

  // Draw white outline (3 pixels thick)
  sprite->drawRect(X_PROGRESS_BAR, Y_PROGRESS_BAR, PROGRESS_BAR_WIDTH, PROGRESS_BAR_HEIGHT, TFT_WHITE);
  sprite->drawRect(X_PROGRESS_BAR + 1, Y_PROGRESS_BAR + 1, PROGRESS_BAR_WIDTH - 2, PROGRESS_BAR_HEIGHT - 2, TFT_WHITE);
  sprite->drawRect(X_PROGRESS_BAR + 2, Y_PROGRESS_BAR + 2, PROGRESS_BAR_WIDTH - 4, PROGRESS_BAR_HEIGHT - 4, TFT_WHITE);

  // Fill with sky blue based on percentage (leave 3px padding for outline)
  int fillWidth = ((PROGRESS_BAR_WIDTH - 6) * chargePercent) / 100;
  if (fillWidth > 0) {
    sprite->fillRect(X_PROGRESS_BAR + 3, Y_PROGRESS_BAR + 3, fillWidth, PROGRESS_BAR_HEIGHT - 6, TFT_SKYBLUE);
  }

  // Draw percentage text centered in the bar
  sprite->setTextColor(TFT_WHITE, TFT_BLACK);
  sprite->setTextSize(2);
  char percentStr[8];
  sprintf(percentStr, "%d%%", chargePercent);
  sprite->drawString(percentStr, X_PROGRESS_BAR + (PROGRESS_BAR_WIDTH / 2) - 20, Y_PROGRESS_BAR + 10);

  // Requested amps (left side)
  sprite->loadFont(midleFont);
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

  // Standard title format
  sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  sprite->setTextSize(2);
  sprite->drawString("CHARGE", 200, 40);

  // Static labels (removed STATUS label)
  sprite->drawString("Requested Amps", X_REQUESTED_AMPS - 60, Y_REQUESTED_AMPS - 50);
  sprite->drawString("Current Voltage", X_CURRENT_VOLTAGE - 70, Y_CURRENT_VOLTAGE - 50);
  sprite->drawString("Target Voltage", X_TARGET_VOLTAGE - 60, Y_TARGET_VOLTAGE - 50);
};

void ChargeScreen::onScroll(int x, TFT_eSprite *sprite)
{
  return;
};
