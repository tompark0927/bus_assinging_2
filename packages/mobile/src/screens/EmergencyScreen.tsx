import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, Modal, TextInput, AppState,
  ActivityIndicator, Animated, Vibration,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { emergencyApi, schedulesApi } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ko } from 'date-fns/locale';
import * as Notifications from 'expo-notifications';
import EmptyState from '../components/EmptyState';
import { CardSkeleton } from '../components/Skeleton';
import { toast } from '../components/ToastHost';
import { useAuthStore } from '../store/authStore';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';
import { parseSlotDate, slotDateKey } from '../utils/date';

interface EmergencyDrop {
  id: number;
  reason: string;
  status: 'OPEN' | 'FILLED' | 'CANCELLED';
  createdAt: string;
  slot: {
    date: string;
    route: { routeNumber: string; name: string };
    bus?: { busNumber: string };
    shift: string;
  };
  driver: { id: number; name: string; phone: string };
}

interface ScheduleSlotLite {
  id: number;
  date: string;
  shift: string;
  isRestDay: boolean;
  status: string;
  route?: { routeNumber: string; name: string };
  bus?: { busNumber: string };
}

function TimeAgo({ date }: { date: string }) {
  const { t } = useTranslation();
  const ago = formatDistanceToNowStrict(new Date(date), { locale: ko, addSuffix: false });
  return (
    <View style={styles.timeAgoBadge}>
      <Ionicons name="time-outline" size={12} color={colors.textMuted} />
      <Text style={styles.timeAgoText}>{t('emergency.agoRequested', { ago })}</Text>
    </View>
  );
}

function SuccessModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 80,
        friction: 8,
        useNativeDriver: true,
      }).start();
    } else {
      scaleAnim.setValue(0);
    }
  }, [visible, scaleAnim]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.successOverlay}>
        <Animated.View style={[styles.successCard, { transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark" size={36} color={colors.white} />
          </View>
          <Text style={styles.successTitle}>{t('emergency.successTitle')}</Text>
          <Text style={styles.successMessage}>{t('emergency.successMsg')}</Text>

          <TouchableOpacity
            style={styles.successCloseBtn}
            onPress={onClose}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('common.ok')}
          >
            <Text style={styles.successCloseBtnText}>{t('common.ok')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function EmergencyScreen() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const currentUserId = useAuthStore(s => s.user?.id);
  const tShift = (s: string) => t(`shifts.${s}`, { defaultValue: s });
  const [showDropModal, setShowDropModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [dropReason, setDropReason] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [dropSectionOpen, setDropSectionOpen] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // 월말에 다음 달 근무일까지 대타 요청할 수 있도록 다음 달 배차도 함께 조회
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  const { data: openDrops = [], refetch: refetchDrops, isRefetching: isRefetchingDrops, isLoading: isLoadingDrops } = useQuery<EmergencyDrop[]>({
    queryKey: ['emergency-open'],
    queryFn: () => emergencyApi.list().then(r => r.data.data),
    refetchInterval: 5000,
  });

  // 본인이 드랍한 슬롯은 대타 목록에서 제외 (자기 슬롯을 자기가 받을 수 없음)
  const visibleDrops = openDrops.filter(d => d.driver.id !== currentUserId);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notif) => {
      const type = notif.request.content.data?.type as string | undefined;
      if (type === 'EMERGENCY_FILLED' || type === 'EMERGENCY_SLOT') {
        queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
        queryClient.invalidateQueries({ queryKey: ['my-schedule'] });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  const { data: schedule, refetch: refetchSchedule, isRefetching: isRefetchingSchedule } = useQuery({
    queryKey: ['my-schedule', year, month],
    queryFn: () => schedulesApi.getMySchedule(year, month).then(r => r.data.data),
  });

  const { data: nextSchedule, refetch: refetchNextSchedule } = useQuery({
    queryKey: ['my-schedule', nextYear, nextMonth],
    queryFn: () => schedulesApi.getMySchedule(nextYear, nextMonth).then(r => r.data.data),
  });

  const isRefetching = isRefetchingDrops || isRefetchingSchedule;

  const onRefresh = useCallback(() => {
    refetchDrops();
    refetchSchedule();
    refetchNextSchedule();
  }, [refetchDrops, refetchSchedule, refetchNextSchedule]);

  const acceptMutation = useMutation({
    mutationFn: (id: number) => emergencyApi.accept(id),
    onSuccess: () => {
      Vibration.vibrate([0, 80, 60, 80]);
      queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
      queryClient.invalidateQueries({ queryKey: ['my-schedule'] });
      setShowSuccessModal(true);
    },
    onError: (err: unknown) => {
      Vibration.vibrate(300);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || t('emergency.alreadyTaken');
      toast.error(msg);
    },
  });

  const dropMutation = useMutation({
    mutationFn: ({ slotId, reason }: { slotId: number; reason: string }) =>
      emergencyApi.create(slotId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
      // 팝업은 신청 시점에 이미 닫혔으므로 입력값만 초기화한다
      setShowDropModal(false);
      setDropReason('');
      setSelectedSlotId(null);
      toast.success(t('emergency.doneMsg'));
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || t('common.error');
      toast.error(msg);
    },
  });

  const todayKey = slotDateKey(now);
  // 오늘 포함 앞으로의 모든 근무일(SCHEDULED, 휴무 아님) — 날짜 오름차순
  const upcomingSlots: ScheduleSlotLite[] = [
    ...((schedule?.slots ?? []) as ScheduleSlotLite[]),
    ...((nextSchedule?.slots ?? []) as ScheduleSlotLite[]),
  ]
    .filter(s => !s.isRestDay && s.status === 'SCHEDULED' && slotDateKey(s.date) >= todayKey)
    .sort((a, b) => slotDateKey(a.date).localeCompare(slotDateKey(b.date)));

  // 칩으로 선택된 슬롯 (선택 전/선택 슬롯이 사라지면 가장 가까운 근무일로 폴백)
  const selectedSlot =
    upcomingSlots.find(s => s.id === selectedSlotId) ?? upcomingSlots[0] ?? null;
  // 모달에 표시할 슬롯 (요청 버튼을 누르는 순간 selectedSlotId 가 확정됨)
  const modalSlot = upcomingSlots.find(s => s.id === selectedSlotId) ?? null;

  const handleAccept = (drop: EmergencyDrop) => {
    const dateStr = format(parseSlotDate(drop.slot.date), 'M월 d일 (EEEE)', { locale: ko });
    Alert.alert(
      t('emergency.accept'),
      `${dateStr}\n${drop.slot.route.routeNumber}번 (${tShift(drop.slot.shift)})`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), onPress: () => acceptMutation.mutate(drop.id) },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing['4xl'] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Section: Available Emergency Slots */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionIconBox}>
            <Ionicons name="flash" size={16} color={colors.dangerDeep} />
          </View>
          <Text style={styles.sectionTitle}>{t('emergency.available')}</Text>
          {visibleDrops.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{visibleDrops.length}</Text>
            </View>
          )}
        </View>

        {isLoadingDrops ? (
          <View style={{ gap: spacing.md }}>
            <CardSkeleton />
            <CardSkeleton />
          </View>
        ) : visibleDrops.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            iconColor={colors.successDeep}
            iconBg={colors.successSoft}
            title={t('emergency.noneTitle')}
            subtitle={t('emergency.noneSub')}
          />
        ) : visibleDrops.map(drop => {
          const slotDate = parseSlotDate(drop.slot.date);
          const isToday = slotDateKey(drop.slot.date) === todayKey;

          return (
            <View key={drop.id} style={[styles.emergencyCard, isToday && styles.todayEmergency]}>
              {isToday && (
                <View style={styles.todayBadge}>
                  <Ionicons name="alert-circle" size={12} color={colors.dangerDeep} />
                  <Text style={styles.todayBadgeText}>{t('emergency.todayBadge')}</Text>
                </View>
              )}

              <View style={styles.emergencyHeader}>
                <View style={styles.routeCircle}>
                  <Text style={styles.routeCircleText}>{drop.slot.route.routeNumber}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emergencyDate}>
                    {format(slotDate, 'M월 d일 (EEEE)', { locale: ko })}
                  </Text>
                  <Text style={styles.emergencyShift}>
                    {t('home.shiftWork', { shift: tShift(drop.slot.shift) })}
                  </Text>
                </View>
              </View>

              <TimeAgo date={drop.createdAt} />

              <View style={styles.emergencyDetails}>
                <DetailRow icon="bus-outline" text={drop.slot.route.name} />
                {drop.slot.bus && <DetailRow icon="car-outline" text={t('emergency.busLabel', { bus: drop.slot.bus.busNumber })} />}
              </View>

              <TouchableOpacity
                style={[styles.acceptBtn, acceptMutation.isPending && styles.acceptBtnDisabled]}
                onPress={() => handleAccept(drop)}
                disabled={acceptMutation.isPending}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('emergency.accept')}
              >
                {acceptMutation.isPending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="hand-left" size={20} color={colors.white} />
                    <Text style={styles.acceptBtnText}>{t('emergency.accept')}</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.skipBtn} activeOpacity={0.5} accessibilityRole="button">
                <Text style={styles.skipBtnText}>{t('emergency.skip')}</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Section: Request a substitute for my upcoming shifts (collapsible) */}
        {upcomingSlots.length > 0 && (
          <View style={styles.dropSection}>
            <TouchableOpacity
              style={styles.dropSectionHeader}
              onPress={() => setDropSectionOpen(prev => !prev)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={[styles.sectionIconBox, { backgroundColor: colors.dangerSoft }]}>
                  <Ionicons name="warning" size={16} color={colors.dangerDeep} />
                </View>
                <Text style={styles.dropSectionTitle}>{t('emergency.askMyDayoff')}</Text>
              </View>
              <Ionicons
                name={dropSectionOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </TouchableOpacity>

            {dropSectionOpen && selectedSlot && (
              <View style={styles.dropSectionBody}>
                <Text style={styles.pickLabel}>{t('emergency.pickDate')}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {upcomingSlots.map(s => {
                    const d = parseSlotDate(s.date);
                    const isSel = s.id === selectedSlot.id;
                    const isToday = slotDateKey(s.date) === todayKey;
                    return (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.dateChip, isSel && styles.dateChipActive]}
                        onPress={() => setSelectedSlotId(s.id)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                      >
                        {isToday && <View style={[styles.chipDot, isSel && styles.chipDotActive]} />}
                        <Text style={[styles.dateChipDay, isSel && styles.dateChipTextActive]}>
                          {format(d, 'M/d')}
                        </Text>
                        <Text style={[styles.dateChipWeek, isSel && styles.dateChipTextActive]}>
                          {format(d, '(EEE)', { locale: ko })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View style={styles.todaySlotInfo}>
                  <Text style={styles.todaySlotLabel}>{t('emergency.selectedShift')}</Text>
                  <Text style={styles.todaySlotRoute}>
                    {selectedSlot.route?.routeNumber ?? '-'}번 노선
                  </Text>
                  <Text style={styles.todaySlotShift}>
                    {t('home.shiftWork', { shift: tShift(selectedSlot.shift) })}
                    {selectedSlot.bus ? `  ·  ${selectedSlot.bus.busNumber}` : ''}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.dropMySlotBtn}
                  onPress={() => {
                    setSelectedSlotId(selectedSlot.id);
                    setShowDropModal(true);
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('emergency.sendDayoff')}
                >
                  <Ionicons name="megaphone" size={18} color={colors.white} />
                  <Text style={styles.dropMySlotBtnText}>{t('emergency.sendDayoff')}</Text>
                </TouchableOpacity>

                <Text style={styles.dropWarningSmall}>{t('emergency.willNotify')}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <SuccessModal
        visible={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
      />

      <Modal
        visible={showDropModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDropModal(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('emergency.modalTitle')}</Text>
            <TouchableOpacity
              onPress={() => setShowDropModal(false)}
              style={styles.modalCloseBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={20} color={colors.textBody} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            {modalSlot && (
              <View style={styles.modalSlotChip}>
                <Ionicons name="calendar-outline" size={16} color={colors.dangerDeep} />
                <Text style={styles.modalSlotText}>
                  {format(parseSlotDate(modalSlot.date), 'M월 d일 (EEE)', { locale: ko })}
                  {'  ·  '}
                  {modalSlot.route?.routeNumber ?? '-'}번 ({tShift(modalSlot.shift)})
                </Text>
              </View>
            )}

            <View style={styles.warningBox}>
              <Ionicons name="alert-circle" size={18} color={colors.warningDeep} style={{ marginTop: 2 }} />
              <Text style={styles.warningText}>{t('emergency.warning')}</Text>
            </View>

            <Text style={styles.inputLabel}>{t('emergency.dropReasonLabel')}</Text>
            <TextInput
              style={styles.textArea}
              value={dropReason}
              onChangeText={setDropReason}
              placeholder={t('emergency.dropReasonPlaceholder')}
              placeholderTextColor={colors.textSubtle}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              accessibilityLabel={t('emergency.dropReasonLabel')}
            />

            <TouchableOpacity
              style={[styles.dropBtn, (!dropReason.trim() || dropMutation.isPending) && styles.disabledBtn]}
              onPress={() => {
                if (!dropReason.trim()) {
                  toast.error(t('emergency.dropReasonLabel'));
                  return;
                }
                if (!selectedSlotId) return;
                Alert.alert(
                  t('emergency.sendDayoff'),
                  '',
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('common.confirm'),
                      style: 'destructive',
                      onPress: () => {
                        // 신청과 동시에 입력 팝업을 내린다 (전송은 백그라운드로 진행)
                        setShowDropModal(false);
                        dropMutation.mutate({ slotId: selectedSlotId, reason: dropReason });
                      },
                    },
                  ]
                );
              }}
              disabled={!dropReason.trim() || dropMutation.isPending}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {dropMutation.isPending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.dropBtnText}>{t('emergency.sendDayoff')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.detailText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    color: colors.text,
    flex: 1,
    letterSpacing: -0.2,
  },
  countBadge: {
    backgroundColor: colors.danger,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: colors.white,
    fontSize: typography.sm,
    fontWeight: weight.bold,
  },

  // Emergency Card
  emergencyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    ...shadow.sm,
  },
  todayEmergency: {
    borderLeftColor: colors.dangerDeep,
    backgroundColor: '#fff5f5',
    borderColor: '#fecaca',
  },
  todayBadge: {
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  todayBadgeText: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: colors.dangerDeep,
  },

  emergencyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  routeCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeCircleText: {
    color: colors.white,
    fontSize: typography['2xl'],
    fontWeight: weight.extrabold,
    letterSpacing: -0.5,
  },
  emergencyDate: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  emergencyShift: {
    fontSize: typography.base,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: weight.semibold,
  },

  timeAgoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  timeAgoText: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: weight.medium,
  },

  emergencyDetails: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    fontSize: typography.base,
    color: colors.textBody,
    lineHeight: 20,
    flex: 1,
    fontWeight: weight.medium,
  },

  acceptBtn: {
    backgroundColor: colors.successDeep,
    borderRadius: radius.lg,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  acceptBtnDisabled: {
    opacity: 0.6,
  },
  acceptBtnText: {
    color: colors.white,
    fontSize: typography.lg,
    fontWeight: weight.bold,
    letterSpacing: 0.2,
  },

  skipBtn: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontSize: typography.base,
    color: colors.textSubtle,
    fontWeight: weight.medium,
  },

  // Success Modal
  successOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  successCard: {
    backgroundColor: colors.white,
    borderRadius: radius['2xl'],
    padding: spacing['2xl'],
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    ...shadow.lg,
  },
  successIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.successDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    fontSize: typography['2xl'],
    fontWeight: weight.bold,
    color: colors.text,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  successMessage: {
    fontSize: typography.base,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  successCloseBtn: {
    backgroundColor: colors.successDeep,
    borderRadius: radius.lg,
    height: 48,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCloseBtnText: {
    color: colors.white,
    fontSize: typography.lg,
    fontWeight: weight.bold,
  },

  // Drop Section
  dropSection: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: '#fecaca',
    overflow: 'hidden',
    ...shadow.xs,
  },
  dropSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  dropSectionTitle: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.dangerDeep,
  },
  dropSectionBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  pickLabel: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingRight: spacing.xs,
  },
  dateChip: {
    minWidth: 60,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateChipActive: {
    backgroundColor: colors.dangerDeep,
    borderColor: colors.dangerDeep,
  },
  dateChipDay: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  dateChipWeek: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: weight.medium,
    marginTop: 1,
  },
  dateChipTextActive: {
    color: colors.white,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.dangerDeep,
    marginBottom: 3,
  },
  chipDotActive: {
    backgroundColor: colors.white,
  },
  todaySlotInfo: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  todaySlotLabel: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: colors.warningText,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  todaySlotRoute: {
    fontSize: typography.xl,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  todaySlotShift: {
    fontSize: typography.base,
    color: colors.textBody,
    marginTop: 2,
    fontWeight: weight.medium,
  },
  dropMySlotBtn: {
    backgroundColor: colors.dangerDeep,
    borderRadius: radius.lg,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dropMySlotBtnText: {
    color: colors.white,
    fontSize: typography.md,
    fontWeight: weight.bold,
    letterSpacing: 0.2,
  },
  dropWarningSmall: {
    textAlign: 'center',
    fontSize: typography.sm,
    color: colors.textSubtle,
    marginTop: spacing.sm,
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: colors.white,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: typography.xl,
    fontWeight: weight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: spacing.xl,
  },
  modalSlotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  modalSlotText: {
    flex: 1,
    fontSize: typography.base,
    fontWeight: weight.bold,
    color: colors.dangerDeep,
    letterSpacing: -0.2,
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: '#fed7aa',
    gap: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: typography.base,
    color: colors.warningText,
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: typography.base,
    fontWeight: weight.semibold,
    color: colors.textBody,
    marginBottom: 6,
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: typography.md,
    color: colors.text,
    height: 120,
    backgroundColor: colors.white,
  },
  dropBtn: {
    backgroundColor: colors.dangerDeep,
    borderRadius: radius.lg,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  dropBtnText: {
    color: colors.white,
    fontSize: typography.lg,
    fontWeight: weight.bold,
    letterSpacing: 0.2,
  },
});
