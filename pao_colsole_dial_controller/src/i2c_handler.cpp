#include "i2c_handler.h"

void I2CHandler::setup()
{
     Wire.begin(7);
    Serial.begin(9600);
    Wire.onRequest(handleOnRequest);
}

void I2CHandler::process(State::Data *data) {
      Wire.requestFrom(8, 6);


    while (Wire.available()) {
        char c = Wire.read();
        Serial.print(c); 
    }

}

void I2CHandler::handleOnRequest() {
    Wire.write("hello");
}