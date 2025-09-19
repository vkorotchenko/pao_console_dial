#include "spotify_screen.h"

    // #include <Keypad.h> 
    // #include <BleKeyboard.h> 
    // BleKeyboard blekeyboard ("spotify_controller");
    //  #define USE_NIMBLE
    //   #define w_key 0x77
    //    #define B_key 0xB 
    //    #define super_key 0xFFE7 
    //    #define S_key 0x53 
    //    const byte ROWS = 4; //four rows 
    //    const byte COLS = 2; //three columns 
    //    char keys[ROWS][COLS] = { {'1', '2'}, // here what function or command tp be made
    //     {'3', '4'}, {'5', '6'}, {'7', '8'} }; 
    //    byte rowPins[ROWS] = {13, 12, 14, 27}; //connect to the row pinouts of the keypad 
    //    byte colPins[COLS] = {25, 33}; //connect to the column pinouts of the keypad 
    //    Keypad keypad = Keypad( makeKeymap(keys), rowPins, colPins, ROWS, COLS );

bool SpotifyScreen::onClick(TFT_eSprite *sprite)
{
  return false;
}

void SpotifyScreen::onTouch(int x, int y, TFT_eSprite *sprite)
 {
    sprite->drawString("G", x, y);
    return;
};

void SpotifyScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

};
void SpotifyScreen::onLoad(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {

  sprite->fillSprite(TFT_GREEN);
  gfx->fillScreen(TFT_GREEN);
  
  sprite->drawString("SPOTIFY SCREEN", 200, 100);

};

void SpotifyScreen::onScroll(int x, TFT_eSprite *sprite) {
    return;
};