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
    for (int i = 0; i < 57; i++) {
        checksum ^= buffer[i];
    }
    if (checksum != buffer[57]) {
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

    // GPS date/time (bytes 33-38)
    uint8_t gpsHour = buffer[33];
    uint8_t gpsMinute = buffer[34];
    uint8_t gpsSecond = buffer[35];
    uint8_t gpsDay = buffer[36];
    uint8_t gpsMonth = buffer[37];
    uint8_t gpsYear = buffer[38];

    // Update GlobalState (triggers screen re-render)
    state.setSpeed(gpsSpeed);  // GPS speed in knots — getSpeed() converts to km/h or mph
    state.setRpm(resSpeed);    // CAN motor speed
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
    state.setPreChargeReady(statusFlags & 0x20);
    state.setCanConnected(statusFlags & 0x40);
    state.setGpsHour(gpsHour);
    state.setGpsMinute(gpsMinute);
    state.setGpsSecond(gpsSecond);
    state.setGpsDay(gpsDay);
    state.setGpsMonth(gpsMonth);
    state.setGpsYear(gpsYear);

    // Charge data (bytes 39-46)
    state.setChargePercentage(buffer[39]);
    state.setChargeErrorState(buffer[40]);
    uint16_t chargeMaxA = ((uint16_t)buffer[41] << 8) | buffer[42];
    state.setRequestedAmps(chargeMaxA / 10.0f);
    uint16_t tgtV = ((uint16_t)buffer[43] << 8) | buffer[44];
    state.setTargetVoltage(tgtV / 10.0f);
    uint16_t chargeMaxTime = ((uint16_t)buffer[45] << 8) | buffer[46];
    state.setChargeMaxTime(chargeMaxTime);

    // Extended charge fields (bytes 47-56)
    uint16_t chargeActualV  = ((uint16_t)buffer[47] << 8) | buffer[48];
    uint16_t chargeActualA  = ((uint16_t)buffer[49] << 8) | buffer[50];
    uint16_t chargeNomV     = ((uint16_t)buffer[51] << 8) | buffer[52];
    uint16_t chargeMaxMult  = ((uint16_t)buffer[53] << 8) | buffer[54];
    uint8_t  chargeMinMult  = buffer[55];
    uint8_t  chargeAutoNom  = buffer[56];

    state.setCurrentVoltage(chargeActualV / 10.0f);
    state.updateChargerNominalVoltage((int)chargeNomV);
    state.updateChargerMaxMultiplier((int)chargeMaxMult);
    state.updateChargerMinMultiplier((int)chargeMinMult);
    state.updateChargerAutoNominal(chargeAutoNom != 0);

    // Battery level calculation (could use voltage)
    int batteryPercent = map(voltage, 3000, 4200, 0, 100);  // adjust ranges
    state.setBatteryLevel(constrain(batteryPercent, 0, 100));

    // Check if the charger has confirmed a pending config change via its CAN broadcast
    if (state.getPendingChargeCmd() != 0) {
        uint8_t cmd = state.getPendingChargeCmd();
        uint16_t expected = state.getPendingChargeValue();
        bool confirmed = false;
        switch (cmd) {
            case 3:  // set_amps: expected is 1/10th A
                confirmed = (chargeMaxA == expected);
                break;
            case 2:  // set_target_pct: expected is pct*10 (e.g. 950), chargePercent is 0-100
                confirmed = (buffer[39] == (uint8_t)(expected / 10));
                break;
            case 1:  // set_max_time: expected is seconds
                confirmed = (chargeMaxTime == expected);
                break;
            case 4:  // set_nominal_voltage: expected is 1/10th V
                confirmed = (chargeNomV == expected);
                break;
            case 5:  // set_nominal_max_mult: expected is ×100
                confirmed = (chargeMaxMult == expected);
                break;
            case 6:  // set_nominal_min_mult: expected is ×100
                confirmed = ((uint16_t)chargeMinMult == expected);
                break;
            case 7:  // set_auto_nominal: expected is 0 or 1
                confirmed = ((uint16_t)chargeAutoNom == expected);
                break;
        }
        if (confirmed) {
            Serial.println("I2C: Charge config confirmed by charger broadcast");
            state.clearPendingChargeCmd();
        }
    }

    Serial.print("I2C: Parsed - Speed: ");
    Serial.print(resSpeed);
    Serial.print(", Motor Temp: ");
    Serial.print(motorTemp / 10);
    Serial.print(", Voltage: ");
    Serial.println(voltage / 10);
}

void I2CHandler::updateI2CData()
{
    // Build 8-byte message: gear command or charge config command
    uint8_t msg[8] = {0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};

    // Expire stale pending command (no confirmation after 30s)
    if (state.isPendingChargeExpired()) {
        Serial.println("I2C: Charge config timed out, clearing");
        state.clearPendingChargeCmd();
    }

    if (state.getPendingChargeCmd() != 0) {
        // Charge config command — keep resending until confirmed via CAN broadcast
        msg[1] = 0x03;
        msg[2] = state.getPendingChargeCmd();
        uint16_t val = state.getPendingChargeValue();
        msg[3] = (val >> 8) & 0xFF;
        msg[4] = val & 0xFF;
        // Do NOT clear here — clearPendingChargeCmd() is called in parseI2CState
        // once the charger confirms the new value via its CAN broadcast
    } else {
        // Gear command
        msg[1] = 0x02;
        switch (state.getGear()) {
            case Gears::Gear::NEUTRAL: msg[2] = 0; break;
            case Gears::Gear::DRIVE:   msg[2] = 1; break;
            case Gears::Gear::REVERSE: msg[2] = 2; break;
            case Gears::Gear::PARK:    msg[2] = 3; break;
        }
    }

    // XOR checksum of bytes 0-6
    uint8_t cs = 0;
    for (int i = 0; i < 7; i++) cs ^= msg[i];
    msg[7] = cs;

    Wire.beginTransmission(CONTROLLER_I2C_ADDRESS);
    Wire.write(msg, 8);
    uint8_t error = Wire.endTransmission();

    if (error != 0) {
        Serial.print("I2C: Transmission error: ");
        Serial.println(error);
        return;
    }

    Serial.println("I2C: Requesting data from controller");

    // Request state data from controller
    uint8_t stateBuffer[58];
    int bytesReceived = Wire.requestFrom(CONTROLLER_I2C_ADDRESS, 58);

    if (bytesReceived == 58) {
        for (int i = 0; i < 58 && Wire.available(); i++) {
            stateBuffer[i] = Wire.read();
        }
        Serial.print("I2C: Received bytes: ");
        Serial.println(bytesReceived);
        parseI2CState(stateBuffer);
    } else {
        Serial.print("I2C: Expected 58 bytes, got ");
        Serial.println(bytesReceived);
        // Flush any remaining bytes
        while (Wire.available()) {
            Wire.read();
        }
    }
}
