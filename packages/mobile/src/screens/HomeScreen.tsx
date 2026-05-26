import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';
import { schedulesApi, notificationsApi, emergencyApi, dayOffApi } from '../services/api';
import { parseSlotDate, slotDateKey } from '../utils/date';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import NextMonthDayoffModal from '../components/NextMonthDayoffModal';

/**
 * 다음 달 휴무 미리 신청 안내 팝업.
 * - 평소: 다음 달 시작 7일 전부터 자동으로 1회 노출 (그 달에 한 번 닫으면 다시 안 뜸)
 * - 테스트: 아래 값을 true 로 두면 날짜·닫음 여부와 무관하게 항상 노출
 *   ⚠️ 배포 전 반드시 false 로 되돌릴 것
 */
const FORCE_SHOW_DAYOFF_REMINDER = false;
const DAYS_BEFORE_NEXT_MONTH = 7;
import EmptyState from '../components/EmptyState';
import { Skeleton, CardSkeleton } from '../components/Skeleton';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

interface Slot {
  id: number;
  date: string;
  isRestDay: boolean;
  status: string;
  route: { routeNumber: string; name: string; startPoint?: string | null; endPoint?: string | null };
  bus?: { busNumber: string };
  shift: string;
}

export default function HomeScreen() {
  const { user } = useAuthStore();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
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

  // ── 다음 달 휴무 미리 신청 안내 팝업 ──
  // 정책: 다음 달 시작 7일 전부터, 다음 달 휴무를 신청하기 전까지 "하루 1회"씩 노출.
  //       다음 달 휴무 신청이 확인되면 그 달은 더 이상 노출하지 않음.
  const nextMonthDate = new Date(year, now.getMonth() + 1, 1);
  const nextMonthLabel = format(nextMonthDate, 'M월', { locale: ko });
  const nextMonthPrefix = format(nextMonthDate, 'yyyy-MM'); // 예: "2026-06"
  // 다음 달 1일까지 남은 일수
  const daysUntilNextMonth = Math.ceil(
    (nextMonthDate.getTime() - new Date(year, now.getMonth(), now.getDate()).getTime()) / 86400000,
  );
  // 하루 1회 제한용 키 (다음 달 단위)
  const lastShownKey = `dayoffReminderLastShown:${nextMonthPrefix}`;

  // 내 휴무 신청 내역 (DayOffScreen 과 캐시 공유)
  const { data: myDayOffs } = useQuery<Array<{ date: string; status: string }>>({
    queryKey: ['my-dayoff'],
    queryFn: () => dayOffApi.list().then(r => r.data.data),
  });
  // 다음 달에 대한 휴무 신청이 이미 있는지 (거절된 건 제외 → 재신청 유도)
  const hasNextMonthRequest =
    Array.isArray(myDayOffs) &&
    myDayOffs.some(
      d => d.date?.startsWith(nextMonthPrefix) && d.status !== 'REJECTED',
    );

  const [dayoffReminderReady, setDayoffReminderReady] = useState(false);
  const [shownToday, setShownToday] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (FORCE_SHOW_DAYOFF_REMINDER) {
        if (active) { setShownToday(false); setDayoffReminderReady(true); }
        return;
      }
      try {
        const v = await AsyncStorage.getItem(lastShownKey);
        if (active) { setShownToday(v === todayStr); setDayoffReminderReady(true); }
      } catch {
        if (active) { setShownToday(false); setDayoffReminderReady(true); }
      }
    })();
    return () => { active = false; };
  }, [lastShownKey, todayStr]);

  const withinReminderWindow =
    daysUntilNextMonth > 0 && daysUntilNextMonth <= DAYS_BEFORE_NEXT_MONTH;
  const showDayoffReminder =
    dayoffReminderReady &&
    !shownToday &&
    !hasNextMonthRequest && // 다음 달 휴무 이미 신청 → 노출 안 함
    (FORCE_SHOW_DAYOFF_REMINDER || withinReminderWindow);

  // 오늘은 봤음으로 기록 (내일 다시 노출됨, 단 신청 완료 시 위 조건에서 차단)
  const markShownToday = () => {
    setShownToday(true);
    if (!FORCE_SHOW_DAYOFF_REMINDER) {
      AsyncStorage.setItem(lastShownKey, todayStr).catch(() => {});
    }
  };

  const goToNextMonthDayoff = () => {
    markShownToday();
    navigation.navigate('휴무신청', {
      openCreate: true,
      initialMonth: format(nextMonthDate, 'yyyy-MM-dd'),
    });
  };

  const unreadCount: number = notifData?.unreadCount || 0;
  // 본인이 드랍한 슬롯은 대타 대상이 아니므로 카운트에서 제외
  const emergencyCount: number = (openEmergency || []).filter(
    (d: { driver?: { id: number } }) => d.driver?.id !== user?.id,
  ).length;

  const todaySlot: Slot | undefined = schedule?.slots?.find(
    (s: Slot) => slotDateKey(s.date) === todayStr,
  );

  const upcomingSlots: Slot[] =
    schedule?.slots
      ?.filter((s: Slot) => !s.isRestDay && slotDateKey(s.date) > todayStr)
      .sort((a: Slot, b: Slot) => slotDateKey(a.date).localeCompare(slotDateKey(b.date)))
      .slice(0, 3) || [];

  const greeting = () => {
    const h = now.getHours();
    if (h < 12) return t('home.greetingMorning');
    if (h < 18) return t('home.greetingDay');
    return t('home.greetingEvening');
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetchSchedule}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View pointerEvents="none" style={styles.headerBlob} />
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.date}>
                {format(now, 'M월 d일 (EEEE)', { locale: ko })}
              </Text>
              <Text style={styles.greeting}>
                {greeting()}, {user?.name} 기사님
              </Text>
            </View>
            <TouchableOpacity
              style={styles.notifBtn}
              onPress={() => navigation.navigate('Notifications')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('notifications.title')}
            >
              <Ionicons name="notifications-outline" size={22} color={colors.white} />
              {unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* 비기사 계정 안내 */}
        {user && user.role !== 'DRIVER' && (
          <View style={styles.roleNotice}>
            <Ionicons name="information-circle" size={20} color={colors.dangerDeep} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text style={styles.roleNoticeTitle}>기사 전용 화면입니다</Text>
              <Text style={styles.roleNoticeText}>
                현재 관리자 계정으로 로그인되어 있어 배차 정보가 표시되지 않습니다.
                기사 앱은 기사 계정으로 로그인해 주세요.
              </Text>
            </View>
          </View>
        )}

        {/* Emergency Alert */}
        {emergencyCount > 0 && (
          <TouchableOpacity
            style={styles.emergencyCard}
            onPress={() => navigation.navigate('긴급/대타')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${t('home.emergencyAlertTitle')} ${t('home.emergencyAlertText', { count: emergencyCount })}`}
          >
            <View style={styles.emergencyIcon}>
              <Ionicons name="warning" size={20} color={colors.dangerDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emergencyTitle}>긴급 운행 요청</Text>
              <Text style={styles.emergencyText}>
                {t('home.emergencyAlertText', { count: emergencyCount })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.dangerDeep} />
          </TouchableOpacity>
        )}

        {/* Today's Schedule Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIconCircle}>
              <Ionicons name="today-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle}>{t('home.todayDispatch')}</Text>
          </View>

          {isLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <Skeleton width={60} height={60} borderRadius={radius.lg} />
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Skeleton width="70%" height={16} />
                <Skeleton width="50%" height={12} />
                <Skeleton width="40%" height={12} />
                <Skeleton width={80} height={20} borderRadius={radius.full} />
              </View>
            </View>
          ) : !schedule ? (
            <EmptyState
              variant="compact"
              icon="calendar-outline"
              title={t('home.noScheduleThisMonth')}
            />
          ) : !todaySlot ? (
            <EmptyState
              variant="compact"
              icon="help-circle-outline"
              title={t('home.noTodayInfo')}
            />
          ) : todaySlot.isRestDay ? (
            <View style={styles.restDayBox}>
              <View style={styles.restIconCircle}>
                <Ionicons name="cafe-outline" size={28} color={colors.successDeep} />
              </View>
              <Text style={styles.restDayText}>{t('home.restDayTitle')}</Text>
              <Text style={styles.restDaySub}>{t('home.restDaySub')}</Text>
            </View>
          ) : (
            <>
            <View style={styles.todaySchedule}>
              <View style={styles.routeBadge}>
                <Text style={styles.routeNum}>{todaySlot.route.routeNumber}</Text>
                <Text style={styles.routeLabel}>번</Text>
              </View>
              <View style={styles.scheduleInfo}>
                <Text style={styles.routeName}>{todaySlot.route.name}</Text>
                <View style={styles.infoRow}>
                  <Ionicons name="time-outline" size={15} color={colors.textMuted} />
                  <Text style={styles.infoText}>
                    {t('home.shiftWork', { shift: t(`shifts.${todaySlot.shift}`, { defaultValue: todaySlot.shift }) })}
                  </Text>
                </View>
                {todaySlot.bus && (
                  <View style={styles.infoRow}>
                    <Ionicons name="bus-outline" size={15} color={colors.textMuted} />
                    <Text style={styles.infoText}>{todaySlot.bus.busNumber}</Text>
                  </View>
                )}
              </View>
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
                    todaySlot.status === 'DROPPED'
                      ? { color: colors.dangerDeep }
                      : todaySlot.status === 'FILLED'
                        ? { color: colors.primary }
                        : { color: colors.successDeep },
                  ]}
                >
                  {todaySlot.status === 'DROPPED'
                    ? t('home.statusDropped')
                    : todaySlot.status === 'FILLED'
                      ? t('home.statusFilled')
                      : t('home.statusNormal')}
                </Text>
              </View>
            </View>

            {todaySlot.route.startPoint && todaySlot.route.endPoint && (
              <View style={styles.routePathBar}>
                <Ionicons name="location-outline" size={15} color={colors.primary} />
                <Text style={styles.routePathText} numberOfLines={1}>{todaySlot.route.startPoint}</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.textSubtle} style={{ marginHorizontal: 6 }} />
                <Ionicons name="flag-outline" size={15} color={colors.successDeep} />
                <Text style={styles.routePathText} numberOfLines={1}>{todaySlot.route.endPoint}</Text>
              </View>
            )}
            </>
          )}
        </View>

        {/* Upcoming Schedule */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIconCircle}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle}>{t('home.upcoming')}</Text>
          </View>

          {isLoading ? (
            <View style={{ gap: spacing.md }}>
              <CardSkeleton />
              <CardSkeleton />
            </View>
          ) : upcomingSlots.length === 0 ? (
            <EmptyState variant="compact" icon="calendar-outline" title={t('home.noUpcoming')} />
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
                    {format(parseSlotDate(slot.date), 'dd')}
                  </Text>
                  <Text style={styles.upcomingDateDay}>
                    {format(parseSlotDate(slot.date), 'EEE', { locale: ko })}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.upcomingRoute}>
                    {slot.route.routeNumber}번 · {slot.route.name}
                  </Text>
                  <Text style={styles.upcomingShift}>
                    {t('home.shiftWork', { shift: t(`shifts.${slot.shift}`, { defaultValue: slot.shift }) })}
                  </Text>
                </View>
                <View style={styles.shiftTag}>
                  <Text style={styles.shiftTagText}>
                    {t(`shifts.${slot.shift}`, { defaultValue: slot.shift })}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <NextMonthDayoffModal
        visible={!!showDayoffReminder}
        nextMonthLabel={nextMonthLabel}
        onConfirm={goToNextMonthDayoff}
        onClose={markShownToday}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  loadingText: {
    fontSize: typography.md,
    color: colors.textMuted,
    marginTop: spacing.md,
  },

  // Header
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
  },
  headerBlob: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.primaryLight,
    opacity: 0.4,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  date: {
    fontSize: typography.base,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: weight.semibold,
    marginBottom: 4,
  },
  greeting: {
    fontSize: typography['2xl'],
    fontWeight: weight.bold,
    color: colors.white,
    letterSpacing: -0.3,
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.danger,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  notifBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: weight.bold,
  },

  // Emergency
  emergencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#FECACA',
    gap: spacing.md,
  },
  emergencyIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  roleNoticeTitle: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.dangerDeep,
    marginBottom: 2,
  },
  roleNoticeText: {
    fontSize: typography.base,
    color: colors.dangerText,
    lineHeight: 19,
  },
  emergencyTitle: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    color: colors.dangerDeep,
  },
  emergencyText: {
    fontSize: typography.base,
    color: colors.dangerText,
    marginTop: 2,
  },

  // Card
  card: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  cardIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.primaryGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.2,
  },

  // Rest day
  restDayBox: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  restIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  restDayText: {
    fontSize: typography.xl,
    fontWeight: weight.bold,
    color: colors.text,
  },
  restDaySub: {
    fontSize: typography.base,
    color: colors.textMuted,
    marginTop: 4,
  },

  // Today schedule
  todaySchedule: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  routeBadge: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 60,
  },
  routeNum: {
    color: colors.white,
    fontSize: typography['2xl'],
    fontWeight: weight.extrabold,
    letterSpacing: -0.5,
  },
  routeLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: typography.xs,
    fontWeight: weight.semibold,
  },
  scheduleInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  routeName: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
    letterSpacing: -0.2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  infoText: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: weight.medium,
  },
  statusChip: {
    marginLeft: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  statusNormal: { backgroundColor: colors.successSoft },
  statusDropped: { backgroundColor: colors.dangerSoft },
  statusFilled: { backgroundColor: colors.primaryGhost },
  routePathBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  routePathText: {
    fontSize: typography.base,
    color: colors.textBody,
    fontWeight: weight.semibold,
    flexShrink: 1,
    marginLeft: 4,
  },
  statusChipText: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
  },

  // Upcoming
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  upcomingBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  upcomingDate: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingDateNum: {
    fontSize: typography.lg,
    fontWeight: weight.extrabold,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  upcomingDateDay: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: weight.semibold,
    marginTop: -2,
  },
  upcomingRoute: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  upcomingShift: {
    fontSize: typography.base,
    color: colors.textMuted,
    marginTop: 2,
  },
  shiftTag: {
    backgroundColor: colors.primaryGhost,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  shiftTagText: {
    fontSize: typography.sm,
    color: colors.primary,
    fontWeight: weight.bold,
  },
});
