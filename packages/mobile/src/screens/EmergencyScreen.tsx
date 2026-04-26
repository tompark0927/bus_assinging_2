import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, Modal, TextInput, Platform,
  ActivityIndicator, Animated, Vibration,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emergencyApi, schedulesApi, goldenTicketsApi } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ko } from 'date-fns/locale';

interface EmergencyDrop {
  id: number;
  reason: string;
  status: 'OPEN' | 'FILLED' | 'CANCELLED';
  createdAt: string;
  slot: {
    date: string;
    route: { routeNumber: string; name: string; fatigueScore?: number };
    bus?: { busNumber: string };
    shift: string;
  };
  driver: { id: number; name: string; phone: string };
}

interface GoldenTicket {
  id: number;
  status: string;
  earnedAt: string;
}

const SHIFT_KR: Record<string, string> = { MORNING: '오전', AFTERNOON: '오후', FULL_DAY: '종일' };

/** Render fatigue stars (0-5) */
function FatigueStars({ score }: { score?: number }) {
  const s = Math.min(Math.max(Math.round(score ?? 3), 0), 5);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={i <= s ? 'star' : 'star-outline'}
          size={16}
          color={i <= s ? '#F59E0B' : '#D1D5DB'}
        />
      ))}
      <Text style={{ fontSize: 14, color: '#6B7280', marginLeft: 4 }}>피로도</Text>
    </View>
  );
}

/** Time-ago badge */
function TimeAgo({ date }: { date: string }) {
  const ago = formatDistanceToNowStrict(new Date(date), { locale: ko, addSuffix: false });
  return (
    <View style={styles.timeAgoBadge}>
      <Ionicons name="time-outline" size={14} color="#6B7280" />
      <Text style={styles.timeAgoText}>~{ago} 전 요청됨</Text>
    </View>
  );
}

/** 수락 완료 축하 모달 */
function SuccessModal({ visible, onClose, ticketCount }: { visible: boolean; onClose: () => void; ticketCount: number }) {
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
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.successOverlay}>
        <Animated.View style={[styles.successCard, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.successEmoji}>🎉</Text>
          <Text style={styles.successTitle}>수락 완료!</Text>
          <Text style={styles.successMessage}>
            대타를 수락해주셔서 감사합니다
          </Text>

          <View style={styles.successTicketBox}>
            <Text style={styles.successTicketEmoji}>🎫</Text>
            <Text style={styles.successTicketText}>
              황금 티켓 1장 지급!
            </Text>
            <Text style={styles.successTicketTotal}>
              현재 보유: {ticketCount}장
            </Text>
          </View>

          <Text style={styles.successHint}>
            황금 티켓으로 원하는 날 쉴 수 있어요
          </Text>

          <TouchableOpacity
            style={styles.successCloseBtn}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.successCloseBtnText}>확인</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function EmergencyScreen() {
  const queryClient = useQueryClient();
  const [showDropModal, setShowDropModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [dropReason, setDropReason] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [dropSectionOpen, setDropSectionOpen] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // ── Queries ──

  const { data: openDrops = [], refetch: refetchDrops, isRefetching: isRefetchingDrops } = useQuery<EmergencyDrop[]>({
    queryKey: ['emergency-open'],
    queryFn: () => emergencyApi.list().then(r => r.data.data),
    refetchInterval: 5000,
  });

  const { data: schedule, refetch: refetchSchedule, isRefetching: isRefetchingSchedule } = useQuery({
    queryKey: ['my-schedule', year, month],
    queryFn: () => schedulesApi.getMySchedule(year, month).then(r => r.data.data),
  });

  const { data: goldenTickets = [], refetch: refetchTickets, isRefetching: isRefetchingTickets } = useQuery<GoldenTicket[]>({
    queryKey: ['golden-tickets'],
    queryFn: () => goldenTicketsApi.list().then(r => r.data.data),
  });

  const isRefetching = isRefetchingDrops || isRefetchingSchedule || isRefetchingTickets;

  const onRefresh = useCallback(() => {
    refetchDrops();
    refetchSchedule();
    refetchTickets();
  }, [refetchDrops, refetchSchedule, refetchTickets]);

  // ── Mutations ──

  const acceptMutation = useMutation({
    mutationFn: (id: number) => emergencyApi.accept(id),
    onSuccess: () => {
      Vibration.vibrate([0, 80, 60, 80]); // 성공 진동 피드백
      queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
      queryClient.invalidateQueries({ queryKey: ['my-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['golden-tickets'] });
      setShowSuccessModal(true);
    },
    onError: (err: unknown) => {
      Vibration.vibrate(300); // 실패 진동
      Alert.alert('오류', (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '이미 다른 기사님이 수락했습니다.');
    },
  });

  const dropMutation = useMutation({
    mutationFn: ({ slotId, reason }: { slotId: number; reason: string }) =>
      emergencyApi.create(slotId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
      setShowDropModal(false);
      setDropReason('');
      setSelectedSlotId(null);
      Alert.alert(
        '드랍 완료',
        '슬롯이 드랍되었습니다.\n오늘 쉬는 기사님들에게 알림이 발송되었습니다.',
      );
    },
    onError: (err: unknown) => {
      Alert.alert('오류', (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '오류 발생');
    },
  });

  // ── Derived data ──

  const todayStr = format(now, 'yyyy-MM-dd');
  const todaySlot = schedule?.slots?.find(
    (s: { date: string; isRestDay: boolean; status: string }) =>
      s.date?.startsWith(todayStr) && !s.isRestDay && s.status === 'SCHEDULED'
  );

  const availableTicketCount = goldenTickets.filter((t: GoldenTicket) => t.status === 'AVAILABLE').length;

  // ── Handlers ──

  const handleAccept = (drop: EmergencyDrop) => {
    const dateStr = format(new Date(drop.slot.date), 'M월 d일 (EEEE)', { locale: ko });
    Alert.alert(
      '대타 수락 확인',
      `이 슬롯을 수락하시겠습니까?\n\n${dateStr}\n${drop.slot.route.routeNumber}번 노선 (${SHIFT_KR[drop.slot.shift] || drop.slot.shift})\n\n수락하면 해당 날짜에 근무하게 됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '수락합니다', onPress: () => acceptMutation.mutate(drop.id) },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F3F4F6' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
      >

        {/* ━━━ Section 1: Golden Tickets ━━━ */}
        <View style={styles.ticketCard}>
          <View style={styles.ticketHeader}>
            <Text style={styles.ticketEmoji}>🎫</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.ticketLabel}>내 황금 티켓</Text>
              <Text style={styles.ticketCount}>
                보유: <Text style={styles.ticketNumber}>{availableTicketCount}장</Text>
              </Text>
            </View>
          </View>
          <Text style={styles.ticketDesc}>
            대타 1회 수락 = 티켓 1장 = 원하는 날 하루 쉬기
          </Text>
        </View>

        {/* ━━━ Section 2: Available Emergency Slots ━━━ */}
        <View style={styles.sectionHeader}>
          <Ionicons name="flash" size={22} color="#EF4444" />
          <Text style={styles.sectionTitle}>
            대타 요청
          </Text>
          {openDrops.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{openDrops.length}</Text>
            </View>
          )}
        </View>

        {openDrops.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>😌</Text>
            <Text style={styles.emptyText}>현재 대타 요청이 없습니다</Text>
            <Text style={styles.emptySubtext}>요청이 오면 알림으로 알려드립니다</Text>
          </View>
        ) : openDrops.map(drop => {
          const slotDate = new Date(drop.slot.date);
          const isToday = format(slotDate, 'yyyy-MM-dd') === todayStr;

          return (
            <View key={drop.id} style={[styles.emergencyCard, isToday && styles.todayEmergency]}>
              {isToday && (
                <View style={styles.todayBadge}>
                  <Ionicons name="alert-circle" size={16} color="#DC2626" />
                  <Text style={styles.todayBadgeText}>오늘 긴급</Text>
                </View>
              )}

              {/* Route number - BIG */}
              <View style={styles.emergencyHeader}>
                <View style={styles.routeCircle}>
                  <Text style={styles.routeCircleText}>{drop.slot.route.routeNumber}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emergencyDate}>
                    {format(slotDate, 'M월 d일 (EEEE)', { locale: ko })}
                  </Text>
                  <Text style={styles.emergencyShift}>
                    {SHIFT_KR[drop.slot.shift] || drop.slot.shift} 근무
                  </Text>
                </View>
              </View>

              {/* Time ago */}
              <TimeAgo date={drop.createdAt} />

              {/* Details */}
              <View style={styles.emergencyDetails}>
                <View style={styles.detailRow}>
                  <Ionicons name="person-outline" size={18} color="#6B7280" />
                  <Text style={styles.detailText}>드랍 기사: {drop.driver.name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="bus-outline" size={18} color="#6B7280" />
                  <Text style={styles.detailText}>{drop.slot.route.name}</Text>
                </View>
                {drop.slot.bus && (
                  <View style={styles.detailRow}>
                    <Ionicons name="car-outline" size={18} color="#6B7280" />
                    <Text style={styles.detailText}>버스: {drop.slot.bus.busNumber}</Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color="#6B7280" />
                  <Text style={styles.detailText}>사유: {drop.reason}</Text>
                </View>
                <FatigueStars score={drop.slot.route.fatigueScore} />
              </View>

              {/* Accept button — HUGE */}
              <TouchableOpacity
                style={[styles.acceptBtn, acceptMutation.isPending && styles.acceptBtnDisabled]}
                onPress={() => handleAccept(drop)}
                disabled={acceptMutation.isPending}
                activeOpacity={0.7}
              >
                {acceptMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="hand-left" size={28} color="#fff" />
                    <Text style={styles.acceptBtnText}>대타 수락</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* 보상 안내 — 더 크고 눈에 띄게 */}
              <View style={styles.rewardBanner}>
                <Text style={styles.rewardEmoji}>🎫</Text>
                <Text style={styles.rewardText}>수락하면 황금 티켓 1장!</Text>
              </View>

              {/* 건너뛰기 — 작고 눈에 안 띄게 */}
              <TouchableOpacity style={styles.skipBtn} activeOpacity={0.5}>
                <Text style={styles.skipBtnText}>지금은 못해요</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* ━━━ Section 3: Drop My Slot (collapsible) ━━━ */}
        {todaySlot && (
          <View style={styles.dropSection}>
            <TouchableOpacity
              style={styles.dropSectionHeader}
              onPress={() => setDropSectionOpen(prev => !prev)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="warning" size={22} color="#DC2626" />
                <Text style={styles.dropSectionTitle}>내 슬롯 드랍</Text>
              </View>
              <Ionicons
                name={dropSectionOpen ? 'chevron-up' : 'chevron-down'}
                size={24}
                color="#6B7280"
              />
            </TouchableOpacity>

            {dropSectionOpen && (
              <View style={styles.dropSectionBody}>
                <View style={styles.todaySlotInfo}>
                  <Text style={styles.todaySlotLabel}>오늘 내 배차</Text>
                  <Text style={styles.todaySlotRoute}>
                    {todaySlot.route?.routeNumber ?? '-'}번 노선
                  </Text>
                  <Text style={styles.todaySlotShift}>
                    {SHIFT_KR[todaySlot.shift] || todaySlot.shift} 근무
                  </Text>
                  {todaySlot.bus && (
                    <Text style={styles.todaySlotBus}>
                      버스: {todaySlot.bus.busNumber}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.dropMySlotBtn}
                  onPress={() => {
                    setSelectedSlotId(todaySlot.id);
                    setShowDropModal(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle" size={24} color="#fff" />
                  <Text style={styles.dropMySlotBtnText}>오늘 운행 못합니다</Text>
                </TouchableOpacity>

                <Text style={styles.dropWarningSmall}>
                  드랍하면 쉬는 기사님들에게 자동 알림이 발송됩니다
                </Text>
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* ━━━ 수락 완료 축하 모달 ━━━ */}
      <SuccessModal
        visible={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        ticketCount={availableTicketCount + 1}
      />

      {/* ━━━ Drop Slot Modal ━━━ */}
      <Modal visible={showDropModal} animationType="slide" presentationStyle="formSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>슬롯 드랍</Text>
            <TouchableOpacity
              onPress={() => setShowDropModal(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={28} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <View style={styles.warningBox}>
              <Ionicons name="alert-circle" size={24} color="#C2410C" style={{ marginBottom: 6 }} />
              <Text style={styles.warningText}>
                슬롯을 드랍하면 관리자와 오늘 쉬는 기사님들에게 즉시 알림이 발송됩니다.{'\n'}
                타당한 사유가 없으면 불이익이 있을 수 있습니다.
              </Text>
            </View>

            <Text style={styles.inputLabel}>드랍 사유 *</Text>
            <TextInput
              style={styles.textArea}
              value={dropReason}
              onChangeText={setDropReason}
              placeholder="드랍 사유를 구체적으로 입력해주세요..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.dropBtn, (!dropReason.trim() || dropMutation.isPending) && styles.disabledBtn]}
              onPress={() => {
                if (!dropReason.trim()) {
                  Alert.alert('오류', '사유를 입력해주세요.');
                  return;
                }
                if (!selectedSlotId) return;
                Alert.alert(
                  '드랍 확인',
                  '정말로 슬롯을 드랍하시겠습니까?\n드랍하면 되돌릴 수 없습니다.',
                  [
                    { text: '취소', style: 'cancel' },
                    {
                      text: '드랍',
                      style: 'destructive',
                      onPress: () => dropMutation.mutate({ slotId: selectedSlotId, reason: dropReason }),
                    },
                  ]
                );
              }}
              disabled={!dropReason.trim() || dropMutation.isPending}
            >
              {dropMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.dropBtnText}>슬롯 드랍</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Golden Ticket Card ──
  ticketCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    elevation: 2,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
  },
  ticketEmoji: {
    fontSize: 40,
  },
  ticketLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#92400E',
  },
  ticketCount: {
    fontSize: 20,
    fontWeight: '600',
    color: '#78350F',
    marginTop: 2,
  },
  ticketNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: '#D97706',
  },
  ticketDesc: {
    fontSize: 17,
    color: '#92400E',
    lineHeight: 24,
    fontWeight: '600',
  },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    flex: 1,
  },
  countBadge: {
    backgroundColor: '#EF4444',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },

  // ── Empty State ──
  empty: {
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 40,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#6B7280',
  },
  emptySubtext: {
    fontSize: 16,
    color: '#9CA3AF',
    marginTop: 6,
  },

  // ── Emergency Card ──
  emergencyCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    borderLeftWidth: 5,
    borderLeftColor: '#EF4444',
  },
  todayEmergency: {
    borderLeftColor: '#DC2626',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  todayBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todayBadgeText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#DC2626',
  },

  // ── Emergency Card Header ──
  emergencyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
  },
  routeCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeCircleText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
  },
  emergencyDate: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  emergencyShift: {
    fontSize: 18,
    color: '#4B5563',
    marginTop: 2,
    fontWeight: '600',
  },

  // ── Time ago badge ──
  timeAgoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  timeAgoText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },

  // ── Emergency Details ──
  emergencyDetails: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 18,
    color: '#4B5563',
    lineHeight: 22,
    flex: 1,
  },

  // ── Accept Button ──
  acceptBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 16,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  acceptBtnDisabled: {
    opacity: 0.6,
  },
  acceptBtnText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },

  // ── Reward Banner (수락 버튼 아래) ──
  rewardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  rewardEmoji: {
    fontSize: 20,
  },
  rewardText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#D97706',
  },

  // ── Skip Button ──
  skipBtn: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontSize: 15,
    color: '#9CA3AF',
  },

  // ── Success Modal ──
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
  successEmoji: {
    fontSize: 72,
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#16A34A',
    marginBottom: 8,
  },
  successMessage: {
    fontSize: 18,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 20,
  },
  successTicketBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    marginBottom: 16,
  },
  successTicketEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  successTicketText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#D97706',
  },
  successTicketTotal: {
    fontSize: 16,
    color: '#92400E',
    marginTop: 4,
    fontWeight: '600',
  },
  successHint: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  successCloseBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 14,
    height: 56,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCloseBtnText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },

  // ── Drop Section (collapsible) ──
  dropSection: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginTop: 24,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    overflow: 'hidden',
  },
  dropSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
  },
  dropSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#DC2626',
  },
  dropSectionBody: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: '#FEE2E2',
  },
  todaySlotInfo: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  todaySlotLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 6,
  },
  todaySlotRoute: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  todaySlotShift: {
    fontSize: 18,
    color: '#4B5563',
    marginTop: 4,
  },
  todaySlotBus: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  dropMySlotBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  dropMySlotBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  dropWarningSmall: {
    textAlign: 'center',
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 10,
  },

  // ── Modal ──
  modal: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  modalBody: {
    padding: 20,
  },
  warningBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FED7AA',
    alignItems: 'center',
  },
  warningText: {
    fontSize: 16,
    color: '#92400E',
    lineHeight: 24,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
  textArea: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: '#111827',
    height: 130,
    lineHeight: 26,
  },
  dropBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  dropBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
});
