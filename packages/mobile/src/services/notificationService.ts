import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@notification_settings';

// 알림 유형별 설정
export const NOTIFICATION_CHANNELS = {
  EMERGENCY: {
    name: '긴급 배차',
    sound: true,
    vibrate: [0, 500, 200, 500], // 강한 진동
    priority: 'max' as const,
  },
  SCHEDULE: {
    name: '배차 알림',
    sound: true,
    vibrate: [0, 250],
    priority: 'high' as const,
  },
  DAYOFF: {
    name: '휴무 알림',
    sound: true,
    vibrate: [0, 200],
    priority: 'default' as const,
  },
  MESSAGE: {
    name: '메시지',
    sound: true,
    vibrate: [0, 100],
    priority: 'default' as const,
  },
  GENERAL: {
    name: '일반 알림',
    sound: false,
    vibrate: [0, 100],
    priority: 'low' as const,
  },
} as const;

export type NotificationChannelKey = keyof typeof NOTIFICATION_CHANNELS;

export interface ChannelSettings {
  muted: boolean;
  vibration: boolean;
}

export interface NotificationSettings {
  muteAll: boolean;
  channels: Record<NotificationChannelKey, ChannelSettings>;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  muteAll: false,
  channels: {
    EMERGENCY: { muted: false, vibration: true },
    SCHEDULE: { muted: false, vibration: true },
    DAYOFF: { muted: false, vibration: true },
    MESSAGE: { muted: false, vibration: true },
    GENERAL: { muted: false, vibration: false },
  },
};

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const type = notification.request.content.data?.type as string | undefined;
    const settings = await getNotificationSettings();

    const channelKey = (type && type in NOTIFICATION_CHANNELS
      ? type
      : 'GENERAL') as NotificationChannelKey;
    const channel = NOTIFICATION_CHANNELS[channelKey];
    const channelSettings = settings.channels[channelKey];

    // Check if user has muted this type or all
    if (settings.muteAll || channelSettings?.muted) {
      return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
    }

    return {
      shouldShowAlert: true,
      shouldPlaySound: channel.sound,
      shouldSetBadge: true,
    };
  },
});

// Haptic feedback based on notification type
export async function triggerHaptic(type: string) {
  const settings = await getNotificationSettings();
  const channelKey = (type && type in NOTIFICATION_CHANNELS
    ? type
    : 'GENERAL') as NotificationChannelKey;
  const channelSettings = settings.channels[channelKey];

  // Skip vibration if muted or vibration disabled for this channel
  if (settings.muteAll || channelSettings?.muted || !channelSettings?.vibration) {
    return;
  }

  switch (type) {
    case 'EMERGENCY':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
    case 'SCHEDULE':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'DAYOFF':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'MESSAGE':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    default:
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

// Settings persistence
export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
      // Merge with defaults to handle new channels added in updates
      return {
        muteAll: parsed.muteAll ?? DEFAULT_SETTINGS.muteAll,
        channels: {
          ...DEFAULT_SETTINGS.channels,
          ...(parsed.channels || {}),
        },
      };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Add a notification received listener that triggers haptic
export function addNotificationHapticListener() {
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    const type = notification.request.content.data?.type as string | undefined;
    if (type) {
      triggerHaptic(type);
    }
  });
  return subscription;
}
