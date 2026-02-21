#ifndef BANNER_UTILS_H
#define BANNER_UTILS_H

#include <Arduino.h>
#include <TFT_eSPI.h>
#include "global_state.h"

// Banner constants
const int BANNER_HEIGHT = 25;
const int DATE_X = 30;
const int TIME_X = 480;
const int ICON_Y = 12;
const int ICON_START_X = 180;
const int ICON_SPACING = 35;
const int ICON_SIZE = 8;

// Main function
void drawBanner(TFT_eSprite* sprite, GlobalState& state);

// Helper functions
String formatDate(uint8_t day, uint8_t month, bool useMetric);
String formatTime(uint8_t hour, uint8_t minute, bool format24Hr);
void drawStatusIcon(TFT_eSprite* sprite, int x, int y, int size, uint16_t color, char symbol);

#endif
