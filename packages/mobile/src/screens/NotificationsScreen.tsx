import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../services/api';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { ko } from 'date-fns/locale';

interface NotificationItem {
  id: number;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, { name: string; color: string; bg: string }> = {
  SCHEDULE_PUBLISHED: { name: 'calendar', color: '#1565C0', bg: '#DBEAFE' },
  DAY_OFF_APPROVED: { name: 'checkmark-circle', color: '#059669', bg: '#D1FAE5' },
  DAY_OFF_REJECTED: { name: 'close-circle', color: '#DC2626', bg: '#FEE2E2' },
  EMERGENCY_SLOT: { name: 'warning', color: '#DC2626', bg: '#FEE2E2' },
  SCHEDULE_CHANGE: { name: 'swap-horizontal', color: '#D97706', bg: '#FEF3C7' },
  EMERGENCY_FILLED: { name: 'checkmark-done', color: '#059669', bg: '#D1FAE5' },
};

const DEFAULT_ICON = { name: 'notifications', color: '#6B7280', bg: '#F3F4F6' };

function groupByDate(notifications: NotificationItem[]): { label: string; items: NotificationItem[] }[] {
  const groups: Map<string, NotificationItem[]> = new Map();

  for (const notif of notifications) {
    const date = new Date(notif.createdAt);
    let label: string;
    if (isToday(date)) {
      label = '\uC624\uB298';
    } else if (isYesterday(date)) {
      label = '\uC5B4\uC81C';
    } else {
      label = format(date, 'MM\uC6D4 dd\uC77C (EEE)', { locale: ko });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(notif);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export default function NotificationsScreen() {
  const queryClient = useQueryClient();

  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then(r => r.data.data),
  });

  const notifications: NotificationItem[] = data?.notifications || [];
  const unreadCount: number = data?.unreadCount || 0;
  const grouped = groupByDate(notifications);

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#1565C0" />
        <Text style={styles.loadingText}>
          {'\uBD88\uB7EC\uC624\uB294 \uC911...'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Mark all read button */}
      {unreadCount > 0 && (
        <TouchableOpacity
          style={styles.markAllBtn}
          onPress={() => markAllReadMutation.mutate()}
          activeOpacity={0.7}
        >
          <Ionicons name="checkmark-done" size={22} color="#1565C0" />
          <Text style={styles.markAllText}>
            {'\uBAA8\uB450 \uC77D\uC74C'} ({unreadCount})
          </Text>
        </TouchableOpacity>
      )}

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons
              name="notifications-off-outline"
              size={64}
              color="#D1D5DB"
            />
            <Text style={styles.emptyText}>
              {'\uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
            </Text>
          </View>
        ) : (
          grouped.map(group => (
            <View key={group.label}>
              <Text style={styles.dateLabel}>{group.label}</Text>
              {group.items.map(notif => {
                const iconInfo =
                  TYPE_ICONS[notif.type] || DEFAULT_ICON;
                return (
                  <TouchableOpacity
                    key={notif.id}
                    style={[
                      styles.notifCard,
                      !notif.isRead && styles.unread,
                    ]}
                    onPress={() =>
                      !notif.isRead && markReadMutation.mutate(notif.id)
                    }
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.iconBox,
                        { backgroundColor: iconInfo.bg },
                      ]}
                    >
                      <Ionicons
                        name={iconInfo.name as any}
                        size={24}
                        color={iconInfo.color}
                      />
                    </View>
                    <View style={styles.notifContent}>
                      <Text
                        style={[
                          styles.notifTitle,
                          !notif.isRead && styles.unreadTitle,
                        ]}
                      >
                        {notif.title}
                      </Text>
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
                    {!notif.isRead && <View style={styles.unreadDot} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#6B7280', marginTop: 16 },

  // Mark all
  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    padding: 16,
    margin: 16,
    marginBottom: 0,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  markAllText: { color: '#1565C0', fontWeight: '700', fontSize: 18 },

  // List
  list: { flex: 1 },

  // Empty
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 20, color: '#9CA3AF', marginTop: 16 },

  // Date group label
  dateLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6B7280',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },

  // Notification card
  notifCard: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 18,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  unread: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  notifContent: { flex: 1 },
  notifTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 4,
  },
  unreadTitle: { color: '#1565C0', fontWeight: '800' },
  notifBody: {
    fontSize: 18,
    color: '#6B7280',
    lineHeight: 24,
    marginBottom: 6,
  },
  notifTime: { fontSize: 16, color: '#9CA3AF' },
  unreadDot: {
    width: 12,
    height: 12,
    backgroundColor: '#1565C0',
    borderRadius: 6,
    marginTop: 6,
    marginLeft: 8,
  },
});
