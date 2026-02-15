#ifndef TEXT_UTILS_H
#define TEXT_UTILS_H

#include <Arduino.h>

// Estimate text width in pixels based on character count and text size
int estimateTextWidth(const String &text, int textSize);

// Truncate string to fit within maxWidth pixels at given textSize
// Adds "..." ellipsis if truncated
String truncateToWidth(const String &text, int textSize, int maxWidth);

#endif
