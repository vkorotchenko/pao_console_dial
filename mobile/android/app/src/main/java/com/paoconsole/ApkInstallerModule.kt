package com.paoconsole

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Bridges the React side to Android's package-install intent.
 *
 * Three methods, all returning Promises (so the JS wrapper can `await`):
 *
 *  - installApk(filePath): wrap the on-disk APK in a FileProvider URI and
 *    dispatch ACTION_VIEW with mime `application/vnd.android.package-archive`.
 *    The system installer takes over. Once the user taps "Install", this
 *    process is killed; we never observe completion.
 *
 *  - canRequestInstalls(): on API 26+ Android requires per-app consent in
 *    Settings → Special access → Install unknown apps. This is checked BEFORE
 *    we even download — if the user hasn't granted it, prompt them first.
 *    Returns true on API < 26 (no such restriction existed pre-Oreo).
 *
 *  - openInstallPermissionSettings(): deeplinks to the per-app consent page
 *    so the user can grant it without hunting through Settings.
 *
 * Mirrors the existing KeepAwakeModule pattern: same package, same
 * ReactContextBaseJavaModule base class, `currentActivity` accessed via
 * `reactApplicationContext.currentActivity` (nullable when backgrounded).
 */
class ApkInstallerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ApkInstaller"

    @ReactMethod
    fun installApk(filePath: String, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
                ?: return promise.reject("NO_ACTIVITY", "No current activity")
            val file = File(filePath)
            if (!file.exists()) {
                return promise.reject("FILE_MISSING", "APK not found at $filePath")
            }
            val authority = "${reactApplicationContext.packageName}.fileprovider"
            val uri: Uri = FileProvider.getUriForFile(reactApplicationContext, authority, file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            promise.resolve(true)
        } catch (err: Throwable) {
            promise.reject("INSTALL_FAILED", err.message, err)
        }
    }

    @ReactMethod
    fun canRequestInstalls(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                promise.resolve(reactApplicationContext.packageManager.canRequestPackageInstalls())
            } else {
                // Pre-Oreo: no per-source consent, only the global "Unknown
                // sources" toggle which `REQUEST_INSTALL_PACKAGES` covers
                // implicitly. Treat as granted.
                promise.resolve(true)
            }
        } catch (err: Throwable) {
            promise.reject("CHECK_FAILED", err.message, err)
        }
    }

    @ReactMethod
    fun openInstallPermissionSettings(promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
                ?: return promise.reject("NO_ACTIVITY", "No current activity")
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:${reactApplicationContext.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            promise.resolve(true)
        } catch (err: Throwable) {
            promise.reject("OPEN_FAILED", err.message, err)
        }
    }
}
