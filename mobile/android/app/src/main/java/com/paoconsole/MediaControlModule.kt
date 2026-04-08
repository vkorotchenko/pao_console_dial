package com.paoconsole

import android.content.Context
import android.media.AudioManager
import android.view.KeyEvent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MediaControlModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MediaControl"

    private fun dispatchKey(keyCode: Int) {
        val am = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
    }

    @ReactMethod fun playPause() = dispatchKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
    @ReactMethod fun next()      = dispatchKey(KeyEvent.KEYCODE_MEDIA_NEXT)
    @ReactMethod fun previous()  = dispatchKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
    @ReactMethod fun volumeUp()  {
        val am = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
    }
    @ReactMethod fun volumeDown() {
        val am = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
    }
    @ReactMethod fun mute() {
        val am = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI)
    }
}
