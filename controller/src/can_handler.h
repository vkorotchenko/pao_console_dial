
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
    void sendGearChange(State::Gear gear);

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
    void handle_609(CAN_FRAME *frame, State::Data *data);
    void handle_607(CAN_FRAME *frame, State::Data *data);
    void handle_charger_config1(CAN_FRAME *frame, State::Data *data);  // 0x18FFA0E5
    void handle_charger_config2(CAN_FRAME *frame, State::Data *data);  // 0x18FFA1E5
    void handle_charger_status(CAN_FRAME *frame, State::Data *data);   // 0x18FF50E5
    void sendChargeConfig(uint8_t cmd, uint16_t value);                 // → 0x18FF60F4
};


#endif /* CAN_HANDLER_H_ */