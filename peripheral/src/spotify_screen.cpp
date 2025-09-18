#include "spotify_screen.h"

    #include <Keypad.h> 
    #include <BleKeyboard.h> 
    BleKeyboard blekeyboard ("spotify_controller");
     #define USE_NIMBLE
      #define w_key 0x77
       #define B_key 0xB 
       #define super_key 0xFFE7 
       #define S_key 0x53 
       const byte ROWS = 4; //four rows 
       const byte COLS = 2; //three columns 
       char keys[ROWS][COLS] = { {'1', '2'}, // here what function or command tp be made
        {'3', '4'}, {'5', '6'}, {'7', '8'} }; 
       byte rowPins[ROWS] = {13, 12, 14, 27}; //connect to the row pinouts of the keypad 
       byte colPins[COLS] = {25, 33}; //connect to the column pinouts of the keypad 
       Keypad keypad = Keypad( makeKeymap(keys), rowPins, colPins, ROWS, COLS );

void SpotifyScreen::onClick(){
    return;
}

void SpotifyScreen::onTouch(int x, int y) {
        // void setup() { pinMode(2, OUTPUT); Serial.begin(115200); blekeyboard.begin(); } 
        // void loop() { char key = keypad.getKey(); if (blekeyboard.isConnected()) { digitalWrite(2, HIGH); switch (key) { case'1': blekeyboard.write(KEY_MEDIA_NEXT_TRACK); delay(100); blekeyboard.releaseAll(); break; case'2': blekeyboard.write(KEY_MEDIA_PREVIOUS_TRACK); delay(100); blekeyboard.releaseAll(); break; case'3': blekeyboard.write(KEY_MEDIA_PLAY_PAUSE); delay(100); blekeyboard.releaseAll(); break; case'4': blekeyboard.write(KEY_MEDIA_VOLUME_UP); delay(100); blekeyboard.releaseAll(); break; case'5': blekeyboard.write(KEY_MEDIA_VOLUME_DOWN); delay(100); blekeyboard.releaseAll(); break; case'6': blekeyboard.press(KEY_LEFT_ALT);//alt+shift+b like blekeyboard.press(KEY_LEFT_SHIFT); blekeyboard.press('B'); delay(200); blekeyboard.releaseAll(); break; case'7': blekeyboard.press(KEY_LEFT_ALT);//alt+shift+b like blekeyboard.press(KEY_LEFT_SHIFT); blekeyboard.press('S'); delay(200); blekeyboard.releaseAll(); break; case'8': blekeyboard.press(KEY_LEFT_CTRL); blekeyboard.press(KEY_LEFT_SHIFT); blekeyboard.press('w'); blekeyboard.releaseAll(); delay(10); blekeyboard.print("https://open.spotify.com/"); delay(200); blekeyboard.press(KEY_RETURN); delay(50); blekeyboard.releaseAll(); break; /* blekeyboard.press(KEY_LEFT_ALT); blekeyboard.press(KEY_LEFT_SHIFT); blekeyboard.press('2'); // alt+shift+2: podcasts delay(200); blekeyboard.releaseAll(); break; */ } if (2 != HIGH) { digitalWrite(2, LOW); } }}
   
    return;
};

void SpotifyScreen::display(TFT_eSprite *sprite, Arduino_ST7701_RGBPanel *gfx) {
  
  sprite->fillSprite(strtol("1DB954", NULL, 16));
  sprite->loadFont(midleFont);
  sprite->setTextColor(grays[2],grays[8]);
  sprite->drawString("SPOTIFY SCREEN", 200, 100);

  gfx->draw16bitBeRGBBitmap(40,120,(uint16_t*)sprite->getPointer(),400,240);
};

void SpotifyScreen::onScroll(int x) {
    return;
};