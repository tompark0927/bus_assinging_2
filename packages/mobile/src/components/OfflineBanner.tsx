import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getCacheAge } from '../services/offlineCache';
import { getQueueSize } from '../services/offlineQueue';
import { colors, radius, spacing, typography, weight } from '../theme';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [cacheAgeMin, setCacheAgeMin] = useState<number | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });
    NetInfo.fetch().then((state) => setIsOffline(!state.isConnected));
    return () => unsubscribe();
  }, []);

  // Poll cache age + queue size when relevant
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const [age, size] = await Promise.all([getCacheAge('/schedules'), getQueueSize()]);
      if (!mounted) return;
      setCacheAgeMin(age);
      setQueueSize(size);
    };
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isOffline]);

  // Show banner if offline OR if we have queued writes pending sync
  const visible = isOffline || queueSize > 0;
  if (!visible) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await queryClient.invalidateQueries();
      const size = await getQueueSize();
      setQueueSize(size);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + 8 }]}
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <Ionicons
          name={isOffline ? 'cloud-offline' : 'sync-circle'}
          size={16}
          color={colors.warningText}
        />
        <View style={styles.textContainer}>
          <Text style={styles.text}>
            {isOffline ? t('offline.title') : t('offline.queued', { count: queueSize })}
          </Text>
          {isOffline && cacheAgeMin !== null && (
            <Text style={styles.subText}>
              {cacheAgeMin < 1
                ? t('offline.syncedJustNow')
                : t('offline.minutesAgo', { minutes: cacheAgeMin })}
            </Text>
          )}
          {!isOffline && queueSize > 0 && (
            <Text style={styles.subText}>{t('offline.syncing')}</Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.syncBtn}
          onPress={handleSync}
          disabled={syncing}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('offline.refresh')}
        >
          <Text style={styles.syncText}>
            {syncing ? t('offline.syncing') : t('offline.refresh')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warningSoft,
    paddingBottom: 10,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textContainer: {
    flex: 1,
  },
  text: {
    color: colors.warningText,
    fontSize: typography.base,
    fontWeight: weight.bold,
  },
  subText: {
    color: colors.warningText,
    fontSize: typography.sm,
    fontWeight: weight.medium,
    marginTop: 1,
    opacity: 0.8,
  },
  syncBtn: {
    backgroundColor: 'rgba(146, 64, 14, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  syncText: {
    color: colors.warningText,
    fontSize: typography.sm,
    fontWeight: weight.bold,
  },
});
