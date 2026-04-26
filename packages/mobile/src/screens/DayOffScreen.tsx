import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Modal, Platform,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dayOffApi } from '../services/api';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isBefore, startOfDay } from 'date-fns';
import { ko } from 'date-fns/locale';

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
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (dateStr: string) => void;
}) {
  const [viewMonth, setViewMonth] = useState(new Date());
  const today = startOfDay(new Date());

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // leading empty cells
  const leadingBlanks = getDay(monthStart);

  return (
    <View style={cal.wrapper}>
      {/* Month nav */}
      <View style={cal.nav}>
        <TouchableOpacity onPress={() => setViewMonth(m => subMonths(m, 1))} style={cal.navBtn}>
          <Text style={cal.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={cal.navTitle}>{format(viewMonth, 'yyyy년 M월')}</Text>
        <TouchableOpacity onPress={() => setViewMonth(m => addMonths(m, 1))} style={cal.navBtn}>
          <Text style={cal.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Weekday headers */}
      <View style={cal.weekRow}>
        {WEEK_DAYS.map(d => (
          <Text key={d} style={[cal.weekDay, d === '일' && cal.sunday, d === '토' && cal.saturday]}>
            {d}
          </Text>
        ))}
      </View>

      {/* Day grid */}
      <View style={cal.grid}>
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <View key={`blank-${i}`} style={cal.cell} />
        ))}
        {days.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = isBefore(day, today);
          const isSelected = dateStr === selected;
          const isSunday = getDay(day) === 0;
          const isSaturday = getDay(day) === 6;

          return (
            <TouchableOpacity
              key={dateStr}
              style={[
                cal.cell,
                isSelected && cal.selectedCell,
                isPast && cal.pastCell,
              ]}
              onPress={() => !isPast && onSelect(dateStr)}
              disabled={isPast}
            >
              <Text style={[
                cal.dayText,
                isSelected && cal.selectedText,
                isPast && cal.pastText,
                !isSelected && isSunday && cal.sundayText,
                !isSelected && isSaturday && cal.saturdayText,
              ]}>
                {format(day, 'd')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function DayOffScreen() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [reason, setReason] = useState('');

  const { data: requests = [] } = useQuery<DayOffRequest[]>({
    queryKey: ['my-dayoff'],
    queryFn: () => dayOffApi.list().then(r => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: () => dayOffApi.create(selectedDate, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-dayoff'] });
      setShowModal(false);
      setSelectedDate('');
      setReason('');
      Alert.alert('완료', '휴무 요청이 제출되었습니다.\n관리자 승인 후 배차표에 반영됩니다.');
    },
    onError: (err: unknown) => {
      Alert.alert('오류', (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '오류가 발생했습니다.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => dayOffApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-dayoff'] });
    },
    onError: (err: unknown) => {
      Alert.alert('오류', (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '취소할 수 없습니다.');
    },
  });

  const statusColors: Record<string, string> = {
    PENDING: '#FEF9C3',
    APPROVED: '#DCFCE7',
    REJECTED: '#FEE2E2',
  };
  const statusTextColors: Record<string, string> = {
    PENDING: '#92400E',
    APPROVED: '#166534',
    REJECTED: '#991B1B',
  };
  const statusLabels: Record<string, string> = {
    PENDING: '대기 중',
    APPROVED: '✅ 승인',
    REJECTED: '❌ 거절',
  };

  const handleSubmit = () => {
    if (!selectedDate) {
      Alert.alert('오류', '날짜를 선택해주세요.');
      return;
    }
    Alert.alert(
      '휴무 요청',
      `${format(new Date(selectedDate), 'yyyy년 MM월 dd일 (EEEE)', { locale: ko })} 휴무를 요청하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        { text: '요청', onPress: () => createMutation.mutate() },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.list}>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowModal(true)}>
          <Text style={styles.addButtonText}>+ 휴무 요청 하기</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>내 휴무 요청 내역</Text>

        {requests.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>휴무 요청 내역이 없습니다.</Text>
          </View>
        ) : requests.map(req => (
          <View key={req.id} style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestDate}>
                {format(new Date(req.date), 'yyyy년 MM월 dd일 (EEEE)', { locale: ko })}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: statusColors[req.status] }]}>
                <Text style={[styles.statusText, { color: statusTextColors[req.status] }]}>
                  {statusLabels[req.status]}
                </Text>
              </View>
            </View>

            {req.reason && (
              <Text style={styles.requestReason}>사유: {req.reason}</Text>
            )}

            {req.reviewNote && (
              <View style={styles.reviewNoteBox}>
                <Text style={styles.reviewNoteLabel}>관리자 메모</Text>
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
                    Alert.alert('취소 확인', '휴무 요청을 취소하시겠습니까?', [
                      { text: '아니오', style: 'cancel' },
                      { text: '취소', style: 'destructive', onPress: () => cancelMutation.mutate(req.id) },
                    ]);
                  }}
                  style={styles.cancelBtn}
                >
                  <Text style={styles.cancelBtnText}>요청 취소</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Create Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="formSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>휴무 요청</Text>
            <TouchableOpacity onPress={() => { setShowModal(false); setSelectedDate(''); setReason(''); }}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            {/* Calendar */}
            <Text style={styles.inputLabel}>휴무 날짜 선택</Text>
            <CalendarPicker selected={selectedDate} onSelect={setSelectedDate} />

            {selectedDate ? (
              <View style={styles.selectedDateBox}>
                <Text style={styles.selectedDateText}>
                  📅 {format(new Date(selectedDate), 'yyyy년 MM월 dd일 (EEEE)', { locale: ko })}
                </Text>
              </View>
            ) : (
              <Text style={styles.selectHint}>위 달력에서 날짜를 선택해주세요</Text>
            )}

            <Text style={[styles.inputLabel, { marginTop: 20 }]}>사유 (선택)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={reason}
              onChangeText={setReason}
              placeholder="휴무 사유를 입력하세요..."
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalInfo}>
              <Text style={styles.modalInfoText}>
                📌 휴무 요청은 관리자 승인 후 배차표에 반영됩니다.{'\n'}
                승인 시 해당 슬롯이 빈 슬롯으로 공지되어 다른 기사님이 대체할 수 있습니다.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (!selectedDate || createMutation.isPending) && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!selectedDate || createMutation.isPending}
            >
              <Text style={styles.submitText}>
                {createMutation.isPending ? '제출 중...' : '휴무 요청 제출'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const cal = StyleSheet.create({
  wrapper: {
    backgroundColor: '#F9FAFB', borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 4,
  },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { padding: 8 },
  navArrow: { fontSize: 24, color: '#374151', fontWeight: '300' },
  navTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#6B7280', paddingVertical: 4 },
  sunday: { color: '#EF4444' },
  saturday: { color: '#3B82F6' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  selectedCell: { backgroundColor: '#1565C0', borderRadius: 20 },
  pastCell: {},
  dayText: { fontSize: 14, color: '#111827', fontWeight: '500' },
  selectedText: { color: '#fff', fontWeight: '700' },
  pastText: { color: '#D1D5DB' },
  sundayText: { color: '#EF4444' },
  saturdayText: { color: '#3B82F6' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  list: { flex: 1, padding: 16 },
  addButton: {
    backgroundColor: '#1565C0', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 20,
  },
  addButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginBottom: 12 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#9CA3AF' },
  requestCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8,
  },
  requestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  requestDate: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '600' },
  requestReason: { fontSize: 13, color: '#6B7280', marginBottom: 4 },
  reviewNoteBox: { backgroundColor: '#F5F3FF', borderRadius: 8, padding: 10, marginBottom: 6 },
  reviewNoteLabel: { fontSize: 11, fontWeight: '600', color: '#7C3AED', marginBottom: 2 },
  reviewNote: { fontSize: 13, color: '#6D28D9', fontStyle: 'italic' },
  requestFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  requestTime: { fontSize: 12, color: '#9CA3AF' },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: '#FEE2E2', borderRadius: 8 },
  cancelBtnText: { color: '#DC2626', fontSize: 12, fontWeight: '600' },
  modal: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  closeBtn: { fontSize: 20, color: '#9CA3AF' },
  modalBody: { padding: 20 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  selectedDateBox: {
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#BFDBFE', marginTop: 8,
  },
  selectedDateText: { fontSize: 15, fontWeight: '700', color: '#1565C0' },
  selectHint: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827',
  },
  textArea: { height: 90 },
  modalInfo: { backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, marginTop: 16 },
  modalInfoText: { fontSize: 13, color: '#1E40AF', lineHeight: 20 },
  submitBtn: {
    backgroundColor: '#1565C0', borderRadius: 16, padding: 16, alignItems: 'center', marginTop: 20,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
