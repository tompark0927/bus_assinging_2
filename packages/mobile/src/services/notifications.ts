import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
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

// 동시 호출 가드 — 권한 다이얼로그(네이티브 모달)가 이중으로 뜨는 것을 방지.
// 화면 전환 중 네이티브 모달이 겹치면 iPad 호환 모드에서 앱이 멈출 수 있다.
let registerInFlight: Promise<string | null> | null = null;

/** Request permission, get the Expo push token, and sync it to backend.
 *  Failures are non-fatal — token is cached for retry on reconnect/login.
 *  Concurrent calls share a single in-flight run.
 */
export function registerForPushNotifications(): Promise<string | null> {
  if (!registerInFlight) {
    registerInFlight = doRegister().finally(() => {
      registerInFlight = null;
    });
  }
  return registerInFlight;
}

async function doRegister(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a real device');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      // iPad(호환 모드)에서는 iOS 알림 권한 다이얼로그(시스템 UI)가 닫힌 뒤
      // 앱 윈도우가 터치 포커스를 되찾지 못해 화면 전체가 먹통이 되는
      // iPadOS 26 버그가 있다 (백그라운드 전환 시 복구되는 것으로 확인).
      // → iPad 하드웨어에서는 권한 요청을 띄우지 않는다. 이미 허용된 경우에만
      //   토큰을 등록하고, 아니면 조용히 건너뛴다. (본 앱은 iPhone 전용 배포)
      // Platform.isPad 는 호환 모드에서 phone 으로 보고되므로 하드웨어 모델로 판별.
      const hardwareModel = `${Device.modelName ?? ''} ${Device.modelId ?? ''}`;
      if (Platform.OS === 'ios' && /ipad/i.test(hardwareModel)) {
        console.log('Skipping push permission prompt on iPad (compatibility mode)');
        return null;
      }
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

    // projectId 를 명시적으로 전달 — Constants 자동 탐색이 실패하는 엣지 케이스 방지
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data;

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
