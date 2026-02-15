#ifndef I2C_HANDLER_H_
#define I2C_HANDLER_H_

#include <Arduino.h>
#include <Wire.h>
#include "global_state.h"

#define CONTROLLER_I2C_ADDRESS 7
#define I2C_UPDATE_INTERVAL 1000  // ms, configurable

class I2CHandler
{
public:
    void setup(int sdaPin, int sclPin);
    void process();  // Call this in loop() to handle periodic updates

private:
    unsigned long lastI2CUpdate = 0;

    void updateI2CData();
    void parseI2CState(uint8_t* buffer);
};

#endif /* I2C_HANDLER_H_ */
