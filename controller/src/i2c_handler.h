
#ifndef I2C_HANDLER_H
#define I2C_HANDLER_H

#include <Arduino.h>
#include <Wire.h>
#include "global_state.h"


class I2CHandler
{
public:
    void setup(State::Data *data);
    void process(State::Data *data);

protected:
private:
    static State::Data* statePtr;
    static void handleOnRequest();
    static void handleOnReceive(int numBytes);
};


#endif /* I2C_HANDLER_H */