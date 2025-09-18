#include <Arduino_GFX_Library.h>
#include <RotaryEncoder.h>
#include <ESP32Time.h>
#include <Arduino.h>
#include <Wire.h>
#include "touch.h"
#include "bigFont.h"
#include "midleFont.h"
#include "smallFont.h"
#include "valueFont.h"

#include "global_state.h"

GlobalState* state = new GlobalState(); 


int buttonState= HIGH;
int lastButtonState = HIGH;

unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 500;

double rad=0.01745;

float x[360]; //outer point
float y[360];
float px[360]; //ineer point
float py[360];
float lx[360]; //long line 
float ly[360];
float shx[360]; //short line 
float shy[360];
float tx[360]; //text
float ty[360];

int PPgraph[24]={0};

int angle=0;
int value=0;
int chosenFont;
int chosenColor;
int r=118;
int sx=-2;
int sy=120;
int inc=18;
int a=0;
int prev=0;
String secs="00";
int second1=0;
int second2=0;
bool onOff=0;
String OO[2]={"OFF","ON"};
int deb=0;


#include <TFT_eSPI.h>
TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);

#define I2C_SDA_PIN 17
#define I2C_SCL_PIN 18
#define TOUCH_RST -1 // 38
#define TOUCH_IRQ -1 // 0

ESP32Time rtc(0); 

Arduino_ESP32RGBPanel *bus = new Arduino_ESP32RGBPanel(
    1 /* CS */, 46 /* SCK */, 0 /* SDA */,
    2 /* DE */, 42 /* VSYNC */, 3 /* HSYNC */, 45 /* PCLK */,
    11 /* R0 */, 15 /* R1 */, 12 /* R2 */, 16 /* R3 */, 21 /* R4 */,
    39 /* G0/P22 */, 7 /* G1/P23 */, 47 /* G2/P24 */, 8 /* G3/P25 */, 48 /* G4/P26 */, 9 /* G5 */,
    4 /* B0 */, 41 /* B1 */, 5 /* B2 */, 40 /* B3 */, 6 /* B4 */
);

// Uncomment for 2.1" round display
Arduino_ST7701_RGBPanel *gfx = new Arduino_ST7701_RGBPanel(
    bus, GFX_NOT_DEFINED /* RST */, 0 /* rotation */,
    false /* IPS */, 480 /* width */, 480 /* height */,
    st7701_type5_init_operations, sizeof(st7701_type5_init_operations),
    true /* BGR */,
    10 /* hsync_front_porch */, 8 /* hsync_pulse_width */, 50 /* hsync_back_porch */,
    10 /* vsync_front_porch */, 8 /* vsync_pulse_width */, 20 /* vsync_back_porch */);


#define PWM_CHANNEL 1
#define PWM_FREQ 5000//Hz
#define pwm_resolution_bits 10
#define IO_PWM_PIN 38

int n=0;
int xt = 0, yt = 0;

#define PIN_IN1 13
#define PIN_IN2 10
#define BUTTON 14

RotaryEncoder encoder(PIN_IN1, PIN_IN2, RotaryEncoder::LatchMode::TWO03);

unsigned short grays[13];
#define red 0xD041
#define blue 0x0AD0
#define yellow 0x9381
#define bck TFT_BLACK
char dd[7]={'m','t','w','t','f','s','s'};

void readEncoder()
 {

  static int pos = 0;
  encoder.tick();

  int newPos = encoder.getPosition();
  if (pos != newPos) {
    
    if(newPos>pos)
    angle=angle+inc;
    if(newPos<pos)
    angle=angle-inc;
    
    pos = newPos;
  } 
  if(angle<0){
      angle=359;
  }
  if(angle>=360){
    angle=0;
  }

  // state->getCurrentScreen()->onScroll(angle);
}


void setup() {
  pinMode(IO_PWM_PIN, OUTPUT); 
  pinMode(BUTTON, INPUT_PULLUP); 
  ledcSetup(PWM_CHANNEL, PWM_FREQ, pwm_resolution_bits);  
  ledcAttachPin(IO_PWM_PIN, PWM_CHANNEL); 
  ledcWrite(PWM_CHANNEL, 840); 

  rtc.setTime(0,47,13,10,23,2023,0); 

  sprite.createSprite(400,240);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  gfx->begin();
  gfx->fillScreen(MAROON);
  state->setup();

}

void loop() {

  //  readEncoder();

  //read button with debounce
  int reading = digitalRead(BUTTON);
  if (reading == LOW && lastButtonState == HIGH && (millis() - lastDebounceTime) > debounceDelay) {
    buttonState = reading;
    lastDebounceTime = millis();
    bool isBlocking = state->getCurrentScreen()->onClick(&sprite, gfx);
    if(!isBlocking){
      state->getNextScreen();
    }
  }
 
  // if (read_touch(&xt, &yt) == 1) {
  //   // state->getCurrentScreen()->onTouch(xt, yt);
  // }

  state->getCurrentScreen()->display(&sprite, gfx);
 
}
