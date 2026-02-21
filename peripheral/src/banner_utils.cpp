#include "banner_utils.h"

String formatDate(uint8_t day, uint8_t month, bool useMetric) {
    char buffer[12];
    if (useMetric) {
        sprintf(buffer, "%02d/%02d", day, month);  // DD/MM
    } else {
        sprintf(buffer, "%02d/%02d", month, day);  // MM/DD
    }
    return String(buffer);
}

String formatTime(uint8_t hour, uint8_t minute, bool format24Hr) {
    char buffer[12];
    if (format24Hr) {
        sprintf(buffer, "%02d:%02d", hour, minute);  // 24hr: HH:MM
    } else {
        uint8_t displayHour = hour % 12;
        if (displayHour == 0) displayHour = 12;
        const char* ampm = (hour < 12) ? "AM" : "PM";
        sprintf(buffer, "%2d:%02d%s", displayHour, minute, ampm);  // 12hr: HH:MM AM/PM
    }
    return String(buffer);
}

void drawStatusIcon(TFT_eSprite* sprite, int x, int y, int size, uint16_t color, char symbol) {
    sprite->fillCircle(x, y, size/2, color);
    sprite->setTextDatum(MC_DATUM);
    sprite->setTextColor(TFT_BLACK, color);
    sprite->setTextSize(1);
    sprite->drawChar(symbol, x, y);
}

void drawBanner(TFT_eSprite* sprite, GlobalState& state) {
    // Only show banner if GPS fix is available
    if (!state.getGpsFixAvailable()) {
        return;
    }

    // Format date and time
    String dateStr = formatDate(state.getGpsDay(), state.getGpsMonth(), state.getUseMetricUnits());
    String timeStr = formatTime(state.getGpsHour(), state.getGpsMinute(), state.getTimeFormat24Hr());

    // Draw date (left)
    sprite->setTextDatum(TL_DATUM);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(1);
    sprite->drawString(dateStr, DATE_X, 5);

    // Draw time (right)
    sprite->setTextDatum(TR_DATUM);
    sprite->drawString(timeStr, TIME_X, 5);

    // Draw status icons (center)
    int iconX = ICON_START_X;

    if (state.getIsFaulted()) {
        drawStatusIcon(sprite, iconX, ICON_Y, ICON_SIZE, TFT_RED, 'X');
    }
    iconX += ICON_SPACING;

    if (state.getIsWarning()) {
        drawStatusIcon(sprite, iconX, ICON_Y, ICON_SIZE, TFT_YELLOW, '!');
    }
    iconX += ICON_SPACING;

    if (state.getIsRunning()) {
        drawStatusIcon(sprite, iconX, ICON_Y, ICON_SIZE, TFT_GREEN, '>');
    }
    iconX += ICON_SPACING;

    // GPS fix icon (always show when banner visible)
    drawStatusIcon(sprite, iconX, ICON_Y, ICON_SIZE, TFT_GREEN, 'S');
}
