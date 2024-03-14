
#ifndef GEAR_SCREEN_H_
#define GEAR_SCREEN_H_

#include "screen.h"

class GearScreen :public Screen {
    public:
    virtual void onClick() ;
    virtual void onTouch(int x, int y);
    virtual void display();
    virtual void onScroll(int x);
    protected:
};

#endif /* GEAR_SCREEN_H_ */