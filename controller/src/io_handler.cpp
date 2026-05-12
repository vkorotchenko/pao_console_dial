#include "io_handler.h"

// Discrete digital outputs driven from gear state.
//
// SAMD21 → ESP32 V2 port (Stream 1 of OTA plan):
//
//   ENABLE_PIN  — drives the gear-enable transistor. Asserted when the
//                 driver is in NEUTRAL or REVERSE (see process() below).
//   REVERSE_PIN — drives the reverse output / reverse light.
//
// On SAMD21 these were `1` and `2` — both happen to be regular digital
// IOs on a Feather M0. On the Adafruit Feather ESP32 V2 those numbers
// are unsafe:
//   - GPIO 1 is the boot-time UART0 TX (debug serial). Driving it as an
//     output stomps on `Serial`.
//   - GPIO 2 is a strapping pin (must read low at boot; also tied to the
//     onboard `NEOPIXEL_I2C_POWER` macro on this variant).
//
// Safe replacements picked for the Feather ESP32 V2:
//   - ENABLE_PIN  = GPIO 27. Regular GPIO, no strapping, no boot quirks,
//                    full output drive. ENABLE lives on 27 because
//                    `SPI_CS_PIN` (MCP2515 CS) now owns GPIO 14.
//   - REVERSE_PIN = GPIO 32 (silkscreen `A7` / `T9`). Regular GPIO,
//                    no strapping, no boot quirks, full output drive.
//
// Avoided GPIOs 0, 2, 4, 5, 12, 15 (strapping / boot mode / SPI SCK
// reservation / weak boot pull-ups). Avoided GPIOs 34-39 — those are
// input-only on the ESP32 classic and cannot source `digitalWrite()`.
//
// If the wired schematic mandates different pads, change these two lines
// — everything downstream uses the symbolic name.
static const int ENABLE_PIN  = 27;
static const int REVERSE_PIN = 32;

void IOHandler::setup()
{
    pinMode(ENABLE_PIN, OUTPUT);
    pinMode(REVERSE_PIN, OUTPUT);
}

void IOHandler::process(State::Data *data) {

    digitalWrite(ENABLE_PIN, data->selectedGear == State::Gear::NEUTRAL || data->selectedGear == State::Gear::REVERSE);
    digitalWrite(REVERSE_PIN, data->selectedGear == State::Gear::REVERSE);
}
