#include "pao_ble.h"

// Big-endian helpers
static inline void write_uint16_be(uint8_t* buf, uint16_t val) {
    buf[0] = (val >> 8) & 0xFF;
    buf[1] = val & 0xFF;
}

static inline void write_int16_be(uint8_t* buf, int16_t val) {
    write_uint16_be(buf, (uint16_t)val);
}

static inline void write_float_be(uint8_t* buf, float val) {
    uint32_t bits;
    memcpy(&bits, &val, 4);
    buf[0] = (bits >> 24) & 0xFF;
    buf[1] = (bits >> 16) & 0xFF;
    buf[2] = (bits >> 8) & 0xFF;
    buf[3] = bits & 0xFF;
}

static inline uint16_t read_uint16_be(const uint8_t* buf) {
    return ((uint16_t)buf[0] << 8) | buf[1];
}

PaoBleService& PaoBleService::getInstance() {
    static PaoBleService instance;
    return instance;
}

void PaoBleService::begin() {
    NimBLEDevice::init("PAO Console");
    NimBLEDevice::setSecurityAuth(BLE_SM_PAIR_AUTHREQ_BOND);  // Just Works + bonding

    _pServer = NimBLEDevice::createServer();
    _pServer->setCallbacks(this);

    // Create PAO service
    NimBLEService* paoService = _pServer->createService(PAO_SERVICE_UUID);

    // Telemetry characteristic (Read + Notify, no encryption)
    _telemetryChar = paoService->createCharacteristic(
        PAO_TELEMETRY_CHAR_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
    );

    // Gear characteristic (Write with response, encrypted)
    _gearChar = paoService->createCharacteristic(
        PAO_GEAR_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE_ENC
    );
    _gearChar->setCallbacks(&_gearCallbacks);

    // Charger config (Read + Write encrypted + Notify)
    _chargerChar = paoService->createCharacteristic(
        PAO_CHARGER_CHAR_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::NOTIFY
    );
    _chargerChar->setCallbacks(&_chargerCallbacks);

    paoService->start();

    // Start advertising
    NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(PAO_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->start();

    Serial.println("PAO BLE: Service started, advertising as 'PAO Console'");
}

void PaoBleService::onConnect(NimBLEServer* pServer) {
    _connected = true;
    Serial.println("PAO BLE: Client connected");
}

void PaoBleService::onDisconnect(NimBLEServer* pServer) {
    _connected = false;
    Serial.println("PAO BLE: Client disconnected, restarting advertising");
    NimBLEDevice::startAdvertising();
}

bool PaoBleService::isConnected() const {
    return _connected;
}

void PaoBleService::GearCallbacks::onWrite(NimBLECharacteristic* pCharacteristic) {
    std::string value = pCharacteristic->getValue();
    
    if (value.length() != 1) {
        Serial.println("PAO BLE: Invalid gear command length");
        return;
    }

    uint8_t gearByte = (uint8_t)value[0];
    
    // Validate gear value (0-3)
    if (gearByte > 3) {
        Serial.print("PAO BLE: Invalid gear value: ");
        Serial.println(gearByte);
        return;
    }

    // Map to Gears::Gear enum
    Gears::Gear newGear;
    switch (gearByte) {
        case 0: newGear = Gears::Gear::NEUTRAL; break;
        case 1: newGear = Gears::Gear::DRIVE; break;
        case 2: newGear = Gears::Gear::REVERSE; break;
        case 3: newGear = Gears::Gear::PARK; break;
        default: return;  // Should not reach here
    }

    GlobalState::getInstance().setGear(newGear);
    
    Serial.print("PAO BLE: Gear changed to ");
    Serial.println(gearByte);
}

void PaoBleService::ChargerCallbacks::onRead(NimBLECharacteristic* pCharacteristic) {
    uint8_t buffer[12];
    GlobalState& state = GlobalState::getInstance();

    // Pack 12-byte charger config
    write_uint16_be(&buffer[0], (uint16_t)(state.getTargetVoltage() * 10.0f));  // Target voltage
    write_uint16_be(&buffer[2], (uint16_t)(state.getRequestedAmps() * 10.0f)); // Max current
    buffer[4] = state.getChargePercentage();  // Target SOC %
    write_uint16_be(&buffer[5], state.getChargeMaxTime());  // Max charge time (seconds)
    write_uint16_be(&buffer[7], (uint16_t)(state.getCurrentVoltage() * 10.0f));  // Actual voltage (read-only)
    // Note: actual current is not tracked in GlobalState for charger, using 0
    write_uint16_be(&buffer[9], 0);  // Actual current (read-only)
    buffer[11] = state.getChargeErrorState();  // Error state (read-only)

    pCharacteristic->setValue(buffer, 12);
}

void PaoBleService::ChargerCallbacks::onWrite(NimBLECharacteristic* pCharacteristic) {
    std::string value = pCharacteristic->getValue();
    
    if (value.length() < 7) {
        Serial.println("PAO BLE: Invalid charger config write length");
        return;
    }

    const uint8_t* data = (const uint8_t*)value.data();
    GlobalState& state = GlobalState::getInstance();

    // Parse writable fields (first 7 bytes)
    uint16_t targetVoltage = read_uint16_be(&data[0]);  // V × 10
    uint16_t maxCurrent = read_uint16_be(&data[2]);     // A × 10
    uint8_t targetSOC = data[4];                        // 0-100%
    uint16_t maxTime = read_uint16_be(&data[5]);        // seconds

    // Dispatch each changed field via setPendingChargeCmd
    // Only queue one command at a time — prioritize in order received

    // Check target voltage (cmd 4 = set_nominal_voltage)
    uint16_t currentTargetV = (uint16_t)(state.getTargetVoltage() * 10.0f);
    if (targetVoltage != currentTargetV && state.getPendingChargeCmd() == 0) {
        state.setPendingChargeCmd(4, targetVoltage);
        Serial.print("PAO BLE: Queueing set_nominal_voltage = ");
        Serial.println(targetVoltage);
        return;  // Process one command per write
    }

    // Check max current (cmd 3 = set_amps)
    uint16_t currentMaxA = (uint16_t)(state.getRequestedAmps() * 10.0f);
    if (maxCurrent != currentMaxA && state.getPendingChargeCmd() == 0) {
        state.setPendingChargeCmd(3, maxCurrent);
        Serial.print("PAO BLE: Queueing set_amps = ");
        Serial.println(maxCurrent);
        return;
    }

    // Check target SOC (cmd 2 = set_target_pct)
    // Note: controller expects pct*10 (e.g., 95% → 950)
    if (targetSOC != state.getChargePercentage() && state.getPendingChargeCmd() == 0) {
        state.setPendingChargeCmd(2, targetSOC * 10);
        Serial.print("PAO BLE: Queueing set_target_pct = ");
        Serial.println(targetSOC);
        return;
    }

    // Check max time (cmd 1 = set_max_time)
    if (maxTime != state.getChargeMaxTime() && state.getPendingChargeCmd() == 0) {
        state.setPendingChargeCmd(1, maxTime);
        Serial.print("PAO BLE: Queueing set_max_time = ");
        Serial.println(maxTime);
        return;
    }

    Serial.println("PAO BLE: Charger config write complete (no changes or pending command)");
}

void PaoBleService::packTelemetry(uint8_t* buffer) {
    GlobalState& state = GlobalState::getInstance();

    // Byte 0: Schema version
    buffer[0] = 0x01;

    // Bytes 1-2: Speed (RPM)
    write_int16_be(&buffer[1], (int16_t)state.getRpm());

    // Bytes 3-4: Motor temp (°C × 10)
    write_int16_be(&buffer[3], (int16_t)(state.getMotorTemp() * 10));

    // Bytes 5-6: Inverter temp (°C × 10)
    write_int16_be(&buffer[5], (int16_t)(state.getInverterTemp() * 10));

    // Bytes 7-8: Torque (Nm × 10)
    write_int16_be(&buffer[7], (int16_t)(state.getTorque() * 10));

    // Bytes 9-10: DC Voltage (V × 10)
    write_uint16_be(&buffer[9], (uint16_t)(state.getDcVoltage() * 10));

    // Bytes 11-12: DC Current (A × 10)
    write_int16_be(&buffer[11], (int16_t)(state.getDcCurrent() * 10));

    // Byte 13: Motor state
    buffer[13] = (uint8_t)state.getMotorState();

    // Byte 14: Status flags
    uint8_t flags = 0;
    if (state.getIsRunning()) flags |= 0x01;
    if (state.getIsFaulted()) flags |= 0x02;
    if (state.getIsWarning()) flags |= 0x04;
    if (state.getIsReady()) flags |= 0x08;
    if (state.getGpsFixAvailable()) flags |= 0x10;
    if (state.getPreChargeReady()) flags |= 0x20;
    if (state.getCanConnected()) flags |= 0x40;
    buffer[14] = flags;

    // Byte 15: Gear
    switch (state.getGear()) {
        case Gears::Gear::NEUTRAL: buffer[15] = 0; break;
        case Gears::Gear::DRIVE:   buffer[15] = 1; break;
        case Gears::Gear::REVERSE: buffer[15] = 2; break;
        case Gears::Gear::PARK:    buffer[15] = 3; break;
        default: buffer[15] = 0; break;
    }

    // Bytes 16-19: GPS Latitude (float, big-endian)
    write_float_be(&buffer[16], state.getGpsLatitude());

    // Bytes 20-23: GPS Longitude (float, big-endian)
    write_float_be(&buffer[20], state.getGpsLongitude());

    // Bytes 24-27: GPS Speed (km/h) — already converted by getGpsSpeed()
    write_float_be(&buffer[24], state.getGpsSpeed());

    // Bytes 28-31: GPS Altitude (m)
    write_float_be(&buffer[28], state.getGpsAltitude());

    // Byte 32: GPS Satellites
    buffer[32] = (uint8_t)state.getGpsSatellites();

    // Byte 33: Charge percentage
    buffer[33] = (uint8_t)state.getChargePercentage();

    // Byte 34: Charge error state
    buffer[34] = state.getChargeErrorState();

    // Byte 35: Charge state
    buffer[35] = (uint8_t)state.getChargeState();
}

void PaoBleService::packChargerConfig(uint8_t* buffer) {
    GlobalState& state = GlobalState::getInstance();

    write_uint16_be(&buffer[0], (uint16_t)(state.getTargetVoltage() * 10.0f));
    write_uint16_be(&buffer[2], (uint16_t)(state.getRequestedAmps() * 10.0f));
    buffer[4] = state.getChargePercentage();
    write_uint16_be(&buffer[5], state.getChargeMaxTime());
    write_uint16_be(&buffer[7], (uint16_t)(state.getCurrentVoltage() * 10.0f));
    write_uint16_be(&buffer[9], 0);  // Actual current not tracked for charger
    buffer[11] = state.getChargeErrorState();
}

void PaoBleService::notifyTelemetry() {
    if (!_connected || !_telemetryChar) {
        return;
    }

    if (_telemetryChar->getSubscribedCount() == 0) {
        return;
    }

    uint8_t buffer[36];
    packTelemetry(buffer);
    _telemetryChar->notify(buffer, 36);
}

void PaoBleService::notifyChargerIfChanged() {
    if (!_connected || !_chargerChar) {
        return;
    }

    if (_chargerChar->getSubscribedCount() == 0) {
        return;
    }

    GlobalState& state = GlobalState::getInstance();
    uint16_t actualV = (uint16_t)(state.getCurrentVoltage() * 10.0f);
    uint16_t actualA = 0;  // Not tracked for charger
    uint8_t error = state.getChargeErrorState();

    // Check if values changed since last notify
    if (!_chargerNotifyInitialized || 
        actualV != _lastChargerActualV ||
        actualA != _lastChargerActualA ||
        error != _lastChargerError) {
        
        uint8_t buffer[12];
        packChargerConfig(buffer);
        _chargerChar->notify(buffer, 12);

        _lastChargerActualV = actualV;
        _lastChargerActualA = actualA;
        _lastChargerError = error;
        _chargerNotifyInitialized = true;
    }
}
