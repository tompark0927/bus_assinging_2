import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';
import { schedulesApi, notificationsApi, emergencyApi, driverPreferencesApi } from '../services/api';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import RoutePreferenceModal from '../components/RoutePreferenceModal';

interface Slot {
  id: number;
  date: string;
  isRestDay: boolean;
  status: string;
  route: { routeNumber: string; name: string };
  bus?: { busNumber: string };
  shift: string;
}

const SHIFT_KR: Record<string, string> = {
  MORNING: '\uC624\uC804',
  AFTERNOON: '\uC624\uD6C4',
  FULL_DAY: '\uC885\uC77C',
};

export default function HomeScreen() {
  const { user } = useAuthStore();
  const navigation = useNavigation<any>();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const todayStr = format(now, 'yyyy-MM-dd');

  const {
    data: schedule,
    refetch: refetchSchedule,
    isRefetching,
    isLoading,
  } = useQuery({
    queryKey: ['my-schedule', year, month],
    queryFn: () => schedulesApi.getMySchedule(year, month).then(r => r.data.data),
  });

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then(r => r.data.data),
    refetchInterval: 30000,
  });

  const { data: openEmergency } = useQuery({
    queryKey: ['emergency-open'],
    queryFn: () => emergencyApi.list().then(r => r.data.data),
    refetchInterval: 15000,
  });

  // 선호 노선 설정 여부 확인 — 미설정 시 팝업
  const { data: myPreferences } = useQuery({
    queryKey: ['my-preferences'],
    queryFn: () => driverPreferencesApi.list().then(r => r.data.data),
  });
  const [prefModalDismissed, setPrefModalDismissed] = useState(false);
  const showPrefModal = !prefModalDismissed && myPreferences && Array.isArray(myPreferences) && myPreferences.length === 0;

  const unreadCount: number = notifData?.unreadCount || 0;
  const emergencyCount: number = openEmergency?.length || 0;

  const todaySlot: Slot | undefined = schedule?.slots?.find(
    (s: Slot) => s.date?.startsWith(todayStr),
  );

  const upcomingSlots: Slot[] =
    schedule?.slots
      ?.filter((s: Slot) => !s.isRestDay && s.date > todayStr)
      .slice(0, 3) || [];

  const greeting = () => {
    const h = now.getHours();
    if (h < 12) return '\uC88B\uC740 \uC544\uCE68\uC785\uB2C8\uB2E4';
    if (h < 18) return '\uC548\uB155\uD558\uC138\uC694';
    return '\uC218\uACE0\uD558\uC168\uC2B5\uB2C8\uB2E4';
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#1565C0" />
        <Text style={styles.loadingText}>{'\uBD88\uB7EC\uC624\uB294 \uC911...'}</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetchSchedule} />
      }
    >
      {/* Greeting Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>
              {user?.name} {'\uAE30\uC0AC\uB2D8'},
            </Text>
            <Text style={styles.greetingMsg}>{greeting()}!</Text>
          </View>
          <TouchableOpacity
            style={styles.notifBtn}
            onPress={() => navigation.navigate('\uC54C\uB9BC')}
          >
            <Ionicons name="notifications-outline" size={28} color="#fff" />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.date}>
          {format(now, 'yyyy\uB144 MM\uC6D4 dd\uC77C (EEEE)', { locale: ko })}
        </Text>
      </View>

      {/* Emergency Alert */}
      {emergencyCount > 0 && (
        <TouchableOpacity style={styles.emergencyCard} onPress={() => navigation.navigate('Emergency')}>
          <Ionicons name="warning" size={28} color="#DC2626" />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.emergencyTitle}>
              {'\uAE34\uAE09 \uC6B4\uD589 \uC694\uCCAD'}
            </Text>
            <Text style={styles.emergencyText}>
              {emergencyCount}
              {'\uAC74\uC758 \uAE34\uAE09 \uC2AC\uB86F\uC774 \uC788\uC2B5\uB2C8\uB2E4.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#DC2626" />
        </TouchableOpacity>
      )}

      {/* Today's Schedule Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="today" size={24} color="#1565C0" />
          <Text style={styles.cardTitle}>
            {'\uC624\uB298\uC758 \uBC30\uCC28'}
          </Text>
        </View>

        {!schedule ? (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyText}>
              {'\uC774\uBC88 \uB2EC \uBC30\uCC28\uD45C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
            </Text>
          </View>
        ) : !todaySlot ? (
          <View style={styles.emptyBox}>
            <Ionicons name="help-circle-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyText}>
              {'\uC624\uB298 \uBC30\uCC28 \uC815\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
            </Text>
          </View>
        ) : todaySlot.isRestDay ? (
          <View style={styles.restDayBox}>
            <Ionicons name="bed" size={48} color="#10B981" />
            <Text style={styles.restDayText}>
              {'\uC624\uB298\uC740 \uD734\uBB34\uC77C\uC785\uB2C8\uB2E4'}
            </Text>
            <Text style={styles.restDaySub}>
              {'\uD478 \uC26C\uC138\uC694!'}
            </Text>
          </View>
        ) : (
          <View style={styles.todaySchedule}>
            <View style={styles.routeBadge}>
              <Text style={styles.routeNum}>{todaySlot.route.routeNumber}</Text>
              <Text style={styles.routeLabel}>{'\uBC88'}</Text>
            </View>
            <View style={styles.scheduleInfo}>
              <Text style={styles.routeName}>{todaySlot.route.name}</Text>
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={20} color="#6B7280" />
                <Text style={styles.infoText}>
                  {SHIFT_KR[todaySlot.shift] || todaySlot.shift} {'\uADFC\uBB34'}
                </Text>
              </View>
              {todaySlot.bus && (
                <View style={styles.infoRow}>
                  <Ionicons name="bus-outline" size={20} color="#6B7280" />
                  <Text style={styles.infoText}>{todaySlot.bus.busNumber}</Text>
                </View>
              )}
              <View
                style={[
                  styles.statusChip,
                  todaySlot.status === 'DROPPED'
                    ? styles.statusDropped
                    : todaySlot.status === 'FILLED'
                      ? styles.statusFilled
                      : styles.statusNormal,
                ]}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    todaySlot.status === 'DROPPED' && { color: '#DC2626' },
                  ]}
                >
                  {todaySlot.status === 'DROPPED'
                    ? '\uB4DC\uB78D\uB428'
                    : todaySlot.status === 'FILLED'
                      ? '\uB300\uCCB4\uB428'
                      : '\uC815\uC0C1 \uC6B4\uD589'}
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Quick Actions */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="apps" size={24} color="#1565C0" />
          <Text style={styles.cardTitle}>{'\uBE60\uB978 \uBA54\uB274'}</Text>
        </View>
        <View style={styles.quickGrid}>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('\uCD9C\uD1F4\uADFC')}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#DBEAFE' }]}>
              <Ionicons name="finger-print" size={32} color="#1565C0" />
            </View>
            <Text style={styles.quickLabel}>
              {'\uCD9C\uD1F4\uADFC'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('DayOff')}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="calendar" size={32} color="#D97706" />
            </View>
            <Text style={styles.quickLabel}>
              {'\uD734\uBB34\uC2E0\uCCAD'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('Emergency')}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="alert-circle" size={32} color="#DC2626" />
            </View>
            <Text style={styles.quickLabel}>
              {'\uAE34\uAE09/\uB300\uD0C0'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('Board')}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#D1FAE5' }]}>
              <Ionicons name="megaphone" size={32} color="#059669" />
            </View>
            <Text style={styles.quickLabel}>
              {'\uAC8C\uC2DC\uD310'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('Messages')}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#EDE9FE' }]}>
              <Ionicons name="chatbubbles" size={32} color="#7C3AED" />
            </View>
            <Text style={styles.quickLabel}>
              {'\uBA54\uC2DC\uC9C0'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('Approvals')}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#F3E8FF' }]}>
              <Ionicons name="document-text" size={32} color="#9333EA" />
            </View>
            <Text style={styles.quickLabel}>
              {'\uACB0\uC7AC'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Upcoming Schedule */}
      <View style={[styles.card, { marginBottom: 32 }]}>
        <View style={styles.cardHeader}>
          <Ionicons name="calendar-outline" size={24} color="#1565C0" />
          <Text style={styles.cardTitle}>
            {'\uB2E4\uAC00\uC624\uB294 \uC6B4\uD589 (3\uC77C)'}
          </Text>
        </View>

        {upcomingSlots.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {'\uB2E4\uAC00\uC624\uB294 \uC6B4\uD589 \uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
            </Text>
          </View>
        ) : (
          upcomingSlots.map((slot, idx) => (
            <View
              key={slot.id}
              style={[
                styles.upcomingRow,
                idx < upcomingSlots.length - 1 && styles.upcomingBorder,
              ]}
            >
              <View style={styles.upcomingDate}>
                <Text style={styles.upcomingDateNum}>
                  {format(new Date(slot.date), 'dd')}
                </Text>
                <Text style={styles.upcomingDateDay}>
                  {format(new Date(slot.date), 'EEE', { locale: ko })}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text style={styles.upcomingRoute}>
                  {slot.route.routeNumber}
                  {'\uBC88 - '}
                  {slot.route.name}
                </Text>
                <Text style={styles.upcomingShift}>
                  {SHIFT_KR[slot.shift] || slot.shift} {'\uADFC\uBB34'}
                </Text>
              </View>
              <View style={styles.shiftTag}>
                <Text style={styles.shiftTagText}>
                  {SHIFT_KR[slot.shift] || slot.shift}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>

      {/* 선호 노선 미설정 시 첫 사용 팝업 */}
      <RoutePreferenceModal
        visible={!!showPrefModal}
        onClose={() => setPrefModalDismissed(true)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#6B7280', marginTop: 16 },

  // Header
  header: {
    backgroundColor: '#1565C0',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
  },
  greetingMsg: {
    fontSize: 22,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  notifBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  notifBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  date: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },

  // Emergency
  emergencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FEE2E2',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  emergencyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#DC2626',
  },
  emergencyText: {
    fontSize: 18,
    color: '#B91C1C',
    marginTop: 2,
  },

  // Card
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginLeft: 10,
  },

  // Empty
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 20,
    color: '#9CA3AF',
    marginTop: 8,
    textAlign: 'center',
  },

  // Rest day
  restDayBox: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  restDayText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#059669',
    marginTop: 12,
  },
  restDaySub: {
    fontSize: 18,
    color: '#6B7280',
    marginTop: 4,
  },

  // Today schedule
  todaySchedule: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  routeBadge: {
    backgroundColor: '#1565C0',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    minWidth: 64,
  },
  routeNum: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },
  routeLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    fontWeight: '600',
  },
  scheduleInfo: {
    flex: 1,
    marginLeft: 16,
  },
  routeName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 18,
    color: '#6B7280',
    marginLeft: 8,
  },
  statusChip: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  statusNormal: { backgroundColor: '#D1FAE5' },
  statusDropped: { backgroundColor: '#FEE2E2' },
  statusFilled: { backgroundColor: '#DBEAFE' },
  statusChipText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#065F46',
  },

  // Quick actions
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  quickItem: {
    width: '48%',
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
  },
  quickIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  quickLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
  },

  // Upcoming
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  upcomingBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  upcomingDate: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingDateNum: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1565C0',
  },
  upcomingDateDay: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
  },
  upcomingRoute: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  upcomingShift: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 2,
  },
  shiftTag: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  shiftTagText: {
    fontSize: 16,
    color: '#1565C0',
    fontWeight: '700',
  },
});
