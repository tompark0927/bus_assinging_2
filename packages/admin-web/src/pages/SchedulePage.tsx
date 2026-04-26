import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Download,
  Send,
  Trash2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  Loader2,
  AlertTriangle,
  Users,
  Filter,
  BarChart3,
  Info,
  Check,
  ChevronDown,
  ChevronUp,
  Shield,
  Edit3,
} from 'lucide-react';
import { schedulesApi, routesApi, busesApi, usersApi } from '../services/api';
import { format, getDaysInMonth } from 'date-fns';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────
// 상수 & 타입
// ─────────────────────────────────────────

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'] as const;

const SHIFT_LABELS: Record<string, string> = {
  MORNING: '조',
  AFTERNOON: '석',
  FULL_DAY: '종',
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  DRAFT: { label: '초안', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300' },
  PUBLISHED: { label: '발행됨', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300' },
  ARCHIVED: { label: '보관', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300' },
};

const SLOT_COLORS = {
  SCHEDULED: { bg: 'bg-blue-100', text: 'text-blue-800', ring: 'ring-blue-300' },
  DROPPED: { bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-300' },
  FILLED: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  COMPLETED: { bg: 'bg-slate-100', text: 'text-slate-500', ring: 'ring-slate-300' },
  ABSENT: { bg: 'bg-orange-100', text: 'text-orange-700', ring: 'ring-orange-300' },
  REST: { bg: 'bg-gray-50', text: 'text-gray-400', ring: 'ring-gray-200' },
} as const;

interface Slot {
  id: number;
  date: string;
  isRestDay: boolean;
  shift: string;
  status: string;
  notes?: string;
  fairnessNote?: string;
  isManualOverride?: boolean;
  driver: { id: number; name: string; driverType: string; employeeId: string };
  route: { id: number; routeNumber: string; name: string };
  bus?: { id: number; busNumber: string };
}

interface Schedule {
  id: number;
  year: number;
  month: number;
  status: string;
  slots: Slot[];
}

interface Route {
  id: number;
  routeNumber: string;
  name: string;
}

interface Bus {
  id: number;
  busNumber: string;
}

interface Driver {
  id: number;
  name: string;
  driverType: string;
  employeeId: string;
}

interface FairnessReportEntry {
  driverId: number;
  driverName: string;
  driverType: string;
  workDays: number;
  restDays: number;
  totalFatigue: number;
  avgFatigue: number;
  preferredRouteCount: number;
  summary: string;
}

type FilterDriverType = 'ALL' | 'MAIN' | 'SPARE';

// ─────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────

export default function SchedulePage() {
  const queryClient = useQueryClient();

  // 날짜 / 필터 상태
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));

  const [filterDriverType, setFilterDriverType] = useState<FilterDriverType>('ALL');
  const [filterRouteId, setFilterRouteId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // 모달 상태
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [workDays, setWorkDays] = useState(5);
  const [restDays, setRestDays] = useState(2);
  const [aiNotes, setAiNotes] = useState('');
  const [aiRecs, setAiRecs] = useState('');

  // 공정성 증명서 상태
  const [fairnessReport, setFairnessReport] = useState<FairnessReportEntry[]>([]);
  const [showFairnessReport, setShowFairnessReport] = useState(false);

  // 생성 후 경고 메시지
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);

  // 벌크 액션 상태
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<number>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRouteId, setBulkRouteId] = useState<number>(0);
  const [bulkShift, setBulkShift] = useState<string>('');

  // 오버라이드 모달 상태
  const [overrideSlot, setOverrideSlot] = useState<Slot | null>(null);
  const [overrideForm, setOverrideForm] = useState<{
    driverId: number;
    routeId: number;
    busId: number | null;
    shift: string;
    notes: string;
  }>({ driverId: 0, routeId: 0, busId: null, shift: 'FULL_DAY', notes: '' });
  const [restWarnings, setRestWarnings] = useState<string[]>([]);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // 슬롯 편집 모달 (기존 - 비DRAFT 이외 용도 유지)
  const [editSlot, setEditSlot] = useState<Slot | null>(null);
  const [editForm, setEditForm] = useState<{
    isRestDay: boolean;
    routeId: number;
    busId: number | null;
    shift: string;
    notes: string;
  }>({ isRestDay: false, routeId: 0, busId: null, shift: 'FULL_DAY', notes: '' });

  // ─── 데이터 조회 ───

  const {
    data: schedule,
    isLoading,
    isError,
    error,
  } = useQuery<Schedule>({
    queryKey: ['schedule', year, month],
    queryFn: () => schedulesApi.get(year, month).then((r) => r.data.data),
    retry: 1,
  });

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data),
  });

  const { data: buses = [] } = useQuery<Bus[]>({
    queryKey: ['buses'],
    queryFn: () => busesApi.list().then((r) => r.data.data),
  });

  const { data: allUsersList = [] } = useQuery<Driver[]>({
    queryKey: ['users-drivers'],
    queryFn: () => usersApi.list({ role: 'DRIVER' }).then((r) => r.data.data),
  });

  // ─── 뮤테이션 ───

  const generateMutation = useMutation({
    mutationFn: () => schedulesApi.generate({ year, month, workDays, restDays }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success(res.data.message || '배차표가 생성되었습니다.');
      setShowGenerateModal(false);

      // 공정성 증명서 저장
      if (res.data.data?.fairnessReport) {
        setFairnessReport(res.data.data.fairnessReport);
        setShowFairnessReport(true);
      }

      // 경고 메시지 저장 및 표시
      if (res.data.data?.warnings?.length > 0) {
        setGenerationWarnings(res.data.data.warnings);
        res.data.data.warnings.forEach((w: string) => toast.error(w, { duration: 6000 }));
      } else {
        setGenerationWarnings([]);
      }
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '배차표 생성 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => schedulesApi.publish(year, month),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('배차표가 발행되었습니다. 모든 기사님께 알림이 발송됩니다.');
      setShowPublishConfirm(false);
    },
    onError: () => toast.error('발행 중 오류가 발생했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => schedulesApi.delete(year, month),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('배차표가 삭제되었습니다.');
      setShowDeleteConfirm(false);
    },
    onError: () => toast.error('삭제 중 오류가 발생했습니다.'),
  });

  const aiRecsMutation = useMutation({
    mutationFn: () => schedulesApi.getAIRecommendations(year, month, aiNotes),
    onSuccess: (res) => {
      setAiRecs(res.data.data.recommendations);
      if (res.data.data.parameters) {
        setWorkDays(res.data.data.parameters.workDays || 5);
        setRestDays(res.data.data.parameters.restDays || 2);
      }
      toast.success('AI 추천이 생성되었습니다.');
    },
    onError: () => toast.error('AI 추천 생성 중 오류가 발생했습니다.'),
  });

  const updateSlotMutation = useMutation({
    mutationFn: ({ slotId, data }: { slotId: number; data: Record<string, unknown> }) =>
      schedulesApi.updateSlot(slotId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('슬롯이 수정되었습니다.');
      setEditSlot(null);
    },
    onError: () => toast.error('수정 중 오류가 발생했습니다.'),
  });

  // 벌크 업데이트: 선택된 슬롯 일괄 변경
  const bulkUpdateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const ids = Array.from(selectedSlotIds);
      const results = await Promise.allSettled(
        ids.map(slotId => schedulesApi.updateSlot(slotId, data))
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) throw new Error(`${ids.length}건 중 ${failed}건 실패`);
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success(`${selectedSlotIds.size}개 슬롯이 일괄 변경되었습니다.`);
      setSelectedSlotIds(new Set());
      setShowBulkModal(false);
    },
    onError: (err: unknown) => toast.error((err as Error).message || '일괄 변경 중 오류가 발생했습니다.'),
  });

  const overrideSlotMutation = useMutation({
    mutationFn: ({ slotId, data }: { slotId: number; data: Record<string, unknown> }) =>
      schedulesApi.overrideSlot(slotId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('슬롯이 수동 변경되었습니다.');
      closeOverrideModal();
    },
    onError: (err: unknown) => {
      const response = (err as { response?: { status?: number; data?: { message?: string; restWarnings?: string[] } } })?.response;
      if (response?.status === 409 && response?.data?.restWarnings) {
        setRestWarnings(response.data.restWarnings);
        setShowForceConfirm(true);
      } else {
        const msg = response?.data?.message || '수동 변경 중 오류가 발생했습니다.';
        toast.error(msg);
      }
    },
  });

  // ─── 데이터 가공 ───

  const driverSlotMap = useMemo(() => {
    const map = new Map<number, Map<string, Slot>>();
    if (!schedule?.slots) return map;
    for (const slot of schedule.slots) {
      if (!map.has(slot.driver.id)) {
        map.set(slot.driver.id, new Map());
      }
      const dateKey = slot.date.split('T')[0];
      map.get(slot.driver.id)!.set(dateKey, slot);
    }
    return map;
  }, [schedule?.slots]);

  const allDrivers = useMemo(() => {
    if (!schedule?.slots) return [];
    const seen = new Map<number, Slot['driver']>();
    for (const slot of schedule.slots) {
      if (!seen.has(slot.driver.id)) {
        seen.set(slot.driver.id, slot.driver);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [schedule?.slots]);

  const filteredDrivers = useMemo(() => {
    let result = allDrivers;
    if (filterDriverType !== 'ALL') {
      result = result.filter((d) => d.driverType === filterDriverType);
    }
    if (filterRouteId) {
      result = result.filter((d) => {
        const slotMap = driverSlotMap.get(d.id);
        if (!slotMap) return false;
        return Array.from(slotMap.values()).some((s) => s.route?.id === filterRouteId);
      });
    }
    return result;
  }, [allDrivers, filterDriverType, filterRouteId, driverSlotMap]);

  // 통계
  const stats = useMemo(() => {
    if (!schedule?.slots) return { total: 0, work: 0, rest: 0, dropped: 0, filled: 0, absent: 0, completed: 0 };
    const work = schedule.slots.filter((s) => !s.isRestDay);
    return {
      total: schedule.slots.length,
      work: work.length,
      rest: schedule.slots.filter((s) => s.isRestDay).length,
      dropped: work.filter((s) => s.status === 'DROPPED').length,
      filled: work.filter((s) => s.status === 'FILLED').length,
      absent: work.filter((s) => s.status === 'ABSENT').length,
      completed: work.filter((s) => s.status === 'COMPLETED').length,
    };
  }, [schedule?.slots]);

  const filledRate = stats.work > 0 ? Math.round(((stats.work - stats.dropped - stats.absent) / stats.work) * 100) : 0;

  // ─── 핸들러 ───

  const navigateMonth = useCallback((delta: number) => {
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + delta));
  }, []);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const res = await schedulesApi.exportExcel(year, month);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `배차표_${year}년_${month}월.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('엑셀 파일이 다운로드되었습니다.');
    } catch {
      toast.error('엑셀 다운로드에 실패했습니다.');
    }
  }, [year, month]);

  // 슬롯 클릭 핸들러 - DRAFT일 때 오버라이드 모달 열기
  const openSlotForEdit = useCallback(
    (slot: Slot) => {
      if (schedule?.status !== 'DRAFT') {
        toast.error('초안 상태에서만 수정할 수 있습니다.');
        return;
      }
      // 오버라이드 모달 열기
      setOverrideSlot(slot);
      setOverrideForm({
        driverId: slot.driver.id,
        routeId: slot.route?.id || 0,
        busId: slot.bus?.id || null,
        shift: slot.shift || 'FULL_DAY',
        notes: slot.notes || '',
      });
      setRestWarnings([]);
      setShowForceConfirm(false);
      setOverrideReason('');
    },
    [schedule?.status],
  );

  const closeOverrideModal = useCallback(() => {
    setOverrideSlot(null);
    setRestWarnings([]);
    setShowForceConfirm(false);
    setOverrideReason('');
  }, []);

  const handleOverrideSave = useCallback(() => {
    if (!overrideSlot) return;
    overrideSlotMutation.mutate({
      slotId: overrideSlot.id,
      data: {
        driverId: overrideForm.driverId,
        routeId: overrideForm.routeId || undefined,
        busId: overrideForm.busId || undefined,
        shift: overrideForm.shift,
        notes: overrideForm.notes || undefined,
        isManualOverride: true,
      },
    });
  }, [overrideSlot, overrideForm, overrideSlotMutation]);

  const handleForceOverride = useCallback(() => {
    if (!overrideSlot || !overrideReason.trim()) {
      toast.error('강제 승인 사유를 입력해주세요.');
      return;
    }
    overrideSlotMutation.mutate({
      slotId: overrideSlot.id,
      data: {
        driverId: overrideForm.driverId,
        routeId: overrideForm.routeId || undefined,
        busId: overrideForm.busId || undefined,
        shift: overrideForm.shift,
        notes: overrideForm.notes || undefined,
        isManualOverride: true,
        overrideReason: overrideReason.trim(),
        forceOverride: true,
      },
    });
  }, [overrideSlot, overrideForm, overrideReason, overrideSlotMutation]);

  // 기존 편집 모달 (비오버라이드 용도 유지)
  const openEditSlot = useCallback(
    (slot: Slot) => {
      if (schedule?.status !== 'DRAFT') {
        toast.error('초안 상태에서만 수정할 수 있습니다.');
        return;
      }
      setEditSlot(slot);
      setEditForm({
        isRestDay: slot.isRestDay,
        routeId: slot.route?.id || 0,
        busId: slot.bus?.id || null,
        shift: slot.shift || 'FULL_DAY',
        notes: slot.notes || '',
      });
    },
    [schedule?.status],
  );

  const handleSaveSlot = useCallback(() => {
    if (!editSlot) return;
    updateSlotMutation.mutate({
      slotId: editSlot.id,
      data: {
        isRestDay: editForm.isRestDay,
        routeId: editForm.routeId || undefined,
        busId: editForm.busId || undefined,
        shift: editForm.shift,
        notes: editForm.notes || undefined,
      },
    });
  }, [editSlot, editForm, updateSlotMutation]);

  const resetFilters = useCallback(() => {
    setFilterDriverType('ALL');
    setFilterRouteId(null);
  }, []);

  // ─── 셀 렌더링 헬퍼 ───

  const getCellInfo = useCallback((slot: Slot | undefined) => {
    if (!slot) {
      return { label: '', sub: '', colors: null, isEmpty: true };
    }
    if (slot.isRestDay) {
      return {
        label: '휴',
        sub: '',
        colors: SLOT_COLORS.REST,
        isEmpty: false,
      };
    }
    const statusColors = SLOT_COLORS[slot.status as keyof typeof SLOT_COLORS] || SLOT_COLORS.SCHEDULED;
    const shiftLabel = SHIFT_LABELS[slot.shift] || '';
    const routeNum = slot.route?.routeNumber || '';
    const busNum = slot.bus?.busNumber || '';

    let label = '';
    if (slot.status === 'DROPPED') {
      label = '드랍';
    } else if (slot.status === 'ABSENT') {
      label = '결근';
    } else {
      label = routeNum || shiftLabel;
    }

    let sub = '';
    if (slot.status !== 'DROPPED' && slot.status !== 'ABSENT') {
      if (routeNum && shiftLabel) sub = shiftLabel;
      if (busNum) sub = sub ? `${sub}/${busNum}` : busNum;
    }

    return { label, sub, colors: statusColors, isEmpty: false };
  }, []);

  // 피로도 색상 헬퍼
  const getFatigueColor = useCallback((avg: number) => {
    if (avg <= 2) return 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30';
    if (avg <= 3) return 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30';
    return 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-900/30';
  }, []);

  // ─── 상태 뱃지 ───

  const statusConfig = schedule ? STATUS_CONFIG[schedule.status] || STATUS_CONFIG.DRAFT : null;

  // ═══════════════════════════════════════
  // 렌더링
  // ═══════════════════════════════════════

  return (
    <div className="space-y-5">
      {/* ─── 페이지 헤더 ─── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <Calendar className="text-blue-600" size={28} />
            배차표 관리
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-lg text-gray-600 dark:text-gray-400">
              {year}년 {month}월
            </span>
            {statusConfig && (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-base font-semibold border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}
              >
                {statusConfig.label}
              </span>
            )}
            {!schedule && !isLoading && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-base font-medium bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                미생성
              </span>
            )}
            {schedule?.status === 'DRAFT' && (
              <span className="text-base text-blue-600 dark:text-blue-400 font-medium">
                (셀을 클릭하여 수정 가능)
              </span>
            )}
          </div>
        </div>

        {/* 월 네비게이션 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-l-xl transition-colors"
              aria-label="이전 달"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              onClick={goToToday}
              className="px-5 py-3 text-lg font-semibold text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors min-w-[140px] text-center"
            >
              {year}년 {month}월
            </button>
            <button
              onClick={() => navigateMonth(1)}
              className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-r-xl transition-colors"
              aria-label="다음 달"
            >
              <ChevronRight size={22} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── 액션 버튼 바 ─── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowGenerateModal(true)}
          className="btn-primary inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px]"
        >
          <Play size={20} />
          배차표 생성
        </button>

        {schedule && (
          <>
            {schedule.status === 'DRAFT' && (
              <button
                onClick={() => setShowPublishConfirm(true)}
                disabled={publishMutation.isPending}
                className="inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50"
              >
                {publishMutation.isPending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                배차표 발행
              </button>
            )}

            <button
              onClick={handleExport}
              className="btn-secondary inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px]"
            >
              <Download size={20} />
              Excel 내보내기
            </button>

            <button
              onClick={() => {
                setShowGenerateModal(true);
                setAiNotes('');
                setAiRecs('');
              }}
              className="inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px] bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
            >
              <Sparkles size={20} />
              AI 추천
            </button>

            {schedule.status === 'DRAFT' && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleteMutation.isPending}
                className="btn-danger inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px]"
              >
                <Trash2 size={20} />
                삭제
              </button>
            )}
          </>
        )}

        {/* 필터 토글 */}
        <div className="ml-auto">
          <button
            onClick={() => setShowFilters((p) => !p)}
            className={`btn-secondary inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px] ${showFilters ? 'ring-2 ring-blue-400' : ''}`}
          >
            <Filter size={20} />
            필터
            {(filterDriverType !== 'ALL' || filterRouteId) && (
              <span className="ml-1 w-2.5 h-2.5 bg-blue-500 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* ─── 필터 패널 ─── */}
      {showFilters && (
        <div className="card flex flex-wrap items-end gap-6">
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">기사 구분</label>
            <div className="flex gap-2">
              {([['ALL', '전체'], ['MAIN', '메인 기사'], ['SPARE', '스페어 기사']] as const).map(
                ([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setFilterDriverType(value)}
                    className={`px-4 py-2.5 rounded-lg text-base font-medium transition-colors min-h-[48px] ${
                      filterDriverType === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="min-w-[200px]">
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">노선 필터</label>
            <select
              className="input text-base py-2.5 min-h-[48px]"
              value={filterRouteId || ''}
              onChange={(e) => setFilterRouteId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">전체 노선</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.routeNumber}번 - {r.name}
                </option>
              ))}
            </select>
          </div>
          {(filterDriverType !== 'ALL' || filterRouteId) && (
            <button
              onClick={resetFilters}
              className="btn-secondary inline-flex items-center gap-2 text-base min-h-[48px]"
            >
              <X size={18} />
              필터 초기화
            </button>
          )}
        </div>
      )}

      {/* ─── 통계 요약 ─── */}
      {schedule && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="전체 슬롯" value={stats.total} icon={<BarChart3 size={20} />} color="slate" />
          <StatCard label="근무일" value={stats.work} icon={<Users size={20} />} color="blue" />
          <StatCard label="배차율" value={`${filledRate}%`} icon={<Check size={20} />} color="emerald" />
          <StatCard label="드랍" value={stats.dropped} icon={<AlertTriangle size={20} />} color="red" />
          <StatCard label="결근" value={stats.absent} icon={<AlertTriangle size={20} />} color="orange" />
          <StatCard
            label="기사 수"
            value={`${filteredDrivers.length}명`}
            icon={<Users size={20} />}
            color="purple"
          />
        </div>
      )}

      {/* ─── 공정성 증명서 패널 ─── */}
      {fairnessReport.length > 0 && (
        <div className="card p-0 overflow-hidden dark:bg-gray-800">
          <button
            onClick={() => setShowFairnessReport((p) => !p)}
            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Shield size={22} className="text-blue-600 dark:text-blue-400" />
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                공정성 증명서
              </span>
              <span className="text-base text-gray-500 dark:text-gray-400">
                ({fairnessReport.length}명)
              </span>
            </div>
            {showFairnessReport ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
          </button>

          {showFairnessReport && (
            <div className="border-t border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-700">
                    <th className="text-left px-5 py-3 font-semibold text-gray-700 dark:text-gray-300 min-w-[120px]">
                      기사명
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 min-w-[80px]">
                      구분
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 min-w-[80px]">
                      근무일
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 min-w-[80px]">
                      휴무일
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 min-w-[100px]">
                      평균 피로도
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 min-w-[120px]">
                      선호노선 배정
                    </th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-700 dark:text-gray-300 min-w-[200px]">
                      요약
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fairnessReport.map((entry) => (
                    <tr
                      key={entry.driverId}
                      className="border-t border-gray-100 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <td className="px-5 py-3 font-semibold text-gray-900 dark:text-gray-100">
                        {entry.driverName}
                      </td>
                      <td className="text-center px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded text-sm font-bold ${
                            entry.driverType === 'MAIN'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                              : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                          }`}
                        >
                          {entry.driverType === 'MAIN' ? '메인' : '스페어'}
                        </span>
                      </td>
                      <td className="text-center px-4 py-3 font-bold text-gray-800 dark:text-gray-200">
                        {entry.workDays}일
                      </td>
                      <td className="text-center px-4 py-3 text-gray-600 dark:text-gray-400">
                        {entry.restDays}일
                      </td>
                      <td className="text-center px-4 py-3">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-base font-bold ${getFatigueColor(
                            entry.avgFatigue,
                          )}`}
                        >
                          {entry.avgFatigue.toFixed(1)}
                        </span>
                      </td>
                      <td className="text-center px-4 py-3 font-bold text-gray-800 dark:text-gray-200">
                        {entry.preferredRouteCount}건
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                        {entry.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── 생성 후 경고 메시지 ─── */}
      {generationWarnings.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-600 p-5">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle size={22} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <h3 className="text-lg font-bold text-amber-800 dark:text-amber-300">
              배차 생성 경고 ({generationWarnings.length}건)
            </h3>
          </div>
          <ul className="space-y-2">
            {generationWarnings.map((warning, idx) => (
              <li key={idx} className="flex items-start gap-2 text-base text-amber-700 dark:text-amber-300">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setGenerationWarnings([])}
            className="mt-4 text-base text-amber-600 dark:text-amber-400 hover:underline font-medium"
          >
            경고 닫기
          </button>
        </div>
      )}

      {/* ─── 로딩 상태 ─── */}
      {isLoading && (
        <div className="card text-center py-24">
          <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
          <p className="text-xl text-gray-500 dark:text-gray-400">
            {year}년 {month}월 배차표를 불러오는 중입니다...
          </p>
        </div>
      )}

      {/* ─── 에러 상태 ─── */}
      {isError && !isLoading && (
        <div className="card text-center py-20 border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-700">
          <AlertTriangle size={48} className="mx-auto text-red-400 mb-4" />
          <h3 className="text-xl font-semibold text-red-700 dark:text-red-400 mb-2">데이터를 불러올 수 없습니다</h3>
          <p className="text-base text-red-500 dark:text-red-400 mb-6">
            {(error as { message?: string })?.message || '서버 연결을 확인해주세요.'}
          </p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['schedule', year, month] })}
            className="btn-primary text-base px-6 py-3 min-h-[48px]"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* ─── 빈 상태 ─── */}
      {!isLoading && !isError && !schedule && (
        <div className="card text-center py-24">
          <Calendar size={64} className="mx-auto text-gray-300 dark:text-gray-600 mb-5" />
          <h3 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {year}년 {month}월 배차표가 없습니다
          </h3>
          <p className="text-lg text-gray-400 dark:text-gray-500 mb-8">AI 자동 생성으로 최적의 배차표를 만들어 보세요.</p>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="btn-primary inline-flex items-center gap-3 text-lg px-8 py-4 min-h-[56px]"
          >
            <Play size={24} />
            배차표 자동 생성
          </button>
        </div>
      )}

      {/* ─── 벌크 액션 바 ─── */}
      {selectedSlotIds.size > 0 && schedule?.status === 'DRAFT' && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-5 py-3">
          <span className="text-base font-semibold text-blue-800 dark:text-blue-200">
            {selectedSlotIds.size}{'\uAC1C \uC2AC\uB86F \uC120\uD0DD\uB428'}
          </span>
          <div className="flex items-center gap-3">
            <button
              className="btn-primary text-sm px-4 py-2"
              onClick={() => setShowBulkModal(true)}
            >
              {'\uC77C\uAD04 \uBCC0\uACBD'}
            </button>
            <button
              className="btn-secondary text-sm px-3 py-2"
              onClick={() => setSelectedSlotIds(new Set())}
            >
              {'\uC120\uD0DD \uD574\uC81C'}
            </button>
          </div>
        </div>
      )}

      {/* ─── 벌크 변경 모달 ─── */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="일괄 변경">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-2xl p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {selectedSlotIds.size}{'\uAC1C \uC2AC\uB86F \uC77C\uAD04 \uBCC0\uACBD'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{'\uB178\uC120 \uBCC0\uACBD'}</label>
                <select
                  className="form-input"
                  value={bulkRouteId}
                  onChange={e => setBulkRouteId(Number(e.target.value))}
                >
                  <option value={0}>{'\uBCC0\uACBD \uC548 \uD568'}</option>
                  {(routes || []).map((r: Route) => (
                    <option key={r.id} value={r.id}>{r.routeNumber}{'\uBC88'} {r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{'\uADFC\uBB34 \uBCC0\uACBD'}</label>
                <select
                  className="form-input"
                  value={bulkShift}
                  onChange={e => setBulkShift(e.target.value)}
                >
                  <option value="">{'\uBCC0\uACBD \uC548 \uD568'}</option>
                  <option value="MORNING">{'\uC624\uC804'}</option>
                  <option value="AFTERNOON">{'\uC624\uD6C4'}</option>
                  <option value="FULL_DAY">{'\uC885\uC77C'}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setShowBulkModal(false)}>
                {'\uCDE8\uC18C'}
              </button>
              <button
                className="btn-primary"
                disabled={(!bulkRouteId && !bulkShift) || bulkUpdateMutation.isPending}
                onClick={() => {
                  const data: Record<string, unknown> = {};
                  if (bulkRouteId) data.routeId = bulkRouteId;
                  if (bulkShift) data.shift = bulkShift;
                  bulkUpdateMutation.mutate(data);
                }}
              >
                {bulkUpdateMutation.isPending ? '\uCC98\uB9AC \uC911...' : '\uC77C\uAD04 \uC801\uC6A9'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 캘린더/그리드 배차표 ─── */}
      {!isLoading && !isError && schedule && (
        <div className="card p-0 overflow-hidden dark:bg-gray-800">
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse"
              style={{ minWidth: `${daysInMonth * 52 + 220}px` }}
            >
              {/* 테이블 헤더 */}
              <thead>
                <tr className="bg-gray-800 dark:bg-gray-900 text-white">
                  {/* 기사 이름 열 (고정) */}
                  <th className="sticky left-0 z-20 bg-gray-800 dark:bg-gray-900 text-left px-4 py-3 text-base font-semibold min-w-[180px] border-r border-gray-700">
                    기사명 / 사번
                  </th>
                  {/* 날짜 열 */}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const date = new Date(year, month - 1, i + 1);
                    const dow = date.getDay();
                    const isSun = dow === 0;
                    const isSat = dow === 6;
                    return (
                      <th
                        key={i}
                        className={`text-center px-0.5 py-3 font-medium min-w-[48px] border-r border-gray-700/50 ${
                          isSun ? 'text-red-300' : isSat ? 'text-sky-300' : 'text-gray-200'
                        }`}
                      >
                        <div className="text-base font-bold">{i + 1}</div>
                        <div className={`text-sm font-normal ${isSun ? 'text-red-400' : isSat ? 'text-sky-400' : 'text-gray-400'}`}>
                          {DAYS_KR[dow]}
                        </div>
                      </th>
                    );
                  })}
                  {/* 합계 열 */}
                  <th className="bg-gray-700 dark:bg-gray-800 text-center px-3 py-3 text-base font-semibold min-w-[80px]">
                    합계
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredDrivers.length === 0 && (
                  <tr>
                    <td colSpan={daysInMonth + 2} className="text-center py-16 text-lg text-gray-400 dark:text-gray-500">
                      {allDrivers.length === 0
                        ? '배차표에 기사 정보가 없습니다.'
                        : '필터 조건에 맞는 기사가 없습니다.'}
                    </td>
                  </tr>
                )}

                {filteredDrivers.map((driver, idx) => {
                  const slotMap = driverSlotMap.get(driver.id) || new Map<string, Slot>();
                  const isEven = idx % 2 === 0;
                  const rowBg = isEven ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/80 dark:bg-gray-750';

                  // 기사별 통계
                  const driverWorkCount = Array.from(slotMap.values()).filter((s) => !s.isRestDay).length;
                  const driverRestCount = Array.from(slotMap.values()).filter((s) => s.isRestDay).length;

                  return (
                    <tr key={driver.id} className={`${rowBg} hover:bg-blue-50/40 dark:hover:bg-blue-900/20 transition-colors`}>
                      {/* 기사 정보 (고정 열) */}
                      <td
                        className={`sticky left-0 z-10 ${rowBg} px-4 py-2 border-b border-r border-gray-200 dark:border-gray-700`}
                      >
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                              {driver.name}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-sm text-gray-500 dark:text-gray-400">{driver.employeeId}</span>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                  driver.driverType === 'MAIN'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                                }`}
                              >
                                {driver.driverType === 'MAIN' ? '메인' : '스페어'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 날짜별 셀 */}
                      {Array.from({ length: daysInMonth }, (_, i) => {
                        const date = new Date(year, month - 1, i + 1);
                        const dateKey = format(date, 'yyyy-MM-dd');
                        const slot = slotMap.get(dateKey);
                        const dow = date.getDay();
                        const { label, sub, colors, isEmpty } = getCellInfo(slot);
                        const isEditable = schedule.status === 'DRAFT' && !!slot;
                        const isWeekend = dow === 0 || dow === 6;

                        return (
                          <td
                            key={i}
                            className={`text-center border-b border-r border-gray-100 dark:border-gray-700 py-1 px-0.5 transition-all ${
                              isEmpty
                                ? isWeekend
                                  ? 'bg-gray-50/50 dark:bg-gray-800/50'
                                  : ''
                                : ''
                            } ${isEditable ? 'cursor-pointer hover:ring-2 hover:ring-blue-400 hover:ring-inset' : ''}`}
                            title={
                              slot
                                ? `${slot.driver.name} | ${slot.route?.routeNumber || '-'}번 ${slot.route?.name || ''} | ${slot.bus?.busNumber || '차량미배정'} | ${slot.status === 'DROPPED' ? '드랍' : slot.isRestDay ? '휴무' : SHIFT_LABELS[slot.shift] || slot.shift}${slot.notes ? ` | ${slot.notes}` : ''}${slot.fairnessNote ? ` | 공정성: ${slot.fairnessNote}` : ''}${slot.isManualOverride ? ' | [수동변경]' : ''}`
                                : ''
                            }
                            onClick={(e) => {
                              if (!slot || !isEditable) return;
                              // Shift+클릭: 벌크 선택 토글
                              if (e.shiftKey && !slot.isRestDay) {
                                setSelectedSlotIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(slot.id)) next.delete(slot.id);
                                  else next.add(slot.id);
                                  return next;
                                });
                                return;
                              }
                              openSlotForEdit(slot);
                            }}
                          >
                            {isEmpty ? (
                              <span className="text-gray-200 dark:text-gray-600 text-sm">&middot;</span>
                            ) : (
                              <div className="relative">
                                {/* 벌크 선택 표시 */}
                                {slot && selectedSlotIds.has(slot.id) && (
                                  <div className="absolute -top-1 -left-0.5 z-10 w-4 h-4 rounded bg-blue-600 flex items-center justify-center">
                                    <Check size={10} className="text-white" />
                                  </div>
                                )}
                                <div
                                  className={`rounded-md mx-auto py-0.5 min-h-[38px] flex flex-col items-center justify-center ${
                                    colors ? `${colors.bg} ${colors.text}` : ''
                                  } ${slot && selectedSlotIds.has(slot.id) ? 'ring-2 ring-blue-500' : ''}`}
                                >
                                  <span className="text-sm font-bold leading-tight">{label}</span>
                                  {sub && <span className="text-[10px] leading-tight opacity-75">{sub}</span>}
                                </div>
                                {/* 수동 변경 뱃지 */}
                                {slot?.isManualOverride && (
                                  <span className="absolute -top-1 -right-0.5 px-1 py-0 text-[9px] font-bold bg-orange-500 text-white rounded leading-tight">
                                    수동
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* 합계 */}
                      <td
                        className={`text-center border-b border-l-2 border-gray-200 dark:border-gray-700 py-2 px-2 ${
                          isEven ? 'bg-gray-50 dark:bg-gray-700/50' : 'bg-gray-100/80 dark:bg-gray-700'
                        }`}
                      >
                        <div className="text-base font-bold text-blue-700 dark:text-blue-400">{driverWorkCount}일</div>
                        <div className="text-sm text-gray-400 dark:text-gray-500">{driverRestCount}휴</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 범례 (Legend) ─── */}
      {schedule && (
        <div className="card py-4 px-5 dark:bg-gray-800">
          <div className="flex items-center gap-2 mb-3 text-base font-semibold text-gray-700 dark:text-gray-300">
            <Info size={18} />
            범례 (색상 안내)
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
            <LegendItem color="bg-blue-100 border-blue-300" label="배차됨 (예정)" />
            <LegendItem color="bg-red-100 border-red-300" label="드랍 (긴급 공석)" />
            <LegendItem color="bg-emerald-100 border-emerald-300" label="대체 배차 완료" />
            <LegendItem color="bg-slate-100 border-slate-300" label="운행 완료" />
            <LegendItem color="bg-orange-100 border-orange-300" label="결근" />
            <LegendItem color="bg-gray-50 border-gray-200" label="휴무일" />
            <span className="ml-2 flex items-center gap-2">
              <span className="px-1.5 py-0 text-[10px] font-bold bg-orange-500 text-white rounded">수동</span>
              <span className="text-gray-600 dark:text-gray-400">수동 변경됨</span>
            </span>
            <span className="ml-4 border-l border-gray-200 dark:border-gray-600 pl-4 flex items-center gap-3 text-gray-500 dark:text-gray-400">
              <span className="font-bold text-blue-800 dark:text-blue-400">조</span> 오전
              <span className="font-bold text-blue-800 dark:text-blue-400">석</span> 오후
              <span className="font-bold text-blue-800 dark:text-blue-400">종</span> 전일
            </span>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════
          모달들
          ═══════════════════════════════════════ */}

      {/* 수동 오버라이드 모달 */}
      {overrideSlot && (
        <Modal onClose={closeOverrideModal} title="슬롯 수동 변경" maxWidth="max-w-lg" icon={<Edit3 size={22} className="text-blue-600" />}>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-5">
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{overrideSlot.driver.name}</div>
            <div className="text-base text-gray-500 dark:text-gray-400 mt-1">
              {overrideSlot.date.split('T')[0]} | 사번: {overrideSlot.driver.employeeId}
            </div>
            <div className="mt-2 flex items-center gap-3 text-base text-gray-600 dark:text-gray-300">
              <span>현재 노선: <strong>{overrideSlot.route?.routeNumber || '-'}번</strong></span>
              <span>|</span>
              <span>차량: <strong>{overrideSlot.bus?.busNumber || '미배정'}</strong></span>
            </div>
            {overrideSlot.fairnessNote && (
              <div className="mt-3 flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800">
                <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>AI 배정 근거:</strong> {overrideSlot.fairnessNote}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-5">
            {/* 기사 변경 */}
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">
                기사 배정 변경
              </label>
              <select
                className="input text-base py-3 min-h-[48px]"
                value={overrideForm.driverId}
                onChange={(e) => setOverrideForm((p) => ({ ...p, driverId: parseInt(e.target.value) }))}
              >
                <option value={0}>기사 선택</option>
                {allUsersList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.employeeId}) - {d.driverType === 'MAIN' ? '메인' : '스페어'}
                  </option>
                ))}
              </select>
            </div>

            {/* 교대 구분 */}
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">교대 구분</label>
              <div className="flex gap-3">
                {[
                  { value: 'MORNING', label: '오전 (조)' },
                  { value: 'AFTERNOON', label: '오후 (석)' },
                  { value: 'FULL_DAY', label: '전일 (종)' },
                ].map((opt) => (
                  <ToggleButton
                    key={opt.value}
                    active={overrideForm.shift === opt.value}
                    onClick={() => setOverrideForm((p) => ({ ...p, shift: opt.value }))}
                    activeColor="bg-blue-600"
                    label={opt.label}
                  />
                ))}
              </div>
            </div>

            {/* 노선 */}
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">노선</label>
              <select
                className="input text-base py-3 min-h-[48px]"
                value={overrideForm.routeId}
                onChange={(e) => setOverrideForm((p) => ({ ...p, routeId: parseInt(e.target.value) }))}
              >
                <option value={0}>선택 안함</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.routeNumber}번 - {r.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 차량 */}
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">차량 번호</label>
              <select
                className="input text-base py-3 min-h-[48px]"
                value={overrideForm.busId || ''}
                onChange={(e) =>
                  setOverrideForm((p) => ({ ...p, busId: e.target.value ? parseInt(e.target.value) : null }))
                }
              >
                <option value="">차량 미배정</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.busNumber}
                  </option>
                ))}
              </select>
            </div>

            {/* 메모 */}
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">메모 (선택)</label>
              <input
                className="input text-base py-3 min-h-[48px]"
                placeholder="예: 기사 교체, 노선 변경..."
                value={overrideForm.notes}
                onChange={(e) => setOverrideForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>

            {/* 휴식시간 위반 경고 */}
            {restWarnings.length > 0 && (
              <div className="rounded-xl border-2 border-red-400 bg-red-50 dark:bg-red-900/30 dark:border-red-600 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <AlertTriangle size={24} className="text-red-600 dark:text-red-400 flex-shrink-0" />
                  <h4 className="text-lg font-bold text-red-800 dark:text-red-300">
                    휴식시간 위반 경고
                  </h4>
                </div>
                <ul className="space-y-2 mb-4">
                  {restWarnings.map((w, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-base text-red-700 dark:text-red-300">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>

                {!showForceConfirm ? (
                  <button
                    onClick={() => setShowForceConfirm(true)}
                    className="w-full text-base py-3 min-h-[48px] bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-bold"
                  >
                    그래도 강제 승인하시겠습니까?
                  </button>
                ) : (
                  <div className="space-y-3 border-t border-red-300 dark:border-red-600 pt-4 mt-3">
                    <label className="block text-base font-bold text-red-800 dark:text-red-300">
                      강제 승인하시겠습니까? (사유 입력)
                    </label>
                    <textarea
                      className="w-full border-2 border-red-300 dark:border-red-600 rounded-lg px-4 py-3 text-base min-h-[80px] resize-none focus:ring-2 focus:ring-red-400 dark:bg-gray-800 dark:text-gray-100"
                      placeholder="강제 승인 사유를 반드시 입력하세요..."
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                    />
                    <button
                      onClick={handleForceOverride}
                      disabled={!overrideReason.trim() || overrideSlotMutation.isPending}
                      className="w-full text-base py-3 min-h-[52px] bg-red-700 text-white rounded-lg hover:bg-red-800 transition-colors font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      {overrideSlotMutation.isPending ? (
                        <>
                          <Loader2 size={20} className="animate-spin" /> 처리 중...
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={20} /> 강제 승인
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 하단 버튼 - 경고가 없을 때만 일반 저장 버튼 표시 */}
          {restWarnings.length === 0 && (
            <div className="flex gap-3 mt-7">
              <button
                onClick={closeOverrideModal}
                className="btn-secondary flex-1 text-base py-3 min-h-[52px]"
              >
                취소
              </button>
              <button
                onClick={handleOverrideSave}
                disabled={overrideSlotMutation.isPending}
                className="btn-primary flex-1 text-base py-3 min-h-[52px] inline-flex items-center justify-center gap-2"
              >
                {overrideSlotMutation.isPending ? (
                  <>
                    <Loader2 size={20} className="animate-spin" /> 저장 중...
                  </>
                ) : (
                  '변경 저장'
                )}
              </button>
            </div>
          )}

          {/* 경고 있을 때 취소 버튼 */}
          {restWarnings.length > 0 && (
            <div className="flex gap-3 mt-5">
              <button
                onClick={closeOverrideModal}
                className="btn-secondary flex-1 text-base py-3 min-h-[52px]"
              >
                취소
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* 기존 슬롯 편집 모달 (fallback) */}
      {editSlot && (
        <Modal onClose={() => setEditSlot(null)} title="슬롯 수정" maxWidth="max-w-lg">
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-5">
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{editSlot.driver.name}</div>
            <div className="text-base text-gray-500 dark:text-gray-400 mt-1">
              {editSlot.date.split('T')[0]} | 사번: {editSlot.driver.employeeId}
            </div>
          </div>

          <div className="space-y-5">
            {/* 근무/휴무 */}
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">근무 상태</label>
              <div className="flex gap-3">
                <ToggleButton
                  active={!editForm.isRestDay}
                  onClick={() => setEditForm((p) => ({ ...p, isRestDay: false }))}
                  activeColor="bg-blue-600"
                  label="근무일"
                />
                <ToggleButton
                  active={editForm.isRestDay}
                  onClick={() => setEditForm((p) => ({ ...p, isRestDay: true }))}
                  activeColor="bg-gray-600"
                  label="휴무일"
                />
              </div>
            </div>

            {/* 교대 구분 */}
            {!editForm.isRestDay && (
              <div>
                <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">교대 구분</label>
                <div className="flex gap-3">
                  {[
                    { value: 'MORNING', label: '오전 (조)' },
                    { value: 'AFTERNOON', label: '오후 (석)' },
                    { value: 'FULL_DAY', label: '전일 (종)' },
                  ].map((opt) => (
                    <ToggleButton
                      key={opt.value}
                      active={editForm.shift === opt.value}
                      onClick={() => setEditForm((p) => ({ ...p, shift: opt.value }))}
                      activeColor="bg-blue-600"
                      label={opt.label}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 노선 */}
            {!editForm.isRestDay && (
              <div>
                <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">노선</label>
                <select
                  className="input text-base py-3 min-h-[48px]"
                  value={editForm.routeId}
                  onChange={(e) => setEditForm((p) => ({ ...p, routeId: parseInt(e.target.value) }))}
                >
                  <option value={0}>선택 안함</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.routeNumber}번 - {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 차량 */}
            {!editForm.isRestDay && (
              <div>
                <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">차량 번호</label>
                <select
                  className="input text-base py-3 min-h-[48px]"
                  value={editForm.busId || ''}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, busId: e.target.value ? parseInt(e.target.value) : null }))
                  }
                >
                  <option value="">차량 미배정</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.busNumber}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 메모 */}
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">메모 (선택)</label>
              <input
                className="input text-base py-3 min-h-[48px]"
                placeholder="예: 병가, 출장, 대체 근무..."
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex gap-3 mt-7">
            <button
              onClick={() => setEditSlot(null)}
              className="btn-secondary flex-1 text-base py-3 min-h-[52px]"
            >
              취소
            </button>
            <button
              onClick={handleSaveSlot}
              disabled={updateSlotMutation.isPending}
              className="btn-primary flex-1 text-base py-3 min-h-[52px] inline-flex items-center justify-center gap-2"
            >
              {updateSlotMutation.isPending ? (
                <>
                  <Loader2 size={20} className="animate-spin" /> 저장 중...
                </>
              ) : (
                '저장'
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* 배차표 생성 모달 */}
      {showGenerateModal && (
        <Modal
          onClose={() => {
            setShowGenerateModal(false);
            setAiRecs('');
          }}
          title={`${year}년 ${month}월 배차표 생성`}
          maxWidth="max-w-xl"
          icon={<Sparkles size={24} className="text-blue-600" />}
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">근무 일수</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  className="input text-lg py-3 min-h-[48px] text-center font-bold"
                  value={workDays}
                  onChange={(e) => setWorkDays(parseInt(e.target.value) || 5)}
                />
                <p className="text-sm text-gray-400 mt-1 text-center">연속 근무일</p>
              </div>
              <div>
                <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">휴무 일수</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  className="input text-lg py-3 min-h-[48px] text-center font-bold"
                  value={restDays}
                  onChange={(e) => setRestDays(parseInt(e.target.value) || 2)}
                />
                <p className="text-sm text-gray-400 mt-1 text-center">연속 휴무일</p>
              </div>
            </div>

            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">
                AI 특이사항 (선택)
              </label>
              <textarea
                className="input text-base py-3 resize-none"
                rows={3}
                placeholder="예: 이번 달은 추석 연휴가 있어서 공휴일 처리가 필요합니다..."
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
              />
              <button
                onClick={() => aiRecsMutation.mutate()}
                disabled={aiRecsMutation.isPending}
                className="mt-3 inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px] bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50"
              >
                <Sparkles size={18} />
                {aiRecsMutation.isPending ? 'AI 분석 중...' : 'AI 추천 받기'}
              </button>
            </div>

            {aiRecs && (
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-5">
                <h3 className="text-base font-bold text-purple-800 dark:text-purple-300 mb-2 flex items-center gap-2">
                  <Sparkles size={18} /> AI 추천 사항
                </h3>
                <p className="text-base text-purple-700 dark:text-purple-300 whitespace-pre-wrap leading-relaxed">{aiRecs}</p>
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={22} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-base text-amber-800 dark:text-amber-300">
                기존 초안 배차표가 있으면 삭제 후 새로 생성됩니다.
                <br />
                이미 발행된 배차표는 영향 받지 않습니다.
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-7">
            <button
              onClick={() => {
                setShowGenerateModal(false);
                setAiRecs('');
              }}
              className="btn-secondary flex-1 text-base py-3 min-h-[52px]"
            >
              취소
            </button>
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="btn-primary flex-1 text-base py-3 min-h-[52px] inline-flex items-center justify-center gap-2"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 size={20} className="animate-spin" /> AI가 최적 배차를 계산하고 있습니다...
                </>
              ) : (
                <>
                  <Sparkles size={20} /> AI 자동 생성
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* 발행 확인 모달 */}
      {showPublishConfirm && (
        <Modal onClose={() => setShowPublishConfirm(false)} title="배차표 발행 확인" maxWidth="max-w-md">
          <div className="text-center py-4">
            <Send size={48} className="mx-auto text-emerald-500 mb-4" />
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
              <strong>{year}년 {month}월</strong> 배차표를 발행하시겠습니까?
            </p>
            <p className="text-base text-gray-500 dark:text-gray-400">
              발행 시 모든 기사님께 푸시 알림이 발송됩니다.
              <br />
              발행 후에는 수정이 불가합니다.
            </p>
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setShowPublishConfirm(false)}
              className="btn-secondary flex-1 text-base py-3 min-h-[52px]"
            >
              취소
            </button>
            <button
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="flex-1 text-base py-3 min-h-[52px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {publishMutation.isPending ? (
                <>
                  <Loader2 size={20} className="animate-spin" /> 발행 중...
                </>
              ) : (
                <>
                  <Send size={20} /> 발행하기
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <Modal onClose={() => setShowDeleteConfirm(false)} title="배차표 삭제 확인" maxWidth="max-w-md">
          <div className="text-center py-4">
            <Trash2 size={48} className="mx-auto text-red-500 mb-4" />
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
              <strong>{year}년 {month}월</strong> 배차표를 삭제하시겠습니까?
            </p>
            <p className="text-base text-red-500 dark:text-red-400 font-medium">이 작업은 되돌릴 수 없습니다.</p>
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="btn-secondary flex-1 text-base py-3 min-h-[52px]"
            >
              취소
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="btn-danger flex-1 text-base py-3 min-h-[52px] inline-flex items-center justify-center gap-2"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 size={20} className="animate-spin" /> 삭제 중...
                </>
              ) : (
                <>
                  <Trash2 size={20} /> 삭제하기
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// 서브 컴포넌트
// ═══════════════════════════════════════

function Modal({
  onClose,
  title,
  maxWidth = 'max-w-lg',
  icon,
  children,
}: {
  onClose: () => void;
  title: string;
  maxWidth?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full ${maxWidth} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            {icon}
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="닫기"
          >
            <X size={22} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
    red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
    orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',
    purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[color] || colorMap.slate}`}>
      <div className="flex items-center gap-2 mb-1 opacity-70">{icon}<span className="text-sm font-medium">{label}</span></div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`w-5 h-5 rounded border ${color}`} />
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
    </span>
  );
}

function ToggleButton({
  active,
  onClick,
  activeColor,
  label,
}: {
  active: boolean;
  onClick: () => void;
  activeColor: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 rounded-lg border text-base font-semibold transition-colors min-h-[48px] ${
        active
          ? `${activeColor} text-white border-transparent`
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-500'
      }`}
    >
      {label}
    </button>
  );
}
