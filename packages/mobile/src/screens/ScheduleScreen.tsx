import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { schedulesApi } from '../services/api';
import { format, getDaysInMonth } from 'date-fns';
import { ko } from 'date-fns/locale';

interface Slot {
  id: number;
  date: string;
  isRestDay: boolean;
  status: string;
  shift: string;
  route: { routeNumber: string; name: string };
  bus?: { busNumber: string };
}

const DAYS_KR = ['\uC77C', '\uC6D4', '\uD654', '\uC218', '\uBAA9', '\uAE08', '\uD1A0'];
const SHIFT_KR: Record<string, string> = {
  MORNING: '\uC624\uC804',
  AFTERNOON: '\uC624\uD6C4',
  FULL_DAY: '\uC885\uC77C',
};

export default function ScheduleScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const { data: schedule, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['my-schedule', year, month],
    queryFn: () => schedulesApi.getMySchedule(year, month).then(r => r.data.data),
  });

  const slots: Slot[] = schedule?.slots || [];
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));

  const slotMap = new Map<string, Slot>();
  for (const slot of slots) {
    slotMap.set(slot.date.split('T')[0], slot);
  }

  const prevMonth = useCallback(() => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }, [month]);

  const nextMonth = useCallback(() => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }, [month]);

  const workDays = slots.filter(s => !s.isRestDay).length;
  const restDays = slots.filter(s => s.isRestDay).length;
  const droppedDays = slots.filter(s => s.status === 'DROPPED').length;

  const todayStr = format(now, 'yyyy-MM-dd');
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#1565C0" />
        <Text style={styles.loadingText}>
          {'\uBC30\uCC28\uD45C \uBD88\uB7EC\uC624\uB294 \uC911...'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{year}{'\uB144'} {month}{'\uC6D4'}</Text>
        <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
            <Text style={styles.legendText}>{'\uADFC\uBB34'}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
            <Text style={styles.legendText}>{'\uD734\uBB34'}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
            <Text style={styles.legendText}>{'\uB4DC\uB78D'}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#1565C0', borderWidth: 2, borderColor: '#1565C0' }]} />
            <Text style={styles.legendText}>{'\uC624\uB298'}</Text>
          </View>
        </View>

        {/* Stats */}
        {schedule && (
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: '#EFF6FF' }]}>
              <Text style={styles.statNum}>{workDays}</Text>
              <Text style={styles.statLabel}>{'\uC6B4\uD589\uC77C'}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#D1FAE5' }]}>
              <Text style={styles.statNum}>{restDays}</Text>
              <Text style={styles.statLabel}>{'\uD734\uBB34\uC77C'}</Text>
            </View>
            {droppedDays > 0 && (
              <View style={[styles.statCard, { backgroundColor: '#FEE2E2' }]}>
                <Text style={[styles.statNum, { color: '#DC2626' }]}>{droppedDays}</Text>
                <Text style={styles.statLabel}>{'\uB4DC\uB78D'}</Text>
              </View>
            )}
          </View>
        )}

        {!schedule ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={64} color="#D1D5DB" />
            <Text style={styles.emptyText}>
              {month}{'\uC6D4 \uBC30\uCC28\uD45C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
            </Text>
            <Text style={styles.emptySub}>
              {'\uAD00\uB9AC\uC790\uC5D0\uAC8C \uBB38\uC758\uD558\uC138\uC694.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Calendar */}
            <View style={styles.calendarCard}>
              {/* Day headers */}
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

              {/* Calendar cells */}
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

                  let cellBg = '#fff';
                  if (slot?.status === 'DROPPED') cellBg = '#FEE2E2';
                  else if (slot?.isRestDay) cellBg = '#D1FAE5';
                  else if (slot) cellBg = '#DBEAFE';

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
                      {slot && !slot.isRestDay && slot.status !== 'DROPPED' && (
                        <Text style={styles.routeLabel} numberOfLines={1}>
                          {slot.route.routeNumber}
                        </Text>
                      )}
                      {slot?.isRestDay && (
                        <Text style={styles.restLabel}>{'\uD734'}</Text>
                      )}
                      {slot?.status === 'DROPPED' && (
                        <Text style={styles.droppedLabel}>{'\uB4DC\uB78D'}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Schedule List */}
            <View style={[styles.listCard, { marginBottom: 32 }]}>
              <Text style={styles.listTitle}>
                {'\uC6B4\uD589 \uBAA9\uB85D'}
              </Text>
              {slots
                .filter(s => !s.isRestDay)
                .map(slot => {
                  const date = new Date(slot.date);
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      style={styles.listRow}
                      onPress={() => setSelectedSlot(slot)}
                    >
                      <View style={styles.listDateCol}>
                        <Text style={styles.listDateText}>
                          {format(date, 'MM.dd')}
                        </Text>
                        <Text style={styles.listDayText}>
                          {DAYS_KR[date.getDay()]}
                        </Text>
                      </View>
                      <View style={styles.listRouteBox}>
                        <Text style={styles.listRouteNum}>
                          {slot.route.routeNumber}{'\uBC88'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.listRouteName}>
                          {slot.route.name}
                        </Text>
                        <Text style={styles.listShift}>
                          {SHIFT_KR[slot.shift] || slot.shift}
                        </Text>
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
                        <Text style={styles.listStatusText}>
                          {slot.status === 'DROPPED'
                            ? '\uB4DC\uB78D'
                            : slot.status === 'FILLED'
                              ? '\uB300\uCCB4'
                              : '\uC815\uC0C1'}
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
        <Modal visible animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {'\uBC30\uCC28 \uC0C1\uC138'}
                </Text>
                <TouchableOpacity
                  onPress={() => setSelectedSlot(null)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={28} color="#6B7280" />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                <View style={styles.detailRow}>
                  <Ionicons name="calendar" size={24} color="#1565C0" />
                  <Text style={styles.detailLabel}>{'\uB0A0\uC9DC'}</Text>
                  <Text style={styles.detailValue}>
                    {format(new Date(selectedSlot.date), 'yyyy\uB144 MM\uC6D4 dd\uC77C (EEE)', { locale: ko })}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="bus" size={24} color="#1565C0" />
                  <Text style={styles.detailLabel}>{'\uB178\uC120'}</Text>
                  <Text style={styles.detailValue}>
                    {selectedSlot.route.routeNumber}{'\uBC88 - '}{selectedSlot.route.name}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="time" size={24} color="#1565C0" />
                  <Text style={styles.detailLabel}>{'\uADFC\uBB34'}</Text>
                  <Text style={styles.detailValue}>
                    {SHIFT_KR[selectedSlot.shift] || selectedSlot.shift}
                  </Text>
                </View>
                {selectedSlot.bus && (
                  <View style={styles.detailRow}>
                    <Ionicons name="car" size={24} color="#1565C0" />
                    <Text style={styles.detailLabel}>{'\uCC28\uB7C9'}</Text>
                    <Text style={styles.detailValue}>
                      {selectedSlot.bus.busNumber}
                    </Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Ionicons name="flag" size={24} color="#1565C0" />
                  <Text style={styles.detailLabel}>{'\uC0C1\uD0DC'}</Text>
                  <Text style={styles.detailValue}>
                    {selectedSlot.isRestDay
                      ? '\uD734\uBB34'
                      : selectedSlot.status === 'DROPPED'
                        ? '\uB4DC\uB78D'
                        : selectedSlot.status === 'FILLED'
                          ? '\uB300\uCCB4'
                          : '\uC815\uC0C1 \uC6B4\uD589'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.modalDoneBtn}
                onPress={() => setSelectedSlot(null)}
              >
                <Text style={styles.modalDoneBtnText}>{'\uD655\uC778'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#6B7280', marginTop: 16 },

  // Month nav
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#1565C0',
  },
  navBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginHorizontal: 24,
    minWidth: 140,
    textAlign: 'center',
  },

  // Legend
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 6,
  },
  legendText: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '600',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statNum: { fontSize: 26, fontWeight: '800', color: '#111827' },
  statLabel: { fontSize: 16, color: '#6B7280', marginTop: 2, fontWeight: '600' },

  // Empty
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 20, fontWeight: '700', color: '#6B7280', marginTop: 16 },
  emptySub: { fontSize: 18, color: '#9CA3AF', marginTop: 8 },

  // Calendar
  calendarCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 16,
    padding: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  dayHeaders: { flexDirection: 'row', marginBottom: 6 },
  dayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#6B7280',
    paddingVertical: 6,
  },
  sunday: { color: '#EF4444' },
  saturday: { color: '#3B82F6' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    padding: 2,
  },
  todayCell: {
    borderWidth: 3,
    borderColor: '#1565C0',
  },
  dayNum: { fontSize: 18, fontWeight: '700', color: '#374151' },
  sundayText: { color: '#EF4444' },
  saturdayText: { color: '#3B82F6' },
  todayText: { fontWeight: '900', color: '#1565C0' },
  routeLabel: { fontSize: 11, color: '#1565C0', fontWeight: '800', marginTop: 1 },
  restLabel: { fontSize: 11, color: '#059669', fontWeight: '800' },
  droppedLabel: { fontSize: 10, color: '#DC2626', fontWeight: '800' },

  // Schedule list
  listCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
    elevation: 2,
  },
  listTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  listDateCol: { width: 56 },
  listDateText: { fontSize: 18, fontWeight: '700', color: '#374151' },
  listDayText: { fontSize: 16, color: '#9CA3AF', fontWeight: '600' },
  listRouteBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 12,
  },
  listRouteNum: { fontSize: 16, fontWeight: '800', color: '#1565C0' },
  listRouteName: { fontSize: 18, fontWeight: '600', color: '#374151' },
  listShift: { fontSize: 18, color: '#9CA3AF', fontWeight: '500' },
  listStatusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  chipNormal: { backgroundColor: '#D1FAE5' },
  chipDropped: { backgroundColor: '#FEE2E2' },
  chipFilled: { backgroundColor: '#DBEAFE' },
  listStatusText: { fontSize: 14, fontWeight: '700', color: '#374151' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 24, fontWeight: '800', color: '#111827' },
  modalCloseBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { padding: 24 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  detailLabel: {
    fontSize: 18,
    color: '#6B7280',
    fontWeight: '600',
    marginLeft: 12,
    width: 60,
  },
  detailValue: {
    fontSize: 18,
    color: '#111827',
    fontWeight: '700',
    flex: 1,
  },
  modalDoneBtn: {
    marginHorizontal: 24,
    backgroundColor: '#1565C0',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  modalDoneBtnText: { fontSize: 20, fontWeight: '800', color: '#fff' },
});
