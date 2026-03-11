#include "banner_utils.h"

String formatDate(uint8_t day, uint8_t month, bool useMetric) {
    static const char* months[] = {
        "???", "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
        "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
    };
    const char* mon = (month >= 1 && month <= 12) ? months[month] : months[0];
    char buffer[12];
    sprintf(buffer, "%s %02d", mon, day);
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
    // Ensure default font is active (custom fonts from previous renders may still be loaded)
    sprite->unloadFont();

    // Format date and time (show placeholders if no GPS fix)
    String dateStr, timeStr;
    if (state.getGpsFixAvailable()) {
        dateStr = formatDate(state.getLocalDay(), state.getLocalMonth(), state.getUseMetricUnits());
        timeStr = formatTime(state.getLocalHour(), state.getGpsMinute(), state.getTimeFormat24Hr());
    } else {
        dateStr = "--/--";
        timeStr = "--:--";
    }

    // Draw date (left)
    sprite->setTextDatum(TL_DATUM);
    sprite->setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    sprite->setTextSize(3);
    sprite->drawString(dateStr, DATE_X, BANNER_Y);

    // Draw time (left-aligned, after icons)
    sprite->setTextDatum(TL_DATUM);
    sprite->drawString(timeStr, TIME_X, BANNER_Y);

    // Single status icon — colour indicates priority state
    uint16_t statusColor;
    char statusSymbol;
    if (state.getIsFaulted()) {
        statusColor = TFT_RED;    statusSymbol = 'X';
    } else if (state.getIsWarning()) {
        statusColor = TFT_YELLOW; statusSymbol = '!';
    } else if (state.getIsRunning()) {
        statusColor = TFT_GREEN;  statusSymbol = '>';
    } else {
        statusColor = TFT_DARKGREY; statusSymbol = '>';
    }
    drawStatusIcon(sprite, ICON_START_X, ICON_Y, ICON_SIZE, statusColor, statusSymbol);

    // GPS fix icon: green when fix available, red when no fix
    drawStatusIcon(sprite, ICON_START_X + ICON_SPACING, ICON_Y, ICON_SIZE,
                   state.getGpsFixAvailable() ? TFT_GREEN : TFT_RED, 'S');
}
