import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Settings,
  Printer,
  RotateCcw,
  Plus,
} from 'lucide-react';
import { schedulesApi, routesApi, busesApi, usersApi, dayOffApi } from '../services/api';
import { format, getDaysInMonth } from 'date-fns';
import toast from 'react-hot-toast';
import PrintOptionsModal from '../components/PrintOptionsModal';
import PageHeader from '../components/PageHeader';
import { useAuthStore } from '../store/authStore';

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

interface V2Result {
  scheduleId: number;
  slotsCreated: number;
  policyUsed: string;
  elapsedMs: number;
  summary?: string;
  metrics?: {
    fairnessScore?: number;
    workDayMean?: number;
    workDayStdev?: number;
    withinTargetRate?: number;
    withinAcceptableRate?: number;
    hardViolationCount?: number;
    exemptedCount?: number;
    homeBusRate?: number;
    crossRouteRate?: number;
    restCycleCompliance?: number;
    weeklyShiftConsistencyRate?: number;
    weekendStdev?: number;
    dayOffSatisfactionRate?: number;
    unfilledCount?: number;
    localSearchSwaps?: number;
  };
  unfilled?: Array<{
    date: string;
    busId?: number;
    routeId?: number;
    shift?: string;
    reason?: string;
  }>;
  hardViolators?: Array<{
    driverId?: number;
    driverName?: string;
    name?: string;
    workDays?: number;
    workloadEval?: { tier?: string; appliedSweetRange?: { min: number; max: number } };
    detail?: string;
  }>;
  exempted?: Array<{
    driverId?: number;
    driverName?: string;
    name?: string;
    workloadEval?: { exemptionReason?: string; exemptionNote?: string };
  }>;
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
  const [showPolicyNudge, setShowPolicyNudge] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const navigate = useNavigate();
  const companyId = useAuthStore((s) => s.user?.companyId);

  // 첫 배차 안내(nudge)는 "계정(회사)당 딱 한 번"만 뜬다.
  //   - 키를 회사별로 분리 (브라우저 전역 X) → 계정 전환 시 각 계정마다 한 번씩
  //   - nudge 가 뜨는 순간 '봤음'으로 기록 → 설정에 갔다 와도 다시 안 뜸(무한 반복 방지)
  const nudgeSeenKey = `busync.policyNudgeSeen.${companyId ?? 'unknown'}`;
  const openGenerate = useCallback(() => {
    let seen = false;
    try { seen = localStorage.getItem(nudgeSeenKey) === '1'; } catch { /* ignore */ }
    if (seen) {
      setShowGenerateModal(true);
    } else {
      try { localStorage.setItem(nudgeSeenKey, '1'); } catch { /* ignore */ }
      setShowPolicyNudge(true);
    }
  }, [nudgeSeenKey]);
  const proceedToGenerate = useCallback(() => {
    setShowPolicyNudge(false);
    setShowGenerateModal(true);
  }, []);
  const goToSettings = useCallback(() => {
    setShowPolicyNudge(false);
    navigate('/dashboard/settings');
  }, [navigate]);
  const [workDays, setWorkDays] = useState(5);
  const [restDays, setRestDays] = useState(2);
  const [aiNotes, setAiNotes] = useState('');
  const [aiRecs, setAiRecs] = useState('');

  // v2 솔버 결과 (메트릭·미충족·하드룰 위반자)
  const [v2Result, setV2Result] = useState<V2Result | null>(null);
  const [showViolators, setShowViolators] = useState(false);
  const [showUnfilled, setShowUnfilled] = useState(false);

  // DRAFT 덮어쓰기 확인
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);

  // 기사 드릴다운 — 한 달 상세 모달
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);

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

  // 빈 셀 배차 추가 모달 상태
  const [addCtx, setAddCtx] = useState<{ driverId: number; driverName: string; dateKey: string } | null>(null);
  const [addForm, setAddForm] = useState<{ routeId: number; busId: number | null; shift: string; isRestDay: boolean; notes: string }>(
    { routeId: 0, busId: null, shift: 'FULL_DAY', isRestDay: false, notes: '' },
  );

  // 수동 변경 되돌리기 스택 (클라이언트 세션 한정)
  const [undoStack, setUndoStack] = useState<Array<{ slotId: number; label: string; prev: Record<string, unknown> }>>([]);
  const pendingUndoRef = useRef<{ slotId: number; label: string; prev: Record<string, unknown> } | null>(null);

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
    queryKey: ['routes', 'all'],
    queryFn: () => routesApi.list({ limit: '100' }).then((r) => r.data.data),
  });

  const { data: buses = [] } = useQuery<Bus[]>({
    queryKey: ['buses', 'all'],
    queryFn: () => busesApi.list({ limit: '100' }).then((r) => r.data.data),
  });

  const { data: allUsersList = [] } = useQuery<Driver[]>({
    queryKey: ['users-drivers'],
    queryFn: () => usersApi.list({ role: 'DRIVER' }).then((r) => r.data.data),
  });

  // 배차 품질 체크리스트용: 이번 달 회사 전체 휴가 신청
  const monthParam = `${year}-${String(month).padStart(2, '0')}`;
  const { data: monthDayoffs = [] } = useQuery<Array<{ id: number; date: string; status: string; driver: { id: number; name: string; employeeId: string } }>>({
    queryKey: ['dayoff', 'month-all', monthParam],
    queryFn: () => dayOffApi.list({ month: monthParam, limit: '100' }).then((r) => r.data.data ?? []),
  });

  // ─── 뮤테이션 ───

  const generateMutation = useMutation({
    // v2 솔버 사용 — 회사 정책(CITY_2SHIFT 등) 자동 적용 + PAIR + 헌법룰
    mutationFn: () => schedulesApi.generateV2({ year, month, overwriteDraft: true }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      const d = res.data as V2Result;
      setV2Result(d);
      toast.success(
        `배차표 생성 완료 — ${d.slotsCreated ?? 0}슬롯 (${d.policyUsed ?? '기본정책'}, ${(d.elapsedMs ?? 0) / 1000}초)`,
      );
      setShowGenerateModal(false);
      setShowOverwriteConfirm(false);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error?.message ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '배차표 생성 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  // 수동 편집된 슬롯 수 (덮어쓰기 경고용)
  const manualOverrideCount = useMemo(() => {
    return (schedule?.slots ?? []).filter((s) => s.isManualOverride).length;
  }, [schedule]);

  // "AI 자동 생성" 클릭 — DRAFT 가 있고 수동 편집이 있으면 경고 모달
  const handleGenerateClick = () => {
    if (schedule?.status === 'DRAFT' && manualOverrideCount > 0) {
      setShowOverwriteConfirm(true);
    } else {
      generateMutation.mutate();
    }
  };

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
      // 되돌리기 스택에 변경 직전 상태 적재
      if (pendingUndoRef.current) {
        const entry = pendingUndoRef.current;
        setUndoStack((prev) => [...prev, entry]);
        pendingUndoRef.current = null;
      }
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

  // ─── AI 배차 품질 체크리스트 ───
  const quality = useMemo(() => {
    if (!schedule?.slots) return null;
    const work = schedule.slots.filter((s) => !s.isRestDay);

    // 1) 차량 미배정 (근무인데 차량 없음) — 노선별 집계
    const noBus = work.filter((s) => !s.bus);
    const noBusByRoute = new Map<string, number>();
    for (const s of noBus) {
      const rn = s.route?.routeNumber ?? '-';
      noBusByRoute.set(rn, (noBusByRoute.get(rn) ?? 0) + 1);
    }

    // 2) 미충원 (드랍/결근)
    const unfilled = work.filter((s) => s.status === 'DROPPED' || s.status === 'ABSENT');

    // 3) 휴가 반영 — 승인된 휴가일에 기사가 근무로 잡혀있으면 미반영
    const slotByKey = new Map<string, Slot>();
    for (const s of schedule.slots) slotByKey.set(`${s.driver.id}|${s.date.slice(0, 10)}`, s);
    const approved = monthDayoffs.filter((d) => d.status === 'APPROVED');
    const unreflected = approved
      .filter((d) => {
        const s = slotByKey.get(`${d.driver.id}|${d.date.slice(0, 10)}`);
        return s && !s.isRestDay; // 승인 휴가인데 근무 중
      })
      .map((d) => ({ name: d.driver.name, employeeId: d.driver.employeeId, date: d.date.slice(5, 10) }));
    const pendingCount = monthDayoffs.filter((d) => d.status === 'PENDING').length;

    // 4) 근무일 균형 (기사별 근무일 최소~최대)
    const workByDriver = new Map<number, number>();
    for (const s of work) workByDriver.set(s.driver.id, (workByDriver.get(s.driver.id) ?? 0) + 1);
    const counts = [...workByDriver.values()];
    const minWork = counts.length ? Math.min(...counts) : 0;
    const maxWork = counts.length ? Math.max(...counts) : 0;

    return {
      noBusCount: noBus.length,
      noBusByRoute: [...noBusByRoute.entries()].sort((a, b) => b[1] - a[1]),
      unfilledCount: unfilled.length,
      approvedCount: approved.length,
      unreflected,
      pendingCount,
      minWork,
      maxWork,
      spread: maxWork - minWork,
    };
  }, [schedule?.slots, monthDayoffs]);

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

  // 수동 변경 직전 상태를 되돌리기용으로 캡처 (override 성공 시 스택에 적재됨)
  const captureUndo = useCallback((slot: Slot) => {
    pendingUndoRef.current = {
      slotId: slot.id,
      label: `${slot.driver.name} ${slot.date.split('T')[0]}`,
      prev: {
        driverId: slot.driver.id,
        routeId: slot.route?.id || undefined,
        busId: slot.bus?.id ?? null,
        shift: slot.shift || 'FULL_DAY',
        isRestDay: slot.isRestDay,
        notes: slot.notes || undefined,
      },
    };
  }, []);

  const handleOverrideSave = useCallback(() => {
    if (!overrideSlot) return;
    captureUndo(overrideSlot);
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
  }, [overrideSlot, overrideForm, overrideSlotMutation, captureUndo]);

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

  // ─── 빈 셀 배차 추가 ───
  const openAddSlot = useCallback(
    (driverId: number, driverName: string, dateKey: string) => {
      if (schedule?.status !== 'DRAFT') {
        toast.error('초안 상태에서만 배차를 추가할 수 있습니다.');
        return;
      }
      setAddCtx({ driverId, driverName, dateKey });
      setAddForm({ routeId: 0, busId: null, shift: 'FULL_DAY', isRestDay: false, notes: '' });
    },
    [schedule?.status],
  );

  const createSlotMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => schedulesApi.createSlot(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('배차가 추가되었습니다.');
      setAddCtx(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '배차 추가 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  const handleAddSlot = useCallback(() => {
    if (!addCtx || !schedule) return;
    if (!addForm.isRestDay && !addForm.routeId) {
      toast.error('노선을 선택해주세요. (휴무는 노선 없이 가능)');
      return;
    }
    createSlotMutation.mutate({
      scheduleId: schedule.id,
      driverId: addCtx.driverId,
      date: addCtx.dateKey,
      routeId: addForm.routeId || routes[0]?.id,
      busId: addForm.busId || undefined,
      shift: addForm.shift,
      isRestDay: addForm.isRestDay,
      notes: addForm.notes || undefined,
    });
  }, [addCtx, addForm, schedule, createSlotMutation, routes]);

  // ─── 수동 변경 되돌리기 ───
  const undoMutation = useMutation({
    mutationFn: ({ slotId, data }: { slotId: number; data: Record<string, unknown> }) =>
      schedulesApi.updateSlot(slotId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('이전 상태로 되돌렸습니다.');
    },
    onError: () => toast.error('되돌리기 중 오류가 발생했습니다.'),
  });

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      undoMutation.mutate({ slotId: last.slotId, data: last.prev });
      return prev.slice(0, -1);
    });
  }, [undoMutation]);

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

// ─── 상태 뱃지 ───

  const statusConfig = schedule ? STATUS_CONFIG[schedule.status] || STATUS_CONFIG.DRAFT : null;

  // ═══════════════════════════════════════
  // 렌더링
  // ═══════════════════════════════════════

  return (
    <div className="space-y-5" data-print-root>
      {/* ─── 페이지 헤더 ─── */}
      <div data-print-section="header">
        <PageHeader
          icon={Calendar}
          title="배차표 관리"
          actions={
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
          }
        >
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
                (셀 클릭: 수정 · 빈 셀 클릭: 배차 추가)
              </span>
            )}
          </div>
        </PageHeader>
      </div>

      {/* ─── 액션 버튼 바 ─── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={openGenerate}
          className="btn-primary inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px]"
        >
          <Play size={20} />
          배차표 생성
        </button>

        {schedule && (
          <>
            {schedule.status === 'DRAFT' && undoStack.length > 0 && (
              <button
                onClick={handleUndo}
                disabled={undoMutation.isPending}
                className="inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px] bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium disabled:opacity-50"
                title="마지막 수동 변경을 되돌립니다"
              >
                {undoMutation.isPending ? <Loader2 size={20} className="animate-spin" /> : <RotateCcw size={20} />}
                되돌리기 ({undoStack.length})
              </button>
            )}
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
              onClick={() => setShowPrintOptions(true)}
              className="btn-secondary inline-flex items-center gap-2 text-base px-5 py-3 min-h-[48px]"
              data-print-hide
            >
              <Printer size={20} />
              인쇄
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
        <div data-print-section="summary" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="전체 슬롯" value={stats.total} icon={<BarChart3 size={20} />} color="slate" />
          <StatCard label="근무일" value={stats.work} icon={<Users size={20} />} color="blue" />
          <StatCard label="배차율" value={`${filledRate}%`} icon={<Check size={20} />} color="emerald" />
          <StatCard
            label="기사 수"
            value={`${filteredDrivers.length}명`}
            icon={<Users size={20} />}
            color="purple"
          />
        </div>
      )}

      {/* ─── AI 배차 품질 체크리스트 ─── */}
      {schedule && quality && (
        <QualityChecklist quality={quality} filledRate={filledRate} />
      )}

      {/* ─── v2 솔버 결과 패널 ─── */}
      {v2Result && (
        <V2ResultPanel
          result={v2Result}
          showViolators={showViolators}
          showUnfilled={showUnfilled}
          onToggleViolators={() => setShowViolators((p) => !p)}
          onToggleUnfilled={() => setShowUnfilled((p) => !p)}
          onClose={() => setV2Result(null)}
          onDriverClick={(driverId) => setSelectedDriverId(driverId)}
        />
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
            onClick={openGenerate}
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

      {/* ─── 인쇄 영역: 이 안(배차표 + 범례)만 인쇄된다 ─── */}
      <div data-print-area className="space-y-5">
      {/* 인쇄 전용 제목 — 화면에서는 숨김, 인쇄 시에만 표시 */}
      {schedule && (
        <div className="hidden print:block text-center mb-2">
          <h2 className="text-xl font-bold text-black">{year}년 {month}월 배차표</h2>
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
                <tr className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                  {/* 기사 이름 열 (고정) */}
                  <th className="sticky left-0 z-20 bg-gray-200 dark:bg-gray-700 text-left px-4 py-3 text-base font-semibold min-w-[180px] border-r border-gray-300 dark:border-gray-600">
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
                        className={`text-center px-0.5 py-3 font-medium min-w-[48px] border-r border-gray-300/70 dark:border-gray-600/50 ${
                          isSun ? 'text-red-600 dark:text-red-300' : isSat ? 'text-sky-600 dark:text-sky-300' : 'text-gray-700 dark:text-gray-200'
                        }`}
                      >
                        <div className="text-base font-bold">{i + 1}</div>
                        <div className={`text-sm font-normal ${isSun ? 'text-red-500 dark:text-red-400' : isSat ? 'text-sky-500 dark:text-sky-400' : 'text-gray-500 dark:text-gray-400'}`}>
                          {DAYS_KR[dow]}
                        </div>
                      </th>
                    );
                  })}
                  {/* 합계 열 */}
                  <th className="bg-gray-200 dark:bg-gray-700 text-center px-3 py-3 text-base font-semibold min-w-[80px]">
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
                      {/* 기사 정보 (고정 열) — 클릭 시 드릴다운 */}
                      <td
                        className={`sticky left-0 z-10 ${rowBg} px-4 py-2 border-b border-r border-gray-200 dark:border-gray-700`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedDriverId(driver.id)}
                          className="w-full text-left flex items-center gap-2 -mx-2 px-2 py-1 rounded-lg hover:bg-blue-100/60 dark:hover:bg-blue-900/30 transition group"
                          aria-label={`${driver.name} 기사 한 달 상세 보기`}
                        >
                          <div>
                            <div className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight group-hover:text-blue-700 dark:group-hover:text-blue-300">
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
                        </button>
                      </td>

                      {/* 날짜별 셀 */}
                      {Array.from({ length: daysInMonth }, (_, i) => {
                        const date = new Date(year, month - 1, i + 1);
                        const dateKey = format(date, 'yyyy-MM-dd');
                        const slot = slotMap.get(dateKey);
                        const dow = date.getDay();
                        const { label, sub, colors, isEmpty } = getCellInfo(slot);
                        const isDraft = schedule.status === 'DRAFT';
                        const isEditable = isDraft && !!slot;
                        const canAdd = isDraft && !slot;
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
                            } ${(isEditable || canAdd) ? 'cursor-pointer hover:ring-2 hover:ring-blue-400 hover:ring-inset' : ''}`}
                            title={
                              slot
                                ? `${slot.driver.name} | ${slot.route?.routeNumber || '-'}번 ${slot.route?.name || ''} | ${slot.bus?.busNumber || '차량미배정'} | ${slot.status === 'DROPPED' ? '드랍' : slot.isRestDay ? '휴무' : SHIFT_LABELS[slot.shift] || slot.shift}${slot.notes ? ` | ${slot.notes}` : ''}${friendlyFairnessNote(slot.fairnessNote) ? ` | ${friendlyFairnessNote(slot.fairnessNote)}` : ''}${slot.isManualOverride ? ' | [수동변경]' : ''}`
                                : canAdd
                                  ? '클릭하여 배차 추가'
                                  : ''
                            }
                            onClick={(e) => {
                              if (!slot) {
                                if (canAdd) openAddSlot(driver.id, driver.name, dateKey);
                                return;
                              }
                              if (!isEditable) return;
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
                              canAdd ? (
                                <span className="text-gray-300 dark:text-gray-600 inline-flex items-center justify-center min-h-[38px]"><Plus size={14} /></span>
                              ) : (
                                <span className="text-gray-200 dark:text-gray-600 text-sm">&middot;</span>
                              )
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
        <div data-print-section="legend" className="card py-4 px-5 dark:bg-gray-800">
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
      </div>
      {/* ─── /인쇄 영역 ─── */}

      {/* ═══════════════════════════════════════
          모달들
          ═══════════════════════════════════════ */}

      {/* 빈 셀 배차 추가 모달 */}
      {addCtx && (
        <Modal onClose={() => setAddCtx(null)} title="배차 추가" maxWidth="max-w-lg" icon={<Plus size={22} className="text-blue-600" />}>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-5">
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{addCtx.driverName}</div>
            <div className="text-base text-gray-500 dark:text-gray-400 mt-1">{addCtx.dateKey}</div>
          </div>

          <div className="space-y-5">
            <label className="flex items-center gap-2 text-base text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={addForm.isRestDay} onChange={(e) => setAddForm((p) => ({ ...p, isRestDay: e.target.checked }))} />
              휴무일로 추가
            </label>

            {!addForm.isRestDay && (
              <>
                <div>
                  <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">노선 *</label>
                  <select className="input text-base py-3 min-h-[48px]" value={addForm.routeId} onChange={(e) => setAddForm((p) => ({ ...p, routeId: parseInt(e.target.value) }))}>
                    <option value={0}>노선 선택</option>
                    {routes.map((r) => (<option key={r.id} value={r.id}>{r.routeNumber}번 {r.name}</option>))}
                  </select>
                </div>

                <div>
                  <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">차량 (선택)</label>
                  <select className="input text-base py-3 min-h-[48px]" value={addForm.busId ?? 0} onChange={(e) => setAddForm((p) => ({ ...p, busId: parseInt(e.target.value) || null }))}>
                    <option value={0}>차량 미배정</option>
                    {buses.map((b) => (<option key={b.id} value={b.id}>{b.busNumber}</option>))}
                  </select>
                </div>

                <div>
                  <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">교대 구분</label>
                  <div className="flex gap-3">
                    {[{ value: 'MORNING', label: '오전 (조)' }, { value: 'AFTERNOON', label: '오후 (석)' }, { value: 'FULL_DAY', label: '전일 (종)' }].map((opt) => (
                      <ToggleButton key={opt.value} active={addForm.shift === opt.value} onClick={() => setAddForm((p) => ({ ...p, shift: opt.value }))} activeColor="bg-blue-600" label={opt.label} />
                    ))}
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">메모 (선택)</label>
              <input className="input text-base py-3 min-h-[48px]" value={addForm.notes} onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))} placeholder="비고" />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button className="btn-secondary" onClick={() => setAddCtx(null)}>취소</button>
            <button className="btn-primary inline-flex items-center gap-2" disabled={createSlotMutation.isPending} onClick={handleAddSlot}>
              {createSlotMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              추가
            </button>
          </div>
        </Modal>
      )}

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
            {friendlyFairnessNote(overrideSlot.fairnessNote) && (
              <div className="mt-3 flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800">
                <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>AI 배정 근거:</strong> {friendlyFairnessNote(overrideSlot.fairnessNote)}
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

      {/* 기사 한 달 상세 (드릴다운) */}
      {selectedDriverId !== null && schedule && (
        <DriverDetailModal
          driverId={selectedDriverId}
          year={year}
          month={month}
          daysInMonth={daysInMonth}
          slots={schedule.slots}
          violatorEntry={v2Result?.hardViolators?.find((v) => v.driverId === selectedDriverId)}
          onClose={() => setSelectedDriverId(null)}
        />
      )}

      {/* DRAFT 덮어쓰기 확인 — 수동 편집된 슬롯이 있을 때만 */}
      {showOverwriteConfirm && (
        <Modal
          onClose={() => setShowOverwriteConfirm(false)}
          title="기존 초안을 덮어쓸까요?"
          maxWidth="max-w-md"
          icon={<AlertTriangle size={22} className="text-amber-500" />}
        >
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
              <div className="text-[14px] font-semibold text-amber-800 dark:text-amber-200 mb-1">
                수동 편집한 슬롯 {manualOverrideCount}건이 사라집니다
              </div>
              <p className="text-[13px] text-amber-700 dark:text-amber-300 leading-relaxed">
                현재 초안에 직접 수정한 배차가 있어요. AI가 새로 생성하면 이 수정 사항은 모두 덮어쓰여 복구할 수 없습니다.
              </p>
            </div>
            <p className="text-[13px] text-gray-500 dark:text-gray-400">
              이미 발행된 배차표(PUBLISHED)는 영향 받지 않습니다.
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
              <button
                onClick={() => setShowOverwriteConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-[14px]"
              >
                취소
              </button>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white inline-flex items-center justify-center gap-2 text-[14px] font-medium"
              >
                {generateMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                덮어쓰기 진행
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 첫 배차 — 배차 설정 안내 nudge */}
      {showPolicyNudge && (
        <Modal
          onClose={() => setShowPolicyNudge(false)}
          title="배차 설정을 먼저 확인해 보세요"
          maxWidth="max-w-md"
          icon={<Settings size={22} className="text-blue-600" />}
        >
          <div className="space-y-4">
            <p className="text-[15px] text-gray-700 dark:text-gray-200 leading-relaxed">
              처음 배차표를 생성하시는 것 같아요. AI는 <b>회사 운영 정책</b>(시프트 형태, 승무 모델, 근무 사이클, 안전 룰 등)에 따라 배차표를 만듭니다.
            </p>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">
              지금 설정을 확인하지 않으면 기본 정책(시내버스 2교대, PAIR, 5근 2휴)으로 진행됩니다.
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
              <button
                onClick={proceedToGenerate}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-[14px]"
              >
                기본값으로 진행
              </button>
              <button
                onClick={goToSettings}
                className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center justify-center gap-2 text-[14px] font-medium"
              >
                <Settings size={16} /> 배차 설정 보러 가기
              </button>
            </div>
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
              onClick={handleGenerateClick}
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

      {/* 인쇄 옵션 모달 */}
      <PrintOptionsModal
        open={showPrintOptions}
        onClose={() => setShowPrintOptions(false)}
        title={`busync-schedule-${year}-${String(month).padStart(2, '0')}`}
      />

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
  // 배경은 전부 흰색으로 통일. 색상은 아이콘·수치 텍스트에만 사용해 구분.
  const accentMap: Record<string, string> = {
    slate: 'text-slate-600 dark:text-slate-300',
    blue: 'text-blue-700 dark:text-blue-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    red: 'text-red-700 dark:text-red-300',
    orange: 'text-orange-700 dark:text-orange-300',
    purple: 'text-purple-700 dark:text-purple-300',
  };
  const accent = accentMap[color] || accentMap.slate;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
      <div className={`flex items-center gap-2 mb-1 ${accent}`}>{icon}<span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span></div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
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

/* ────────────────────────────────────────────────
   V2 솔버 결과 패널 — 메트릭·미충족·하드룰 위반자
   ──────────────────────────────────────────────── */

function V2ResultPanel({
  result,
  showViolators,
  showUnfilled,
  onToggleViolators,
  onToggleUnfilled,
  onClose,
  onDriverClick,
}: {
  result: V2Result;
  showViolators: boolean;
  showUnfilled: boolean;
  onToggleViolators: () => void;
  onToggleUnfilled: () => void;
  onClose: () => void;
  onDriverClick: (driverId: number) => void;
}) {
  const m = result.metrics ?? {};
  const fairness = Math.round(m.fairnessScore ?? 0);
  const fairnessColor = fairness >= 85 ? 'green' : fairness >= 60 ? 'amber' : 'red';
  const unfilled = m.unfilledCount ?? 0;
  const violators = m.hardViolationCount ?? 0;
  const exempted = m.exemptedCount ?? 0;
  const homeBusPct = Math.round((m.homeBusRate ?? 0) * 100);
  const targetPct = Math.round((m.withinTargetRate ?? 0) * 100);

  return (
    <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Sparkles size={18} className="text-blue-500" />
            AI 배차 결과
          </h2>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
            {result.policyUsed} 정책 · {result.slotsCreated.toLocaleString()}개 슬롯 · {((result.elapsedMs ?? 0) / 1000).toFixed(1)}초 소요
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5"
          aria-label="결과 닫기"
        >
          <X size={18} />
        </button>
      </div>

      {/* 메트릭 카드 */}
      <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="공정성 점수"
          value={`${fairness}`}
          unit="/100"
          color={fairnessColor}
          hint={fairness >= 85 ? '목표 달성' : fairness >= 60 ? '개선 여지' : '재생성 권장'}
        />
        <MetricCard
          label="목표 근무일 충족"
          value={`${targetPct}`}
          unit="%"
          color={targetPct >= 80 ? 'green' : targetPct >= 60 ? 'amber' : 'red'}
          hint={`평균 ${(m.workDayMean ?? 0).toFixed(1)}일`}
        />
        <MetricCard
          label="미배정 슬롯"
          value={`${unfilled}`}
          unit="개"
          color={unfilled === 0 ? 'green' : unfilled < 50 ? 'amber' : 'red'}
          hint={unfilled === 0 ? '모두 배정됨' : '본인 차량 외 충원 필요'}
        />
        <MetricCard
          label="안전 룰 위반"
          value={`${violators}`}
          unit="명"
          color={violators === 0 ? 'green' : violators < 10 ? 'amber' : 'red'}
          hint={exempted > 0 ? `면제 ${exempted}명 제외` : ''}
        />
      </div>

      {/* 보조 지표 (작은 텍스트 줄) */}
      <div className="px-6 pb-4 -mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-gray-500 dark:text-gray-400">
        <span>본인 차량 배정률 <b className="text-gray-700 dark:text-gray-200">{homeBusPct}%</b></span>
        <span>휴무 사이클 준수 <b className="text-gray-700 dark:text-gray-200">{Math.round((m.restCycleCompliance ?? 0) * 100)}%</b></span>
        <span>주간 시프트 일관성 <b className="text-gray-700 dark:text-gray-200">{Math.round((m.weeklyShiftConsistencyRate ?? 0) * 100)}%</b></span>
        <span>승인 휴무 반영 <b className="text-gray-700 dark:text-gray-200">{Math.round((m.dayOffSatisfactionRate ?? 0) * 100)}%</b></span>
      </div>

      {/* 펼치기: 하드룰 위반자 */}
      {result.hardViolators && result.hardViolators.length > 0 && (
        <div className="border-t border-gray-200 dark:border-white/10">
          <button
            onClick={onToggleViolators}
            className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] transition"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              <span className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">
                안전 룰 위반자
              </span>
              <span className="text-[12px] text-gray-500">({result.hardViolators.length}명)</span>
            </div>
            {showViolators ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showViolators && (
            <div className="overflow-x-auto border-t border-gray-100 dark:border-white/10 max-h-[300px]">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 dark:bg-white/[0.02] sticky top-0">
                  <tr>
                    <th className="text-left px-5 py-2 font-semibold text-gray-600 dark:text-gray-300">기사</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">근무일</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">사유</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                  {result.hardViolators.map((v, i) => {
                    const tier = v.workloadEval?.tier;
                    const range = v.workloadEval?.appliedSweetRange;
                    const reason = tier === 'UNDER_MIN' ? '근무일 부족' : tier === 'OVER_MAX' ? '근무일 초과' : tier || '범위 위반';
                    const clickable = v.driverId !== undefined;
                    return (
                      <tr
                        key={i}
                        onClick={() => clickable && onDriverClick(v.driverId!)}
                        className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] ${clickable ? 'cursor-pointer' : ''}`}
                      >
                        <td className="px-5 py-2 font-medium text-gray-900 dark:text-gray-100">
                          {clickable ? (
                            <span className="text-blue-700 dark:text-blue-300 hover:underline">
                              {v.driverName || v.name || `#${v.driverId}`}
                            </span>
                          ) : (
                            v.driverName || v.name || `#${v.driverId}`
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-200">
                          {v.workDays ?? '-'}일
                        </td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                          {reason}
                          {range && ` (허용 ${range.min}~${range.max}일)`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 펼치기: 미배정 슬롯 */}
      {result.unfilled && result.unfilled.length > 0 && (
        <div className="border-t border-gray-200 dark:border-white/10">
          <button
            onClick={onToggleUnfilled}
            className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] transition"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <span className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">
                미배정 슬롯
              </span>
              <span className="text-[12px] text-gray-500">
                ({m.unfilledCount ?? result.unfilled.length}개{result.unfilled.length < (m.unfilledCount ?? 0) ? ` 중 ${result.unfilled.length}개 표시` : ''})
              </span>
            </div>
            {showUnfilled ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showUnfilled && (
            <div className="overflow-x-auto border-t border-gray-100 dark:border-white/10 max-h-[300px]">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 dark:bg-white/[0.02] sticky top-0">
                  <tr>
                    <th className="text-left px-5 py-2 font-semibold text-gray-600 dark:text-gray-300">날짜</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">시프트</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">버스</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">사유</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                  {result.unfilled.map((u, i) => {
                    const shift = u.shift === 'AM' || u.shift === 'MORNING' ? '오전'
                      : u.shift === 'PM' || u.shift === 'AFTERNOON' ? '오후'
                      : u.shift === 'FULL_DAY' ? '종일'
                      : u.shift || '-';
                    return (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <td className="px-5 py-2 text-gray-900 dark:text-gray-100 font-mono">{u.date.slice(0, 10)}</td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{shift}</td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-200 font-mono">
                          {u.busId ? `#${u.busId}` : '-'}
                        </td>
                        <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{u.reason || '대체 인력 없음'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, unit, color, hint }: {
  label: string;
  value: string;
  unit: string;
  color: 'green' | 'amber' | 'red';
  hint?: string;
}) {
  const cls = {
    green: 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/5',
    amber: 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5',
    red: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5',
  }[color];
  const textCls = {
    green: 'text-green-700 dark:text-green-300',
    amber: 'text-amber-700 dark:text-amber-300',
    red: 'text-red-700 dark:text-red-300',
  }[color];
  return (
    <div className={`border-2 rounded-xl p-4 ${cls}`}>
      <div className="text-[12px] text-gray-600 dark:text-gray-300">{label}</div>
      <div className={`text-[26px] font-bold mt-1 ${textCls}`}>
        {value}
        <span className="text-[13px] font-normal opacity-80 ml-0.5">{unit}</span>
      </div>
      {hint && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate">{hint}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────────
   기사 한 달 상세 — 드릴다운 모달
   ──────────────────────────────────────────────── */

function DriverDetailModal({
  driverId,
  year,
  month,
  daysInMonth,
  slots,
  violatorEntry,
  onClose,
}: {
  driverId: number;
  year: number;
  month: number;
  daysInMonth: number;
  slots: Slot[];
  violatorEntry?: NonNullable<V2Result['hardViolators']>[number];
  onClose: () => void;
}) {
  const driverSlots = useMemo(
    () => slots.filter((s) => s.driver?.id === driverId).sort((a, b) => a.date.localeCompare(b.date)),
    [slots, driverId],
  );
  const driver = driverSlots[0]?.driver;

  const stats = useMemo(() => {
    const work = driverSlots.filter((s) => !s.isRestDay);
    const rest = driverSlots.filter((s) => s.isRestDay);
    const morning = work.filter((s) => s.shift === 'MORNING').length;
    const afternoon = work.filter((s) => s.shift === 'AFTERNOON').length;
    const fullDay = work.filter((s) => s.shift === 'FULL_DAY').length;
    const dropped = work.filter((s) => s.status === 'DROPPED').length;
    const filled = work.filter((s) => s.status === 'FILLED').length;
    const overrides = driverSlots.filter((s) => s.isManualOverride).length;
    const routeCounts = new Map<string, number>();
    for (const s of work) {
      const rn = s.route?.routeNumber || '-';
      routeCounts.set(rn, (routeCounts.get(rn) ?? 0) + 1);
    }
    const routes = [...routeCounts.entries()].sort((a, b) => b[1] - a[1]);
    return { work: work.length, rest: rest.length, morning, afternoon, fullDay, dropped, filled, overrides, routes };
  }, [driverSlots]);

  const slotByDay = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const s of driverSlots) m.set(s.date.slice(0, 10), s);
    return m;
  }, [driverSlots]);

  // 이 기사의 휴가(휴무) 요청일 — 캘린더에 점으로 표시
  const monthParam = `${year}-${String(month).padStart(2, '0')}`;
  const { data: dayOffReqs = [] } = useQuery<Array<{ date: string }>>({
    queryKey: ['dayoff', 'driver', driverId, monthParam],
    queryFn: () =>
      dayOffApi.list({ driverId: String(driverId), month: monthParam }).then((r) => r.data.data ?? []),
  });
  const requestedDays = useMemo(
    () => new Set(dayOffReqs.map((d) => d.date.slice(0, 10))),
    [dayOffReqs],
  );

  if (!driver) {
    return (
      <Modal onClose={onClose} title="기사 상세" maxWidth="max-w-md">
        <div className="py-8 text-center text-gray-500">이 기사의 슬롯이 없습니다.</div>
      </Modal>
    );
  }

  // 위반 사유 변환
  const violationLine = (() => {
    if (!violatorEntry) return null;
    const tier = violatorEntry.workloadEval?.tier;
    const range = violatorEntry.workloadEval?.appliedSweetRange;
    if (!tier) return violatorEntry.detail || null;
    const reason = tier === 'UNDER_MIN' ? '근무일 부족' : tier === 'OVER_MAX' ? '근무일 초과' : tier;
    return `${reason}${range ? ` (허용 ${range.min}~${range.max}일)` : ''}`;
  })();

  return (
    <Modal
      onClose={onClose}
      title={`${driver.name} 기사 상세`}
      maxWidth="max-w-4xl"
      icon={<Users size={22} className="text-blue-600" />}
    >
      <div className="space-y-5">
        {/* 헤더 정보 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[14px] text-gray-500">{driver.employeeId}</span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
              driver.driverType === 'MAIN'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
            }`}
          >
            {driver.driverType === 'MAIN' ? '메인' : '스페어'}
          </span>
          <span className="text-[13px] text-gray-500">{year}년 {month}월</span>
        </div>

        {/* 위반 배너 */}
        {violationLine && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-3 flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <div className="text-[13px] text-red-700 dark:text-red-300">
              <b>안전 룰 위반:</b> {violationLine}
            </div>
          </div>
        )}

        {/* 통계 칩 */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          <StatChip label="근무" value={`${stats.work}일`} color="blue" />
          <StatChip label="휴무" value={`${stats.rest}일`} color="gray" />
          {stats.morning > 0 && <StatChip label="오전" value={`${stats.morning}일`} color="amber" />}
          {stats.afternoon > 0 && <StatChip label="오후" value={`${stats.afternoon}일`} color="sky" />}
          {stats.fullDay > 0 && <StatChip label="종일" value={`${stats.fullDay}일`} color="indigo" />}
          {stats.dropped > 0 && <StatChip label="드랍" value={`${stats.dropped}건`} color="red" />}
          {stats.filled > 0 && <StatChip label="대타 출근" value={`${stats.filled}건`} color="emerald" />}
          {stats.overrides > 0 && <StatChip label="수동 변경" value={`${stats.overrides}건`} color="purple" />}
        </div>

        {/* 노선 분포 */}
        {stats.routes.length > 0 && (
          <div>
            <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200 mb-2">담당 노선</div>
            <div className="flex flex-wrap gap-2">
              {stats.routes.map(([rn, count]) => (
                <span key={rn} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 text-[12px]">
                  {rn}번 <b>{count}일</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 한 달 캘린더 그리드 */}
        <div>
          <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200 mb-2">{month}월 일별 배차</div>
          <div className="grid grid-cols-7 gap-1.5">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <div key={d} className={`text-center text-[11px] font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
                {d}
              </div>
            ))}
            {/* 첫 주 빈 칸 */}
            {Array.from({ length: new Date(year, month - 1, 1).getDay() }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const date = new Date(year, month - 1, day);
              const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const slot = slotByDay.get(dateKey);
              const dow = date.getDay();
              return (
                <DayCell key={day} day={day} dow={dow} slot={slot} requested={requestedDays.has(dateKey)} />
              );
            })}
          </div>
          {/* 색상/표시 안내 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border bg-amber-50 border-amber-200" /> 오전</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border bg-sky-50 border-sky-200" /> 오후</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border bg-indigo-50 border-indigo-200" /> 종일</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border bg-gray-100 border-gray-200" /> 휴무</span>
            <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> 휴가 요청일</span>
          </div>
        </div>

      </div>
    </Modal>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color: 'blue' | 'gray' | 'amber' | 'orange' | 'sky' | 'indigo' | 'red' | 'emerald' | 'purple' }) {
  const cls = {
    blue: 'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/5 text-blue-700 dark:text-blue-300',
    gray: 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02] text-gray-700 dark:text-gray-300',
    amber: 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 text-amber-700 dark:text-amber-300',
    orange: 'border-orange-200 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/5 text-orange-700 dark:text-orange-300',
    sky: 'border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/5 text-sky-700 dark:text-sky-300',
    indigo: 'border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/5 text-indigo-700 dark:text-indigo-300',
    red: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5 text-red-700 dark:text-red-300',
    emerald: 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    purple: 'border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/5 text-purple-700 dark:text-purple-300',
  }[color];
  return (
    <div className={`border rounded-lg px-3 py-2 ${cls}`}>
      <div className="text-[10px] opacity-80">{label}</div>
      <div className="text-[16px] font-bold leading-tight">{value}</div>
    </div>
  );
}

type QualityData = {
  noBusCount: number;
  noBusByRoute: [string, number][];
  unfilledCount: number;
  approvedCount: number;
  unreflected: { name: string; employeeId: string; date: string }[];
  pendingCount: number;
  minWork: number;
  maxWork: number;
  spread: number;
};

function QualityChecklist({ quality: q, filledRate }: { quality: QualityData; filledRate: number }) {
  const checks: boolean[] = [filledRate === 100, q.noBusCount === 0, q.approvedCount === 0 || q.unreflected.length === 0];
  const passCount = checks.filter(Boolean).length;
  const warnCount = checks.filter((c) => !c).length;
  return (
    <div data-print-hide className="card dark:bg-gray-800 p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <Shield size={18} className="text-blue-600" />
        <h3 className="text-base font-bold text-gray-900 dark:text-white">AI 배차 품질 체크리스트</h3>
        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">통과 {passCount} · 주의 {warnCount}</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        <ChecklistRow
          status={filledRate === 100 ? 'pass' : 'warn'}
          title="배차 완료율"
          summary={filledRate === 100 ? '모든 근무 슬롯이 배차되었습니다' : `미충원 ${q.unfilledCount}건 (배차율 ${filledRate}%)`}
        />
        <ChecklistRow
          status={q.noBusCount === 0 ? 'pass' : 'warn'}
          title="차량 배정"
          summary={q.noBusCount === 0 ? '모든 근무에 차량이 배정되었습니다' : `차량 미배정 ${q.noBusCount}건 — 노선별 확인`}
        >
          {q.noBusCount > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.noBusByRoute.map(([rn, c]) => (
                <span key={rn} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 text-[12px]">
                  {rn}번 <b>{c}건</b>
                </span>
              ))}
            </div>
          )}
        </ChecklistRow>
        <ChecklistRow
          status={q.approvedCount === 0 ? 'info' : q.unreflected.length === 0 ? 'pass' : 'warn'}
          title="휴가 반영"
          summary={
            q.approvedCount === 0
              ? `승인된 휴가 없음${q.pendingCount > 0 ? ` · 미결재 ${q.pendingCount}건` : ''}`
              : q.unreflected.length === 0
                ? `승인 휴가 ${q.approvedCount}건 모두 반영됨${q.pendingCount > 0 ? ` · 미결재 ${q.pendingCount}건` : ''}`
                : `승인 휴가 ${q.approvedCount}건 중 ${q.unreflected.length}건 미반영${q.pendingCount > 0 ? ` · 미결재 ${q.pendingCount}건` : ''}`
          }
        >
          {q.unreflected.length > 0 && (
            <ul className="space-y-1">
              {q.unreflected.map((u, i) => (
                <li key={i} className="text-[12px] text-gray-600 dark:text-gray-300">
                  <b>{u.name}</b> ({u.employeeId}) — {u.date} 휴가 신청했으나 근무 배정됨
                </li>
              ))}
            </ul>
          )}
        </ChecklistRow>
        <ChecklistRow
          status={q.spread <= 2 ? 'pass' : 'info'}
          title="근무일 균형"
          summary={`기사별 근무 ${q.minWork}~${q.maxWork}일 (편차 ${q.spread}일)`}
        />
      </div>
    </div>
  );
}

function ChecklistRow({ status, title, summary, children }: { status: 'pass' | 'warn' | 'info'; title: string; summary: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!children;
  const icon =
    status === 'pass' ? <Check size={18} className="text-emerald-600" />
    : status === 'warn' ? <AlertTriangle size={18} className="text-amber-500" />
    : <Info size={18} className="text-blue-500" />;
  return (
    <div className="px-5 py-3">
      <div className={`flex items-center gap-3 ${hasDetail ? 'cursor-pointer' : ''}`} onClick={() => hasDetail && setOpen((o) => !o)}>
        <span className="shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">{title}</div>
          <div className={`text-[13px] ${status === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>{summary}</div>
        </div>
        {hasDetail && (open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />)}
      </div>
      {hasDetail && open && <div className="mt-2.5 pl-8">{children}</div>}
    </div>
  );
}

// AI 배정 근거를 사람이 읽기 쉬운 한글로 변환. 내부 코드는 매핑하고, 한글 설명은 그대로,
// 알 수 없는 내부 코드는 null(미표시) 반환.
function friendlyFairnessNote(note?: string | null): string | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  // 이미 한글 설명(공휴일/선호 노선/피로도/예비기사/강제 승인 등)은 그대로 노출
  if (/[가-힣]/.test(trimmed)) return trimmed;
  // 내부 코드(SAME_ROUTE / CROSS_ROUTE / HOME, ·HOME=평소 차량) 매핑
  const FAM: Record<string, string> = {
    SAME_ROUTE: '기존 담당 노선 유지',
    CROSS_ROUTE: '다른 노선 배정',
    HOME: '평소 담당 노선',
  };
  const parts = trimmed.split('·');
  const fam = FAM[parts[0]];
  if (fam) {
    const homeBus = parts.slice(1).includes('HOME');
    return homeBus ? `${fam} · 평소 차량` : fam;
  }
  return null; // 알 수 없는 내부 코드는 숨김
}

function DayCell({ day, dow, slot, requested }: { day: number; dow: number; slot?: Slot; requested?: boolean }) {
  const dowColor = dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-500';
  // 휴가 요청일 점 표시 (요청만 — 승인/반려 무관하게 "신청했음")
  const dot = requested ? (
    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500" title="휴가 요청일" />
  ) : null;
  if (!slot) {
    return (
      <div className="relative aspect-square rounded-lg border border-gray-100 dark:border-white/5 p-1.5 bg-gray-50/50 dark:bg-white/[0.01] flex flex-col">
        {dot}
        <div className={`text-[11px] font-medium ${dowColor}`}>{day}</div>
      </div>
    );
  }
  if (slot.isRestDay) {
    return (
      <div className="relative aspect-square rounded-lg border border-gray-200 dark:border-white/10 p-1.5 bg-gray-100 dark:bg-white/5 flex flex-col">
        {dot}
        <div className={`text-[11px] font-medium ${dowColor}`}>{day}</div>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-[12px] font-semibold">휴</div>
      </div>
    );
  }
  // 색상은 교대(오전/오후/종일) 기준
  const shiftBg = slot.shift === 'MORNING'
    ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
    : slot.shift === 'AFTERNOON'
    ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30'
    : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30';
  const shiftLabel = slot.shift === 'MORNING' ? '오전' : slot.shift === 'AFTERNOON' ? '오후' : slot.shift === 'FULL_DAY' ? '종일' : '';
  return (
    <div className={`relative aspect-square rounded-lg border p-1.5 flex flex-col ${shiftBg}`}>
      {dot}
      <div className={`text-[11px] font-medium ${dowColor}`}>{day}</div>
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="text-[11px] font-bold text-gray-900 dark:text-gray-100 leading-tight">
          {slot.route?.routeNumber || '-'}번
        </div>
        {shiftLabel && <div className="text-[9px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5">{shiftLabel}</div>}
      </div>
    </div>
  );
}
