
#ifndef I2C_HANDLER_H
#define I2C_HANDLER_H

#include <Arduino.h>
#include <Wire.h>
#include "global_state.h"


class I2CHandler
{
public:
    void setup();
    void process(State::Data *data);

protected:
private:  
    static void handleOnRequest();
};


#endif /* I2C_HANDLER_H */