import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  NOTIFICATION_CHANNELS,
  NotificationChannelKey,
  NotificationSettings,
  DEFAULT_SETTINGS,
  getNotificationSettings,
  saveNotificationSettings,
} from '../services/notificationService';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

const CHANNEL_META: Record<NotificationChannelKey, {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  desc: string;
}> = {
  EMERGENCY: { icon: 'warning',         iconColor: colors.dangerDeep,  iconBg: colors.dangerSoft,  desc: '긴급 대체 운행 요청 알림' },
  SCHEDULE:  { icon: 'calendar',        iconColor: colors.primary,     iconBg: colors.primaryGhost, desc: '배차표 발행 및 변경 알림' },
  DAYOFF:    { icon: 'document-text',   iconColor: colors.warningDeep, iconBg: colors.warningSoft, desc: '휴무 승인/반려 알림' },
  MESSAGE:   { icon: 'chatbubbles',     iconColor: '#7c3aed',          iconBg: '#ede9fe',          desc: '1:1 메시지 수신 알림' },
  GENERAL:   { icon: 'notifications',   iconColor: colors.textMuted,   iconBg: colors.bgAlt,       desc: '기타 일반 알림' },
};

// 기사 앱에서 실제로 수신하는 알림 종류만 노출한다.
// (긴급 대타 / 배차 / 휴무 승인·반려) — 메시지·일반 알림은 기사에게 발송되지 않는다.
const CHANNEL_ORDER: NotificationChannelKey[] = [
  'EMERGENCY',
  'SCHEDULE',
  'DAYOFF',
];

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
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
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing['3xl'] }}>
      {/* Master mute */}
      <View style={styles.masterCard}>
        <View style={styles.masterRow}>
          <View style={styles.masterInfo}>
            <View style={styles.masterIconBox}>
              <Ionicons name="notifications-off-outline" size={18} color={colors.dangerDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.masterTitle}>{t('notifSettings.muteAll')}</Text>
              <Text style={styles.masterDesc}>{t('notifSettings.muteAllDesc')}</Text>
            </View>
          </View>
          <Switch
            value={settings.muteAll}
            onValueChange={toggleMuteAll}
            trackColor={{ false: colors.border, true: colors.danger }}
            thumbColor={colors.white}
            accessibilityLabel={t('notifSettings.muteAll')}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('notifSettings.byChannel')}</Text>

      {CHANNEL_ORDER.map((key) => {
        const channel = NOTIFICATION_CHANNELS[key];
        const channelSettings = settings.channels[key];
        const disabled = settings.muteAll;
        const meta = CHANNEL_META[key];

        return (
          <View
            key={key}
            style={[styles.channelCard, disabled && styles.channelCardDisabled]}
          >
            <View style={styles.channelHeader}>
              <View style={[styles.channelIconBox, { backgroundColor: meta.iconBg }]}>
                <Ionicons name={meta.icon} size={18} color={meta.iconColor} />
              </View>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelName, disabled && styles.textDisabled]}>
                  {channel.name}
                </Text>
                <Text style={[styles.channelDesc, disabled && styles.textDisabled]}>
                  {meta.desc}
                </Text>
              </View>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleItem}>
                <Text style={[styles.toggleLabel, disabled && styles.textDisabled]}>{t('notifSettings.receive')}</Text>
                <Switch
                  value={!channelSettings.muted}
                  onValueChange={() => toggleChannelMuted(key)}
                  disabled={disabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                  accessibilityLabel={`${channel.name} ${t('notifSettings.receive')}`}
                />
              </View>
              <View style={styles.toggleDivider} />
              <View style={styles.toggleItem}>
                <Text style={[styles.toggleLabel, disabled && styles.textDisabled]}>{t('notifSettings.vibration')}</Text>
                <Switch
                  value={channelSettings.vibration}
                  onValueChange={() => toggleChannelVibration(key)}
                  disabled={disabled || channelSettings.muted}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                  accessibilityLabel={`${channel.name} ${t('notifSettings.vibration')}`}
                />
              </View>
            </View>

            {key === 'EMERGENCY' && !channelSettings.muted && !disabled && (
              <View style={styles.warningBanner}>
                <Ionicons name="information-circle-outline" size={14} color={colors.warningDeep} />
                <Text style={styles.warningText}>{t('notifSettings.emergencyHint')}</Text>
              </View>
            )}
          </View>
        );
      })}

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('notifSettings.autoSaved')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  masterCard: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  masterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  masterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  masterIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterTitle: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  masterDesc: {
    fontSize: typography.base,
    color: colors.textMuted,
    marginTop: 2,
  },

  sectionTitle: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: colors.textMuted,
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  channelCard: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.xs,
  },
  channelCardDisabled: {
    opacity: 0.55,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  channelIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInfo: { flex: 1 },
  channelName: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  channelDesc: {
    fontSize: typography.base,
    color: colors.textMuted,
    marginTop: 2,
  },

  toggleRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  toggleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleDivider: {
    width: 1,
    backgroundColor: colors.borderSoft,
  },
  toggleLabel: {
    fontSize: typography.base,
    color: colors.textBody,
    fontWeight: weight.semibold,
  },
  textDisabled: { color: colors.textDisabled },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: spacing.md,
  },
  warningText: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.warningText,
    lineHeight: 18,
    fontWeight: weight.medium,
  },

  footer: { padding: spacing.xl, alignItems: 'center' },
  footerText: { fontSize: typography.base, color: colors.textSubtle },
});
