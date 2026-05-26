import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarOff,
  Check,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  MessageSquare,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { dayOffApi } from '../services/api';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameMonth,
  addMonths,
  subMonths,
  isToday,
  parseISO,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DayOffRequest {
  id: number;
  date: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote?: string | null;
  createdAt: string;
  driver: { id: number; name: string; employeeId: string };
}

type StatusFilter = '' | 'PENDING' | 'APPROVED' | 'REJECTED';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  'PENDING' | 'APPROVED' | 'REJECTED',
  { label: string; bg: string; text: string; icon: typeof Clock }
> = {
  PENDING: { label: '대기중', bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock },
  APPROVED: { label: '승인', bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle2 },
  REJECTED: { label: '반려', bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
};

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'PENDING', label: '대기중' },
  { key: 'APPROVED', label: '승인됨' },
  { key: 'REJECTED', label: '반려됨' },
];

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateKey(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DayOffPage() {
  const queryClient = useQueryClient();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date());

  // Review modal state
  const [reviewModal, setReviewModal] = useState<{
    id: number;
    name: string;
    date: string;
    action: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth() + 1;
  const monthParam = `${year}-${String(month).padStart(2, '0')}`;

  const {
    data: requests = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<DayOffRequest[]>({
    queryKey: ['dayoff', statusFilter, monthParam],
    queryFn: () =>
      dayOffApi
        .list({
          ...(statusFilter ? { status: statusFilter } : {}),
          month: monthParam,
        })
        .then((r) => r.data.data),
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: number;
      status: 'APPROVED' | 'REJECTED';
      note: string;
    }) => dayOffApi.review(id, status, note),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['dayoff'] });
      if (vars.status === 'APPROVED') {
        const slotNotified = _res.data?.slotNotified;
        toast.success(
          slotNotified
            ? '승인 완료 - 빈 슬롯이 생성되어 쉬는 기사님들에게 알림이 발송되었습니다.'
            : '휴무 요청이 승인되었습니다.',
        );
      } else {
        toast.success('휴무 요청이 반려되었습니다.');
      }
      setReviewModal(null);
      setReviewNote('');
    },
    onError: () => {
      toast.error('처리 중 오류가 발생했습니다. 다시 시도해주세요.');
    },
  });

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, total: 0 };
    for (const req of requests) {
      c[req.status]++;
      c.total++;
    }
    return c;
  }, [requests]);

  // Calendar: approved requests grouped by date
  const approvedByDate = useMemo(() => {
    const map = new Map<string, { name: string; employeeId: string }[]>();
    for (const req of requests) {
      if (req.status !== 'APPROVED') continue;
      const key = toDateKey(req.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ name: req.driver.name, employeeId: req.driver.employeeId });
    }
    return map;
  }, [requests]);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end = endOfMonth(selectedMonth);
    const days = eachDayOfInterval({ start, end });
    const startPadding = getDay(start); // 0=Sun
    return { days, startPadding };
  }, [selectedMonth]);

  // ---------------------------------------------------------------------------
  // Month navigation
  // ---------------------------------------------------------------------------

  const goToPrevMonth = () => setSelectedMonth((m) => subMonths(m, 1));
  const goToNextMonth = () => setSelectedMonth((m) => addMonths(m, 1));
  const goToCurrentMonth = () => setSelectedMonth(new Date());

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderStatusBadge(status: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const cfg = STATUS_CONFIG[status];
    const Icon = cfg.icon;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] font-semibold ${cfg.bg} ${cfg.text}`}
      >
        <Icon size={16} />
        {cfg.label}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-gray-900">휴무 관리</h1>
          <p className="text-[16px] text-gray-500 mt-1">
            기사님들의 휴무 요청을 검토하고 승인 또는 반려하세요.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors min-h-[48px]"
        >
          <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="대기중"
          count={counts.PENDING}
          icon={Clock}
          iconBg="bg-yellow-100"
          iconColor="text-yellow-600"
        />
        <SummaryCard
          label="승인"
          count={counts.APPROVED}
          icon={CheckCircle2}
          iconBg="bg-green-100"
          iconColor="text-green-600"
        />
        <SummaryCard
          label="반려"
          count={counts.REJECTED}
          icon={XCircle}
          iconBg="bg-red-100"
          iconColor="text-red-600"
        />
        <SummaryCard
          label="이번 달 총 요청"
          count={counts.total}
          icon={CalendarDays}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />
      </div>

      {/* Month selector + filter tabs */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Month selector */}
          <div className="flex items-center gap-2">
            <button
              onClick={goToPrevMonth}
              className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-100 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
              aria-label="이전 달"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-[18px] font-bold text-gray-900 min-w-[140px] text-center">
              {format(selectedMonth, 'yyyy년 MM월', { locale: ko })}
            </span>
            <button
              onClick={goToNextMonth}
              className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-100 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
              aria-label="다음 달"
            >
              <ChevronRight size={20} />
            </button>
            <button
              onClick={goToCurrentMonth}
              className="ml-2 px-4 min-h-[48px] rounded-xl border border-gray-200 hover:bg-gray-100 transition-colors text-[16px] font-medium text-gray-600"
            >
              이번 달
            </button>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gray-400 mr-1" />
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-4 min-h-[48px] rounded-xl text-[16px] font-semibold transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content: table + calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Request table (2/3 width on xl) */}
        <div className="xl:col-span-2">
          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-[18px] font-bold text-gray-900">휴무 요청 목록</h2>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Loader2 size={40} className="animate-spin mb-3" />
                <p className="text-[16px]">불러오는 중...</p>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-20 text-red-400">
                <AlertTriangle size={40} className="mb-3" />
                <p className="text-[16px] font-medium">데이터를 불러오지 못했습니다.</p>
                <p className="text-[14px] text-gray-400 mt-1">
                  {(error as Error)?.message || '네트워크 오류'}
                </p>
              </div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <CalendarOff size={48} className="text-gray-300 mb-4" />
                <p className="text-[18px] font-medium text-gray-400">휴무 요청이 없습니다.</p>
                <p className="text-[14px] text-gray-300 mt-1">
                  선택한 기간에 해당하는 요청이 없습니다.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-6 py-4 text-[14px] font-bold text-gray-500">
                        기사
                      </th>
                      <th className="text-left px-6 py-4 text-[14px] font-bold text-gray-500">
                        사원번호
                      </th>
                      <th className="text-left px-6 py-4 text-[14px] font-bold text-gray-500">
                        휴무 날짜
                      </th>
                      <th className="text-left px-6 py-4 text-[14px] font-bold text-gray-500">
                        사유
                      </th>
                      <th className="text-left px-6 py-4 text-[14px] font-bold text-gray-500">
                        상태
                      </th>
                      <th className="text-right px-6 py-4 text-[14px] font-bold text-gray-500">
                        처리
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {requests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                        {/* Driver name */}
                        <td className="px-6 py-4">
                          <span className="text-[16px] font-semibold text-gray-900">
                            {req.driver.name}
                          </span>
                        </td>

                        {/* Employee ID */}
                        <td className="px-6 py-4">
                          <span className="text-[14px] text-gray-500 font-mono">
                            {req.driver.employeeId}
                          </span>
                        </td>

                        {/* Request dates */}
                        <td className="px-6 py-4">
                          <span className="text-[16px] font-medium text-gray-900">
                            {format(parseISO(req.date), 'MM월 dd일 (EEE)', { locale: ko })}
                          </span>
                          <div className="text-[13px] text-gray-400 mt-0.5">
                            요청: {format(parseISO(req.createdAt), 'MM.dd HH:mm')}
                          </div>
                        </td>

                        {/* Reason */}
                        <td className="px-6 py-4 max-w-[200px]">
                          {req.reason ? (
                            <span className="text-[15px] text-gray-700 line-clamp-2">
                              {req.reason}
                            </span>
                          ) : (
                            <span className="text-[14px] text-gray-300 italic">사유 없음</span>
                          )}
                          {req.reviewNote && (
                            <div className="flex items-start gap-1 mt-1.5">
                              <MessageSquare size={13} className="text-gray-400 mt-0.5 shrink-0" />
                              <span className="text-[13px] text-gray-400 line-clamp-2">
                                {req.reviewNote}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Status badge */}
                        <td className="px-6 py-4">{renderStatusBadge(req.status)}</td>

                        {/* Actions */}
                        <td className="px-6 py-4">
                          {req.status === 'PENDING' ? (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() =>
                                  setReviewModal({
                                    id: req.id,
                                    name: req.driver.name,
                                    date: req.date,
                                    action: 'APPROVED',
                                  })
                                }
                                className="flex items-center gap-1.5 px-4 min-h-[48px] bg-green-50 text-green-700 rounded-xl text-[16px] font-semibold hover:bg-green-100 transition-colors"
                              >
                                <Check size={18} />
                                승인
                              </button>
                              <button
                                onClick={() =>
                                  setReviewModal({
                                    id: req.id,
                                    name: req.driver.name,
                                    date: req.date,
                                    action: 'REJECTED',
                                  })
                                }
                                className="flex items-center gap-1.5 px-4 min-h-[48px] bg-red-50 text-red-700 rounded-xl text-[16px] font-semibold hover:bg-red-100 transition-colors"
                              >
                                <X size={18} />
                                반려
                              </button>
                            </div>
                          ) : (
                            <div className="text-right text-[13px] text-gray-400">처리 완료</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Calendar mini-view (1/3 width on xl) */}
        <div className="xl:col-span-1">
          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-[18px] font-bold text-gray-900">승인된 휴무 현황</h2>
              <p className="text-[14px] text-gray-400 mt-0.5">
                {format(selectedMonth, 'yyyy년 MM월', { locale: ko })}
              </p>
            </div>

            <div className="p-4">
              {/* Weekday header */}
              <div className="grid grid-cols-7 mb-2">
                {WEEKDAY_LABELS.map((label, i) => (
                  <div
                    key={label}
                    className={`text-center text-[13px] font-bold py-2 ${
                      i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-px">
                {/* Start padding */}
                {Array.from({ length: calendarDays.startPadding }).map((_, i) => (
                  <div key={`pad-${i}`} className="min-h-[60px]" />
                ))}

                {calendarDays.days.map((day) => {
                  const key = toDateKey(day);
                  const drivers = approvedByDate.get(key);
                  const dayOfWeek = getDay(day);
                  const isCurrent = isToday(day);
                  const inMonth = isSameMonth(day, selectedMonth);

                  return (
                    <div
                      key={key}
                      className={`min-h-[60px] rounded-lg p-1 transition-colors ${
                        isCurrent ? 'bg-blue-50 ring-2 ring-blue-300' : ''
                      } ${drivers && drivers.length > 0 ? 'bg-orange-50' : ''} ${
                        !inMonth ? 'opacity-30' : ''
                      }`}
                    >
                      <div
                        className={`text-[13px] font-bold text-center mb-0.5 ${
                          dayOfWeek === 0
                            ? 'text-red-500'
                            : dayOfWeek === 6
                              ? 'text-blue-500'
                              : 'text-gray-700'
                        } ${isCurrent ? 'text-blue-600' : ''}`}
                      >
                        {format(day, 'd')}
                      </div>
                      {drivers &&
                        drivers.slice(0, 2).map((d, i) => (
                          <div
                            key={i}
                            className="text-[11px] text-orange-700 bg-orange-100 rounded px-1 py-0.5 mb-0.5 truncate font-medium text-center"
                            title={`${d.name} (${d.employeeId})`}
                          >
                            {d.name}
                          </div>
                        ))}
                      {drivers && drivers.length > 2 && (
                        <div
                          className="text-[10px] text-orange-500 text-center font-semibold"
                          title={drivers
                            .slice(2)
                            .map((d) => d.name)
                            .join(', ')}
                        >
                          +{drivers.length - 2}명
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              {approvedByDate.size > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-[13px] font-bold text-gray-500 mb-2">이번 달 휴무 기사</p>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {Array.from(approvedByDate.entries())
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([dateKey, drivers]) => (
                        <div key={dateKey} className="flex items-start gap-2">
                          <span className="text-[13px] text-gray-500 font-mono shrink-0 min-w-[50px]">
                            {format(parseISO(dateKey), 'MM/dd')}
                          </span>
                          <span className="text-[13px] text-gray-700">
                            {drivers.map((d) => d.name).join(', ')}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Review modal */}
      {reviewModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setReviewModal(null);
              setReviewNote('');
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in fade-in">
            {/* Modal header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  reviewModal.action === 'APPROVED'
                    ? 'bg-green-100 text-green-600'
                    : 'bg-red-100 text-red-600'
                }`}
              >
                {reviewModal.action === 'APPROVED' ? (
                  <CheckCircle2 size={24} />
                ) : (
                  <XCircle size={24} />
                )}
              </div>
              <div>
                <h2 className="text-[20px] font-bold text-gray-900">
                  {reviewModal.action === 'APPROVED' ? '휴무 승인' : '휴무 반려'}
                </h2>
                <p className="text-[14px] text-gray-500">
                  {reviewModal.name} 기사님 -{' '}
                  {format(parseISO(reviewModal.date), 'MM월 dd일', { locale: ko })}
                </p>
              </div>
            </div>

            {/* Confirmation text */}
            <p className="text-[16px] text-gray-600 mb-4">
              {reviewModal.name} 기사님의 휴무 요청을{' '}
              <span
                className={`font-bold ${
                  reviewModal.action === 'APPROVED' ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {reviewModal.action === 'APPROVED' ? '승인' : '반려'}
              </span>
              하시겠습니까?
            </p>

            {/* Review note */}
            <div className="mb-5">
              <label className="block text-[16px] font-semibold text-gray-700 mb-2">
                {reviewModal.action === 'REJECTED' ? '반려 사유' : '메모 (선택)'}
                {reviewModal.action === 'REJECTED' && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </label>
              <textarea
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                rows={3}
                placeholder={
                  reviewModal.action === 'REJECTED'
                    ? '반려 사유를 입력해주세요...'
                    : '메모를 남겨주세요 (선택)'
                }
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                autoFocus
              />
            </div>

            {/* Modal buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setReviewModal(null);
                  setReviewNote('');
                }}
                className="flex-1 min-h-[48px] px-4 rounded-xl border border-gray-300 text-[16px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() =>
                  reviewMutation.mutate({
                    id: reviewModal.id,
                    status: reviewModal.action,
                    note: reviewNote,
                  })
                }
                disabled={
                  reviewMutation.isPending || (reviewModal.action === 'REJECTED' && !reviewNote.trim())
                }
                className={`flex-1 min-h-[48px] px-4 rounded-xl text-[16px] font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  reviewModal.action === 'APPROVED'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {reviewMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    처리 중...
                  </span>
                ) : reviewModal.action === 'APPROVED' ? (
                  '승인'
                ) : (
                  '반려'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Card Sub-component
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  count,
  icon: Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  count: number;
  icon: typeof Clock;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div
        className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${iconBg}`}
      >
        <Icon size={26} className={iconColor} />
      </div>
      <div>
        <p className="text-[14px] font-medium text-gray-500">{label}</p>
        <p className="text-[28px] font-bold text-gray-900 leading-tight">{count}</p>
      </div>
    </div>
  );
}
