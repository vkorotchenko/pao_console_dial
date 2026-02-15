#include "i2c_handler.h"

extern GlobalState &state;

void I2CHandler::setup(int sdaPin, int sclPin)
{
    Wire.begin(sdaPin, sclPin);
    Serial.println("I2C: Master initialized, controller address 7");
}

void I2CHandler::process()
{
    // Periodic I2C data exchange with controller
    if (millis() - lastI2CUpdate >= I2C_UPDATE_INTERVAL) {
        lastI2CUpdate = millis();
        updateI2CData();
    }
}

void I2CHandler::parseI2CState(uint8_t* buffer)
{
    // Validate checksum
    uint8_t checksum = 0;
    for (int i = 0; i < 47; i++) {
        checksum ^= buffer[i];
    }
    if (checksum != buffer[47]) {
        Serial.println("I2C: Checksum error");
        return;
    }

    // Validate protocol
    if (buffer[0] != 0x01 || buffer[1] != 0x01) {
        Serial.println("I2C: Invalid protocol");
        return;
    }

    // Parse data (big-endian)
    int16_t resSpeed = (buffer[2] << 8) | buffer[3];
    int16_t motorTemp = (buffer[4] << 8) | buffer[5];
    int16_t invTemp = (buffer[6] << 8) | buffer[7];
    int16_t torque = (buffer[8] << 8) | buffer[9];
    uint16_t voltage = (buffer[10] << 8) | buffer[11];
    int16_t current = (buffer[12] << 8) | buffer[13];
    uint8_t motorState = buffer[14];
    uint8_t statusFlags = buffer[15];

    float gpsLat, gpsLon, gpsSpeed, gpsAlt;
    memcpy(&gpsLat, &buffer[16], 4);
    memcpy(&gpsLon, &buffer[20], 4);
    memcpy(&gpsSpeed, &buffer[24], 4);
    memcpy(&gpsAlt, &buffer[28], 4);
    uint8_t gpsSats = buffer[32];

    // Update GlobalState (triggers screen re-render)
    state.setSpeed(resSpeed);
    state.setRpm(resSpeed);  // or calculate RPM if different
    state.setMotorTemp(motorTemp / 10);  // convert back from ×10
    state.setInverterTemp(invTemp / 10);
    state.setTorque(torque / 10);
    state.setDcVoltage(voltage / 10);
    state.setDcCurrent(current / 10);
    state.setMotorState(motorState);
    state.setIsRunning(statusFlags & 0x01);
    state.setIsFaulted(statusFlags & 0x02);
    state.setIsWarning(statusFlags & 0x04);
    state.setIsReady(statusFlags & 0x08);
    state.setGpsLatitude(gpsLat);
    state.setGpsLongitude(gpsLon);
    state.setGpsSpeed(gpsSpeed);
    state.setGpsAltitude(gpsAlt);
    state.setGpsSatellites(gpsSats);
    state.setGpsFixAvailable(statusFlags & 0x10);

    // Battery level calculation (could use voltage)
    int batteryPercent = map(voltage, 3000, 4200, 0, 100);  // adjust ranges
    state.setBatteryLevel(constrain(batteryPercent, 0, 100));

    Serial.print("I2C: Parsed - Speed: ");
    Serial.print(resSpeed);
    Serial.print(", Motor Temp: ");
    Serial.print(motorTemp / 10);
    Serial.print(", Voltage: ");
    Serial.println(voltage / 10);
}

void I2CHandler::updateI2CData()
{
    // Send gear change to controller
    uint8_t gearMessage[4];
    gearMessage[0] = 0x01;  // protocol version
    gearMessage[1] = 0x02;  // message type: gear command

    // Map gear enum to byte
    switch (state.getGear()) {
        case Gears::Gear::NEUTRAL: gearMessage[2] = 0; break;
        case Gears::Gear::DRIVE: gearMessage[2] = 1; break;
        case Gears::Gear::REVERSE: gearMessage[2] = 2; break;
        case Gears::Gear::PARK: gearMessage[2] = 3; break;
    }

    gearMessage[3] = gearMessage[0] ^ gearMessage[1] ^ gearMessage[2];

    Wire.beginTransmission(CONTROLLER_I2C_ADDRESS);
    Wire.write(gearMessage, 4);
    uint8_t error = Wire.endTransmission();

    if (error != 0) {
        Serial.print("I2C: Transmission error: ");
        Serial.println(error);
        return;
    }

    Serial.println("I2C: Requesting data from controller");

    // Request state data from controller
    uint8_t stateBuffer[48];
    int bytesReceived = Wire.requestFrom(CONTROLLER_I2C_ADDRESS, 48);

    if (bytesReceived == 48) {
        for (int i = 0; i < 48 && Wire.available(); i++) {
            stateBuffer[i] = Wire.read();
        }
        Serial.print("I2C: Received bytes: ");
        Serial.println(bytesReceived);
        parseI2CState(stateBuffer);
    } else {
        Serial.print("I2C: Expected 48 bytes, got ");
        Serial.println(bytesReceived);
        // Flush any remaining bytes
        while (Wire.available()) {
            Wire.read();
        }
    }
}
