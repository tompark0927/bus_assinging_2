import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { notificationsApi } from '../services/api';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { ko } from 'date-fns/locale';
import EmptyState from '../components/EmptyState';
import { CardSkeleton } from '../components/Skeleton';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

interface NotificationItem {
  id: number;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string; bg: string }> = {
  SCHEDULE_PUBLISHED: { name: 'calendar',          color: colors.primary,     bg: colors.primaryGhost },
  DAY_OFF_APPROVED:   { name: 'checkmark-circle',  color: colors.successDeep, bg: colors.successSoft },
  DAY_OFF_REJECTED:   { name: 'close-circle',      color: colors.dangerDeep,  bg: colors.dangerSoft },
  EMERGENCY_SLOT:     { name: 'warning',           color: colors.dangerDeep,  bg: colors.dangerSoft },
  SCHEDULE_CHANGE:    { name: 'swap-horizontal',   color: colors.warningDeep, bg: colors.warningSoft },
  EMERGENCY_FILLED:   { name: 'checkmark-done',    color: colors.successDeep, bg: colors.successSoft },
};

const DEFAULT_ICON = { name: 'notifications' as const, color: colors.textMuted, bg: colors.bgAlt };

function groupByDate(
  notifications: NotificationItem[],
  todayLabel: string,
  yesterdayLabel: string,
): { label: string; items: NotificationItem[] }[] {
  const groups: Map<string, NotificationItem[]> = new Map();

  for (const notif of notifications) {
    const date = new Date(notif.createdAt);
    let label: string;
    if (isToday(date)) label = todayLabel;
    else if (isYesterday(date)) label = yesterdayLabel;
    else label = format(date, 'MM월 dd일 (EEE)', { locale: ko });

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(notif);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then(r => r.data.data),
  });

  const notifications: NotificationItem[] = data?.notifications || [];
  const unreadCount: number = data?.unreadCount || 0;
  const grouped = groupByDate(notifications, '오늘', '어제');

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <View style={styles.container}>
      {unreadCount > 0 && (
        <TouchableOpacity
          style={styles.markAllBtn}
          onPress={() => markAllReadMutation.mutate()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('notifications.markAllRead', { count: unreadCount })}
        >
          <Ionicons name="checkmark-done" size={16} color={colors.primary} />
          <Text style={styles.markAllText}>{t('notifications.markAllRead', { count: unreadCount })}</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading ? (
          <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </View>
        ) : notifications.length === 0 ? (
          <EmptyState icon="notifications-off-outline" title={t('notifications.empty')} />
        ) : (
          grouped.map(group => (
            <View key={group.label}>
              <Text style={styles.dateLabel}>{group.label}</Text>
              {group.items.map(notif => {
                const iconInfo = TYPE_ICONS[notif.type] || DEFAULT_ICON;
                return (
                  <TouchableOpacity
                    key={notif.id}
                    style={[styles.notifCard, !notif.isRead && styles.unread]}
                    onPress={() => !notif.isRead && markReadMutation.mutate(notif.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBox, { backgroundColor: iconInfo.bg }]}>
                      <Ionicons name={iconInfo.name} size={18} color={iconInfo.color} />
                    </View>
                    <View style={styles.notifContent}>
                      <View style={styles.notifTitleRow}>
                        <Text
                          style={[styles.notifTitle, !notif.isRead && styles.unreadTitle]}
                          numberOfLines={1}
                        >
                          {notif.title}
                        </Text>
                        {!notif.isRead && <View style={styles.unreadDot} />}
                      </View>
                      <Text style={styles.notifBody} numberOfLines={2}>
                        {notif.body}
                      </Text>
                      <Text style={styles.notifTime}>
                        {formatDistanceToNow(new Date(notif.createdAt), {
                          addSuffix: true,
                          locale: ko,
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primaryGhost,
    paddingVertical: 12,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  markAllText: { color: colors.primary, fontWeight: weight.bold, fontSize: typography.md, letterSpacing: -0.1 },

  list: { flex: 1 },

  dateLabel: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  notifCard: {
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadow.xs,
  },
  unread: {
    backgroundColor: colors.primaryGhost,
    borderColor: '#bfdbfe',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifContent: { flex: 1 },
  notifTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  notifTitle: {
    flex: 1,
    fontSize: typography.md,
    fontWeight: weight.semibold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  unreadTitle: { color: colors.primary, fontWeight: weight.bold },
  notifBody: {
    fontSize: typography.base,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 4,
  },
  notifTime: {
    fontSize: typography.sm,
    color: colors.textSubtle,
    fontWeight: weight.medium,
  },
  unreadDot: {
    width: 8,
    height: 8,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
});
