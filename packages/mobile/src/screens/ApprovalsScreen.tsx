import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, TextInput, Modal, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { approvalsApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { format, addDays } from 'date-fns';
import { ko } from 'date-fns/locale';

interface ApprovalStep {
  id: number;
  stepOrder: number;
  status: string;
  comment: string | null;
  approver: { id: number; name: string };
}

interface Approval {
  id: number;
  type: string;
  title: string;
  content: string;
  status: string;
  data?: Record<string, unknown> | null;
  createdAt: string;
  requester: { id: number; name: string };
  steps: ApprovalStep[];
}

const TYPE_LABELS: Record<string, string> = {
  DAY_OFF: '휴무 신청',
  SHIFT_CHANGE: '교대 요청',
  EXPENSE: '경비 청구',
  MAINTENANCE: '차량 정비',
  INCIDENT: '사고 보고',
  PURCHASE: '물품 구매',
  OTHER: '기타',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: '대기중',
  IN_PROGRESS: '진행중',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '취소',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  PENDING: { bg: '#FEF3C7', text: '#92400E', icon: 'time' },
  IN_PROGRESS: { bg: '#DBEAFE', text: '#1E40AF', icon: 'hourglass' },
  APPROVED: { bg: '#D1FAE5', text: '#065F46', icon: 'checkmark-circle' },
  REJECTED: { bg: '#FEE2E2', text: '#991B1B', icon: 'close-circle' },
  CANCELLED: { bg: '#F3F4F6', text: '#6B7280', icon: 'ban' },
};

type TabType = 'my' | 'pending' | 'all';

export default function ApprovalsScreen() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('my');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [processComment, setProcessComment] = useState('');
  const [showProcess, setShowProcess] = useState<{
    approval: Approval;
    action: 'approve' | 'reject';
  } | null>(null);

  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['approvals', activeTab],
    queryFn: () => {
      const params: Record<string, string> =
        activeTab === 'pending'
          ? { role: 'approver' }
          : activeTab === 'my'
            ? { role: 'requester' }
            : {};
      return approvalsApi.list(params).then(r => r.data.data);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['approval-stats'],
    queryFn: () => approvalsApi.stats().then(r => r.data.data),
  });

  const processMutation = useMutation({
    mutationFn: ({
      id,
      action,
      comment,
    }: {
      id: number;
      action: 'approve' | 'reject';
      comment?: string;
    }) => approvalsApi.process(id, action, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      setShowProcess(null);
      setProcessComment('');
      Alert.alert('완료', '처리되었습니다.');
    },
    onError: () =>
      Alert.alert('오류', '처리에 실패했습니다.'),
  });

  const approvals: Approval[] = data || [];
  const tabs: { key: TabType; label: string; count?: number }[] = [
    { key: 'my', label: '내 결재' },
    { key: 'pending', label: '결재 대기', count: stats?.myPending || 0 },
    { key: 'all', label: '전체' },
  ];

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabRow}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive,
              ]}
            >
              {tab.label}
            </Text>
            {tab.count !== undefined && tab.count > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{tab.count}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
        >
          {approvals.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={64} color="#D1D5DB" />
              <Text style={styles.emptyText}>
                결재 내역이 없습니다.
              </Text>
            </View>
          ) : (
            approvals.map(approval => {
              const statusColor = STATUS_COLORS[approval.status] || STATUS_COLORS.PENDING;
              const dateInfo = approval.data && (approval.data as Record<string, string>).date;
              return (
                <TouchableOpacity
                  key={approval.id}
                  style={styles.card}
                  onPress={() => setSelectedApproval(approval)}
                  activeOpacity={0.7}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeText}>
                        {TYPE_LABELS[approval.type] || approval.type}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: statusColor.bg },
                      ]}
                    >
                      <Ionicons
                        name={statusColor.icon as any}
                        size={16}
                        color={statusColor.text}
                      />
                      <Text
                        style={[styles.statusText, { color: statusColor.text }]}
                      >
                        {STATUS_LABELS[approval.status] || approval.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.cardTitle}>{approval.title}</Text>

                  {dateInfo && (
                    <View style={styles.dateInfoRow}>
                      <Ionicons name="calendar-outline" size={16} color="#1565C0" />
                      <Text style={styles.dateInfoText}>
                        {format(new Date(dateInfo), 'yyyy년 M월 d일 (EEEE)', { locale: ko })}
                      </Text>
                    </View>
                  )}

                  <View style={styles.cardFooter}>
                    <Text style={styles.cardMeta}>{approval.requester.name}</Text>
                    <Text style={styles.cardMeta}>
                      {format(new Date(approval.createdAt), 'MM.dd HH:mm', {
                        locale: ko,
                      })}
                    </Text>
                  </View>

                  {/* Step progress */}
                  {approval.steps && approval.steps.length > 0 && (
                    <View style={styles.stepsRow}>
                      {approval.steps.map((step, idx) => (
                        <View key={step.id} style={styles.stepItem}>
                          <View
                            style={[
                              styles.stepDot,
                              step.status === 'APPROVED' && styles.stepApproved,
                              step.status === 'REJECTED' && styles.stepRejected,
                              step.status === 'PENDING' && styles.stepPending,
                            ]}
                          />
                          <Text style={styles.stepName} numberOfLines={1}>
                            {step.approver.name}
                          </Text>
                          {idx < approval.steps.length - 1 && (
                            <View style={styles.stepLine} />
                          )}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Action buttons */}
                  {activeTab === 'pending' &&
                    approval.status !== 'APPROVED' &&
                    approval.status !== 'REJECTED' && (
                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.approveBtn]}
                          onPress={() =>
                            setShowProcess({ approval, action: 'approve' })
                          }
                        >
                          <Ionicons
                            name="checkmark-circle"
                            size={22}
                            color="#065F46"
                          />
                          <Text style={styles.approveBtnText}>
                            승인
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.rejectBtn]}
                          onPress={() =>
                            setShowProcess({ approval, action: 'reject' })
                          }
                        >
                          <Ionicons
                            name="close-circle"
                            size={22}
                            color="#991B1B"
                          />
                          <Text style={styles.rejectBtnText}>
                            반려
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowCreate(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </TouchableOpacity>

      {/* Create Modal */}
      <CreateApprovalModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: ['approvals'] });
          queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
        }}
      />

      {/* Detail Modal */}
      {selectedApproval && (
        <Modal visible animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  결재 상세
                </Text>
                <TouchableOpacity
                  onPress={() => setSelectedApproval(null)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={28} color="#6B7280" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBody}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>유형</Text>
                  <Text style={styles.detailValue}>
                    {TYPE_LABELS[selectedApproval.type]}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>상태</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          STATUS_COLORS[selectedApproval.status]?.bg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        {
                          color:
                            STATUS_COLORS[selectedApproval.status]?.text,
                        },
                      ]}
                    >
                      {STATUS_LABELS[selectedApproval.status]}
                    </Text>
                  </View>
                </View>
                {selectedApproval.data && (selectedApproval.data as Record<string, string>).date && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>희망 날짜</Text>
                    <Text style={styles.detailValue}>
                      {format(new Date((selectedApproval.data as Record<string, string>).date), 'yyyy년 M월 d일 (EEEE)', { locale: ko })}
                    </Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>신청자</Text>
                  <Text style={styles.detailValue}>
                    {selectedApproval.requester.name}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>신청일</Text>
                  <Text style={styles.detailValue}>
                    {format(
                      new Date(selectedApproval.createdAt),
                      'yyyy.MM.dd HH:mm',
                      { locale: ko },
                    )}
                  </Text>
                </View>

                <Text style={styles.sectionTitle}>제목</Text>
                <Text style={styles.contentBox}>
                  {selectedApproval.title}
                </Text>

                <Text style={styles.sectionTitle}>내용</Text>
                <Text style={styles.contentBox}>
                  {selectedApproval.content}
                </Text>

                <Text style={styles.sectionTitle}>결재선</Text>
                {selectedApproval.steps?.map(step => (
                  <View key={step.id} style={styles.stepDetail}>
                    <View
                      style={[
                        styles.stepDot,
                        { width: 16, height: 16, borderRadius: 8 },
                        step.status === 'APPROVED' && styles.stepApproved,
                        step.status === 'REJECTED' && styles.stepRejected,
                        step.status === 'PENDING' && styles.stepPending,
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepDetailName}>
                        {step.stepOrder}차 - {step.approver.name}
                      </Text>
                      <Text style={styles.stepDetailStatus}>
                        {STATUS_LABELS[step.status] || step.status}
                      </Text>
                      {step.comment && (
                        <Text style={styles.stepComment}>
                          "{step.comment}"
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Cancel button */}
              {selectedApproval.requester.id === user?.id &&
                (selectedApproval.status === 'PENDING' ||
                  selectedApproval.status === 'IN_PROGRESS') && (
                  <TouchableOpacity
                    style={styles.cancelActionBtn}
                    onPress={() => {
                      Alert.alert(
                        '결재 취소',
                        '이 결재를 취소하시겠습니까?',
                        [
                          { text: '아니오' },
                          {
                            text: '예, 취소',
                            style: 'destructive',
                            onPress: () => {
                              approvalsApi
                                .cancel(selectedApproval.id)
                                .then(() => {
                                  queryClient.invalidateQueries({
                                    queryKey: ['approvals'],
                                  });
                                  setSelectedApproval(null);
                                  Alert.alert(
                                    '완료',
                                    '결재가 취소되었습니다.',
                                  );
                                });
                            },
                          },
                        ],
                      );
                    }}
                  >
                    <Text style={styles.cancelActionBtnText}>
                      결재 취소
                    </Text>
                  </TouchableOpacity>
                )}
            </View>
          </View>
        </Modal>
      )}

      {/* Process Modal */}
      {showProcess && (
        <Modal visible animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: 420 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {showProcess.action === 'approve'
                    ? '결재 승인'
                    : '결재 반려'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setShowProcess(null);
                    setProcessComment('');
                  }}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={28} color="#6B7280" />
                </TouchableOpacity>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.processTitle}>
                  {showProcess.approval.title}
                </Text>
                <TextInput
                  style={styles.commentInput}
                  placeholder={'의견을 입력하세요 (선택)'}
                  value={processComment}
                  onChangeText={setProcessComment}
                  multiline
                  numberOfLines={3}
                  placeholderTextColor="#9CA3AF"
                />
                <TouchableOpacity
                  style={[
                    styles.processBtn,
                    showProcess.action === 'approve'
                      ? styles.approveBtn
                      : styles.rejectBtn,
                  ]}
                  onPress={() =>
                    processMutation.mutate({
                      id: showProcess.approval.id,
                      action: showProcess.action,
                      comment: processComment || undefined,
                    })
                  }
                  disabled={processMutation.isPending}
                >
                  <Text
                    style={
                      showProcess.action === 'approve'
                        ? styles.approveBtnText
                        : styles.rejectBtnText
                    }
                  >
                    {processMutation.isPending
                      ? '처리중...'
                      : showProcess.action === 'approve'
                        ? '승인하기'
                        : '반려하기'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

/* ========== Create Approval Modal ========== */
function CreateApprovalModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [type, setType] = useState('DAY_OFF');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // DAY_OFF / SHIFT_CHANGE: 날짜 선택
  const [selectedDate, setSelectedDate] = useState<Date>(addDays(new Date(), 1));
  const [showDatePicker, setShowDatePicker] = useState(false);
  // EXPENSE: 금액
  const [amount, setAmount] = useState('');

  const needsDate = type === 'DAY_OFF' || type === 'SHIFT_CHANGE';
  const needsAmount = type === 'EXPENSE' || type === 'PURCHASE';

  // 날짜 선택 시 제목 자동 생성
  const autoTitle = () => {
    if (type === 'DAY_OFF') {
      return `${format(selectedDate, 'M월 d일', { locale: ko })} 휴무 신청`;
    }
    if (type === 'SHIFT_CHANGE') {
      return `${format(selectedDate, 'M월 d일', { locale: ko })} 교대 요청`;
    }
    return '';
  };

  const buildData = (): Record<string, unknown> | undefined => {
    if (needsDate) {
      return { date: format(selectedDate, 'yyyy-MM-dd') };
    }
    if (needsAmount && amount) {
      return { amount: Number(amount) };
    }
    return undefined;
  };

  const createMutation = useMutation({
    mutationFn: (payload: { type: string; title: string; content: string; data?: Record<string, unknown> }) =>
      approvalsApi.create(payload),
    onSuccess: () => {
      setType('DAY_OFF');
      setTitle('');
      setContent('');
      setAmount('');
      setSelectedDate(addDays(new Date(), 1));
      onSuccess();
      Alert.alert('완료', '결재가 신청되었습니다.');
    },
    onError: () =>
      Alert.alert('오류', '결재 신청에 실패했습니다.'),
  });

  const types = Object.entries(TYPE_LABELS);

  // 날짜 리스트 (내일부터 30일)
  const dateOptions: Date[] = [];
  for (let i = 1; i <= 30; i++) {
    dateOptions.push(addDays(new Date(), i));
  }

  const finalTitle = title.trim() || autoTitle();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>결재 신청</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={28} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={styles.inputLabel}>결재 유형</Text>
            <View style={styles.typeGrid}>
              {types.map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.typeOption,
                    type === key && styles.typeOptionActive,
                  ]}
                  onPress={() => setType(key)}
                >
                  <Text
                    style={[
                      styles.typeOptionText,
                      type === key && styles.typeOptionTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 날짜 선택 (휴무/교대) */}
            {needsDate && (
              <>
                <Text style={styles.inputLabel}>
                  {type === 'DAY_OFF' ? '휴무 희망 날짜' : '교대 희망 날짜'}
                </Text>
                <TouchableOpacity
                  style={styles.datePickerBtn}
                  onPress={() => setShowDatePicker(!showDatePicker)}
                >
                  <Ionicons name="calendar" size={22} color="#1565C0" />
                  <Text style={styles.datePickerText}>
                    {format(selectedDate, 'yyyy년 M월 d일 (EEEE)', { locale: ko })}
                  </Text>
                  <Ionicons name={showDatePicker ? 'chevron-up' : 'chevron-down'} size={20} color="#6B7280" />
                </TouchableOpacity>

                {showDatePicker && (
                  <ScrollView style={styles.dateList} nestedScrollEnabled>
                    {dateOptions.map(d => {
                      const isSelected = format(d, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                      const dayOfWeek = d.getDay();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                      return (
                        <TouchableOpacity
                          key={d.toISOString()}
                          style={[styles.dateOption, isSelected && styles.dateOptionActive]}
                          onPress={() => {
                            setSelectedDate(d);
                            setShowDatePicker(false);
                          }}
                        >
                          <Text style={[
                            styles.dateOptionText,
                            isSelected && styles.dateOptionTextActive,
                            isWeekend && { color: '#EF4444' },
                            isSelected && isWeekend && { color: '#fff' },
                          ]}>
                            {format(d, 'M월 d일 (EEEE)', { locale: ko })}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </>
            )}

            {/* 금액 (경비/구매) */}
            {needsAmount && (
              <>
                <Text style={styles.inputLabel}>금액 (원)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="예: 50000"
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="number-pad"
                  placeholderTextColor="#9CA3AF"
                />
              </>
            )}

            <Text style={styles.inputLabel}>제목</Text>
            <TextInput
              style={styles.input}
              placeholder={autoTitle() || '결재 제목을 입력하세요'}
              value={title}
              onChangeText={setTitle}
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.inputLabel}>내용</Text>
            <TextInput
              style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
              placeholder={
                type === 'DAY_OFF' ? '휴무 사유를 입력하세요 (예: 개인 사정, 병원 등)'
                : type === 'SHIFT_CHANGE' ? '교대 사유와 희망 조건을 입력하세요'
                : '결재 내용을 입력하세요'
              }
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={4}
              placeholderTextColor="#9CA3AF"
            />

            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!finalTitle || !content.trim()) && styles.submitBtnDisabled,
              ]}
              disabled={
                !finalTitle || !content.trim() || createMutation.isPending
              }
              onPress={() =>
                createMutation.mutate({
                  type,
                  title: finalTitle,
                  content: content.trim(),
                  data: buildData(),
                })
              }
            >
              <Text style={styles.submitBtnText}>
                {createMutation.isPending
                  ? '신청중...'
                  : '결재 신청'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  tabActive: { borderBottomWidth: 3, borderBottomColor: '#1565C0' },
  tabText: { fontSize: 18, fontWeight: '700', color: '#9CA3AF' },
  tabTextActive: { color: '#1565C0' },
  tabBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  tabBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // List
  list: { flex: 1, padding: 16 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 20, color: '#9CA3AF', marginTop: 16 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  typeBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  typeText: { fontSize: 18, fontWeight: '700', color: '#1565C0' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusText: { fontSize: 16, fontWeight: '700' },
  cardTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMeta: { fontSize: 16, color: '#9CA3AF', fontWeight: '500' },

  // Date info in card
  dateInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  dateInfoText: { fontSize: 18, fontWeight: '700', color: '#1565C0' },

  // Steps
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  stepItem: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E5E7EB',
    marginRight: 6,
  },
  stepApproved: { backgroundColor: '#10B981' },
  stepRejected: { backgroundColor: '#EF4444' },
  stepPending: { backgroundColor: '#F59E0B' },
  stepName: { fontSize: 16, color: '#6B7280', maxWidth: 70, fontWeight: '600' },
  stepLine: { flex: 1, height: 2, backgroundColor: '#E5E7EB', marginHorizontal: 4 },

  // Actions
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
  },
  approveBtn: { backgroundColor: '#D1FAE5' },
  approveBtnText: { fontSize: 18, fontWeight: '800', color: '#065F46' },
  rejectBtn: { backgroundColor: '#FEE2E2' },
  rejectBtnText: { fontSize: 18, fontWeight: '800', color: '#991B1B' },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },

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
    maxHeight: '90%',
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { padding: 24 },

  // Detail
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  detailLabel: { fontSize: 18, color: '#6B7280', fontWeight: '600' },
  detailValue: { fontSize: 18, color: '#111827', fontWeight: '700' },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginTop: 24,
    marginBottom: 10,
  },
  contentBox: {
    fontSize: 18,
    color: '#374151',
    lineHeight: 28,
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 14,
  },
  stepDetail: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  stepDetailName: { fontSize: 18, fontWeight: '700', color: '#111827' },
  stepDetailStatus: { fontSize: 16, color: '#6B7280', marginTop: 2 },
  stepComment: {
    fontSize: 16,
    color: '#1565C0',
    marginTop: 4,
    fontStyle: 'italic',
  },
  cancelActionBtn: {
    margin: 24,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
  },
  cancelActionBtnText: { fontSize: 20, fontWeight: '800', color: '#991B1B' },

  // Process
  processTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
  },
  commentInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    padding: 16,
    fontSize: 18,
    minHeight: 100,
    marginBottom: 20,
    textAlignVertical: 'top',
  },
  processBtn: {
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
  },

  // Create
  inputLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: '#374151',
    marginBottom: 10,
    marginTop: 20,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  typeOptionActive: { borderColor: '#1565C0', backgroundColor: '#EFF6FF' },
  typeOptionText: { fontSize: 18, fontWeight: '700', color: '#6B7280' },
  typeOptionTextActive: { color: '#1565C0' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    padding: 16,
    fontSize: 18,
    backgroundColor: '#fff',
  },

  // Date picker
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderColor: '#1565C0',
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#EFF6FF',
  },
  datePickerText: { flex: 1, fontSize: 18, fontWeight: '700', color: '#1565C0' },
  dateList: {
    maxHeight: 200,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  dateOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dateOptionActive: { backgroundColor: '#1565C0' },
  dateOptionText: { fontSize: 17, fontWeight: '600', color: '#374151' },
  dateOptionTextActive: { color: '#fff' },

  submitBtn: {
    marginTop: 28,
    marginBottom: 40,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: '#1565C0',
    alignItems: 'center',
  },
  submitBtnDisabled: { backgroundColor: '#93C5FD' },
  submitBtnText: { fontSize: 20, fontWeight: '800', color: '#fff' },
});
