import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  NOTIFICATION_CHANNELS,
  NotificationChannelKey,
  NotificationSettings,
  DEFAULT_SETTINGS,
  getNotificationSettings,
  saveNotificationSettings,
} from '../services/notificationService';

const CHANNEL_ICONS: Record<NotificationChannelKey, string> = {
  EMERGENCY: '🚨',
  SCHEDULE: '📅',
  DAYOFF: '📋',
  MESSAGE: '💬',
  GENERAL: '🔔',
};

const CHANNEL_DESCRIPTIONS: Record<NotificationChannelKey, string> = {
  EMERGENCY: '긴급 대체 운행 요청 알림',
  SCHEDULE: '배차표 발행 및 변경 알림',
  DAYOFF: '휴무 승인/반려 알림',
  MESSAGE: '1:1 메시지 수신 알림',
  GENERAL: '기타 일반 알림',
};

const CHANNEL_ORDER: NotificationChannelKey[] = [
  'EMERGENCY',
  'SCHEDULE',
  'DAYOFF',
  'MESSAGE',
  'GENERAL',
];

export default function NotificationSettingsScreen() {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const s = await getNotificationSettings();
      setSettings(s);
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (next: NotificationSettings) => {
    setSettings(next);
    await saveNotificationSettings(next);
  }, []);

  const toggleMuteAll = useCallback(() => {
    persist({ ...settings, muteAll: !settings.muteAll });
  }, [settings, persist]);

  const toggleChannelMuted = useCallback(
    (key: NotificationChannelKey) => {
      persist({
        ...settings,
        channels: {
          ...settings.channels,
          [key]: { ...settings.channels[key], muted: !settings.channels[key].muted },
        },
      });
    },
    [settings, persist],
  );

  const toggleChannelVibration = useCallback(
    (key: NotificationChannelKey) => {
      persist({
        ...settings,
        channels: {
          ...settings.channels,
          [key]: { ...settings.channels[key], vibration: !settings.channels[key].vibration },
        },
      });
    },
    [settings, persist],
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* 전체 무음 */}
      <View style={styles.masterCard}>
        <View style={styles.masterRow}>
          <View style={styles.masterInfo}>
            <Text style={styles.masterIcon}>🔇</Text>
            <View>
              <Text style={styles.masterTitle}>전체 무음</Text>
              <Text style={styles.masterDesc}>모든 알림의 소리와 진동을 끕니다</Text>
            </View>
          </View>
          <Switch
            value={settings.muteAll}
            onValueChange={toggleMuteAll}
            trackColor={{ false: '#D1D5DB', true: '#EF4444' }}
            thumbColor={settings.muteAll ? '#fff' : '#fff'}
            style={styles.switchLarge}
          />
        </View>
      </View>

      {/* 채널별 설정 */}
      <Text style={styles.sectionTitle}>알림 유형별 설정</Text>

      {CHANNEL_ORDER.map((key) => {
        const channel = NOTIFICATION_CHANNELS[key];
        const channelSettings = settings.channels[key];
        const disabled = settings.muteAll;

        return (
          <View
            key={key}
            style={[styles.channelCard, disabled && styles.channelCardDisabled]}
          >
            <View style={styles.channelHeader}>
              <Text style={styles.channelIcon}>{CHANNEL_ICONS[key]}</Text>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelName, disabled && styles.textDisabled]}>
                  {channel.name}
                </Text>
                <Text style={[styles.channelDesc, disabled && styles.textDisabled]}>
                  {CHANNEL_DESCRIPTIONS[key]}
                </Text>
              </View>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleItem}>
                <Text style={[styles.toggleLabel, disabled && styles.textDisabled]}>알림 받기</Text>
                <Switch
                  value={!channelSettings.muted}
                  onValueChange={() => toggleChannelMuted(key)}
                  disabled={disabled}
                  trackColor={{ false: '#D1D5DB', true: '#1565C0' }}
                  thumbColor="#fff"
                  style={styles.switchLarge}
                />
              </View>
              <View style={styles.toggleItem}>
                <Text style={[styles.toggleLabel, disabled && styles.textDisabled]}>진동</Text>
                <Switch
                  value={channelSettings.vibration}
                  onValueChange={() => toggleChannelVibration(key)}
                  disabled={disabled || channelSettings.muted}
                  trackColor={{ false: '#D1D5DB', true: '#1565C0' }}
                  thumbColor="#fff"
                  style={styles.switchLarge}
                />
              </View>
            </View>

            {key === 'EMERGENCY' && !channelSettings.muted && !disabled && (
              <View style={styles.warningBanner}>
                <Text style={styles.warningText}>
                  긴급 배차 알림은 안전을 위해 항상 켜두는 것을 권장합니다.
                </Text>
              </View>
            )}
          </View>
        );
      })}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          설정은 자동으로 저장됩니다.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  masterCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  masterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  masterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  masterIcon: {
    fontSize: 28,
  },
  masterTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  masterDesc: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 14,
  },
  channelCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  channelCardDisabled: {
    opacity: 0.5,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  channelIcon: {
    fontSize: 24,
  },
  channelInfo: {
    flex: 1,
  },
  channelName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  channelDesc: {
    fontSize: 16,
    color: '#9CA3AF',
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 12,
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    fontSize: 18,
    color: '#374151',
    fontWeight: '600',
  },
  switchLarge: {
    transform: [{ scaleX: 1.1 }, { scaleY: 1.1 }],
    // Ensures minimum 56px touch target via the scaled switch (~51px native + scale)
    ...(Platform.OS === 'android' ? { height: 32 } : {}),
  },
  textDisabled: {
    color: '#D1D5DB',
  },
  warningBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  warningText: {
    fontSize: 16,
    color: '#92400E',
    lineHeight: 24,
  },
  footer: {
    padding: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
});
