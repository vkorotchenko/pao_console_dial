
#ifndef SCREEN_H_
#define SCREEN_H_

class Screen {
    public:
    virtual void onClick() = 0;
    virtual void onTouch(int x, int y) = 0;
    virtual void onScroll(int x) = 0;
    virtual void display() = 0;
    protected:
};

#endif /* SCREEN_H_ */