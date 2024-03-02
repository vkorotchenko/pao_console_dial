#ifndef IO_HANDLER_H_
#define IO_HANDLER_H_

#include <Arduino.h>
#include "global_state.h"

class IOHandler {

  public:
    void setup();
    void process(State::Data *data);
};
#endif //IO_HANDLER_H_