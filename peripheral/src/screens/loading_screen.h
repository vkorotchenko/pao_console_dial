
#ifndef LOADING_SCREEN_H_
#define LOADING_SCREEN_H_

#include "screen.h"

class LoadingScreen :public Screen {
    public:
    virtual void onClick() ;
    virtual void onTouch(int x, int y);
    virtual void display();
    virtual void onScroll(int x);
    protected:
};

#endif /* LOADING_SCREEN_H_ */