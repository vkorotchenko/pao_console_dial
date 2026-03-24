#define BUFFER_LENGTH 64  // Increase I2C buffer from default 32

#include "i2c_handler.h"
#include <Wire.h>

// Initialize static state pointer
State::Data* I2CHandler::statePtr = nullptr;

void I2CHandler::setup(State::Data *data)
{
    statePtr = data;
    Wire.begin(7);  // I2C slave address 7
    Wire.onRequest(handleOnRequest);
    Wire.onReceive(handleOnReceive);
    Serial.println("I2C: Slave initialized on address 7");
}

void I2CHandler::process(State::Data *data) {
    // Process method is now empty - all I2C communication happens via callbacks
    // This could be removed or used for periodic tasks if needed
}

void I2CHandler::handleOnRequest() {
    if (!statePtr) {
        Serial.println("I2C: Error - statePtr is null");
        return;
    }

    Serial.println("I2C: Sending state data");

    uint8_t buffer[58] = {0};
    buffer[0] = 0x01;  // protocol version
    buffer[1] = 0x01;  // message type: full state

    // Pack data (big-endian)
    buffer[2] = (statePtr->resSpeed >> 8) & 0xFF;
    buffer[3] = statePtr->resSpeed & 0xFF;
    buffer[4] = (statePtr->resMotorTemp >> 8) & 0xFF;
    buffer[5] = statePtr->resMotorTemp & 0xFF;
    buffer[6] = (statePtr->resInvTemp >> 8) & 0xFF;
    buffer[7] = statePtr->resInvTemp & 0xFF;
    buffer[8] = (statePtr->resTorque >> 8) & 0xFF;
    buffer[9] = statePtr->resTorque & 0xFF;
    buffer[10] = (statePtr->resDcVolt >> 8) & 0xFF;
    buffer[11] = statePtr->resDcVolt & 0xFF;
    buffer[12] = (statePtr->resDcCurrent >> 8) & 0xFF;
    buffer[13] = statePtr->resDcCurrent & 0xFF;
    buffer[14] = statePtr->resState;

    // Status flags
    buffer[15] = (statePtr->isRunning ? 0x01 : 0) |
                 (statePtr->isFaulted ? 0x02 : 0) |
                 (statePtr->isWarning ? 0x04 : 0) |
                 (statePtr->isReady ? 0x08 : 0) |
                 (statePtr->gpsFixAvailable ? 0x10 : 0) |
                 (statePtr->preChargeReady ? 0x20 : 0) |
                 (statePtr->canConnected ? 0x40 : 0);

    // GPS data (floats as raw bytes)
    memcpy(&buffer[16], &statePtr->gpsLatitude, 4);
    memcpy(&buffer[20], &statePtr->gpsLongitude, 4);
    memcpy(&buffer[24], &statePtr->gpsSpeed, 4);
    memcpy(&buffer[28], &statePtr->gpsAltitude, 4);
    buffer[32] = statePtr->gpsSatellites;

    // GPS date/time (bytes 33-38)
    buffer[33] = statePtr->gpsHour;
    buffer[34] = statePtr->gpsMinute;
    buffer[35] = statePtr->gpsSecond;
    buffer[36] = statePtr->gpsDay;
    buffer[37] = statePtr->gpsMonth;
    buffer[38] = statePtr->gpsYear;
    // Charge data (bytes 39-46)
    buffer[39] = statePtr->chargePercent;
    buffer[40] = statePtr->chargeErrorState;
    buffer[41] = (statePtr->chargeMaxCurrent >> 8) & 0xFF;
    buffer[42] = statePtr->chargeMaxCurrent & 0xFF;
    buffer[43] = (statePtr->chargeTargetVoltage >> 8) & 0xFF;
    buffer[44] = statePtr->chargeTargetVoltage & 0xFF;
    buffer[45] = (statePtr->chargeMaxTime >> 8) & 0xFF;
    buffer[46] = statePtr->chargeMaxTime & 0xFF;
    buffer[47] = (statePtr->chargeActualVoltage >> 8) & 0xFF;
    buffer[48] = statePtr->chargeActualVoltage & 0xFF;
    buffer[49] = (statePtr->chargeActualCurrent >> 8) & 0xFF;
    buffer[50] = statePtr->chargeActualCurrent & 0xFF;
    buffer[51] = (statePtr->chargeNomVoltage >> 8) & 0xFF;
    buffer[52] = statePtr->chargeNomVoltage & 0xFF;
    buffer[53] = (statePtr->chargeMaxMult >> 8) & 0xFF;
    buffer[54] = statePtr->chargeMaxMult & 0xFF;
    buffer[55] = statePtr->chargeMinMult;
    buffer[56] = statePtr->chargeAutoNominal;

    // Calculate checksum
    uint8_t checksum = 0;
    for (int i = 0; i < 57; i++) {
        checksum ^= buffer[i];
    }
    buffer[57] = checksum;

    Wire.write(buffer, 58);
}

void I2CHandler::handleOnReceive(int numBytes) {
    if (!statePtr) {
        Serial.println("I2C: Error - statePtr is null in receive");
        // Flush the buffer
        while (Wire.available()) Wire.read();
        return;
    }

    if (numBytes != 4 && numBytes != 8) {
        Serial.print("I2C: Invalid message size: ");
        Serial.println(numBytes);
        // Flush the buffer
        while (Wire.available()) Wire.read();
        return;
    }

    uint8_t buffer[8] = {0};
    for (int i = 0; i < numBytes && Wire.available(); i++) {
        buffer[i] = Wire.read();
    }

    // Validate checksum (XOR of all bytes except last)
    uint8_t checksum = 0;
    for (int i = 0; i < numBytes - 1; i++) checksum ^= buffer[i];
    if (checksum != buffer[numBytes - 1]) {
        Serial.println("I2C: Checksum error");
        return;
    }

    // Validate protocol version
    if (buffer[0] != 0x01) {
        Serial.println("I2C: Invalid protocol version");
        return;
    }

    if (buffer[1] == 0x02) {
        // Gear command (4 or 8 bytes)
        State::Gear oldGear = statePtr->selectedGear;
        switch (buffer[2]) {
            case 0: statePtr->selectedGear = State::Gear::NEUTRAL; break;
            case 1: statePtr->selectedGear = State::Gear::DRIVE;   break;
            case 2: statePtr->selectedGear = State::Gear::REVERSE; break;
            case 3: statePtr->selectedGear = State::Gear::PARK;    break;
            default:
                Serial.println("I2C: Invalid gear value");
                return;
        }
        Serial.print("I2C: Received gear change: ");
        switch (statePtr->selectedGear) {
            case State::Gear::NEUTRAL: Serial.println("NEUTRAL"); break;
            case State::Gear::DRIVE:   Serial.println("DRIVE");   break;
            case State::Gear::REVERSE: Serial.println("REVERSE"); break;
            case State::Gear::PARK:    Serial.println("PARK");    break;
        }
        // Gear change will be detected by CAN handler which checks for changes
    } else if (buffer[1] == 0x03 && numBytes == 8) {
        // Charge config command
        uint8_t cmd = buffer[2];
        uint16_t value = ((uint16_t)buffer[3] << 8) | buffer[4];
        statePtr->pendingChargeCmd = cmd;
        statePtr->pendingChargeValue = value;
        Serial.print("I2C: Received charge config cmd=");
        Serial.print(cmd);
        Serial.print(" value=");
        Serial.println(value);
    } else {
        Serial.println("I2C: Unknown message type");
    }
}
