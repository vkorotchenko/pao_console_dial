#include "text_utils.h"

// Average character width for custom fonts
// Tuned to 2.3 for accurate width estimation with bigFont/midleFont
// This gives better unit positioning in carousel panels
const float CHAR_WIDTH_MULTIPLIER = 2.3;

int estimateTextWidth(const String &text, int textSize) {
    return text.length() * CHAR_WIDTH_MULTIPLIER * textSize;
}

String truncateToWidth(const String &text, int textSize, int maxWidth) {
    int estimatedWidth = estimateTextWidth(text, textSize);

    // If text fits, return as-is
    if (estimatedWidth <= maxWidth) {
        return text;
    }

    // Calculate how many characters fit (leaving room for "...")
    int ellipsisWidth = estimateTextWidth("...", textSize);
    int availableWidth = maxWidth - ellipsisWidth;
    int maxChars = availableWidth / (CHAR_WIDTH_MULTIPLIER * textSize);

    // Ensure at least 1 character
    if (maxChars < 1) maxChars = 1;

    // Truncate and add ellipsis
    return text.substring(0, maxChars) + "...";
}
