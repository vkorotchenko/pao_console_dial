
#ifndef SPEEDO_SCREEN_H_
#define SPEEDO_SCREEN_H_

#include "screen.h"

class SpeedometerScreen :public Screen {
    public:
    virtual void onClick() ;
    virtual void onTouch(int x, int y);
    virtual void display();
    virtual void onScroll(int x);
    protected:
};

#endif /* SPEEDO_SCREEN_H_ */