#ifndef OTA_UPDATE_SCREEN_H_
#define OTA_UPDATE_SCREEN_H_

#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>
#include <stdint.h>

// Draw the OTA "Updating" screen once to the sprite and push it to the panel.
// Called as a one-shot from the main loop's isInFlight() gate — the main loop
// then returns and stays paused for the duration of the OTA transfer. The
// display will hold this frame statically until the device reboots.
//
// bigFontData / midleFontData are the PROGMEM font arrays from bigFont.h and
// midleFont.h, passed in by the caller (main.cpp) so that this translation
// unit does not need to #include those headers. The font headers have no
// include guards and define their arrays with internal linkage — a second
// #include would emit a duplicate copy of the data in flash (~563 KB extra).
// Accepting the pointers here avoids that entirely.
void drawOtaUpdateScreen(TFT_eSprite *sprite, Arduino_RGB_Display *gfx,
                         const uint8_t *bigFontData, const uint8_t *midleFontData);

#endif /* OTA_UPDATE_SCREEN_H_ */
