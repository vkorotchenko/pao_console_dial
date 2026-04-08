import notifee, {AndroidImportance} from '@notifee/react-native';

const CHANNEL_ID = 'pao_charger';

async function ensureChannel(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Charger',
    importance: AndroidImportance.HIGH,
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= 1;
}

export async function displayChargeTimeWarning(minutesLeft: number): Promise<void> {
  try {
    await ensureChannel();
    await notifee.displayNotification({
      title: 'Charging time almost up',
      body: `${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''} remaining`,
      android: {channelId: CHANNEL_ID, smallIcon: 'ic_launcher'},
    });
  } catch (e) {
    console.warn('notifications: displayChargeTimeWarning failed', e);
  }
}

export async function displaySocWarning(socPct: number): Promise<void> {
  try {
    await ensureChannel();
    await notifee.displayNotification({
      title: 'Charging threshold reached',
      body: `Battery is at ${socPct.toFixed(0)}%`,
      android: {channelId: CHANNEL_ID, smallIcon: 'ic_launcher'},
    });
  } catch (e) {
    console.warn('notifications: displaySocWarning failed', e);
  }
}
