import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Users,
  CalendarDays,
  MapPin,
  Pencil,
  X,
  FileSpreadsheet,
  UserCheck,
  UserX,
  Timer,
  Palmtree,
  BarChart3,
  List,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { attendanceApi, usersApi } from '../services/api';

// ─── 타입 정의 ────────────────────────────────────────────
interface Driver {
  id: number;
  name: string;
  employeeId: string;
}

interface AttendanceRecord {
  id: number;
  driverId: number;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInMethod: string | null;
  checkOutMethod: string | null;
  status: string;
  notes: string | null;
  driver: {
    id: number;
    name: string;
    employeeId: string;
  };
}

interface WeeklySummaryDriver {
  driverId: number;
  driverName: string;
  employeeId: string;
  totalHours: number;
  maxWeekHours: number;
  isOver52h: boolean;
}

interface WeeklyWarning {
  driverName: string;
  employeeId: string;
  week: number;
  hours: number;
  days: number;
}

// ─── 상수 ──────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  PRESENT: { label: '출근', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  LATE: { label: '지각', bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  ABSENT: { label: '결근', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  ON_LEAVE: { label: '휴무', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  PRESENT: <CheckCircle size={14} />,
  LATE: <Timer size={14} />,
  ABSENT: <XCircle size={14} />,
  ON_LEAVE: <Palmtree size={14} />,
};

const METHOD_LABEL: Record<string, string> = {
  GPS: 'GPS',
  MANUAL: '수동',
};

// ─── 유틸 ──────────────────────────────────────────────────
function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function calcHours(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return '-';
  const diff = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60);
  if (diff < 0) return '-';
  return `${diff.toFixed(1)}시간`;
}

function formatDateKR(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────
export default function AttendancePage() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(now));
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);

  // 월 이동
  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  // ─── 데이터 쿼리 ──────────────────────────────────────────
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ['drivers-simple'],
    queryFn: () => usersApi.list({ role: 'DRIVER' }).then(r => r.data.data),
  });

  const { data: recordsRaw = [], isLoading: recordsLoading, isError: recordsError } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-records', year, month],
    queryFn: () => attendanceApi.list(year, month).then(r => r.data.data),
  });

  const { data: weeklyData, isLoading: weeklyLoading } = useQuery({
    queryKey: ['attendance-weekly', year, month],
    queryFn: () => attendanceApi.weeklyHours(year, month).then(r => r.data.data),
    enabled: viewMode === 'weekly',
  });

  // ─── 뮤테이션 ─────────────────────────────────────────────
  const upsertMutation = useMutation({
    mutationFn: attendanceApi.upsert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-records'] });
      qc.invalidateQueries({ queryKey: ['attendance-weekly'] });
      toast.success('근태 기록이 저장되었습니다.');
      setModalOpen(false);
      setEditingRecord(null);
    },
    onError: () => toast.error('저장 중 오류가 발생했습니다.'),
  });

  // ─── 날짜 필터링된 레코드 ──────────────────────────────────
  const filteredRecords = useMemo(() => {
    if (!selectedDate) return recordsRaw;
    return recordsRaw.filter(r => {
      const rDate = new Date(r.date).toISOString().split('T')[0];
      return rDate === selectedDate;
    });
  }, [recordsRaw, selectedDate]);

  // ─── 요약 카드 계산 ────────────────────────────────────────
  const summary = useMemo(() => {
    const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0 };
    filteredRecords.forEach(r => {
      if (r.status in counts) counts[r.status as keyof typeof counts]++;
    });
    return counts;
  }, [filteredRecords]);

  // ─── 주간 데이터 ──────────────────────────────────────────
  const warnings: WeeklyWarning[] = weeklyData?.warnings || [];
  const weeklySummary: WeeklySummaryDriver[] = weeklyData?.summary || [];

  // ─── 모달 열기 ─────────────────────────────────────────────
  const openCreateModal = useCallback(() => {
    setEditingRecord(null);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((record: AttendanceRecord) => {
    setEditingRecord(record);
    setModalOpen(true);
  }, []);

  // ─── Excel 내보내기 힌트 ──────────────────────────────────
  const handleExportHint = () => {
    toast('Excel 내보내기 기능은 준비 중입니다.', { icon: '📊' });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 pb-12">
      {/* ── 헤더 ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-gray-900 dark:text-gray-100">근태 관리</h1>
          <p className="text-gray-500 dark:text-gray-400 text-[16px] mt-1">출퇴근 기록 조회 및 관리</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportHint}
            className="flex items-center gap-2 px-5 h-[48px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-[16px] font-medium transition-colors"
          >
            <FileSpreadsheet size={20} />
            Excel 내보내기
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-5 h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[16px] font-medium transition-colors"
          >
            <Pencil size={20} />
            근태 입력
          </button>
        </div>
      </div>

      {/* ── 월 네비게이션 + 날짜 선택 ────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="flex items-center justify-center w-[48px] h-[48px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            aria-label="이전 월"
          >
            <ChevronLeft size={22} />
          </button>
          <span className="text-[20px] font-bold text-gray-900 dark:text-gray-100 min-w-[140px] text-center">
            {year}년 {month}월
          </span>
          <button
            onClick={nextMonth}
            className="flex items-center justify-center w-[48px] h-[48px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            aria-label="다음 월"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* 날짜 선택 (일별 모드) */}
          {viewMode === 'daily' && (
            <div className="flex items-center gap-2">
              <CalendarDays size={20} className="text-gray-400 dark:text-gray-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[16px] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          )}

          {/* 보기 모드 토글 */}
          <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setViewMode('daily')}
              className={`flex items-center gap-2 px-4 h-[48px] text-[16px] font-medium transition-colors ${
                viewMode === 'daily'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <List size={18} />
              일별
            </button>
            <button
              onClick={() => setViewMode('weekly')}
              className={`flex items-center gap-2 px-4 h-[48px] text-[16px] font-medium transition-colors ${
                viewMode === 'weekly'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <BarChart3 size={18} />
              주간 분석
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* 일별 보기 */}
      {/* ══════════════════════════════════════════════════ */}
      {viewMode === 'daily' && (
        <>
          {/* ── 요약 카드 ──────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              icon={<UserCheck size={24} className="text-green-600" />}
              label="출근"
              count={summary.PRESENT}
              bg="bg-green-50"
              border="border-green-200"
              text="text-green-700"
            />
            <SummaryCard
              icon={<Timer size={24} className="text-yellow-600" />}
              label="지각"
              count={summary.LATE}
              bg="bg-yellow-50"
              border="border-yellow-200"
              text="text-yellow-700"
            />
            <SummaryCard
              icon={<UserX size={24} className="text-red-600" />}
              label="결근"
              count={summary.ABSENT}
              bg="bg-red-50"
              border="border-red-200"
              text="text-red-700"
            />
            <SummaryCard
              icon={<Palmtree size={24} className="text-blue-600" />}
              label="휴무"
              count={summary.ON_LEAVE}
              bg="bg-blue-50"
              border="border-blue-200"
              text="text-blue-700"
            />
          </div>

          {/* ── 기록 테이블 ────────────────────────────── */}
          {recordsLoading ? (
            <LoadingState message="근태 기록을 불러오는 중..." />
          ) : recordsError ? (
            <ErrorState message="근태 기록을 불러오지 못했습니다. 새로고침 해주세요." />
          ) : filteredRecords.length === 0 ? (
            <EmptyState
              message={selectedDate ? `${formatDateKR(selectedDate)}에 등록된 근태 기록이 없습니다.` : '이번 달 근태 기록이 없습니다.'}
              onAction={openCreateModal}
              actionLabel="근태 입력하기"
            />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users size={20} className="text-gray-400 dark:text-gray-500" />
                  <span className="text-[18px] font-bold text-gray-900 dark:text-gray-100">출퇴근 기록</span>
                  <span className="text-[16px] text-gray-400 dark:text-gray-500 font-medium">
                    ({filteredRecords.length}명)
                  </span>
                </div>
                {selectedDate && (
                  <span className="text-[16px] text-gray-500 dark:text-gray-400 font-medium">
                    {formatDateKR(selectedDate)}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">기사명</th>
                      <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">사원번호</th>
                      <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">날짜</th>
                      <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">출근 시간</th>
                      <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">퇴근 시간</th>
                      <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">입력 방법</th>
                      <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">상태</th>
                      <th className="text-right px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">근무 시간</th>
                      <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">수정</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {filteredRecords.map((r) => {
                      const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.PRESENT;
                      const method = r.checkInMethod || r.checkOutMethod;
                      return (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          <td className="px-6 py-4">
                            <span className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
                              {r.driver.name}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[15px] text-gray-500 dark:text-gray-400">
                              {r.driver.employeeId}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[15px] text-gray-700 dark:text-gray-200">
                              {formatDateKR(r.date)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[16px] text-gray-900 dark:text-gray-100 font-medium">
                              {formatTime(r.checkIn)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[16px] text-gray-900 dark:text-gray-100 font-medium">
                              {formatTime(r.checkOut)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {method ? (
                              <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-lg">
                                {method === 'GPS' && <MapPin size={14} />}
                                {METHOD_LABEL[method] || method}
                              </span>
                            ) : (
                              <span className="text-[14px] text-gray-300 dark:text-gray-600">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 text-[14px] font-semibold px-3 py-1.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}
                            >
                              {STATUS_ICON[r.status]}
                              {cfg.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-[16px] font-medium text-gray-700 dark:text-gray-200">
                              {calcHours(r.checkIn, r.checkOut)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={() => openEditModal(r)}
                              className="inline-flex items-center justify-center w-[40px] h-[40px] rounded-lg text-gray-400 dark:text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                              aria-label={`${r.driver.name} 근태 수정`}
                            >
                              <Pencil size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* 주간 분석 보기 */}
      {/* ══════════════════════════════════════════════════ */}
      {viewMode === 'weekly' && (
        <div>
          {/* 52시간 초과 경고 */}
          {warnings.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
              <AlertTriangle size={24} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[18px] font-bold text-red-700">주 52시간 초과 경고</p>
                <p className="text-[16px] text-red-600 mt-1">
                  {warnings.length}건의 초과 근무가 감지되었습니다. 즉시 확인이 필요합니다.
                </p>
                <div className="mt-3 space-y-1.5">
                  {warnings.map((w, i) => (
                    <p key={i} className="text-[15px] text-red-600">
                      - {w.driverName} ({w.employeeId}) : {w.week}주차 {w.hours}시간 ({w.days}일 근무)
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {weeklyLoading ? (
            <LoadingState message="주간 근무시간을 분석하는 중..." />
          ) : weeklySummary.length === 0 ? (
            <EmptyState message="이번 달 근무 데이터가 없습니다." />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
                <BarChart3 size={20} className="text-gray-400 dark:text-gray-500" />
                <span className="text-[18px] font-bold text-gray-900 dark:text-gray-100">주간 근무시간 분석</span>
                <span className="text-[16px] text-gray-400 dark:text-gray-500 font-medium">
                  ({weeklySummary.length}명)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">기사명</th>
                      <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">사원번호</th>
                      <th className="text-right px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">월 총 시간</th>
                      <th className="text-right px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">최대 주간시간</th>
                      <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">52시간 상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {weeklySummary.map((d) => (
                      <tr key={d.driverId} className={`transition-colors ${d.isOver52h ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                        <td className="px-6 py-4">
                          <span className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">{d.driverName}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[15px] text-gray-500 dark:text-gray-400">{d.employeeId}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-[16px] font-medium text-gray-700 dark:text-gray-200">{d.totalHours}시간</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={`text-[16px] font-bold ${
                            d.maxWeekHours > 52 ? 'text-red-600'
                              : d.maxWeekHours > 48 ? 'text-yellow-600'
                                : 'text-green-600'
                          }`}>
                            {d.maxWeekHours}시간
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {d.isOver52h ? (
                            <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-red-600 bg-red-100 border border-red-200 px-3 py-1.5 rounded-full">
                              <XCircle size={16} /> 초과
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-green-600 bg-green-100 border border-green-200 px-3 py-1.5 rounded-full">
                              <CheckCircle size={16} /> 정상
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 모달 ──────────────────────────────────────────── */}
      {modalOpen && (
        <AttendanceModal
          drivers={drivers}
          editingRecord={editingRecord}
          defaultDate={selectedDate}
          loading={upsertMutation.isPending}
          onClose={() => { setModalOpen(false); setEditingRecord(null); }}
          onSubmit={(data) => upsertMutation.mutate(data)}
        />
      )}
    </div>
  );
}

// ─── 요약 카드 컴포넌트 ──────────────────────────────────────
function SummaryCard({
  icon, label, count, bg, border, text,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  bg: string;
  border: string;
  text: string;
}) {
  return (
    <div className={`rounded-2xl border ${border} ${bg} p-5 flex items-center gap-4`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className={`text-[16px] font-medium ${text}`}>{label}</p>
        <p className={`text-[28px] font-bold ${text}`}>{count}</p>
      </div>
    </div>
  );
}

// ─── 로딩 상태 ────────────────────────────────────────────
function LoadingState({ message }: { message: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-12 flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-4 border-gray-200 dark:border-gray-600 border-t-blue-600 rounded-full animate-spin" />
      <p className="text-[16px] text-gray-400 dark:text-gray-500 font-medium">{message}</p>
    </div>
  );
}

// ─── 에러 상태 ────────────────────────────────────────────
function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-red-200 p-12 flex flex-col items-center justify-center gap-4">
      <AlertTriangle size={40} className="text-red-400" />
      <p className="text-[16px] text-red-500 font-medium text-center">{message}</p>
    </div>
  );
}

// ─── 빈 상태 ──────────────────────────────────────────────
function EmptyState({
  message,
  onAction,
  actionLabel,
}: {
  message: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-12 flex flex-col items-center justify-center gap-4">
      <Clock size={48} className="text-gray-300 dark:text-gray-600" />
      <p className="text-[16px] text-gray-400 dark:text-gray-500 font-medium text-center">{message}</p>
      {onAction && actionLabel && (
        <button
          onClick={onAction}
          className="mt-2 h-[48px] px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[16px] font-medium transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ─── 근태 입력/수정 모달 ──────────────────────────────────────
function AttendanceModal({
  drivers,
  editingRecord,
  defaultDate,
  loading,
  onClose,
  onSubmit,
}: {
  drivers: Driver[];
  editingRecord: AttendanceRecord | null;
  defaultDate: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  const isEdit = !!editingRecord;

  const extractTime = (iso: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const [form, setForm] = useState({
    driverId: editingRecord ? String(editingRecord.driverId) : '',
    date: editingRecord ? new Date(editingRecord.date).toISOString().split('T')[0] : defaultDate,
    checkIn: editingRecord ? extractTime(editingRecord.checkIn) : '',
    checkOut: editingRecord ? extractTime(editingRecord.checkOut) : '',
    status: editingRecord?.status || 'PRESENT',
    notes: editingRecord?.notes || '',
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = () => {
    if (!form.driverId || !form.date) {
      toast.error('기사와 날짜를 선택해주세요.');
      return;
    }
    onSubmit({
      ...form,
      driverId: Number(form.driverId),
      checkInMethod: 'MANUAL',
      checkOutMethod: form.checkOut ? 'MANUAL' : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 배경 오버레이 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* 모달 본문 */}
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-[560px] mx-4 overflow-hidden">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-[20px] font-bold text-gray-900 dark:text-gray-100">
            {isEdit ? '근태 기록 수정' : '근태 기록 입력'}
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-[40px] h-[40px] rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="닫기"
          >
            <X size={22} />
          </button>
        </div>

        {/* 모달 바디 */}
        <div className="px-6 py-6 space-y-5">
          {/* 기사 선택 */}
          <div>
            <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-200 mb-2">기사 선택</label>
            <select
              value={form.driverId}
              onChange={set('driverId')}
              disabled={isEdit}
              className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[16px] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50 dark:disabled:bg-gray-700 disabled:text-gray-500 dark:disabled:text-gray-400"
            >
              <option value="">기사를 선택하세요</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.employeeId})</option>
              ))}
            </select>
          </div>

          {/* 날짜 */}
          <div>
            <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-200 mb-2">날짜</label>
            <input
              type="date"
              value={form.date}
              onChange={set('date')}
              disabled={isEdit}
              className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[16px] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50 dark:disabled:bg-gray-700 disabled:text-gray-500 dark:disabled:text-gray-400"
            />
          </div>

          {/* 출근/퇴근 시간 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-200 mb-2">출근 시간</label>
              <input
                type="time"
                value={form.checkIn}
                onChange={set('checkIn')}
                className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[16px] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-200 mb-2">퇴근 시간</label>
              <input
                type="time"
                value={form.checkOut}
                onChange={set('checkOut')}
                className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[16px] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* 상태 */}
          <div>
            <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-200 mb-2">근태 상태</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, status: key }))}
                  className={`h-[48px] rounded-xl border text-[16px] font-semibold transition-all ${
                    form.status === key
                      ? `${cfg.bg} ${cfg.text} ${cfg.border} ring-2 ring-offset-1 ring-current`
                      : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* 비고 */}
          <div>
            <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-200 mb-2">비고</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              placeholder="추가 메모를 입력하세요 (선택)"
              rows={2}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[16px] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="flex items-center justify-end gap-3 px-6 py-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            onClick={onClose}
            className="h-[48px] px-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-[16px] font-medium transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !form.driverId || !form.date}
            className="h-[48px] px-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[16px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                저장 중...
              </>
            ) : (
              isEdit ? '수정 완료' : '저장'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
