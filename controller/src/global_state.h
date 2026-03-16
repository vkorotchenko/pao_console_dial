#ifndef GLOABAL_STATE_H_
#define GLOABAL_STATE_H_

#include <Arduino.h>
enum Screen
{
    PRELOAD = 0,
    CHARGING = 1,
    CAN_DATA = 2,
    SPOTIFY = 3,
    SPEEDOMETER = 4,
    SETTINGS = 5,
    GEARS = 6,
};

enum Gear {
    NEUTRAL = 0,
    DRIVE = 1,
    REVERSE = 2,
    PARK = 3,
};

class State {
public:

    enum Gear {
        NEUTRAL = 0,
        DRIVE = 1,
        REVERSE = 2,
        PARK = 3,
    };

    struct Data {
      int serviceId;
      int reqSpeed;
      int reqState;
      int reqGear;
      int reqTorque;
      int reqLimit;
      int reqAccel;
      int reqRegen;
      int resMotorTemp;
      int resInvTemp;
      int resTorque;
      int resSpeed;
      int resState;
      int resDcVolt;
      int resDcCurrent;
      bool outMainCon;
      bool outPreCon;
      bool outBrake;
      bool outCooling;
      bool outReverseLight;
      bool inReverse;
      bool inEnable;
      int inThrottle;
      int inBrake;
      bool isRunning;
      bool isFaulted;
      bool isWarning;
      bool isReady;
      bool preChargeReady;  // Pre-charge contactor ready status from CAN 0x607
      bool canConnected;    // True while CAN messages are being received

      int configSpeedMax;
      int configTorqueMax;
      int configSpeedSlewRate;
      int configTorqueSlewRate;
      int configReversePercent;
      int configKilowattHrs;
      int configPrechargeR;
      int configNominalVolt;
      int configPrechargeRelay;
      int configMainContactorRelay;
      int configCoolFan;
      int configCoolOn;
      int configCoolOff;
      int configBrakeLight;
      int configRevLight;
      int configEnableIn;
      int configReverseIn;
      int configRegenTaperLower;
      int configRegenTaperUpper;

      // GPS data
      float gpsLatitude;
      float gpsLongitude;
      float gpsSpeed;        // knots
      float gpsAltitude;     // meters
      uint8_t gpsSatellites;
      bool gpsFixAvailable;

      // GPS date/time (UTC)
      uint8_t gpsHour;       // 0-23
      uint8_t gpsMinute;     // 0-59
      uint8_t gpsSecond;     // 0-59
      uint8_t gpsDay;        // 1-31
      uint8_t gpsMonth;      // 1-12
      uint8_t gpsYear;       // 0-99 (years since 2000)

      Gear selectedGear;

      // Timestamp tracking for staleness detection
      unsigned long lastCanMessageTime;  // Timestamp of last CAN message receipt
      unsigned long lastGpsUpdateTime;   // Timestamp of last GPS fix
    };

    Screen screen;
    Data data;

    // Staleness timeout constants (in milliseconds)
    static const unsigned long CAN_TIMEOUT_MS = 5000;   // 5 second timeout
    static const unsigned long GPS_TIMEOUT_MS = 10000;  // 10 second timeout

    void setup();

    // Staleness detection methods
    bool isCanDataStale();
    bool isGpsDataStale();
    void resetCanData();    // Reset CAN fields to defaults
    void resetGpsData();    // Reset GPS fields to defaults

private:
};

#endif /* GLOABAL_STATE_H_ */

