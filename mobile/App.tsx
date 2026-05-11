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

LogBox.ignoreLogs(['Cannot start scanning operation']);

function App(): React.JSX.Element {
  // Phase 1 of mobile self-update: read the running app's versionName /
  // versionCode from native once at boot and stash in the store. Fire-and-
  // forget — failures leave cached state null and the UI shows "—".
  useEffect(() => {
    initAppVersion().then(() => {
      const v = getCachedAppVersion();
      const b = getCachedAppBuildNumber();
      if (v && b) {
        useAppStore.getState().setAppVersion(v, b);
      }
    });
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
