import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Modal, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { dayOffApi, schedulesApi } from '../services/api';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isBefore, startOfDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import EmptyState from '../components/EmptyState';
import { CardSkeleton } from '../components/Skeleton';
import { toast } from '../components/ToastHost';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';
import { parseSlotDate, slotDateKey } from '../utils/date';

interface DayOffRequest {
  id: number;
  date: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  reviewNote?: string;
}

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function CalendarPicker({
  selectedDates,
  onToggle,
  initialMonth,
}: {
  selectedDates: string[];
  onToggle: (dateStr: string) => void;
  initialMonth?: Date;
}) {
  const [viewMonth, setViewMonth] = useState(initialMonth ?? new Date());
  const today = startOfDay(new Date());

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const leadingBlanks = getDay(monthStart);

  // 표시 중인 달의 내 배차 → 근무가 있는 날짜 집합 (날짜 밑 점 표시용)
  const { data: monthSchedule } = useQuery({
    queryKey: ['my-schedule', viewMonth.getFullYear(), viewMonth.getMonth() + 1],
    queryFn: () =>
      schedulesApi
        .getMySchedule(viewMonth.getFullYear(), viewMonth.getMonth() + 1)
        .then(r => r.data.data),
  });

  const workDayKeys = new Set<string>(
    (monthSchedule?.slots ?? [])
      .filter((s: { isRestDay: boolean; status: string }) => !s.isRestDay && s.status !== 'DROPPED')
      .map((s: { date: string }) => slotDateKey(s.date)),
  );

  return (
    <View style={cal.wrapper}>
      <View style={cal.nav}>
        <TouchableOpacity onPress={() => setViewMonth(m => subMonths(m, 1))} style={cal.navBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={colors.textBody} />
        </TouchableOpacity>
        <Text style={cal.navTitle}>{format(viewMonth, 'yyyy년 M월')}</Text>
        <TouchableOpacity onPress={() => setViewMonth(m => addMonths(m, 1))} style={cal.navBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-forward" size={18} color={colors.textBody} />
        </TouchableOpacity>
      </View>

      <View style={cal.weekRow}>
        {WEEK_DAYS.map(d => (
          <Text key={d} style={[cal.weekDay, d === '일' && cal.sunday, d === '토' && cal.saturday]}>
            {d}
          </Text>
        ))}
      </View>

      <View style={cal.grid}>
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <View key={`blank-${i}`} style={cal.cell} />
        ))}
        {days.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = isBefore(day, today);
          const isSelected = selectedDates.includes(dateStr);
          const isSunday = getDay(day) === 0;
          const isSaturday = getDay(day) === 6;
          const isWorkDay = workDayKeys.has(dateStr);

          return (
            <TouchableOpacity
              key={dateStr}
              style={cal.cell}
              onPress={() => !isPast && onToggle(dateStr)}
              disabled={isPast}
              activeOpacity={0.6}
            >
              <View style={[cal.cellInner, isSelected && cal.selectedCell]}>
                <Text style={[
                  cal.dayText,
                  isSelected && cal.selectedText,
                  isPast && cal.pastText,
                  !isSelected && isSunday && cal.sundayText,
                  !isSelected && isSaturday && cal.saturdayText,
                ]}>
                  {format(day, 'd')}
                </Text>
                {isWorkDay && (
                  <View style={[cal.workDot, isSelected && cal.workDotSelected]} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function DayOffScreen() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const [showModal, setShowModal] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  // 홈 화면의 "다음 달 휴무 미리 신청" 팝업에서 진입한 경우
  const initialMonth: Date | undefined = route.params?.initialMonth
    ? new Date(route.params.initialMonth)
    : undefined;

  useEffect(() => {
    if (route.params?.openCreate) {
      setShowModal(true);
      // 파라미터 1회 소비 (탭 재방문 시 다시 안 열리도록)
      navigation.setParams({ openCreate: undefined });
    }
  }, [route.params?.openCreate, navigation]);

  const toggleDate = (dateStr: string) => {
    setSelectedDates(prev =>
      prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]
    );
  };

  const { data: rawRequests = [], isLoading, refetch, isRefetching } = useQuery<DayOffRequest[]>({
    queryKey: ['my-dayoff'],
    queryFn: () => dayOffApi.list().then(r => r.data.data),
  });

  // 휴가 잔액 — 신청(PENDING 포함) 즉시 차감, 반려/취소 시 복원 (서버 계산)
  const { data: balance } = useQuery<{ total: number; used: number; remaining: number }>({
    queryKey: ['dayoff-balance'],
    queryFn: () => dayOffApi.balance().then(r => r.data.data),
  });

  // 최근 요청이 위로 오도록 정렬 (createdAt 내림차순)
  const requests = [...rawRequests].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        selectedDates.map(d => dayOffApi.create(d, reason))
      );
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`${failures.length}개의 날짜 요청에 실패했습니다.`);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-dayoff'] });
      queryClient.invalidateQueries({ queryKey: ['dayoff-balance'] });
      const count = selectedDates.length;
      setShowModal(false);
      setSelectedDates([]);
      setReason('');
      toast.success(t('dayoff.doneN', { count }));
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err instanceof Error ? err.message : t('common.error'));
      toast.error(msg);
      queryClient.invalidateQueries({ queryKey: ['my-dayoff'] });
      queryClient.invalidateQueries({ queryKey: ['dayoff-balance'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => dayOffApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-dayoff'] });
      queryClient.invalidateQueries({ queryKey: ['dayoff-balance'] });
      toast.success(t('common.done'));
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || t('common.error');
      toast.error(msg);
    },
  });

  const statusMeta: Record<string, { bg: string; color: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
    PENDING:  { bg: colors.warningSoft, color: colors.warningText, label: t('dayoff.status.PENDING'),  icon: 'time-outline' },
    APPROVED: { bg: colors.successSoft, color: colors.successText, label: t('dayoff.status.APPROVED'), icon: 'checkmark-circle' },
    REJECTED: { bg: colors.dangerSoft,  color: colors.dangerText,  label: t('dayoff.status.REJECTED'), icon: 'close-circle' },
  };

  const handleSubmit = () => {
    if (selectedDates.length === 0) {
      toast.error(t('dayoff.selectHint'));
      return;
    }
    const sorted = [...selectedDates].sort();
    const preview =
      sorted.length === 1
        ? format(parseSlotDate(sorted[0]), 'yyyy년 MM월 dd일 (EEEE)', { locale: ko })
        : `${sorted.length}일 (${format(parseSlotDate(sorted[0]), 'MM.dd', { locale: ko })} 외 ${sorted.length - 1}개)`;

    Alert.alert(
      t('dayoff.request'),
      `${preview} 휴무를 요청하시겠습니까?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), onPress: () => createMutation.mutate() },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing['3xl'] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowModal(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('dayoff.requestNew')}
        >
          <Ionicons name="add" size={20} color={colors.white} style={{ marginRight: 6 }} />
          <Text style={styles.addButtonText}>{t('dayoff.requestNew')}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>{t('dayoff.history')}</Text>

        {isLoading ? (
          <View style={{ gap: spacing.md }}>
            <CardSkeleton />
            <CardSkeleton />
          </View>
        ) : requests.length === 0 ? (
          <EmptyState icon="document-text-outline" title={t('dayoff.noHistory')} />
        ) : requests.map(req => {
          const meta = statusMeta[req.status];
          return (
            <View key={req.id} style={styles.requestCard}>
              <View style={styles.requestHeader}>
                <Text style={styles.requestDate}>
                  {format(parseSlotDate(req.date), 'yyyy년 MM월 dd일 (EEEE)', { locale: ko })}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={12} color={meta.color} style={{ marginRight: 3 }} />
                  <Text style={[styles.statusText, { color: meta.color }]}>
                    {meta.label}
                  </Text>
                </View>
              </View>

              {req.reason && (
                <Text style={styles.requestReason}>
                  <Text style={{ color: colors.textMuted, fontWeight: weight.semibold }}>{t('dayoff.reasonLabel')} · </Text>
                  {req.reason}
                </Text>
              )}

              {req.reviewNote && (
                <View style={styles.reviewNoteBox}>
                  <Text style={styles.reviewNoteLabel}>{t('dayoff.reviewNote')}</Text>
                  <Text style={styles.reviewNote}>{req.reviewNote}</Text>
                </View>
              )}

              <View style={styles.requestFooter}>
                <Text style={styles.requestTime}>
                  {format(new Date(req.createdAt), 'MM.dd HH:mm 요청')}
                </Text>
                {req.status === 'PENDING' && (
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(t('dayoff.cancelConfirm'), '', [
                        { text: t('common.no'), style: 'cancel' },
                        { text: t('common.yes'), style: 'destructive', onPress: () => cancelMutation.mutate(req.id) },
                      ]);
                    }}
                    style={styles.cancelBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('dayoff.cancelRequest')}
                  >
                    <Text style={styles.cancelBtnText}>{t('dayoff.cancelRequest')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Create Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setShowModal(false); setSelectedDates([]); setReason(''); }}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('dayoff.request')}</Text>
            <TouchableOpacity
              onPress={() => { setShowModal(false); setSelectedDates([]); setReason(''); }}
              style={styles.modalCloseBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={20} color={colors.textBody} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
            <View style={styles.labelRow}>
              <Text style={[styles.inputLabel, { flex: 1 }]} numberOfLines={1}>{t('dayoff.selectDates')}</Text>
              {balance != null && (
                <View style={[styles.balancePill, balance.remaining <= 0 && styles.balancePillEmpty]}>
                  <Text style={[styles.balancePillText, balance.remaining <= 0 && styles.balancePillTextEmpty]}>
                    {t('dayoff.remaining', { count: balance.remaining })}
                  </Text>
                </View>
              )}
            </View>
            <CalendarPicker selectedDates={selectedDates} onToggle={toggleDate} initialMonth={initialMonth} />

            {selectedDates.length > 0 ? (
              <View style={styles.chipsBox}>
                <View style={styles.chipsHeader}>
                  <Text style={styles.chipsCount}>{t('dayoff.selectedCount', { count: selectedDates.length })}</Text>
                  <TouchableOpacity
                    onPress={() => setSelectedDates([])}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('dayoff.clearAll')}
                  >
                    <Text style={styles.clearLink}>{t('dayoff.clearAll')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.chips}>
                  {[...selectedDates].sort().map(d => (
                    <View key={d} style={styles.chip}>
                      <Text style={styles.chipText}>
                        {format(parseSlotDate(d), 'M.d (EEE)', { locale: ko })}
                      </Text>
                      <TouchableOpacity
                        onPress={() => toggleDate(d)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.delete')}
                      >
                        <Ionicons name="close" size={12} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.selectHint}>{t('dayoff.selectHint')}</Text>
            )}

            <Text style={[styles.inputLabel, { marginTop: spacing.lg }]}>{t('dayoff.reasonLabel')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={reason}
              onChangeText={setReason}
              placeholder={t('dayoff.reasonPlaceholder')}
              placeholderTextColor={colors.textSubtle}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel={t('dayoff.reasonLabel')}
            />

            <View style={styles.modalInfo}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} style={{ marginTop: 2 }} />
              <Text style={styles.modalInfoText}>{t('dayoff.info')}</Text>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (selectedDates.length === 0 || createMutation.isPending) && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={selectedDates.length === 0 || createMutation.isPending}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.submitText}>
                {createMutation.isPending
                  ? t('dayoff.submitting')
                  : selectedDates.length > 1
                    ? t('dayoff.requestSubmitN', { count: selectedDates.length })
                    : t('dayoff.requestSubmit')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const cal = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  navTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: typography.sm, fontWeight: weight.semibold, color: colors.textMuted, paddingVertical: 4 },
  sunday: { color: colors.danger },
  saturday: { color: colors.primaryLight },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', aspectRatio: 1, padding: 3, alignItems: 'center', justifyContent: 'center' },
  cellInner: { width: '100%', height: '100%', borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  selectedCell: { backgroundColor: colors.primary },
  workDot: {
    position: 'absolute',
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  workDotSelected: { backgroundColor: colors.white },
  dayText: { fontSize: typography.base, color: colors.text, fontWeight: weight.medium, lineHeight: typography.base * 1.1 },
  selectedText: { color: colors.white, fontWeight: weight.bold },
  pastText: { color: colors.textDisabled },
  sundayText: { color: colors.danger },
  saturdayText: { color: colors.primaryLight },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    marginBottom: spacing.xl,
    ...shadow.sm,
  },
  addButtonText: { color: colors.white, fontSize: typography.lg, fontWeight: weight.bold, letterSpacing: 0.2 },

  sectionTitle: {
    fontSize: typography.base,
    fontWeight: weight.bold,
    color: colors.textMuted,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  requestCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.xs,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  requestDate: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.text,
    flex: 1,
    letterSpacing: -0.2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  statusText: { fontSize: typography.sm, fontWeight: weight.bold },
  requestReason: { fontSize: typography.base, color: colors.textBody, marginBottom: 4, lineHeight: 20 },
  reviewNoteBox: {
    backgroundColor: colors.primaryGhost,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  reviewNoteLabel: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.primary, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  reviewNote: { fontSize: typography.base, color: colors.textBody, lineHeight: 20 },
  requestFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  requestTime: { fontSize: typography.sm, color: colors.textSubtle, fontWeight: weight.medium },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.full,
  },
  cancelBtnText: { color: colors.dangerDeep, fontSize: typography.sm, fontWeight: weight.bold },

  modal: { flex: 1, backgroundColor: colors.white },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.text, letterSpacing: -0.3 },
  balancePill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    marginLeft: spacing.sm,
  },
  balancePillEmpty: { backgroundColor: colors.dangerSoft },
  balancePillText: { fontSize: typography.md, fontWeight: weight.bold, color: colors.primaryOnText },
  balancePillTextEmpty: { color: colors.dangerText },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { flex: 1 },
  inputLabel: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.textBody, marginBottom: 6 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  clearLink: {
    fontSize: typography.sm,
    color: colors.primary,
    fontWeight: weight.semibold,
  },
  chipsBox: {
    backgroundColor: colors.primaryGhost,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  chipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipsCount: {
    fontSize: typography.base,
    color: colors.textBody,
    fontWeight: weight.semibold,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: radius.full,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: typography.sm,
    color: colors.primary,
    fontWeight: weight.bold,
  },
  selectHint: { fontSize: typography.base, color: colors.textSubtle, textAlign: 'center', marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: typography.md,
    color: colors.text,
    backgroundColor: colors.white,
  },
  textArea: { height: 90 },
  modalInfo: {
    flexDirection: 'row',
    backgroundColor: colors.primaryGhost,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  modalInfoText: { flex: 1, fontSize: typography.base, color: colors.primaryActive, lineHeight: 20 },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: colors.white, fontSize: typography.lg, fontWeight: weight.bold, letterSpacing: 0.2 },
});
