#include "i2c_handler.h"

void I2CHandler::setup()
{
     Wire.begin(7);
    Serial.begin(9600);
    Wire.onRequest(handleOnRequest);
}

void I2CHandler::process(State::Data *data) {
      Wire.requestFrom(8, 1);


    while (Wire.available()) {
        char c = Wire.read();
        switch (c)
        {
        case '0':
            data->selectedGear = State::Gear::NEUTRAL;
            break;
        case '1':
            data->selectedGear = State::Gear::DRIVE;
            break;
        case '2':
            data->selectedGear = State::Gear::REVERSE;
            break;
        case '3':
            data->selectedGear = State::Gear::PARK;
            break;
        default:
            break;
        }
    }

}

void I2CHandler::handleOnRequest() {
    Wire.write("SEND DATA HERE");
}