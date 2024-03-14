
#ifndef DATA_SCREEN_H_
#define DATA_SCREEN_H_

#include "screen.h"

class DataScreen :public Screen {
    public:
    virtual void onClick() ;
    virtual void onTouch(int x, int y);
    virtual void display();
    virtual void onScroll(int x);
    protected:
};

#endif /* DATA_SCREEN_H_ */