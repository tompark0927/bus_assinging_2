import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const PENDING_TOKEN_KEY = 'push:pendingToken';
const REGISTERED_TOKEN_KEY = 'push:registeredToken';

let netListenerAttached = false;

/** Request permission, get the Expo push token, and sync it to backend.
 *  Failures are non-fatal — token is cached for retry on reconnect/login.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a real device');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permissions denied');
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Busync 알림',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2563eb',
      });

      await Notifications.setNotificationChannelAsync('emergency', {
        name: '긴급 운행 알림',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#dc2626',
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;

    // Cache the token + try to register with backend
    await AsyncStorage.setItem(PENDING_TOKEN_KEY, token);
    attachNetListener();
    await flushPendingToken();
    return token;
  } catch (error) {
    console.warn('registerForPushNotifications failed:', error);
    return null;
  }
}

/** Push the cached token to backend if it differs from what was last accepted. */
async function flushPendingToken(): Promise<void> {
  try {
    const pending = await AsyncStorage.getItem(PENDING_TOKEN_KEY);
    const registered = await AsyncStorage.getItem(REGISTERED_TOKEN_KEY);
    if (!pending) return;
    if (pending === registered) return;

    const state = await NetInfo.fetch();
    if (!state.isConnected) return;

    await authApi.updatePushToken(pending);
    await AsyncStorage.setItem(REGISTERED_TOKEN_KEY, pending);
  } catch (err) {
    // Backend rejection or transient failure — leave pending for next attempt
    console.log('flushPendingToken deferred:', (err as Error)?.message);
  }
}

function attachNetListener() {
  if (netListenerAttached) return;
  netListenerAttached = true;
  NetInfo.addEventListener((state) => {
    if (state.isConnected) flushPendingToken();
  });
}

export function setupNotificationListeners(
  onNotification: (notification: Notifications.Notification) => void,
  onResponse: (response: Notifications.NotificationResponse) => void,
) {
  const notificationListener = Notifications.addNotificationReceivedListener(onNotification);
  const responseListener = Notifications.addNotificationResponseReceivedListener(onResponse);

  return () => {
    Notifications.removeNotificationSubscription(notificationListener);
    Notifications.removeNotificationSubscription(responseListener);
  };
}

/** Clear cached push tokens — call on logout so the next user gets a fresh sync. */
export async function clearPushTokenCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_TOKEN_KEY);
    await AsyncStorage.removeItem(REGISTERED_TOKEN_KEY);
  } catch {
    // ignore
  }
}
