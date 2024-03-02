#include "can_handler.h"

mcp2515_can CAN(SPI_CS_PIN); // Set CS pin


/*
 * Initialization of the CAN bus
 */
void CanHandler::setup()
{
    while (CAN_OK != CAN.begin(16)) // TODO move to config
    {
        SERIAL_PORT_MONITOR.println("CAN init fail, retry...");
        delay(200);
    }
}

/*
 * If a message is available, read it and forward it to registered observers.
 */
void CanHandler::process(State::Data *data) {
    static CAN_FRAME frame;

    unsigned char len = 8;
    unsigned char buf[8];

    if (CAN_MSGAVAIL == CAN.checkReceive())
    {
        CAN.readMsgBuf(&len, buf); 
        frame.length = (uint8_t)len;
        for (int i = 0; i < len; i++)
        {
            frame.data.bytes[i] = uint8_t(buf[i]);
        }
        frame.id = CAN.getCanId();
        frame.extended = (bool)CAN.isExtendedFrame();
        frame.rtr = CAN.isRemoteRequest();

        switch (frame.id) { 
            case 0x650:
                CanHandler::handle_650(&frame, data);
                break;
            case 0x651:
                CanHandler::handle_651(&frame, data);
                break;
            case 0x23A:
                CanHandler::handle_23A(&frame, data);
                break;
            case 0x23B:
                CanHandler::handle_23B(&frame, data);
                break;   
            case 0x232:
                CanHandler::handle_232(&frame, data);
                break;
            case 0x233:
                CanHandler::handle_233(&frame, data);
                break;   
            case 0x234:
                CanHandler::handle_234(&frame, data);
                break;
            case 0x235:
                CanHandler::handle_235(&frame, data);
                break;   
            case 0x236: 
                CanHandler::handle_236(&frame, data);
                break;
        }
    }
}

void CanHandler::handle_651(CAN_FRAME *frame, State::Data *data)
{
    uint8_t rotorTemp = frame->data.bytes[0];
    uint8_t invTemp = frame->data.bytes[1];
    uint8_t statorTemp = frame->data.bytes[2];
    uint8_t temperatureInverter = (invTemp-40) *10;
    uint8_t temperatureMotor; 

    //now pick highest of motor temps and report it
    if (rotorTemp > statorTemp) {
        temperatureMotor = (rotorTemp - 40) * 10;
    }
    else {
        temperatureMotor = (statorTemp - 40) * 10;
    }
    data->resMotorTemp = temperatureMotor;
    data->resInvTemp = temperatureInverter;
}

void CanHandler::handle_23A(CAN_FRAME *frame, State::Data *data)
{
    uint8_t torqueActual = ((frame->data.bytes[0] * 256) + frame->data.bytes[1]) - 30000;
    data->resTorque = torqueActual;
}

void CanHandler::handle_23B(CAN_FRAME *frame, State::Data *data)
{
        uint8_t speedActual = abs(((frame->data.bytes[0] * 256) + frame->data.bytes[1]) - 20000);
        uint8_t reportedState = (frame->data.bytes[6] >> 4);
        
        enum State {
            DISABLED = 0,
            STANDBY = 1,
            ENABLE = 2,
            POWERDOWN = 3
        };

        State actualState = DISABLED;
        bool faulted = false;
        bool ready;

        switch (reportedState) {

        case 0: //Initializing
            actualState = DISABLED;
            faulted=false;
            break;

        case 1: //disabled
            actualState = DISABLED;
            faulted=false;
            break;

        case 2: //ready (standby)
            actualState = STANDBY;
            faulted=false;
            ready = true;
            break;

        case 3: //enabled
            actualState = ENABLE;
            faulted=false;
            break;

        case 4: //Power Down
            actualState = POWERDOWN;
            faulted=false;
            break;

        case 5: //Fault
            actualState = DISABLED;
            faulted=true;
            break;

        case 6: //Critical Fault
            actualState = DISABLED;
            faulted=true;
            break;

        case 7: //LOS
            actualState = DISABLED;
            faulted=true;
            break;
        }

        data->resSpeed = speedActual;
        data->resState = actualState;
        data->isFaulted = faulted;
        data->isReady = ready;
}

void CanHandler::handle_650(CAN_FRAME *frame, State::Data *data)
{
        uint8_t dcVoltage = ((frame->data.bytes[0] * 256) + frame->data.bytes[1]);
        uint8_t dcCurrent = ((frame->data.bytes[2] * 256) + frame->data.bytes[3]) - 5000; //offset is 500A, unit = .1A

        data->resDcVolt = dcVoltage;
        data->resDcCurrent = dcCurrent;
}

void CanHandler::handle_232(CAN_FRAME *frame, State::Data *data)
{
        uint8_t requestedSpeed = (frame->data.bytes[0] * 256) + frame->data.bytes[1]; // do we need to abs and adjuest : abs(((frame->data.bytes[0] * 256) + frame->data.bytes[1]) - 20000);
        uint8_t requestedState = (frame->data.bytes[6] >> 6);
        uint8_t requestedGear = (frame->data.bytes[6] >> 4);
        data -> reqSpeed = requestedSpeed;
        data -> reqState = requestedState;
        data -> reqGear = requestedGear;
}

void CanHandler::handle_233(CAN_FRAME *frame, State::Data *data)
{
    uint8_t torqueRequested = (frame->data.bytes[0] * 256) + frame->data.bytes[1];
    uint8_t torqueLimit= (frame->data.bytes[2] * 256) + frame->data.bytes[3];
    data->reqTorque = torqueRequested;
    data->reqLimit = torqueLimit;
}

void CanHandler::handle_234(CAN_FRAME *frame, State::Data *data)
{
    uint8_t regenLimitRequested = (frame->data.bytes[0] * 256) + frame->data.bytes[1];
    uint8_t accLimitRequested= (frame->data.bytes[2] * 256) + frame->data.bytes[3];
    data->reqRegen = regenLimitRequested;
    data->reqAccel = accLimitRequested;
}

void CanHandler::handle_235(CAN_FRAME *frame, State::Data *data)
{
}

void CanHandler::handle_236(CAN_FRAME *frame, State::Data *data)
{
    //u_int8_t selectedGear = frame->data.bytes[5];
}
