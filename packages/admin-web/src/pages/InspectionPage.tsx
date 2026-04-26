import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Bus,
  Calendar,
  BarChart3,
  List,
  Clock,
  Loader2,
  FileWarning,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { inspectionApi, busesApi } from '../services/api';

/* ───────────────────────────────────────
   Types
   ─────────────────────────────────────── */

type Result = 'PASS' | 'FAIL' | 'N/A';

interface InspectionItem {
  id: string;
  name: string;
  category: string;
}

interface ChecklistEntry {
  id: string;
  name: string;
  result: Result;
  notes?: string;
}

interface InspectionRecord {
  id: number;
  date: string;
  status: 'PASSED' | 'FAILED' | 'PENDING';
  bus: { busNumber: string; plateNumber: string };
  driver: { name: string };
  items: ChecklistEntry[];
  notes?: string;
  createdAt: string;
}

type ViewMode = 'list' | 'stats';

/* ───────────────────────────────────────
   Helpers
   ─────────────────────────────────────── */

function formatTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: string) {
  switch (status) {
    case 'PASSED':
      return { text: '합격', bg: 'bg-green-100', fg: 'text-green-700', icon: CheckCircle };
    case 'FAILED':
      return { text: '불합격', bg: 'bg-red-100', fg: 'text-red-700', icon: XCircle };
    default:
      return { text: '미점검', bg: 'bg-gray-100', fg: 'text-gray-500', icon: Clock };
  }
}

/* ───────────────────────────────────────
   Main Page
   ─────────────────────────────────────── */

export default function InspectionPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState(now.toISOString().split('T')[0]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
  };

  /* ── Queries ── */

  const { data: template } = useQuery({
    queryKey: ['inspection-template'],
    queryFn: () => inspectionApi.getTemplate().then(r => r.data.data),
  });

  const { data: buses } = useQuery({
    queryKey: ['buses'],
    queryFn: () => busesApi.list().then(r => r.data.data),
  });

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useQuery({
    queryKey: ['inspection-stats', year, month],
    queryFn: () => inspectionApi.stats(year, month).then(r => r.data.data),
  });

  const {
    data: inspections,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['inspections', selectedDate],
    queryFn: () => inspectionApi.list({ date: selectedDate }).then(r => r.data.data),
  });

  const submitMutation = useMutation({
    mutationFn: inspectionApi.submit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections'] });
      qc.invalidateQueries({ queryKey: ['inspection-stats'] });
      setShowForm(false);
      toast.success('점검표가 제출되었습니다.');
    },
    onError: () => toast.error('제출 중 오류가 발생했습니다.'),
  });

  /* ── Computed summary for selected date ── */

  const summary = useMemo(() => {
    const list: InspectionRecord[] = inspections || [];
    const total = list.length;
    const passed = list.filter(r => r.status === 'PASSED').length;
    const failed = list.filter(r => r.status === 'FAILED').length;
    const pending = list.filter(r => r.status === 'PENDING').length;
    // Count buses that have no inspection record for the day
    const busCount = buses?.length ?? 0;
    const notInspected = Math.max(0, busCount - total);
    return { total, passed, failed, pending, notInspected };
  }, [inspections, buses]);

  /* ── Toggle expand ── */

  const toggleExpand = (id: number) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  /* ── Render ── */

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-gray-900 dark:text-gray-100 leading-tight">
            일일 차량 점검
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-[16px] mt-1">
            도로교통법 기준 운행 전 점검 기록을 관리합니다
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[16px] font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <List size={18} />
              목록
            </button>
            <button
              onClick={() => setViewMode('stats')}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[16px] font-medium transition-colors ${
                viewMode === 'stats'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <BarChart3 size={18} />
              통계
            </button>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-5 h-[48px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-[16px] transition-colors shadow-sm"
          >
            <ClipboardCheck size={20} />
            점검표 작성
          </button>
        </div>
      </div>

      {/* ── Summary Cards (selected date) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          label="총 점검"
          value={summary.total}
          unit="건"
          icon={<ClipboardCheck size={22} className="text-blue-500" />}
          bg="bg-blue-50"
          border="border-blue-200"
        />
        <SummaryCard
          label="합격"
          value={summary.passed}
          unit="건"
          icon={<CheckCircle size={22} className="text-green-500" />}
          bg="bg-green-50"
          border="border-green-200"
        />
        <SummaryCard
          label="불합격"
          value={summary.failed}
          unit="건"
          icon={<XCircle size={22} className="text-red-500" />}
          bg="bg-red-50"
          border="border-red-200"
        />
        <SummaryCard
          label="미점검"
          value={summary.pending + summary.notInspected}
          unit="대"
          icon={<Clock size={22} className="text-gray-400" />}
          bg="bg-gray-50"
          border="border-gray-200"
        />
      </div>

      {/* ── Inspection Form (collapsible) ── */}
      {showForm && template && buses && (
        <InspectionForm
          template={template}
          buses={buses}
          onSubmit={(data) => submitMutation.mutate(data)}
          loading={submitMutation.isPending}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* ── View: List ── */}
      {viewMode === 'list' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {/* List header with date picker */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 gap-3">
            <div className="flex items-center gap-3">
              <Bus size={20} className="text-gray-400 dark:text-gray-500" />
              <span className="font-bold text-[18px] text-gray-900 dark:text-gray-100">점검 기록</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-gray-400 dark:text-gray-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => {
                  setSelectedDate(e.target.value);
                  setExpandedId(null);
                }}
                className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl px-4 py-2.5 text-[16px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
              <Loader2 size={36} className="animate-spin mb-3" />
              <p className="text-[16px]">점검 기록을 불러오는 중...</p>
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
              <FileWarning size={40} className="mb-3 text-red-300" />
              <p className="text-[16px] text-red-500 mb-4">데이터를 불러오지 못했습니다.</p>
              <button
                onClick={() => refetch()}
                className="flex items-center gap-2 px-5 h-[48px] bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-[16px] font-medium text-gray-700 dark:text-gray-200 transition-colors"
              >
                <RefreshCw size={18} />
                다시 시도
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && (inspections || []).length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
              <ClipboardCheck size={48} className="mb-3 opacity-30" />
              <p className="text-[18px] font-medium text-gray-500 dark:text-gray-400 mb-1">점검 기록 없음</p>
              <p className="text-[16px]">해당 날짜의 점검 기록이 없습니다.</p>
            </div>
          )}

          {/* Table */}
          {!isLoading && !isError && (inspections || []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      차량번호
                    </th>
                    <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      기사명
                    </th>
                    <th className="text-center px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      점검 시간
                    </th>
                    <th className="text-center px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      결과
                    </th>
                    <th className="text-center px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-16">
                      상세
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(inspections || []).map((r: InspectionRecord) => {
                    const sl = statusLabel(r.status);
                    const StatusIcon = sl.icon;
                    const isExpanded = expandedId === r.id;

                    return (
                      <InspectionRow
                        key={r.id}
                        record={r}
                        statusInfo={sl}
                        StatusIcon={StatusIcon}
                        isExpanded={isExpanded}
                        onToggle={() => toggleExpand(r.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── View: Stats ── */}
      {viewMode === 'stats' && (
        <div className="space-y-6">
          {/* Month selector */}
          <div className="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm px-5 py-4">
            <button
              onClick={prevMonth}
              className="flex items-center justify-center w-[48px] h-[48px] hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
            >
              <ChevronLeft size={22} />
            </button>
            <span className="font-bold text-[20px] text-gray-900 dark:text-gray-100 min-w-[140px] text-center">
              {year}년 {month}월
            </span>
            <button
              onClick={nextMonth}
              className="flex items-center justify-center w-[48px] h-[48px] hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
            >
              <ChevronRight size={22} />
            </button>
          </div>

          {/* Monthly stats loading/error */}
          {statsLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-gray-400" />
            </div>
          )}

          {statsError && !statsLoading && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
              <FileWarning size={40} className="mx-auto mb-3 text-red-300" />
              <p className="text-[16px] text-red-500">통계를 불러오지 못했습니다.</p>
            </div>
          )}

          {/* Monthly stat cards */}
          {stats && !statsLoading && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <MonthlyStatCard label="총 점검" value={`${stats.total}건`} color="gray" />
                <MonthlyStatCard label="합격" value={`${stats.passed}건`} color="green" />
                <MonthlyStatCard label="불합격" value={`${stats.failed}건`} color="red" />
                <MonthlyStatCard label="합격률" value={`${stats.passRate}%`} color="blue" />
                <MonthlyStatCard label="이행률" value={`${stats.completionRate}%`} color="purple" />
              </div>

              {/* Simple daily completion bar chart */}
              <DailyCompletionChart stats={stats} year={year} month={month} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────��────────────────────────
   SummaryCard (top row)
   ─────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  unit,
  icon,
  bg,
  border,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  bg: string;
  border: string;
}) {
  return (
    <div className={`${bg} ${border} border rounded-2xl p-5 flex items-start gap-4`}>
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
        <p className="text-[28px] font-bold text-gray-900 dark:text-gray-100 leading-tight">
          {value}
          <span className="text-[16px] font-normal text-gray-500 dark:text-gray-400 ml-1">{unit}</span>
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────
   InspectionRow (expandable table row)
   ─────────────────────────────────────── */

function InspectionRow({
  record,
  statusInfo,
  StatusIcon,
  isExpanded,
  onToggle,
}: {
  record: InspectionRecord;
  statusInfo: { text: string; bg: string; fg: string };
  StatusIcon: LucideIcon;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const items: ChecklistEntry[] = record.items || [];
  const failedItems = items.filter(i => i.result === 'FAIL');

  // Group items by category-like naming if available, otherwise flat
  const categories = useMemo(() => {
    const map = new Map<string, ChecklistEntry[]>();
    items.forEach(item => {
      // Try to infer category from item name prefix or use "전체"
      const key = '점검 항목';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    return map;
  }, [items]);

  return (
    <>
      {/* Main row */}
      <tr
        className={`cursor-pointer transition-colors ${
          record.status === 'FAILED' ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
        onClick={onToggle}
      >
        <td className="px-5 py-4">
          <p className="font-bold text-[16px] text-gray-900 dark:text-gray-100">{record.bus.busNumber}</p>
          <p className="text-[14px] text-gray-400 dark:text-gray-500">{record.bus.plateNumber}</p>
        </td>
        <td className="px-5 py-4">
          <p className="text-[16px] text-gray-800 dark:text-gray-200 font-medium">{record.driver.name}</p>
        </td>
        <td className="px-5 py-4 text-center">
          <p className="text-[16px] text-gray-600 dark:text-gray-300">{formatTime(record.createdAt)}</p>
        </td>
        <td className="px-5 py-4 text-center">
          <span
            className={`inline-flex items-center gap-1.5 text-[14px] font-semibold px-3 py-1.5 rounded-full ${statusInfo.bg} ${statusInfo.fg}`}
          >
            <StatusIcon size={16} />
            {statusInfo.text}
          </span>
        </td>
        <td className="px-5 py-4 text-center">
          {isExpanded ? (
            <ChevronUp size={20} className="text-gray-400 mx-auto" />
          ) : (
            <ChevronDown size={20} className="text-gray-400 mx-auto" />
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr>
          <td colSpan={5} className="px-0 py-0">
            <div className="bg-gray-50 dark:bg-gray-900 border-t border-b border-gray-200 dark:border-gray-700 px-6 py-5">
              {/* Notes */}
              {record.notes && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
                  <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-[16px] text-amber-800">
                    <span className="font-semibold">특이사항:</span> {record.notes}
                  </p>
                </div>
              )}

              {/* Failed items highlight */}
              {failedItems.length > 0 && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <p className="text-[16px] font-semibold text-red-700 mb-2 flex items-center gap-2">
                    <XCircle size={18} />
                    불합격 항목 ({failedItems.length}개)
                  </p>
                  <ul className="space-y-1.5">
                    {failedItems.map(item => (
                      <li key={item.id} className="flex items-start gap-2 text-[16px] text-red-700">
                        <span className="text-red-400 mt-0.5">-</span>
                        <span className="font-medium">{item.name}</span>
                        {item.notes && (
                          <span className="text-red-500 italic ml-1">({item.notes})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Full checklist */}
              {Array.from(categories.entries()).map(([cat, catItems]) => (
                <div key={cat} className="mb-3">
                  <h4 className="text-[14px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-2">{cat}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {catItems.map(item => {
                      const isFail = item.result === 'FAIL';
                      const isPass = item.result === 'PASS';
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between rounded-xl px-4 py-3 text-[16px] ${
                            isFail
                              ? 'bg-red-100 border border-red-200'
                              : isPass
                              ? 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
                              : 'bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          <span className={`font-medium ${isFail ? 'text-red-700' : 'text-gray-800 dark:text-gray-200'}`}>
                            {item.name}
                          </span>
                          <span className="flex items-center gap-1.5">
                            {isPass && (
                              <span className="text-green-600 font-semibold flex items-center gap-1">
                                <CheckCircle size={16} /> 합격
                              </span>
                            )}
                            {isFail && (
                              <span className="text-red-600 font-semibold flex items-center gap-1">
                                <XCircle size={16} /> 불합격
                              </span>
                            )}
                            {!isPass && !isFail && (
                              <span className="text-gray-400 font-medium">해당없음</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {items.length === 0 && (
                <p className="text-[16px] text-gray-400 dark:text-gray-500 text-center py-4">점검 항목 데이터가 없습니다.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ───────────────────────────────────────
   MonthlyStatCard
   ─────────────────────────────────────── */

function MonthlyStatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const styles: Record<string, string> = {
    gray: 'bg-gray-50 border-gray-200 text-gray-900',
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };
  return (
    <div className={`${styles[color]} border rounded-2xl p-5`}>
      <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-[26px] font-bold">{value}</p>
    </div>
  );
}

/* ───────────────────────────────────────
   DailyCompletionChart (simple bar chart)
   ─────────────────────────────────────── */

function DailyCompletionChart({
  stats,
  year,
  month,
}: {
  stats: { dailyStats?: Array<{ date: string; total: number; passed: number; failed: number }> };
  year: number;
  month: number;
}) {
  const daysInMonth = new Date(year, month, 0).getDate();

  // Build day-indexed map from stats.dailyStats if available
  const dayMap = useMemo(() => {
    const map = new Map<number, { total: number; passed: number; failed: number }>();
    if (stats.dailyStats) {
      stats.dailyStats.forEach(d => {
        const day = new Date(d.date).getDate();
        map.set(day, { total: d.total, passed: d.passed, failed: d.failed });
      });
    }
    return map;
  }, [stats.dailyStats]);

  const maxTotal = useMemo(() => {
    let max = 1;
    dayMap.forEach(v => { if (v.total > max) max = v.total; });
    return max;
  }, [dayMap]);

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 className="text-[18px] font-bold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <BarChart3 size={20} className="text-blue-500" />
        일별 점검 현황
      </h3>
      <p className="text-[14px] text-gray-400 dark:text-gray-500 mb-6">
        {year}년 {month}월 일별 점검 완료 현황
      </p>

      {dayMap.size === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <BarChart3 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-[16px]">해당 월의 통계 데이터가 없습니다.</p>
        </div>
      ) : (
        <div className="flex items-end gap-1 h-[200px] overflow-x-auto pb-2">
          {days.map(day => {
            const data = dayMap.get(day);
            const total = data?.total ?? 0;
            const passed = data?.passed ?? 0;
            const failed = data?.failed ?? 0;
            const heightPct = total > 0 ? (total / maxTotal) * 100 : 0;
            const passedPct = total > 0 ? (passed / total) * 100 : 0;

            return (
              <div
                key={day}
                className="flex flex-col items-center flex-1 min-w-[24px] group relative"
              >
                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 dark:bg-gray-700 text-white text-[12px] rounded-lg px-2 py-1 whitespace-nowrap z-10">
                  {day}일: 합격 {passed} / 불합격 {failed} / 전체 {total}
                </div>
                {/* Bar */}
                <div
                  className="w-full max-w-[20px] rounded-t-md transition-all relative overflow-hidden"
                  style={{ height: `${Math.max(heightPct, total > 0 ? 8 : 0)}%` }}
                >
                  {/* Green portion (passed) */}
                  <div
                    className="absolute bottom-0 w-full bg-green-400 rounded-t-md"
                    style={{ height: `${passedPct}%` }}
                  />
                  {/* Red portion (failed) at top */}
                  {failed > 0 && (
                    <div
                      className="absolute top-0 w-full bg-red-400"
                      style={{ height: `${100 - passedPct}%` }}
                    />
                  )}
                  {/* If no data, show placeholder line */}
                  {total === 0 && (
                    <div className="absolute bottom-0 w-full h-[2px] bg-gray-200 dark:bg-gray-600 rounded" />
                  )}
                </div>
                {/* Day label */}
                <span className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 leading-none">{day}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2 text-[14px] text-gray-500 dark:text-gray-400">
          <span className="w-3 h-3 rounded-sm bg-green-400" /> 합격
        </div>
        <div className="flex items-center gap-2 text-[14px] text-gray-500 dark:text-gray-400">
          <span className="w-3 h-3 rounded-sm bg-red-400" /> 불합격
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────
   InspectionForm (admin-side creation)
   ─────────────────────────────────────── */

function InspectionForm({
  template,
  buses,
  onSubmit,
  loading,
  onCancel,
}: {
  template: InspectionItem[];
  buses: Array<{ id: number; busNumber: string; plateNumber: string }>;
  onSubmit: (data: Record<string, unknown>) => void;
  loading: boolean;
  onCancel: () => void;
}) {
  const [busId, setBusId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [results, setResults] = useState<Record<string, Result>>({});

  const setResult = (id: string, result: Result) =>
    setResults(p => ({ ...p, [id]: result }));

  const handleSubmit = () => {
    if (!busId) {
      toast.error('차량을 선택해주세요.');
      return;
    }
    const unanswered = template.filter(t => !results[t.id]);
    if (unanswered.length > 0) {
      toast.error(`미점검 항목이 ${unanswered.length}개 남아있습니다.`);
      return;
    }
    const items = template.map(t => ({
      id: t.id,
      name: t.name,
      result: results[t.id] || 'N/A',
    }));
    onSubmit({ busId: Number(busId), date, items, notes });
  };

  const categories = [...new Set(template.map(t => t.category))];

  const totalAnswered = Object.keys(results).length;
  const totalItems = template.length;
  const progressPct = totalItems > 0 ? Math.round((totalAnswered / totalItems) * 100) : 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6">
      <h3 className="font-bold text-[20px] text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <AlertTriangle size={22} className="text-amber-500" />
        운행 전 차량 점검표
      </h3>
      <p className="text-[14px] text-gray-400 dark:text-gray-500 mb-5">모든 항목을 점검한 후 제출하세요.</p>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-[14px] text-gray-500 dark:text-gray-400 mb-1.5">
          <span>진행률</span>
          <span>{totalAnswered}/{totalItems} ({progressPct}%)</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all ${
              progressPct === 100 ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Bus & date selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-[14px] font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
            차량 선택 <span className="text-red-500">*</span>
          </label>
          <select
            value={busId}
            onChange={e => setBusId(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl px-4 py-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">차량을 선택하세요</option>
            {buses.map(b => (
              <option key={b.id} value={b.id}>
                {b.busNumber} ({b.plateNumber})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[14px] font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
            점검일 <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl px-4 py-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Checklist by category */}
      {categories.map(cat => (
        <div key={cat} className="mb-6">
          <h4 className="text-[14px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 border-b border-gray-100 dark:border-gray-700 pb-2">
            {cat}
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {template
              .filter(t => t.category === cat)
              .map(item => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 transition-colors ${
                    results[item.id] === 'FAIL'
                      ? 'bg-red-50 border border-red-200'
                      : results[item.id] === 'PASS'
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <span className="text-[16px] text-gray-800 dark:text-gray-200 font-medium">{item.name}</span>
                  <div className="flex gap-1.5">
                    {(['PASS', 'FAIL', 'N/A'] as Result[]).map(r => (
                      <button
                        key={r}
                        onClick={() => setResult(item.id, r)}
                        className={`px-3 py-2 rounded-lg text-[14px] font-semibold transition-colors min-h-[40px] ${
                          results[item.id] === r
                            ? r === 'PASS'
                              ? 'bg-green-600 text-white'
                              : r === 'FAIL'
                              ? 'bg-red-600 text-white'
                              : 'bg-gray-500 text-white'
                            : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {r === 'PASS' ? '합격' : r === 'FAIL' ? '불합격' : '해당없음'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}

      {/* Notes */}
      <div className="mb-6">
        <label className="block text-[14px] font-semibold text-gray-700 dark:text-gray-200 mb-1.5">특이사항</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="특이사항이 있으면 입력하세요"
          rows={3}
          className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl px-4 py-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-5 h-[48px] text-[16px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl font-medium transition-colors"
        >
          취소
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="flex items-center gap-2 px-6 h-[48px] bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-[16px] font-semibold transition-colors"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              제출 중...
            </>
          ) : (
            <>
              <ClipboardCheck size={18} />
              점검표 제출
            </>
          )}
        </button>
      </div>
    </div>
  );
}
