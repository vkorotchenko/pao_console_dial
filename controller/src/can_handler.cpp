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
            case 0x609:
                CanHandler::handle_609(&frame, data);
                break;
            case 0x607:
                CanHandler::handle_607(&frame, data);
                break;
            case 0x18FFA0E5:
                CanHandler::handle_charger_config1(&frame, data);
                break;
            case 0x18FFA1E5:
                CanHandler::handle_charger_config2(&frame, data);
                break;
            case 0x18FF50E5:
                CanHandler::handle_charger_status(&frame, data);
                break;
        }

        // Update timestamp to track data freshness
        data->lastCanMessageTime = millis();
        data->canConnected = true;
    }

    // Dispatch pending charge config command from peripheral
    if (data->pendingChargeCmd != 0) {
        sendChargeConfig(data->pendingChargeCmd, data->pendingChargeValue);
        data->pendingChargeCmd = 0;
        data->pendingChargeValue = 0;
    }

    // Send gear command on change AND periodically (every 1s)
    static State::Gear lastGear = State::Gear::NEUTRAL;
    static unsigned long lastGearSendTime = 0;
    bool gearChanged = (data->selectedGear != lastGear);
    if (gearChanged || (millis() - lastGearSendTime >= 1000)) {
        sendGearChange(data->selectedGear);
        lastGear = data->selectedGear;
        lastGearSendTime = millis();
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

// Digital output command values per DMOC 0x606 protocol
static const unsigned char DO_NO_CHANGE = 0x00;  // Don't disturb this output
static const unsigned char DO_HIGH      = 0x88;  // Set output to 1 (HIGH)
static const unsigned char DO_LOW       = 0xFF;  // Set output to 0 (LOW)

void CanHandler::sendGearChange(State::Gear gear) {
    unsigned char buf[8] = {
        DO_NO_CHANGE, DO_NO_CHANGE, DO_NO_CHANGE, DO_NO_CHANGE,
        DO_NO_CHANGE, DO_NO_CHANGE, DO_NO_CHANGE, DO_NO_CHANGE
    };

    switch (gear) {
        case State::Gear::NEUTRAL:
            buf[5] = DO_LOW;
            buf[6] = DO_LOW;
            buf[7] = DO_LOW;
            break;

        case State::Gear::DRIVE:
            buf[6] = DO_LOW;
            buf[7] = DO_HIGH;
            break;

        case State::Gear::REVERSE:
            buf[6] = DO_HIGH;
            buf[7] = DO_LOW;
            break;

        case State::Gear::PARK:
            buf[5] = DO_LOW;
            buf[6] = DO_LOW;
            buf[7] = DO_LOW;
            break;
    }

    CAN.sendMsgBuf(0x606, 0, 0, 8, buf);

    // Debug output with all relevant bytes
    Serial.print("CAN: Sending 0x606, bytes[5-7]: ");
    Serial.print(buf[5], HEX);
    Serial.print(" ");
    Serial.print(buf[6], HEX);
    Serial.print(" ");
    Serial.print(buf[7], HEX);
    Serial.print(" (");
    switch (gear) {
        case State::Gear::NEUTRAL: Serial.print("NEUTRAL"); break;
        case State::Gear::DRIVE: Serial.print("DRIVE"); break;
        case State::Gear::REVERSE: Serial.print("REVERSE"); break;
        case State::Gear::PARK: Serial.print("PARK"); break;
    }
    Serial.println(")");
}

void CanHandler::handle_609(CAN_FRAME *frame, State::Data *data) {
    // Process confirmation message from 0x609
    // Could store confirmation status if needed
    Serial.println("CAN: Received 0x609 confirmation");
}

void CanHandler::handle_charger_config1(CAN_FRAME *frame, State::Data *data) {
    // 0x18FFA0E5: bytes 0-1 = maxCurrent, bytes 2-3 = maxMult (×100), bytes 4-5 = nomVoltage, bytes 6-7 = targetVoltage
    data->chargeMaxCurrent    = ((uint16_t)frame->data.bytes[0] << 8) | frame->data.bytes[1];
    data->chargeMaxMult       = ((uint16_t)frame->data.bytes[2] << 8) | frame->data.bytes[3];
    data->chargeNomVoltage    = ((uint16_t)frame->data.bytes[4] << 8) | frame->data.bytes[5];
    data->chargeTargetVoltage = ((uint16_t)frame->data.bytes[6] << 8) | frame->data.bytes[7];
    Serial.print("CAN: Charger config1 - maxCurrent: ");
    Serial.print(data->chargeMaxCurrent);
    Serial.print(", nomVoltage: ");
    Serial.print(data->chargeNomVoltage);
    Serial.print(", targetVoltage: ");
    Serial.println(data->chargeTargetVoltage);
}

void CanHandler::handle_charger_config2(CAN_FRAME *frame, State::Data *data) {
    // 0x18FFA1E5: byte 0 = targetPercentage, byte 1 = errorState,
    //             bytes 4-5 = maxChargeTime, byte 6 = minMult (×100), byte 7 = autoNominal
    data->chargePercent     = frame->data.bytes[0];
    data->chargeErrorState  = frame->data.bytes[1];
    data->chargeMaxTime     = ((uint16_t)frame->data.bytes[4] << 8) | frame->data.bytes[5];
    data->chargeMinMult     = frame->data.bytes[6];
    data->chargeAutoNominal = frame->data.bytes[7];
    Serial.print("CAN: Charger config2 - chargePercent: ");
    Serial.print(data->chargePercent);
    Serial.print(", errorState: ");
    Serial.print(data->chargeErrorState);
    Serial.print(", maxTime: ");
    Serial.println(data->chargeMaxTime);
}

void CanHandler::handle_charger_status(CAN_FRAME *frame, State::Data *data) {
    // 0x18FF50E5: bytes 0-1 = actualVoltage (1/10th V), bytes 2-3 = actualCurrent (1/10th A)
    data->chargeActualVoltage = ((uint16_t)frame->data.bytes[0] << 8) | frame->data.bytes[1];
    data->chargeActualCurrent = ((uint16_t)frame->data.bytes[2] << 8) | frame->data.bytes[3];
}

void CanHandler::sendChargeConfig(uint8_t cmd, uint16_t value) {
    unsigned char buf[8] = {cmd, 0x00, (unsigned char)(value >> 8), (unsigned char)(value & 0xFF), 0x00, 0x00, 0x00, 0x00};
    CAN.sendMsgBuf(0x18FF60F4, 1, 0, 8, buf);
    Serial.print("CAN: Sent charge config cmd=");
    Serial.print(cmd);
    Serial.print(" value=");
    Serial.println(value);
}

void CanHandler::handle_607(CAN_FRAME *frame, State::Data *data) {
    // Byte[1] represents pre-charge contactor ready status
    // 0x88 = HIGH/Ready, 0xFF = LOW/Not Ready
    uint8_t preChargeStatus = frame->data.bytes[1];

    // Set ready if byte is 0x88 (HIGH)
    data->preChargeReady = (preChargeStatus == 0x88);

    // Debug output
    Serial.print("CAN: Received 0x607, pre-charge ready: ");
    Serial.println(data->preChargeReady ? "YES (0x88)" : "NO (0xFF)");
}
