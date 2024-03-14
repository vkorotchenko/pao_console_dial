
#ifndef SETTING_SCREEN_H_
#define SETTING_SCREEN_H_

#include "screen.h"

class SettingsScreen :public Screen {
    public:
    virtual void onClick() ;
    virtual void onTouch(int x, int y);
    virtual void display();
    virtual void onScroll(int x);
    protected:
};

#endif /* SETTING_SCREEN_H_ */