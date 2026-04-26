import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { getCacheAge } from '../services/offlineCache';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [cacheAgeMin, setCacheAgeMin] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });

    NetInfo.fetch().then((state) => {
      setIsOffline(!state.isConnected);
    });

    return () => unsubscribe();
  }, []);

  // 캐시 나이 주기적 업데이트
  useEffect(() => {
    if (!isOffline) return;
    const update = async () => {
      const age = await getCacheAge('/schedules');
      setCacheAgeMin(age);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [isOffline]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setSyncing(false);
    }
  };

  if (!isOffline) return null;

  return (
    <View style={[styles.banner, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Text style={styles.icon}>{'\uD83D\uDCF6'}</Text>
        <View style={styles.textContainer}>
          <Text style={styles.text}>
            {'\uC624\uD504\uB77C\uC778 \uBAA8\uB4DC'}
          </Text>
          {cacheAgeMin !== null && (
            <Text style={styles.subText}>
              {cacheAgeMin < 1
                ? '\uBC29\uAE08 \uB3D9\uAE30\uD654\uB428'
                : `${cacheAgeMin}\uBD84 \uC804 \uB370\uC774\uD130`}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.syncBtn}
          onPress={handleSync}
          disabled={syncing}
        >
          <Text style={styles.syncText}>
            {syncing ? '\uB3D9\uAE30\uD654 \uC911...' : '\uC0C8\uB85C\uACE0\uCE68'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#F59E0B',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 16,
    marginRight: 8,
  },
  textContainer: {
    flex: 1,
  },
  text: {
    color: '#78350F',
    fontSize: 14,
    fontWeight: '700',
  },
  subText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  syncBtn: {
    backgroundColor: 'rgba(120,53,15,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  syncText: {
    color: '#78350F',
    fontSize: 13,
    fontWeight: '700',
  },
});
