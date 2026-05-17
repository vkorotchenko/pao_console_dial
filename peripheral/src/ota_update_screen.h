#ifndef OTA_UPDATE_SCREEN_H_
#define OTA_UPDATE_SCREEN_H_

#include <Arduino_GFX_Library.h>
#include <TFT_eSPI.h>

// Draw the OTA "Updating" screen once to the sprite and push it to the panel.
// Called as a one-shot from the main loop's isInFlight() gate — the main loop
// then returns and stays paused for the duration of the OTA transfer. The
// display will hold this frame statically until the device reboots.
//
// Signature mirrors screen::onLoad() so the call site in main.cpp is
// consistent with other screens.
//
// Font data (bigFont, midleFont) is #included directly inside
// ota_update_screen.cpp rather than passed as parameters. This keeps the
// font arrays in a single translation unit. main.cpp no longer includes
// bigFont.h, removing the duplicate copy that would otherwise appear in both
// main.cpp.o and carousel.cpp.o.
void drawOtaUpdateScreen(TFT_eSprite *sprite, Arduino_RGB_Display *gfx);

#endif /* OTA_UPDATE_SCREEN_H_ */
