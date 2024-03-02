
#ifndef CAN_HANDLER_H_
#define CAN_HANDLER_H_

#include <Arduino.h>
#include "can_common.h"
#include "mcp2515_can.h"
#include "global_state.h"

#define SPI_CS_PIN 5

class CanHandler
{
public:
    void setup();
    void process(State::Data *data);

protected:
private:  
    void handle_651(CAN_FRAME *frame, State::Data *data);
    void handle_23A(CAN_FRAME *frame, State::Data *data);
    void handle_23B(CAN_FRAME *frame, State::Data *data);
    void handle_650(CAN_FRAME *frame, State::Data *data);
    void handle_232(CAN_FRAME *frame, State::Data *data);
    void handle_233(CAN_FRAME *frame, State::Data *data);
    void handle_234(CAN_FRAME *frame, State::Data *data);
    void handle_235(CAN_FRAME *frame, State::Data *data);
    void handle_236(CAN_FRAME *frame, State::Data *data);
};


#endif /* CAN_HANDLER_H_ */