import React, {useEffect} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {PaperProvider} from 'react-native-paper';
import {StyleSheet, LogBox} from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import {useAppStore} from './src/store/useAppStore';
import {
  initAppVersion,
  getCachedAppVersion,
  getCachedAppBuildNumber,
} from './src/services/appVersion';
import {checkForMobileUpdate} from './src/services/mobileUpdateController';
import {cleanupOldApks} from './src/services/mobileAppDownload';

LogBox.ignoreLogs(['Cannot start scanning operation']);

function App(): React.JSX.Element {
  // Read the running app's versionName / versionCode from native once at
  // boot and stash in the store. Fire-and-forget — failures leave cached
  // state null and the UI shows "—".
  useEffect(() => {
    initAppVersion().then(() => {
      const v = getCachedAppVersion();
      const b = getCachedAppBuildNumber();
      if (v && b) {
        useAppStore.getState().setAppVersion(v, b);
      }
    });
  }, []);

  // Fire-and-forget GitHub release check on mount, mirroring the charger
  // detection in AppNavigator. Errors land in the store as
  // appUpdateState='error' — never bubble. 1-hour TTL inside the service
  // prevents thrashing on rapid app relaunches.
  useEffect(() => {
    checkForMobileUpdate().catch(() => {});
  }, []);

  // Housekeeping: at next launch, sweep CacheDir for any stale
  // `pao-console-mobile-*.apk` files left over from prior update attempts.
  // We can't reliably know when an Android install completes (the app gets
  // killed), so cleanup runs opportunistically next time we boot. Passing
  // null keeps no file — the new version is now installed so nothing in
  // cache is still useful. Fire-and-forget; errors just log.
  useEffect(() => {
    cleanupOldApks(null).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <PaperProvider>
          <AppNavigator />
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
