import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Modal, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { schedulesApi } from '../services/api';
import { format, getDaysInMonth } from 'date-fns';
import { ko } from 'date-fns/locale';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';
import { parseSlotDate, slotDateKey } from '../utils/date';
import { routeLabel } from '../utils/route';

interface Slot {
  id: number;
  date: string;
  isRestDay: boolean;
  status: string;
  shift: string;
  route: { routeNumber: string; name: string };
  bus?: { busNumber: string };
}

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

export default function ScheduleScreen() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const tShift = (s: string) => t(`shifts.${s}`, { defaultValue: s });

  const { data: schedule, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['my-schedule', year, month],
    queryFn: () => schedulesApi.getMySchedule(year, month).then(r => r.data.data),
  });

  const slots: Slot[] = schedule?.slots || [];
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));

  const slotMap = new Map<string, Slot>();
  for (const slot of slots) {
    slotMap.set(slotDateKey(slot.date), slot);
  }

  const prevMonth = useCallback(() => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }, [month]);

  const nextMonth = useCallback(() => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }, [month]);

  // 드랍된 운행은 휴무로 합산해 표기한다 (운행일/휴무일 2분류).
  const isRest = (s: Slot) => s.isRestDay || s.status === 'DROPPED';
  const workDays = slots.filter(s => !isRest(s)).length;
  const restDays = slots.filter(s => isRest(s)).length;

  const todayStr = format(now, 'yyyy-MM-dd');
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

  return (
    <View style={styles.container}>
      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity
          onPress={prevMonth}
          style={styles.navBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={20} color={colors.textBody} />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{year}년 {month}월</Text>
        <TouchableOpacity
          onPress={nextMonth}
          style={styles.navBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="next month"
        >
          <Ionicons name="chevron-forward" size={20} color={colors.textBody} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* Stats */}
        {isLoading ? (
          <View style={styles.statsRow}>
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
          </View>
        ) : schedule ? (
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colors.primaryGhost }]}>
              <Text style={[styles.statNum, { color: colors.primary }]}>{workDays}</Text>
              <Text style={styles.statLabel}>{t('schedule.workDays')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.successSoft }]}>
              <Text style={[styles.statNum, { color: colors.successDeep }]}>{restDays}</Text>
              <Text style={styles.statLabel}>{t('schedule.restDays')}</Text>
            </View>
          </View>
        ) : null}

        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.legendText}>{t('schedule.legendWork')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
            <Text style={styles.legendText}>{t('schedule.legendRest')}</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={[styles.calendarCard, { gap: 6 }]}>
            <Skeleton height={28} borderRadius={radius.md} />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={36} borderRadius={radius.md} />
            ))}
          </View>
        ) : !schedule ? (
          <EmptyState
            icon="calendar-outline"
            title={t('schedule.monthAbsent', { month })}
            subtitle={t('schedule.askAdmin')}
          />
        ) : (
          <>
            {/* Calendar */}
            <View style={styles.calendarCard}>
              <View style={styles.dayHeaders}>
                {DAYS_KR.map((day, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.dayHeader,
                      i === 0 && styles.sunday,
                      i === 6 && styles.saturday,
                    ]}
                  >
                    {day}
                  </Text>
                ))}
              </View>

              <View style={styles.calendarGrid}>
                {Array.from({ length: firstDayOfWeek }, (_, i) => (
                  <View key={`empty-${i}`} style={styles.dayCell} />
                ))}

                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const date = new Date(year, month - 1, day);
                  const dateStr = format(date, 'yyyy-MM-dd');
                  const slot = slotMap.get(dateStr);
                  const dow = date.getDay();
                  const isToday = dateStr === todayStr;

                  const slotIsRest = slot ? (slot.isRestDay || slot.status === 'DROPPED') : false;

                  let cellBg: string = colors.white;
                  if (slotIsRest) cellBg = colors.successSoft;
                  else if (slot) cellBg = colors.primaryGhost;

                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayCell,
                        { backgroundColor: cellBg },
                        isToday && styles.todayCell,
                      ]}
                      onPress={() => slot && setSelectedSlot(slot)}
                      disabled={!slot}
                      activeOpacity={0.6}
                    >
                      <Text
                        style={[
                          styles.dayNum,
                          dow === 0 && styles.sundayText,
                          dow === 6 && styles.saturdayText,
                          isToday && styles.todayText,
                        ]}
                      >
                        {day}
                      </Text>
                      {slot && !slotIsRest && (
                        <Text style={styles.routeLabel} numberOfLines={1}>
                          {slot.route.routeNumber}
                        </Text>
                      )}
                      {slotIsRest && (
                        <Text style={styles.restLabel}>휴</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Schedule List */}
            <View style={styles.listCard}>
              <Text style={styles.listTitle}>{t('schedule.list')}</Text>
              {slots
                .filter(s => !isRest(s))
                .sort((a, b) => slotDateKey(a.date).localeCompare(slotDateKey(b.date)))
                .map((slot, idx, arr) => {
                  const date = parseSlotDate(slot.date);
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      style={[
                        styles.listRow,
                        idx < arr.length - 1 && styles.listRowBorder,
                      ]}
                      onPress={() => setSelectedSlot(slot)}
                      activeOpacity={0.6}
                    >
                      <View style={styles.listDateCol}>
                        <Text style={styles.listDateText} numberOfLines={1}>{format(date, 'MM.dd')}</Text>
                        <Text style={styles.listDayText}>{DAYS_KR[date.getDay()]}</Text>
                      </View>
                      <View style={styles.listRouteBox}>
                        <Text style={styles.listRouteNum}>
                          {slot.route.routeNumber}번
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.listRouteName} numberOfLines={1}>
                          {slot.route.name}
                        </Text>
                        <Text style={styles.listShift}>{tShift(slot.shift)}</Text>
                      </View>
                      <View
                        style={[
                          styles.listStatusChip,
                          slot.status === 'DROPPED'
                            ? styles.chipDropped
                            : slot.status === 'FILLED'
                              ? styles.chipFilled
                              : styles.chipNormal,
                        ]}
                      >
                        <Text
                          style={[
                            styles.listStatusText,
                            slot.status === 'DROPPED'
                              ? { color: colors.dangerDeep }
                              : slot.status === 'FILLED'
                                ? { color: colors.primary }
                                : { color: colors.successDeep },
                          ]}
                        >
                          {slot.status === 'DROPPED'
                            ? t('schedule.dropped')
                            : slot.status === 'FILLED'
                              ? t('home.statusFilled')
                              : t('home.statusNormal')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
            </View>
          </>
        )}
      </ScrollView>

      {/* Detail Modal */}
      {selectedSlot && (
        <Modal
          visible
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedSlot(null)}
        >
          {/* overlay tap-to-close */}
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setSelectedSlot(null)}
            accessibilityLabel={t('common.close')}
          >
            {/* content 영역에서 onPress 가 overlay 로 버블링되지 않도록 별도 Pressable */}
            <Pressable style={styles.modalContent} onPress={() => { /* swallow */ }}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('schedule.detail')}</Text>
                <TouchableOpacity
                  onPress={() => setSelectedSlot(null)}
                  style={styles.modalCloseBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                >
                  <Ionicons name="close" size={20} color={colors.textBody} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                <DetailRow icon="calendar-outline" label={t('schedule.fields.date')} value={format(parseSlotDate(selectedSlot.date), 'yyyy년 MM월 dd일 (EEE)', { locale: ko })} />
                <DetailRow icon="bus-outline" label={t('schedule.fields.route')} value={routeLabel(selectedSlot.route.routeNumber, selectedSlot.route.name)} />
                <DetailRow icon="time-outline" label={t('schedule.fields.shift')} value={tShift(selectedSlot.shift)} />
                {selectedSlot.bus && (
                  <DetailRow icon="car-outline" label={t('schedule.fields.bus')} value={selectedSlot.bus.busNumber} />
                )}
                <DetailRow
                  icon="flag-outline"
                  label={t('schedule.fields.status')}
                  value={
                    (selectedSlot.isRestDay || selectedSlot.status === 'DROPPED')
                      ? t('schedule.legendRest')
                      : selectedSlot.status === 'FILLED'
                        ? t('home.statusFilled')
                        : t('home.statusNormal')
                  }
                />
              </View>

              <TouchableOpacity
                style={styles.modalDoneBtn}
                onPress={() => setSelectedSlot(null)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('common.ok')}
              >
                <Text style={styles.modalDoneBtnText}>{t('common.ok')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={detailStyles.row}>
      <View style={detailStyles.iconBox}>
        <Ionicons name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={detailStyles.value} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    gap: spacing.md,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.primaryGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: weight.semibold,
    width: 50,
  },
  value: {
    flex: 1,
    fontSize: typography.md,
    color: colors.text,
    fontWeight: weight.semibold,
    textAlign: 'right',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Month nav
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statNum: { fontSize: typography['3xl'], fontWeight: weight.extrabold, letterSpacing: -0.5 },
  statLabel: { fontSize: typography.base, color: colors.textBody, marginTop: 2, fontWeight: weight.semibold },

  // Legend
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: { fontSize: typography.base, color: colors.textMuted, fontWeight: weight.medium },

  // Calendar
  calendarCard: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  dayHeaders: { flexDirection: 'row', marginBottom: 4 },
  dayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: colors.textMuted,
    paddingVertical: 6,
  },
  sunday: { color: colors.danger },
  saturday: { color: colors.primaryLight },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    padding: 2,
  },
  todayCell: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dayNum: { fontSize: typography.md, fontWeight: weight.semibold, color: colors.textBody },
  sundayText: { color: colors.danger },
  saturdayText: { color: colors.primaryLight },
  todayText: { fontWeight: weight.extrabold, color: colors.primary },
  routeLabel: { fontSize: 10, color: colors.primary, fontWeight: weight.bold, marginTop: 1 },
  restLabel: { fontSize: 11, color: colors.successDeep, fontWeight: weight.bold },
  droppedLabel: { fontSize: 9, color: colors.dangerDeep, fontWeight: weight.bold },

  // Schedule list
  listCard: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  listTitle: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  listRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  listDateCol: { width: 56 },
  listDateText: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  listDayText: { fontSize: typography.sm, color: colors.textSubtle, fontWeight: weight.medium },
  listRouteBox: {
    backgroundColor: colors.primaryGhost,
    borderRadius: radius.md,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  listRouteNum: { fontSize: typography.base, fontWeight: weight.bold, color: colors.primary },
  listRouteName: { fontSize: typography.md, fontWeight: weight.semibold, color: colors.text },
  listShift: { fontSize: typography.base, color: colors.textMuted, fontWeight: weight.medium },
  listStatusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  chipNormal: { backgroundColor: colors.successSoft },
  chipDropped: { backgroundColor: colors.dangerSoft },
  chipFilled: { backgroundColor: colors.primaryGhost },
  listStatusText: { fontSize: typography.sm, fontWeight: weight.bold },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius['3xl'],
    borderTopRightRadius: radius['3xl'],
    paddingBottom: spacing['2xl'],
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.md,
  },
  modalTitle: { fontSize: typography['2xl'], fontWeight: weight.bold, color: colors.text, letterSpacing: -0.3 },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { paddingHorizontal: spacing.xl },
  modalDoneBtn: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalDoneBtnText: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.white },
});
