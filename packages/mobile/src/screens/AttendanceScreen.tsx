import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { attendanceApi } from '../services/api';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function AttendanceScreen() {
  const queryClient = useQueryClient();
  const [locationLoading, setLocationLoading] = useState(false);
  const now = new Date();

  const { data: todayData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['attendance-today'],
    queryFn: () => attendanceApi.todayStatus().then(r => r.data.data),
    refetchInterval: 30000,
  });

  const checkInMutation = useMutation({
    mutationFn: ({ lat, lng }: { lat: number; lng: number }) =>
      attendanceApi.checkIn(lat, lng),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-today'] });
      Alert.alert(
        '\uCD9C\uADFC \uC644\uB8CC',
        '\uCD9C\uADFC\uC774 \uC815\uC0C1 \uCC98\uB9AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.\n\uC624\uB298\uB3C4 \uC548\uC804 \uC6B4\uD589\uD558\uC138\uC694!',
      );
    },
    onError: (err: any) => {
      Alert.alert(
        '\uC624\uB958',
        err.response?.data?.message || '\uCD9C\uADFC \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.',
      );
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: ({ lat, lng }: { lat: number; lng: number }) =>
      attendanceApi.checkOut(lat, lng),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-today'] });
      Alert.alert(
        '\uD1F4\uADFC \uC644\uB8CC',
        '\uD1F4\uADFC\uC774 \uC815\uC0C1 \uCC98\uB9AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.\n\uC218\uACE0\uD558\uC168\uC2B5\uB2C8\uB2E4!',
      );
    },
    onError: (err: any) => {
      Alert.alert(
        '\uC624\uB958',
        err.response?.data?.message || '\uD1F4\uADFC \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.',
      );
    },
  });

  const handleAction = async (type: 'in' | 'out') => {
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          '\uC704\uCE58 \uAD8C\uD55C \uD544\uC694',
          'GPS \uCD9C\uD1F4\uADFC\uC744 \uC704\uD574 \uC704\uCE58 \uAD8C\uD55C\uC744 \uD5C8\uC6A9\uD574\uC8FC\uC138\uC694.',
        );
        setLocationLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;

      if (type === 'in') {
        checkInMutation.mutate({ lat: latitude, lng: longitude });
      } else {
        Alert.alert(
          '\uD1F4\uADFC \uD655\uC778',
          '\uD1F4\uADFC \uCC98\uB9AC\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?',
          [
            { text: '\uCDE8\uC18C', style: 'cancel' },
            {
              text: '\uD1F4\uADFC\uD558\uAE30',
              onPress: () =>
                checkOutMutation.mutate({ lat: latitude, lng: longitude }),
            },
          ],
        );
      }
    } catch {
      Alert.alert(
        '\uC704\uCE58 \uC624\uB958',
        'GPS \uC704\uCE58\uB97C \uAC00\uC838\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.\n\uC704\uCE58 \uC124\uC815\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694.',
      );
    } finally {
      setLocationLoading(false);
    }
  };

  const hasCheckedIn = !!todayData?.checkIn;
  const hasCheckedOut = !!todayData?.checkOut;
  const isPending =
    checkInMutation.isPending || checkOutMutation.isPending || locationLoading;

  const getStatusInfo = () => {
    if (hasCheckedOut)
      return {
        icon: 'home' as const,
        text: '\uD1F4\uADFC \uC644\uB8CC',
        color: '#6B7280',
        bg: '#F3F4F6',
      };
    if (hasCheckedIn)
      return {
        icon: 'bus' as const,
        text: '\uADFC\uBB34\uC911',
        color: '#059669',
        bg: '#D1FAE5',
      };
    return {
      icon: 'time' as const,
      text: '\uCD9C\uADFC \uC804',
      color: '#D97706',
      bg: '#FEF3C7',
    };
  };

  const statusInfo = getStatusInfo();

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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {/* Date Display */}
      <View style={styles.dateSection}>
        <Text style={styles.dateText}>
          {format(now, 'yyyy\uB144 MM\uC6D4 dd\uC77C', { locale: ko })}
        </Text>
        <Text style={styles.dayText}>
          {format(now, 'EEEE', { locale: ko })}
        </Text>
      </View>

      {/* Status Card */}
      <View style={styles.statusCard}>
        <View style={[styles.statusIconCircle, { backgroundColor: statusInfo.bg }]}>
          <Ionicons name={statusInfo.icon} size={40} color={statusInfo.color} />
        </View>
        <Text style={[styles.statusLabel, { color: statusInfo.color }]}>
          {statusInfo.text}
        </Text>

        {/* Time display */}
        <View style={styles.timeRow}>
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>{'\uCD9C\uADFC'}</Text>
            <Text style={styles.timeValue}>
              {todayData?.checkIn
                ? format(new Date(todayData.checkIn), 'HH:mm')
                : '--:--'}
            </Text>
          </View>
          <View style={styles.timeDivider} />
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>{'\uD1F4\uADFC'}</Text>
            <Text style={styles.timeValue}>
              {todayData?.checkOut
                ? format(new Date(todayData.checkOut), 'HH:mm')
                : '--:--'}
            </Text>
          </View>
        </View>

        {/* Work duration */}
        {hasCheckedIn && (
          <View style={styles.durationRow}>
            <Ionicons name="timer-outline" size={22} color="#6B7280" />
            <Text style={styles.durationLabel}>
              {'\uADFC\uBB34 \uC2DC\uAC04'}
            </Text>
            <Text style={styles.durationValue}>
              {getWorkDuration(todayData?.checkIn, todayData?.checkOut)}
            </Text>
          </View>
        )}
      </View>

      {/* GPS Info */}
      {(todayData?.checkInLat || todayData?.checkOutLat) && (
        <View style={styles.gpsCard}>
          <View style={styles.gpsHeader}>
            <Ionicons name="location" size={22} color="#1565C0" />
            <Text style={styles.gpsTitle}>GPS {'\uAE30\uB85D'}</Text>
          </View>
          {todayData?.checkInLat && (
            <Text style={styles.gpsText}>
              {'\uCD9C\uADFC: '}{todayData.checkInLat.toFixed(4)}, {todayData.checkInLng.toFixed(4)}
            </Text>
          )}
          {todayData?.checkOutLat && (
            <Text style={styles.gpsText}>
              {'\uD1F4\uADFC: '}{todayData.checkOutLat.toFixed(4)}, {todayData.checkOutLng.toFixed(4)}
            </Text>
          )}
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actionSection}>
        {!hasCheckedIn ? (
          <TouchableOpacity
            style={[styles.mainBtn, styles.checkInBtn]}
            onPress={() => handleAction('in')}
            disabled={isPending}
            activeOpacity={0.8}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <>
                <Ionicons name="log-in" size={36} color="#fff" />
                <Text style={styles.mainBtnText}>
                  {'\uCD9C\uADFC\uD558\uAE30'}
                </Text>
                <Text style={styles.mainBtnSub}>
                  GPS{'\uB85C \uC704\uCE58\uAC00 \uAE30\uB85D\uB429\uB2C8\uB2E4'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : !hasCheckedOut ? (
          <TouchableOpacity
            style={[styles.mainBtn, styles.checkOutBtn]}
            onPress={() => handleAction('out')}
            disabled={isPending}
            activeOpacity={0.8}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <>
                <Ionicons name="log-out" size={36} color="#fff" />
                <Text style={styles.mainBtnText}>
                  {'\uD1F4\uADFC\uD558\uAE30'}
                </Text>
                <Text style={styles.mainBtnSub}>
                  GPS{'\uB85C \uC704\uCE58\uAC00 \uAE30\uB85D\uB429\uB2C8\uB2E4'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <View style={[styles.mainBtn, styles.doneBtn]}>
            <Ionicons name="checkmark-circle" size={48} color="#059669" />
            <Text style={[styles.mainBtnText, { color: '#374151' }]}>
              {'\uC624\uB298 \uADFC\uBB34 \uC644\uB8CC'}
            </Text>
            <Text style={[styles.mainBtnSub, { color: '#6B7280' }]}>
              {'\uC218\uACE0\uD558\uC168\uC2B5\uB2C8\uB2E4!'}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function getWorkDuration(checkIn?: string, checkOut?: string): string {
  if (!checkIn) return '0\uC2DC\uAC04 0\uBD84';
  const start = new Date(checkIn);
  const end = checkOut ? new Date(checkOut) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}\uC2DC\uAC04 ${minutes}\uBD84`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  scrollContent: { flexGrow: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#6B7280', marginTop: 16 },

  // Date
  dateSection: {
    backgroundColor: '#1565C0',
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
  },
  dateText: { fontSize: 22, fontWeight: '800', color: '#fff' },
  dayText: { fontSize: 18, color: 'rgba(255,255,255,0.85)', marginTop: 4 },

  // Status card
  statusCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: -12,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  statusIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statusLabel: { fontSize: 24, fontWeight: '900', marginBottom: 24 },

  // Time
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  timeItem: { flex: 1, alignItems: 'center' },
  timeLabel: {
    fontSize: 18,
    color: '#9CA3AF',
    fontWeight: '600',
    marginBottom: 6,
  },
  timeValue: { fontSize: 36, fontWeight: '900', color: '#111827' },
  timeDivider: { width: 2, height: 50, backgroundColor: '#E5E7EB' },

  // Duration
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    justifyContent: 'center',
  },
  durationLabel: {
    fontSize: 18,
    color: '#6B7280',
    fontWeight: '600',
    marginLeft: 8,
    marginRight: 12,
  },
  durationValue: { fontSize: 22, fontWeight: '800', color: '#1565C0' },

  // GPS
  gpsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 18,
  },
  gpsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  gpsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginLeft: 8,
  },
  gpsText: { fontSize: 16, color: '#6B7280', marginBottom: 4 },

  // Action
  actionSection: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  mainBtn: {
    borderRadius: 24,
    paddingVertical: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    minHeight: 140,
    justifyContent: 'center',
  },
  checkInBtn: { backgroundColor: '#1565C0' },
  checkOutBtn: { backgroundColor: '#DC2626' },
  doneBtn: {
    backgroundColor: '#F3F4F6',
    shadowOpacity: 0,
    elevation: 0,
  },
  mainBtnText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    marginTop: 10,
  },
  mainBtnSub: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 8,
  },
});
