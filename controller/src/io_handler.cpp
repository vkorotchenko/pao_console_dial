#include "io_handler.h"

int ENABLE_PIN = 1;
int REVERSE_PIN = 2;

void IOHandler::setup()
{
    pinMode(ENABLE_PIN, OUTPUT);
    pinMode(REVERSE_PIN, OUTPUT);
}

void IOHandler::process(State::Data *data) {

    digitalWrite(ENABLE_PIN, data->selectedGear == State::Gear::NEUTRAL || data->selectedGear == State::Gear::REVERSE);
    digitalWrite(REVERSE_PIN, data->selectedGear == State::Gear::REVERSE);
}