#ifndef BANNER_UTILS_H
#define BANNER_UTILS_H

#include <Arduino.h>
#include <TFT_eSPI.h>
#include "global_state.h"

// Banner constants — positions compensate for round 540x540 screen
// At y=90 the safe horizontal range is approx x=69 to x=471
const int BANNER_HEIGHT = 114;
const int BANNER_Y = 90;          // y baseline for text
const int DATE_X = 95;            // left-aligned date, centred around display visual centre (x=240)
const int TIME_X = 285;           // left-aligned, placed after icons with same ICON_SPACING gap
const int ICON_Y = 102;           // icon centre (BANNER_Y + half of size-3 text height)
const int ICON_START_X = 215;     // placed close to the date
const int ICON_SPACING = 35;
const int ICON_SIZE = 8;

// Main function
void drawBanner(TFT_eSprite* sprite, GlobalState& state);

// Helper functions
String formatDate(uint8_t day, uint8_t month, bool useMetric);
String formatTime(uint8_t hour, uint8_t minute, bool format24Hr);
void drawStatusIcon(TFT_eSprite* sprite, int x, int y, int size, uint16_t color, char symbol);

#endif
