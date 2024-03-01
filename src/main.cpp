#include <lvgl.h>
#include <Arduino_GFX_Library.h>
#include <Wire.h>
#include <ui.h>
#include <WiFi.h>

#include "touch.h"

#define SSID "akorotchenko"
#define PWD "december21985"

#define I2C_SDA_PIN 17
#define I2C_SCL_PIN 18
#define TOUCH_RST -1 // 38
#define TOUCH_IRQ -1 // 0

#define TFT_BL 38
#define BUTTON_PIN 14
#define ENCODER_CLK 13 // CLK
#define ENCODER_DT 10  // DT

/*Don't forget to set Sketchbook location in File/Preferencesto the path of your UI project (the parent foder of this INO file)*/

/*Change to your screen resolution*/
static const uint16_t screenWidth = 480;
static const uint16_t screenHeight = 480;

static lv_disp_draw_buf_t draw_buf;
static lv_color_t buf[screenWidth * screenHeight / 10];

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

int counter = 0;
int State;
int old_State;

int move_flag = 0;
int button_flag = 0;
int flesh_flag = 1;
int screen_index = 0;
int wifi_flag = 0;

int x = 0, y = 0;

#define COLOR_NUM 5
int ColorArray[COLOR_NUM] = {WHITE, BLUE, GREEN, RED, YELLOW};

//---------------------------------------------------
void Task_TFT(void *pvParameters)
{
    while (1)
    {
        lv_timer_handler();
        vTaskDelay(10);
    }
}

void Task_main(void *pvParameters)
{
    while (1)
    {
        if (digitalRead(BUTTON_PIN) == 0)
        {
            USBSerial.println("Button Press");
            screen_index++;
            if (screen_index % 3 == 0)
            {
                _ui_screen_change(ui_Screen1, LV_SCR_LOAD_ANIM_FADE_ON, 500, 0);
            }
            else if (screen_index % 3 == 1)
            {
                _ui_screen_change(ui_Screen2, LV_SCR_LOAD_ANIM_FADE_ON, 500, 0);
            }

            else if (screen_index % 3 == 2)
            {
                _ui_screen_change(ui_Screen3, LV_SCR_LOAD_ANIM_FADE_ON, 500, 0);
            }

            while (digitalRead(BUTTON_PIN) == 0)
            {
                vTaskDelay(100);
            }
        }

        if (move_flag == 1)
        {
            USBSerial.print("Position: ");
            USBSerial.println(counter);

            lv_arc_set_value(ui_Arc1, (int)counter * 5);
            lv_arc_set_value(ui_Arc2, (int)counter * 5);
            lv_arc_set_value(ui_Arc3, (int)counter * 5);
            move_flag = 0;
        }

        vTaskDelay(100);
    }
}

void encoder_irq()
{
    State = digitalRead(ENCODER_CLK);
    if (State != old_State)
    {
        if (digitalRead(ENCODER_DT) == State)
        {
            counter++;
        }
        else
        {
            counter--;
        }
    }
    old_State = State; // the first position was changed
    move_flag = 1;
}

//------------------------------------------------------------------------
void pin_init()
{
    pinMode(TFT_BL, OUTPUT);
    digitalWrite(TFT_BL, HIGH);

    pinMode(ENCODER_CLK, INPUT_PULLUP);
    pinMode(ENCODER_DT, INPUT_PULLUP);
    old_State = digitalRead(ENCODER_CLK);

    attachInterrupt(ENCODER_CLK, encoder_irq, CHANGE);

    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
}

/* Display flushing */
void my_disp_flush(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color_p)
{
    uint32_t w = (area->x2 - area->x1 + 1);
    uint32_t h = (area->y2 - area->y1 + 1);

#if (LV_COLOR_16_SWAP != 0)
    gfx->draw16bitBeRGBBitmap(area->x1, area->y1, (uint16_t *)&color_p->full, w, h);
#else
    gfx->draw16bitRGBBitmap(area->x1, area->y1, (uint16_t *)&color_p->full, w, h);
#endif

    lv_disp_flush_ready(disp);
}

/*Read the touchpad*/
void my_touchpad_read(lv_indev_drv_t *indev_driver, lv_indev_data_t *data)
{
    int touchX = 0, touchY = 0;

    if (read_touch(&touchX, &touchY) == 1)
    {
        data->state = LV_INDEV_STATE_PR;

        data->point.x = (uint16_t)touchX;
        data->point.y = (uint16_t)touchY;
    }
    else
    {
        data->state = LV_INDEV_STATE_REL;
    }
}



void page_1()
{
    String temp = "";
    gfx->fillScreen(ColorArray[((unsigned)counter / 2 % COLOR_NUM)]);
    gfx->setTextSize(4);
    gfx->setTextColor(BLACK);
    gfx->setCursor(120, 100);
    gfx->println(F("Makerfabs"));

    gfx->setTextSize(3);
    gfx->setCursor(30, 160);
    gfx->println(F("2.1inch TFT with Touch "));

    gfx->setTextSize(4);
    gfx->setCursor(60, 200);
    temp = temp + "Encoder: " + counter;
    gfx->println(temp);

    gfx->setTextSize(3);
    gfx->setCursor(60, 240);
    // if (wifi_flag == 1)
    // {
    //     gfx->println("Wifi OK!");
    // }
    // else
    // {
    //     gfx->println("Wifi Connecting..");
    // }
    gfx->println("Wifi Support");

    gfx->setTextSize(4);
    gfx->setCursor(60, 280);
    temp = "";
    temp = temp + "Touch X: " + x;
    gfx->println(temp);

    gfx->setTextSize(4);
    gfx->setCursor(60, 320);
    temp = "";
    temp = temp + "Touch Y: " + y;
    gfx->println(temp);

    // gfx->fillRect(240, 400, 30, 30, ColorArray[(((unsigned)counter / 2 + 1) % COLOR_NUM)]);

    flesh_flag = 0;
}

void test()
{
    while (1)
    {
        // if (wifi_flag != 1)
        //     if (WiFi.status() == WL_CONNECTED)
        //     {
        //         USBSerial.println(WiFi.localIP());
        //         wifi_flag = 1;
        //         flesh_flag = 1;
        //     }

        if (read_touch(&x, &y) == 1)
        {
            USBSerial.print("Touch ");
            USBSerial.print(x);
            USBSerial.print("\t");
            USBSerial.println(y);

            flesh_flag = 1;
        }

        if (digitalRead(BUTTON_PIN) == 0)
        {

            USBSerial.println("Button Press");
            delay(100);
            if (digitalRead(BUTTON_PIN) == 0)
                return;
        }

        if (move_flag == 1)
        {
            USBSerial.print("Position: ");
            USBSerial.println(counter);
            move_flag = 0;
            flesh_flag = 1;
        }
        if (flesh_flag == 1)
            page_1();

        delay(100);
    }
    return;
}

void setup()
{
    USBSerial.begin(115200); /* prepare for possible serial debug */

    // WiFi.mode(WIFI_STA);
    // WiFi.disconnect();
    // WiFi.begin(SSID, PWD);

    String LVGL_Arduino = "Hello Arduino! ";
    LVGL_Arduino += String('V') + lv_version_major() + "." + lv_version_minor() + "." + lv_version_patch();

    USBSerial.println(LVGL_Arduino);
    USBSerial.println("I am LVGL_Arduino");

    pin_init();

    // Init Display
    gfx->begin();

    test();

    lv_init();
    lv_disp_draw_buf_init(&draw_buf, buf, NULL, screenWidth * screenHeight / 10);

    /*Initialize the display*/
    static lv_disp_drv_t disp_drv;
    lv_disp_drv_init(&disp_drv);
    /*Change the following line to your display resolution*/
    disp_drv.hor_res = screenWidth;
    disp_drv.ver_res = screenHeight;
    disp_drv.flush_cb = my_disp_flush;
    disp_drv.draw_buf = &draw_buf;
    lv_disp_drv_register(&disp_drv);

    /*Initialize the (dummy) input device driver*/
    static lv_indev_drv_t indev_drv;
    lv_indev_drv_init(&indev_drv);
    indev_drv.type = LV_INDEV_TYPE_POINTER;
    indev_drv.read_cb = my_touchpad_read;
    lv_indev_drv_register(&indev_drv);

    ui_init();
    lv_arc_set_value(ui_Arc1, (int)counter);
    lv_arc_set_value(ui_Arc2, (int)counter);
    lv_arc_set_value(ui_Arc3, (int)counter);

    Serial.println("Setup done");

    xTaskCreatePinnedToCore(Task_TFT, "Task_TFT", 20480, NULL, 3, NULL, 0);
    xTaskCreatePinnedToCore(Task_main, "Task_main", 40960, NULL, 3, NULL, 1);
}

void loop()
{
}