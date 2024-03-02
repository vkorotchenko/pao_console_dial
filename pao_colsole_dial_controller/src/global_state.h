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

      Gear selectedGear;
    };

    Screen screen;
    Data data;

    void setup();

private:
};

#endif /* GLOABAL_STATE_H_ */

