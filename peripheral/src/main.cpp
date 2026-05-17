#include <Arduino_GFX_Library.h>
#include <RotaryEncoder.h>
#include <ESP32Time.h>
#include <Arduino.h>
#include "touch.h"
#include "bigFont.h"
#include "midleFont.h"
#include "smallFont.h"
#include "valueFont.h"

#include "global_state.h"
#include "i2c_handler.h"
#include "pao_ble.h"
#include "ota.h"
#include "ota_update_screen.h"

GlobalState &state = GlobalState::getInstance();
I2CHandler i2cHandler;
PaoBleService &paoService = PaoBleService::getInstance();

int buttonState = HIGH;
int lastButtonState = HIGH;

unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 500;

double rad = 0.01745;

float x[360]; // outer point
float y[360];
float px[360]; // ineer point
float py[360];
float lx[360]; // long line
float ly[360];
float shx[360]; // short line
float shy[360];
float tx[360]; // text
float ty[360];

int PPgraph[24] = {0};

int angle = 0;
int value = 0;
int chosenFont;
int chosenColor;
int r = 118;
int sx = -2;
int sy = 120;
int inc = 18;
int a = 0;
int prev = 0;
String secs = "00";
int second1 = 0;
int second2 = 0;
bool onOff = 0;
String OO[2] = {"OFF", "ON"};
int deb = 0;

#include <TFT_eSPI.h>
TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);

#define I2C_SDA_PIN 17
#define I2C_SCL_PIN 18
#define TOUCH_RST -1 // 38
#define TOUCH_IRQ -1 // 0

ESP32Time rtc(0);

// Migrated to Arduino_GFX v1.6.5 (arduino-esp32 3.x compatible).
// Old API: single `Arduino_ESP32RGBPanel(cs, sck, sda, de, vsync, hsync, pclk, ...)`
//          paired with `Arduino_ST7701_RGBPanel(bus, ...)` that combined init-bus + RGB-panel.
// New API: separate `Arduino_SWSPI` databus for ST7701 init commands, an
//          `Arduino_ESP32RGBPanel` that owns the parallel RGB pins + porches + polarities,
//          and a generic `Arduino_RGB_Display` that ties them together with the init
//          operations. Polarities match the values the old vendored `Arduino_ST7701_RGBPanel`
//          hard-coded internally (`hsync_polarity=1, vsync_polarity=1`).
//          The BGR flag in the old API was redundant: the ST7701 type5 init sequence
//          already sets MADCTL for BGR.
Arduino_DataBus *st7701_bus = new Arduino_SWSPI(
    GFX_NOT_DEFINED /* DC */, 1 /* CS */,
    46 /* SCK */, 0 /* MOSI / SDA */, GFX_NOT_DEFINED /* MISO */);

Arduino_ESP32RGBPanel *rgbpanel = new Arduino_ESP32RGBPanel(
    2 /* DE */, 42 /* VSYNC */, 3 /* HSYNC */, 45 /* PCLK */,
    11 /* R0 */, 15 /* R1 */, 12 /* R2 */, 16 /* R3 */, 21 /* R4 */,
    39 /* G0/P22 */, 7 /* G1/P23 */, 47 /* G2/P24 */, 8 /* G3/P25 */, 48 /* G4/P26 */, 9 /* G5 */,
    4 /* B0 */, 41 /* B1 */, 5 /* B2 */, 40 /* B3 */, 6 /* B4 */,
    1 /* hsync_polarity */, 10 /* hsync_front_porch */, 8 /* hsync_pulse_width */, 50 /* hsync_back_porch */,
    1 /* vsync_polarity */, 10 /* vsync_front_porch */, 8 /* vsync_pulse_width */, 20 /* vsync_back_porch */);

// 2.1" round 540x540 ST7701 panel
Arduino_RGB_Display *gfx = new Arduino_RGB_Display(
    540 /* width */, 540 /* height */, rgbpanel, 0 /* rotation */, true /* auto_flush */,
    st7701_bus, GFX_NOT_DEFINED /* RST */,
    st7701_type5_init_operations, sizeof(st7701_type5_init_operations));

// arduino-esp32 3.x unified LEDC API: ledcAttach(pin, freq, resolution) replaces
// ledcSetup(channel, freq, resolution) + ledcAttachPin(pin, channel). Channel
// allocation is now internal — ledcWrite() takes the pin instead of a channel
// number. PWM_CHANNEL was removed for that reason.
#define PWM_FREQ 5000 // Hz
#define pwm_resolution_bits 10
#define IO_PWM_PIN 38

int n = 0;
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

void readEncoder()
{
  static int pos = 0;
  encoder.tick();

  int newPos = encoder.getPosition();
  if (pos != newPos)
  {
    angle += (newPos > pos) ? inc : -inc;
    pos = newPos;
    state.getCurrentScreen()->onScroll(angle, &sprite);
  }
}

void setup()
{
  // OTA recovery FIRST — before any subsystem (display init, I²C, BLE) so a
  // bricked pending image triggers a partition swap BEFORE the panic-prone
  // code paths run. checkBootRecovery() is idempotent and a no-op when there's
  // no pending OTA. Mirrors charger Decision #52.
  Serial.begin(115200);
  ota::checkBootRecovery();

  pinMode(IO_PWM_PIN, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  // arduino-esp32 3.x: single-call PWM setup (was ledcSetup + ledcAttachPin in 2.x).
  ledcAttach(IO_PWM_PIN, PWM_FREQ, pwm_resolution_bits);

  rtc.setTime(0, 47, 13, 10, 23, 2023, 0);

  sprite.createSprite(540, 540);
  sprite.loadFont(midleFont);
  i2cHandler.setup(I2C_SDA_PIN, I2C_SCL_PIN);
  gfx->begin();
  state.setup();
  state.getCurrentScreen()->onLoad(&sprite, gfx);

  // Initialize BLE with PAO service
  paoService.begin();

  // Diagnostic — logs whether this boot is a pending OTA image awaiting
  // verify() from mobile (informational only; recovery is handled above and
  // commit/rollback is mobile-driven via cmd=13).
  ota::logBootStatus();
}

void loop()
{
  // Phase 5 safety gate: while OTA is flashing, pause the heavy main-loop
  // work (encoder/button/touch input, I²C polling, telemetry notifies,
  // display redraw). Flash erase can stall hundreds of ms on ESP32-S3 and
  // these subsystems would otherwise starve. The display freezes for the
  // OTA duration (~30–60 s); mobile renders progress. Watchdog feed inside
  // ota::writeChunk() handles the BLE-callback-task side. ota::tickWatchdog()
  // still runs so a stalled OTA session can abort itself.
  //
  // Decision follow-up (#63): draw the "Updating" screen once on first entry
  // so the display shows a clear indicator rather than freezing on whatever
  // screen was last active. The static frame persists until reboot.
  static bool s_ota_screen_drawn = false;
  if (ota::isInFlight()) {
    if (!s_ota_screen_drawn) {
      drawOtaUpdateScreen(&sprite, gfx, bigFont, midleFont);
      s_ota_screen_drawn = true;
    }
    ota::tickWatchdog();
    delay(10);  // yield to BLE / IDLE so the OTA stack actually runs
    return;
  }
  s_ota_screen_drawn = false;  // reset for any future OTA in the same boot

  readEncoder();

  // read button with debounce
  int reading = digitalRead(BUTTON);
  if (reading == LOW && lastButtonState == HIGH && (millis() - lastDebounceTime) > debounceDelay)
  {
    buttonState = reading;
    lastDebounceTime = millis();
    bool isBlocking = state.getCurrentScreen()->onClick(&sprite);
    if (!isBlocking)
    {
      state.getNextScreen();
      state.getCurrentScreen()->onLoad(&sprite, gfx);
    }
  }

  if (read_touch(&xt, &yt) == 1)
  {
    state.getCurrentScreen()->onTouch(xt, yt, &sprite);
  }
  else
  {
    state.getCurrentScreen()->onTouch(-1, -1, &sprite);
  }

  // Periodic I2C data exchange with controller
  i2cHandler.process();

  // BLE telemetry notifications (~2 Hz)
  static unsigned long lastTelemetryNotify = 0;
  if (millis() - lastTelemetryNotify >= 500) {
    lastTelemetryNotify = millis();
    paoService.notifyTelemetry();
    paoService.notifyChargerIfChanged();
  }

  // OTA stale-transfer watchdog. Cheap no-op outside RECEIVING.
  ota::tickWatchdog();

  // Apply display brightness setting (0-100% → 10-bit PWM 0-1023).
  // arduino-esp32 3.x: ledcWrite takes the pin, not a channel number.
  ledcWrite(IO_PWM_PIN, (state.getDisplayBrightness() * 1023) / 100);

  state.getCurrentScreen()->display(&sprite, gfx);
  gfx->draw16bitBeRGBBitmap(0, 0, (uint16_t *)sprite.getPointer(), 540, 540);
}
