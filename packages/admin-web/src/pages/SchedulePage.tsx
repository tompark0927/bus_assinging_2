import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Download,
  Send,
  Trash2,
  Sparkles,
  Upload,
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
  Layers,
  Copy,
} from 'lucide-react';
import { schedulesApi, routesApi, busesApi, usersApi, dayOffApi } from '../services/api';
import { format, getDaysInMonth } from 'date-fns';
import toast from 'react-hot-toast';
import PrintOptionsModal from '../components/PrintOptionsModal';
import PageHeader from '../components/PageHeader';
import PostingScheduleGrid, { type PostingView } from '../components/PostingScheduleGrid';
import VehicleScheduleGrid, { type BusGroupMap } from '../components/VehicleScheduleGrid';
import DailyDispatchGrid from '../components/DailyDispatchGrid';
import CellEditModal, { type CellTarget } from '../components/CellEditModal';
import { engineApi } from '../services/api';
import SectionHeader from '../components/SectionHeader';
import { scheduleHelp } from '../help/helpContent';
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

// 색상은 4가지로 단순화: 근무(파랑) · 대타 충원(초록) · 공석(빨강) · 휴무(회색).
//  COMPLETED(운행완료)→근무 파랑, ABSENT(결근)→공석 빨강 으로 통합. 휴가만 옅은 청록 유지.
const SLOT_COLORS = {
  SCHEDULED: { bg: 'bg-blue-100', text: 'text-blue-800', ring: 'ring-blue-300' },
  COMPLETED: { bg: 'bg-blue-100', text: 'text-blue-800', ring: 'ring-blue-300' },
  FILLED: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  DROPPED: { bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-300' },
  ABSENT: { bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-300' },
  REST: { bg: 'bg-gray-50', text: 'text-gray-400', ring: 'ring-gray-200' },
  VACATION: { bg: 'bg-teal-50', text: 'text-teal-600', ring: 'ring-teal-200' },
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
  name?: string;
  status: string;
  slots: Slot[];
}

// 멀티 초안(프로필) 목록 항목 — GET /schedules/:year/:month/drafts
interface DraftSummary {
  id: number;
  name: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  slotCount: number;
}

interface Route {
  id: number;
  routeNumber: string;
  name: string;
}

interface Bus {
  id: number;
  busNumber: string;
  groupType?: string | null; // 출발 그룹 (차량별 보기 블록 구분)
  orderInGroup?: number | null;
}

interface Driver {
  id: number;
  name: string;
  driverType: string;
  employeeId: string;
  /** 기초 데이터의 담당 차량 — 같은 차번을 가진 두 메인 기사가 '짝꿍' */
  assignedBusNumber?: string | null;
  licenseExpiresAt?: string | null;
  qualificationExpiresAt?: string | null;
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
  // 멀티 초안: 프로필 이름 변경 모달
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
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
  // 생성 특이사항 입력: 신규 기사 / 노선별 사고(배차 금지) 기사
  const [newHireIds, setNewHireIds] = useState<number[]>([]);
  const [blockedByRoute, setBlockedByRoute] = useState<Record<number, number[]>>({});
  // 멀티 초안(프로필): 선택된 배차표 ID (null = 발행본 우선 → 최근 초안)
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [newDraftName, setNewDraftName] = useState('');

  // v2 솔버 결과 (메트릭·미충족·하드룰 위반자)
  // 새로고침·페이지 이동 후에도 유지되도록 localStorage 에 저장하고,
  // 해당 월의 배차표(scheduleId)가 일치할 때만 복원한다.
  const [v2Result, setV2Result] = useState<V2Result | null>(null);


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

  // 월 이동 시 프로필 선택 초기화
  useEffect(() => {
    setSelectedScheduleId(null);
  }, [year, month]);

  // 이 달의 배차표 프로필 목록 (발행본 + 초안들)
  const { data: draftList = [] } = useQuery<DraftSummary[]>({
    queryKey: ['schedule-drafts', year, month],
    queryFn: () => schedulesApi.listDrafts(year, month).then((r) => r.data.data ?? []),
  });

  const {
    data: schedule,
    isLoading,
    isError,
    error,
  } = useQuery<Schedule>({
    queryKey: ['schedule', year, month, selectedScheduleId],
    queryFn: () => schedulesApi.get(year, month, selectedScheduleId ?? undefined).then((r) => r.data.data),
    retry: 1,
  });

  // 게시 양식(행=차량, 열=날짜 → 순번|오전|오후) 데이터.
  // AI 엔진으로 만든 배차표만 순번(SchedulePattern)을 갖는다 — 옛 배차표는
  // 빈 결과가 와서 자동으로 기존 기사별 뷰로 폴백된다.
  const { data: postingView } = useQuery<PostingView>({
    queryKey: ['schedule-posting', schedule?.id],
    queryFn: () => schedulesApi.posting(schedule!.id).then((r) => r.data.data),
    enabled: !!schedule?.id,
    retry: 0,
  });
  // 게시 양식은 순번(로테이션) 데이터가 실제로 있을 때만.
  // 수동 감차가 만든 패턴 행(displaySlot null)만으로는 켜지 않는다 —
  // 순번 없는 배차표에 빈 게시 양식 탭이 뜨는 오동작 방지.
  const hasPosting = useMemo(() => {
    if (!postingView?.groups?.length) return false;
    for (const byVehicle of Object.values(postingView.cells ?? {})) {
      for (const cell of Object.values(byVehicle)) {
        if (cell.slot != null) return true;
      }
    }
    return false;
  }, [postingView]);
  // 순번 데이터가 있으면 게시 양식이 기본 — 현장이 보던 그 표
  const [viewMode, setViewMode] = useState<'posting' | 'driver' | 'vehicle' | 'daily'>('posting');
  const showPosting = hasPosting && viewMode === 'posting';
  const showVehicle = viewMode === 'vehicle';
  // 토글 하이라이트용 — 순번 데이터가 없으면 'posting' 선택은 기사별로 폴백된다
  const effectiveViewMode = showPosting ? 'posting' : viewMode === 'posting' ? 'driver' : viewMode;

  // 일일배차 날짜 — 이 달을 벗어나면 오늘(이 달이면) 또는 1일로 되돌린다
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const [dailyDate, setDailyDate] = useState('');
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const effectiveDailyDate = dailyDate.startsWith(monthPrefix)
    ? dailyDate
    : todayKey.startsWith(monthPrefix)
      ? todayKey
      : `${monthPrefix}-01`;
  // 게시 양식에서 셀을 눌렀을 때 열리는 편집 대상
  const [editCell, setEditCell] = useState<CellTarget | null>(null);

  // 엑셀엔 있는데 기초 데이터에 없어 이름만 흐리게 뜨는 기사들.
  // 이게 남아 있으면 배차표가 '미완성'으로 보여 무엇을 보여줘도 신뢰가 안 간다.
  // 화면·인쇄물이 같은 사실을 보게 하는 두 파생값.
  //  unregisteredAt — 계정이 없어 슬롯으로 저장되지 못한 기사 이름
  //                   (키: 날짜|차번|시프트). 일일배차 엑셀은 이 이름을 찍는다.
  //  vacancy        — 운행 차량인데 아무 이름도 없는 칸 = 버스가 나갈 수 없음
  const { unregisteredAt, vacancy } = useMemo(() => {
    const map: Record<string, string> = {};
    let vacant = 0;
    let unregistered = 0;
    for (const [date, byV] of Object.entries(postingView?.cells ?? {})) {
      for (const [vehicle, cell] of Object.entries(byV)) {
        if (!cell.operating) continue; // 감차는 빈 칸이 정상
        for (const [k, shift] of [['am', 'MORNING'], ['pm', 'AFTERNOON']] as const) {
          const d = cell[k];
          if (!d) {
            vacant++;
          } else if (d.unregistered) {
            unregistered++;
            map[`${date}|${vehicle}|${shift}`] = d.name;
          }
        }
      }
    }
    return { unregisteredAt: map, vacancy: { vacant, unregistered } };
  }, [postingView]);

  /** 일일배차용 — 그 날짜만 뽑아 `차번|시프트` 로 키를 줄인다 */
  const dailyUnregistered = useMemo(() => {
    const out: Record<string, string> = {};
    const prefix = `${effectiveDailyDate}|`;
    for (const [k, v] of Object.entries(unregisteredAt)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
    return out;
  }, [unregisteredAt, effectiveDailyDate]);

  const missingDrivers = useMemo(() => {
    const names = new Set<string>();
    for (const byV of Object.values(postingView?.cells ?? {})) {
      for (const c of Object.values(byV)) {
        for (const k of ['am', 'pm'] as const) {
          const d = c[k];
          if (d?.unregistered) names.add(d.name);
        }
      }
    }
    return [...names];
  }, [postingView]);

  const registerMissing = useMutation({
    mutationFn: () => schedulesApi.rematchDrivers(schedule!.id),
    onSuccess: (res) => {
      const d = res.data.data as {
        matched: string[]; unmatchedNames: string[]; filledCells: number; skippedCells?: number;
      };
      queryClient.invalidateQueries({ queryKey: ['schedule-posting'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      if (d.filledCells === 0 && d.unmatchedNames.length > 0) {
        toast(
          `아직 기초 데이터에 없는 기사 ${d.unmatchedNames.length}명 — ` +
          `기초 데이터 › 기사에서 먼저 등록해주세요: ${d.unmatchedNames.slice(0, 5).join(', ')}`,
          { icon: '⚠️', duration: 9000 },
        );
        return;
      }
      const skipped = d.skippedCells ? ` (${d.skippedCells}칸은 이미 배정이 있어 건너뜀)` : '';
      const left = d.unmatchedNames.length ? `, ${d.unmatchedNames.length}명은 아직 미등록` : '';
      toast.success(`배차 ${d.filledCells}칸이 채워졌습니다${left}.${skipped}`);
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err?.response?.data?.message ?? '다시 맞추기에 실패했습니다.'),
  });

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ['routes', 'all'],
    queryFn: () => routesApi.list({ limit: '100' }).then((r) => r.data.data),
  });

  const { data: buses = [] } = useQuery<Bus[]>({
    queryKey: ['buses', 'all'],
    queryFn: () => busesApi.list({ limit: '100' }).then((r) => r.data.data),
  });

  // 차량별 보기의 출발 그룹 블록 — 기초 데이터의 버스 구분(groupType/orderInGroup)
  const busGroupMap = useMemo<BusGroupMap>(() => {
    const m: BusGroupMap = {};
    for (const b of buses) {
      m[b.busNumber] = { group: b.groupType ?? null, order: b.orderInGroup ?? null };
    }
    return m;
  }, [buses]);

  // 감차(휴차) — SchedulePattern.operating 이 원본. 게시 양식·일일배차 엑셀과
  // 같은 값을 읽으므로 화면과 인쇄물이 어긋날 수 없다.
  const vehicleOffSet = useMemo(() => {
    const s = new Set<string>();
    for (const [date, byVehicle] of Object.entries(postingView?.cells ?? {})) {
      for (const [vehicle, cell] of Object.entries(byVehicle)) {
        if (cell.operating === false) s.add(`${date}|${vehicle}`);
      }
    }
    return s;
  }, [postingView]);

  const vehicleOffMutation = useMutation({
    mutationFn: (p: { busNumber: string; date: string; off: boolean }) =>
      schedulesApi.setVehicleOff(schedule!.id, p),
    onSuccess: (_res, p) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-posting'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success(p.off ? `${p.busNumber}호 ${p.date} 감차 처리` : `${p.busNumber}호 ${p.date} 감차 해제`);
    },
    // 배정이 남아 있으면 서버가 기사 이름을 담아 거부한다 — 그대로 보여준다
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err?.response?.data?.message ?? '감차 변경에 실패했습니다.', { duration: 6000 }),
  });

  // 같은 날 같은 기사 중복 배정 — 엑셀 배차총괄의 중복 조건부서식에 대응.
  // 휴무/드랍/결근은 제외: 실제로 두 번 "운행"하는 경우만 경고한다.
  const duplicateInfo = useMemo(() => {
    const byKey = new Map<string, Slot[]>();
    for (const s of schedule?.slots ?? []) {
      if (s.isRestDay || s.status === 'DROPPED' || s.status === 'ABSENT') continue;
      const key = `${s.driver.id}|${s.date.split('T')[0]}`;
      const arr = byKey.get(key) ?? [];
      arr.push(s);
      byKey.set(key, arr);
    }
    const slotIds = new Set<number>();
    const groups: { name: string; date: string; slots: Slot[] }[] = [];
    for (const arr of byKey.values()) {
      if (arr.length < 2) continue;
      for (const s of arr) slotIds.add(s.id);
      groups.push({ name: arr[0].driver.name, date: arr[0].date.split('T')[0], slots: arr });
    }
    groups.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, 'ko') : a.date.localeCompare(b.date)));
    return { slotIds, groups };
  }, [schedule?.slots]);

  // 일일배차: 게시 순번 (게시 양식 패턴이 있을 때만 그 값 사용)
  const postingSlotNo = useMemo(() => {
    const cellsForDate = postingView?.cells?.[effectiveDailyDate];
    if (!cellsForDate) return undefined;
    const m: Record<string, number | null> = {};
    for (const [vehicle, cell] of Object.entries(cellsForDate)) m[vehicle] = cell.slot;
    return m;
  }, [postingView, effectiveDailyDate]);

  const { data: allUsersList = [] } = useQuery<Driver[]>({
    queryKey: ['users-drivers'],
    // 전체 기사(페이지당 최대 100건) — 생성 모달의 신규/사고 기사 선택에 모두 필요
    queryFn: async () => {
      const all: Driver[] = [];
      for (let page = 1; page <= 100; page++) {
        const r = await usersApi.list({ role: 'DRIVER', page: String(page), limit: '100' });
        all.push(...(r.data.data as Driver[]));
        if (!r.data.pagination?.hasNext) break;
      }
      return all;
    },
  });

  // 배차 품질 체크리스트용: 이번 달 회사 전체 휴가 신청
  const monthParam = `${year}-${String(month).padStart(2, '0')}`;
  const { data: monthDayoffs = [] } = useQuery<Array<{ id: number; date: string; status: string; driver: { id: number; name: string; employeeId: string } }>>({
    queryKey: ['dayoff', 'month-all', monthParam],
    queryFn: () => dayOffApi.list({ month: monthParam, limit: '100' }).then((r) => r.data.data ?? []),
  });

  // 승인된 휴가 (기사ID|날짜) — 그리드에서 '휴가 반영' 휴무 표시용
  const approvedDayoffKeys = useMemo(() => {
    const set = new Set<string>();
    for (const d of monthDayoffs) {
      if (d.status === 'APPROVED') set.add(`${d.driver.id}|${d.date.slice(0, 10)}`);
    }
    return set;
  }, [monthDayoffs]);

  // 생성 모달 안내: 대상 월 말일까지 면허/자격이 만료되는(이미 만료 포함) 기사
  const expiringLicenseDrivers = useMemo(() => {
    const monthEnd = new Date(year, month, 0, 23, 59, 59);
    return allUsersList
      .map((d) => {
        const items: string[] = [];
        if (d.licenseExpiresAt && new Date(d.licenseExpiresAt) <= monthEnd) {
          items.push(`운전면허 ${d.licenseExpiresAt.slice(0, 10)} 만료`);
        }
        if (d.qualificationExpiresAt && new Date(d.qualificationExpiresAt) <= monthEnd) {
          items.push(`버스운전자격 ${d.qualificationExpiresAt.slice(0, 10)} 만료`);
        }
        return items.length ? { id: d.id, name: d.name, employeeId: d.employeeId, items } : null;
      })
      .filter((v): v is { id: number; name: string; employeeId: string; items: string[] } => v !== null);
  }, [allUsersList, year, month]);

  // ─── v2 결과 패널 복원/정리 ───
  // 배차표(프로필)별로 저장 — 프로필을 전환하면 각자의 생성 결과가 복원된다
  const v2KeyFor = useCallback(
    (scheduleId: number) => `busync.v2Result.${companyId ?? 'unknown'}.s${scheduleId}`,
    [companyId],
  );
  useEffect(() => {
    if (!schedule?.id) {
      setV2Result(null);
      return;
    }
    try {
      const raw = localStorage.getItem(v2KeyFor(schedule.id));
      if (!raw) {
        setV2Result(null);
        return;
      }
      const stored = JSON.parse(raw) as V2Result;
      setV2Result(stored.scheduleId === schedule.id ? stored : null);
    } catch {
      setV2Result(null);
    }
  }, [v2KeyFor, schedule?.id]);

  // ─── 뮤테이션 ───

  // AI 배차 엔진(CP-SAT)으로 생성 → 배차표로 저장.
  // 엔진은 과거 배차표에서 로테이션·감차·짝궁 규칙을 이어받으므로 직전 월이
  // 포함된 엑셀이 필요하다. 규칙 자체는 [AI 엔진 설정]의 정책을 따른다.
  const [engineFile, setEngineFile] = useState<File | null>(null);
  /**
   * generate = 엔진이 새로 짠다 (과거 배차표에서 규칙을 이어받음)
   * import   = 이미 짜 놓은 배차표를 그대로 읽어온다 (솔버 미실행)
   * 엔진을 쓰지 않는 회사도 화면·인쇄물·기사앱·안전검사를 그대로 쓰게 하는 경로.
   */
  const [engineMode, setEngineMode] = useState<'generate' | 'import'>('generate');
  const [engineUnmatched, setEngineUnmatched] = useState<{ vehicles: string[]; drivers: string[] } | null>(null);
  const engineFileRef = useRef<HTMLInputElement>(null);

  // 덮어쓰기 확인 대기 중인 엔진 초안 — 엔진을 다시 돌리지 않고 저장만 재시도한다
  const pendingEngineDraftRef = useRef<{
    cells: Record<string, Record<string, unknown>>;
    audit: { ok: boolean; violations: unknown[] };
    warnings: string[];
  } | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState<{
    name: string; slotCount: number; manualOverrideCount: number; vehicleOffCount: number;
  } | null>(null);
  // 업로드 파일 명단이 기초 데이터와 안 맞을 때 (다른 회사·철 지난 파일 방어)
  const [rosterMismatch, setRosterMismatch] = useState<{
    totalNames: number; matchedNames: number; unmatchedNames: string[];
    unmatchedRate: number; totalVehicles: number; unmatchedVehicles: string[];
  } | null>(null);

  const engineGenerateMutation = useMutation({
    mutationFn: async (opts?: { confirmOverwrite?: boolean; confirmMismatch?: boolean }) => {
      let draft = (opts?.confirmOverwrite || opts?.confirmMismatch) ? pendingEngineDraftRef.current : null;
      if (!draft) {
        if (!engineFile) throw new Error('배차표 엑셀을 선택해 주세요.');
        const form = new FormData();
        form.append('file', engineFile);
        form.append('year', String(year));
        form.append('month', String(month));
        if (engineMode === 'import') {
          // 그대로 가져오기 — 솔버를 돌리지 않고 파일 내용을 그대로 읽는다.
          // 저장 이후 경로(미등록 기사 자동 등록·안전 검사·발행 게이트)는 동일.
          const res = (await engineApi.importAsIs(form)).data as {
            cells: Record<string, Record<string, unknown>>;
            vehicles: number; dates: number; filled_cells: number; drivers: string[];
          };
          draft = { cells: res.cells, audit: { ok: true, violations: [] }, warnings: [] };
          toast.success(
            `엑셀에서 ${res.vehicles}대 · ${res.dates}일 · 배정 ${res.filled_cells}칸을 읽었습니다.`,
          );
        } else {
          draft = (await engineApi.generate(form)).data as {
            cells: Record<string, Record<string, unknown>>;
            audit: { ok: boolean; violations: unknown[] };
            warnings: string[];
          };
        }
        pendingEngineDraftRef.current = draft;
      }
      const saved = (await schedulesApi.saveFromEngine({
        year, month,
        name: newDraftName.trim() || undefined,
        cells: draft.cells,
        confirmOverwrite: opts?.confirmOverwrite,
        confirmMismatch: opts?.confirmMismatch,
      })).data.data as {
        scheduleId: number; slotCount: number;
        unmatched: { vehicles: string[]; drivers: string[] };
        ambiguousNames: { name: string; candidates: { employeeId: string }[] }[];
      };
      return { draft, saved };
    },
    onSuccess: ({ draft, saved }) => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-posting'] });
      setSelectedScheduleId(saved.scheduleId);
      setEngineUnmatched(saved.unmatched);
      setShowGenerateModal(false);
      setOverwriteConfirm(null);
      setRosterMismatch(null);
      pendingEngineDraftRef.current = null;
      setNewDraftName('');
      setEngineFile(null);
      // 기초 데이터에 없는 이름은 자동 등록하지 않는다 — 몇 명인지만 알린다
      const unmatchedNote = saved.unmatched.drivers.length
        ? `, 기초 데이터에 없는 기사 ${saved.unmatched.drivers.length}명 확인 필요`
        : '';
      toast.success(
        `${year}년 ${month}월 초안 생성 완료 — 배정 ${saved.slotCount}건${unmatchedNote}` +
        (draft.audit.ok ? ', 제약 위반 0건' : `, 위반 ${draft.audit.violations.length}건 확인 필요`)
      );
      // 동명이인 — 추측 배정하지 않고 보류했다. 담당자가 구분해줘야 채워진다.
      if (saved.ambiguousNames?.length) {
        const list = saved.ambiguousNames
          .slice(0, 3)
          .map((a) => `${a.name}(${a.candidates.map((c) => c.employeeId).join('/')})`)
          .join(', ');
        toast(
          `동명이인 ${saved.ambiguousNames.length}명은 배정을 보류했습니다: ${list}${saved.ambiguousNames.length > 3 ? ' 외' : ''} — ` +
          '기초 데이터에서 이름을 구분(예: 김영수A)한 뒤 다시 생성하거나 셀을 직접 채워주세요.',
          { icon: '⚠️', duration: 10000 },
        );
      }
    },
    onError: (err: unknown) => {
      const resp = (err as {
        response?: {
          status?: number;
          data?: {
            detail?: string; message?: string;
            data?: {
              existingDraft?: { name: string; slotCount: number; manualOverrideCount: number; vehicleOffCount: number };
              rosterMismatch?: {
                totalNames: number; matchedNames: number; unmatchedNames: string[];
                unmatchedRate: number; totalVehicles: number; unmatchedVehicles: string[];
              };
            };
          };
        };
      })?.response;
      // 파일 명단이 기초 데이터와 안 맞음 — 잘못된 파일인지 먼저 확인시킨다
      if (resp?.status === 409 && resp.data?.data?.rosterMismatch) {
        setRosterMismatch(resp.data.data.rosterMismatch);
        return;
      }
      // 같은 이름 초안 존재 — 삭제될 내용을 보여주고 덮어쓰기 확인을 받는다
      if (resp?.status === 409 && resp.data?.data?.existingDraft) {
        setOverwriteConfirm(resp.data.data.existingDraft);
        return;
      }
      const msg =
        resp?.data?.detail || resp?.data?.message ||
        (err as Error)?.message ||
        '배차표 생성 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  const generateMutation = useMutation({
    // (구) v2 솔버 — 순번·로테이션 개념이 없어 게시 양식을 재현하지 못한다.
    // AI 엔진으로 대체되었으며 옛 배차표 재생성 용도로만 남겨둔다.
    mutationFn: () => schedulesApi.generateV2({
      year, month,
      name: newDraftName.trim() || undefined,
      workDays,
      restDays,
      newHireDriverIds: newHireIds.length ? newHireIds : undefined,
      blockedRoutes: Object.entries(blockedByRoute)
        .filter(([, ids]) => ids.length > 0)
        .map(([routeId, driverIds]) => ({ routeId: Number(routeId), driverIds })),
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-drafts'] });
      const d = res.data as V2Result;
      setV2Result(d);
      setSelectedScheduleId(d.scheduleId);
      try { localStorage.setItem(v2KeyFor(d.scheduleId), JSON.stringify(d)); } catch { /* ignore */ }
      toast.success(`${year}년 ${month}월 배차표 초안이 생성되었습니다. 아래에서 결과를 확인하세요.`);
      setShowGenerateModal(false);
      setNewDraftName('');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error?.message ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '배차표 생성 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  // "AI 자동 생성" 클릭 — 멀티 초안이라 기존 초안은 보존되고 항상 새 초안이 추가된다
  const handleGenerateClick = () => {
    generateMutation.mutate();
  };

  // 발행 게이트에 걸린 문제 목록 (409 응답) — 강제 발행 확인 UI용
  interface PublishBlockInfo {
    duplicates: { driverName: string; date: string }[];
    violations: { rule: string; driverName?: string; date: string; message: string }[];
    warnings: { rule: string; message: string }[];
    counts?: { vacant: number; unregistered: number; consecutive: number; shortRest: number };
  }
  const [publishBlocked, setPublishBlocked] = useState<PublishBlockInfo | null>(null);

  const publishMutation = useMutation({
    mutationFn: (opts?: { force?: boolean }) =>
      schedulesApi.publish(year, month, schedule?.id, opts?.force),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-drafts'] });
      toast.success('배차표가 발행되었습니다. 모든 기사님께 알림이 발송됩니다.');
      // 발행은 됐지만 알아둘 경고 (짧은 휴식 등) — 법 제44조의6 관련
      const warns = (res.data as { warnings?: { message: string }[] })?.warnings;
      if (warns?.length) {
        toast(
          `주의: 짧은 휴식(오후→다음날 오전) ${warns.length}건이 있습니다. 기사별 보기에서 확인하세요.`,
          { icon: '⚠️', duration: 8000 },
        );
      }
      setShowPublishConfirm(false);
      setPublishBlocked(null);
    },
    onError: (err: unknown) => {
      const resp = (err as {
        response?: {
          status?: number;
          data?: {
            message?: string;
            data?: {
              duplicates?: { driverName: string; date: string }[];
              violations?: { rule: string; driverName?: string; date: string; message: string }[];
              warnings?: { rule: string; message: string }[];
              counts?: { vacant: number; unregistered: number; consecutive: number; shortRest: number };
            };
          };
        };
      })?.response;
      // 발행 게이트: 중복 배정·연속근무 초과 — 목록을 보여주고 강제 발행 여부를 묻는다
      if (resp?.status === 409 && resp.data?.data && (resp.data.data.duplicates || resp.data.data.violations)) {
        setPublishBlocked({
          duplicates: resp.data.data.duplicates ?? [],
          violations: resp.data.data.violations ?? [],
          warnings: resp.data.data.warnings ?? [],
          counts: resp.data.data.counts,
        });
        return;
      }
      toast.error(resp?.data?.message || '발행 중 오류가 발생했습니다.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => schedulesApi.delete(year, month, schedule?.id),
    onSuccess: () => {
      // 삭제된 프로필의 생성 결과 저장본도 함께 정리
      if (schedule?.id) {
        try { localStorage.removeItem(v2KeyFor(schedule.id)); } catch { /* ignore */ }
      }
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-drafts'] });
      setSelectedScheduleId(null);
      toast.success('배차표가 삭제되었습니다.');
      setShowDeleteConfirm(false);
    },
    onError: () => toast.error('삭제 중 오류가 발생했습니다.'),
  });

  // 멀티 초안: 프로필 이름 변경
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => schedulesApi.rename(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-drafts'] });
      toast.success('이름이 변경되었습니다.');
      setShowRenameModal(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '이름 변경 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  // 멀티 초안: 현재 보고 있는 배차표를 새 초안 프로필로 복제
  const duplicateMutation = useMutation({
    mutationFn: () => {
      if (!schedule?.id) throw new Error('NO_SCHEDULE');
      return schedulesApi.duplicate(schedule.id);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-drafts'] });
      const copy = (res.data as { data?: { id?: number } })?.data;
      if (copy?.id) setSelectedScheduleId(copy.id);
      toast.success('초안이 복제되었습니다. 복제본을 자유롭게 수정하세요.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '복제 중 오류가 발생했습니다.';
      toast.error(msg);
    },
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
    // ── 배차표 행 순서 ──
    // 실물 배차표의 규칙 두 가지를 그대로 따른다.
    //   1) 스페어(예비)는 **무조건 맨 아래**
    //   2) 메인은 짝꿍(같은 담당 차량의 정·부)이 **바로 아래 붙는다**
    // 그래서 3단으로 나눈다: 담당차량 있는 메인 → 담당차량 없는 메인 → 스페어.
    // (예전엔 '담당 차량이 불분명한 메인'이 스페어와 한 덩어리로 묶여 이름순
    //  정렬되는 바람에 스페어가 메인 위로 올라오는 일이 있었다.)
    //
    // 짝꿍의 근거는 기초 데이터의 담당 차번(assignedBusNumber)이 1순위다 —
    // 그 달 배차 실적으로 추정하면 대타가 많이 낀 달에 짝이 어긋난다.
    const assignedOf = new Map<number, string>();
    for (const u of allUsersList) {
      if (u.assignedBusNumber) assignedOf.set(u.id, u.assignedBusNumber);
    }
    const routeOfBus = new Map<string, string>();
    for (const slot of schedule.slots) {
      if (slot.bus) routeOfBus.set(slot.bus.busNumber, slot.route?.routeNumber ?? '');
    }

    const homeOf = new Map<number, { route: string; bus: string; count: number }>();
    const tally = new Map<number, Map<string, number>>();
    for (const slot of schedule.slots) {
      if (!slot.bus) continue;
      const key = `${slot.route?.routeNumber ?? ''}|${slot.bus.busNumber}`;
      const m = tally.get(slot.driver.id) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      tally.set(slot.driver.id, m);
    }
    for (const [driverId, m] of tally) {
      let best = '', bestN = 0;
      for (const [k, n] of m) if (n > bestN) { best = k; bestN = n; }
      const [route, bus] = best.split('|');
      homeOf.set(driverId, { route, bus, count: bestN });
    }
    // 그 차량을 절반 이상 몬 사람만 '고정기사'로 본다 — 예비는 여기저기 흩어진다
    const totalOf = new Map<number, number>();
    for (const slot of schedule.slots) {
      totalOf.set(slot.driver.id, (totalOf.get(slot.driver.id) ?? 0) + 1);
    }
    const isFixed = (id: number) => {
      const h = homeOf.get(id);
      const t = totalOf.get(id) ?? 0;
      return !!h && t > 0 && h.count / t >= 0.5;
    };
    const routeKey = (r: string) => {
      // "3-2" 같은 노선번호도 자연스럽게 정렬 (문자열 비교면 3-2가 16보다 앞)
      const m = /^(\d+)(?:-(\d+))?$/.exec(r ?? '');
      return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
    };
    /** 담당 차량 — 기초 데이터 우선, 없으면 그 달 실적으로 추정 */
    const homeBusOf = (id: number): { route: string; bus: string } | null => {
      const assigned = assignedOf.get(id);
      if (assigned) return { route: routeOfBus.get(assigned) ?? '', bus: assigned };
      if (isFixed(id)) {
        const h = homeOf.get(id)!;
        return { route: h.route, bus: h.bus };
      }
      return null;
    };
    /** 0 = 담당차량 있는 메인, 1 = 담당차량 없는 메인, 2 = 스페어(항상 맨 아래) */
    const tierOf = (d: Slot['driver']): number => {
      if (d.driverType === 'SPARE') return 2;
      return homeBusOf(d.id) ? 0 : 1;
    };

    return Array.from(seen.values()).sort((a, b) => {
      const ta = tierOf(a), tb = tierOf(b);
      if (ta !== tb) return ta - tb;
      if (ta === 0) {
        const ha = homeBusOf(a.id)!, hb = homeBusOf(b.id)!;
        const byRoute = routeKey(ha.route) - routeKey(hb.route);
        if (byRoute !== 0) return byRoute;
        // 같은 차량 = 짝꿍 → 바로 위아래로 붙는다
        if (ha.bus !== hb.bus) return ha.bus.localeCompare(hb.bus, undefined, { numeric: true });
        return a.name.localeCompare(b.name, 'ko');
      }
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [schedule?.slots, allUsersList]);

  // 근무일수 중앙값 — 엑셀 배차총괄의 "목표(22일) 대비 차이" 열에 대응.
  // 회사마다 목표가 달라 고정값 대신 중앙값을 기준으로 편차를 보여준다.
  const workDayMedian = useMemo(() => {
    const counts = allDrivers
      .map((d) =>
        Array.from((driverSlotMap.get(d.id) ?? new Map<string, Slot>()).values()).filter(
          (s) => !s.isRestDay,
        ).length,
      )
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (counts.length === 0) return 0;
    const mid = Math.floor(counts.length / 2);
    return counts.length % 2 ? counts[mid] : Math.round((counts[mid - 1] + counts[mid]) / 2);
  }, [allDrivers, driverSlotMap]);

  // 일일배차: 그날 배정 없는 스페어 기사 — 엑셀 sp칸(대기 명단)
  const spareStandby = useMemo(() => {
    const names: string[] = [];
    for (const d of allDrivers) {
      if (d.driverType !== 'SPARE') continue;
      const slot = driverSlotMap.get(d.id)?.get(effectiveDailyDate);
      const working = slot && !slot.isRestDay && slot.status !== 'DROPPED' && slot.status !== 'ABSENT';
      if (!working) names.push(d.name);
    }
    return names.sort((a, b) => a.localeCompare(b, 'ko'));
  }, [allDrivers, driverSlotMap, effectiveDailyDate]);

  /** driverId → 담당 차량 차번 (기초 데이터). 짝꿍 구분의 근거 */
  const busOfDriver = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of allUsersList) if (u.assignedBusNumber) m.set(u.id, u.assignedBusNumber);
    return m;
  }, [allUsersList]);

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
      const res = await schedulesApi.exportExcel(year, month, schedule?.id);
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
  }, [year, month, schedule?.id]);

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

  const getCellInfo = useCallback((slot: Slot | undefined, isVacation = false) => {
    if (!slot) {
      return { label: '', sub: '', colors: null, isEmpty: true };
    }
    if (slot.isRestDay) {
      if (isVacation) {
        return {
          label: '휴가',
          sub: '반영',
          colors: SLOT_COLORS.VACATION,
          isEmpty: false,
        };
      }
      return {
        label: '휴',
        sub: '',
        colors: SLOT_COLORS.REST,
        isEmpty: false,
      };
    }
    const statusColors = SLOT_COLORS[slot.status as keyof typeof SLOT_COLORS] || SLOT_COLORS.SCHEDULED;

    // 셀에는 오전/오후만 — 노선·차번은 툴팁과 차량별 보기에서 확인한다.
    // (예전엔 "3-2 석/1161"처럼 다 넣었더니 칸이 빽빽해 한눈에 안 읽혔다)
    let label = '';
    if (slot.status === 'DROPPED') {
      label = '드랍';
    } else if (slot.status === 'ABSENT') {
      label = '결근';
    } else {
      label =
        slot.shift === 'MORNING' ? '오전' : slot.shift === 'AFTERNOON' ? '오후' : '종일';
    }

    return { label, sub: '', colors: statusColors, isEmpty: false };
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
          help={scheduleHelp}
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

            {(schedule.status === 'DRAFT' || schedule.status === 'PUBLISHED') && (
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

      {/* ─── 필터 패널 (필터 버튼 바로 아래에 붙어서 펼쳐짐) ─── */}
      {showFilters && (
        <div className="card flex flex-wrap items-end gap-6" data-print-hide>
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

      {/* ─── 배차표 프로필 (멀티 초안) ─── */}
      {draftList.length > 0 && (
        <div className="card py-4 px-5 dark:bg-gray-800" data-print-hide>
          <SectionHeader
            icon={Layers}
            title="배차표 프로필"
            hint="초안을 여러 개 만들어 비교·수정한 뒤 하나를 골라 발행하세요 (초안 최대 5개)"
            className="mb-3"
          />
          <div className="flex flex-wrap items-center gap-2">
            {draftList.map((d) => {
              const isSelected = schedule?.id === d.id;
              const isPublished = d.status === 'PUBLISHED';
              return (
                <button
                  key={d.id}
                  onClick={() => setSelectedScheduleId(d.id)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[15px] transition-colors min-h-[48px] ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-2 ring-blue-500/20'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
                  title={`${d.slotCount}개 슬롯 · ${format(new Date(d.updatedAt), 'M/d HH:mm')} 수정`}
                >
                  <span className={`font-semibold ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'}`}>
                    {d.name}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                      isPublished
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                    }`}
                  >
                    {isPublished ? '발행됨' : '초안'}
                  </span>
                </button>
              );
            })}
            {schedule && (
              <>
                <button
                  onClick={() => duplicateMutation.mutate()}
                  disabled={duplicateMutation.isPending}
                  className="btn-secondary inline-flex items-center gap-2 text-[15px] px-4 py-2.5 min-h-[48px] disabled:opacity-50"
                  title="현재 보고 있는 배차표를 새 초안으로 복제합니다"
                >
                  {duplicateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                  복제
                </button>
                <button
                  onClick={() => {
                    setRenameValue(schedule.name ?? '');
                    setShowRenameModal(true);
                  }}
                  className="btn-secondary inline-flex items-center gap-2 text-[15px] px-4 py-2.5 min-h-[48px]"
                  title="현재 프로필의 이름을 변경합니다"
                >
                  <Edit3 size={16} />
                  이름 변경
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── 배차 품질 (라이브 체크리스트 + AI 생성 지표 통합) ─── */}
      {schedule && quality && (
        <ScheduleQualityPanel
          quality={quality}
          filledRate={filledRate}
          result={v2Result}
          onDriverClick={(driverId) => setSelectedDriverId(driverId)}
        />
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
      {/* ─── 뷰 전환 — 게시 양식은 순번 데이터가 있을 때만 노출 ─── */}
      {schedule && (
        <div className="flex items-center gap-2 print:hidden">
          {([
            ...(hasPosting ? [['posting', '게시 양식 (차량·순번)'] as const] : []),
            ['driver', '기사별 보기'] as const,
            ['vehicle', '차량별 보기'] as const,
            ['daily', '일일배차'] as const,
          ]).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                effectiveViewMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ─── 중복 배정 경고 — 같은 날 같은 기사가 두 칸 이상 (엑셀 중복 검사에 대응) ─── */}
      {schedule && duplicateInfo.groups.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 print:hidden dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            ⚠ 같은 날 두 번 배정된 기사 {duplicateInfo.groups.length}건 — 운행 사고로 이어질 수 있어 반드시
            확인이 필요합니다
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-red-700 dark:text-red-400">
            {duplicateInfo.groups.slice(0, 8).map((g) => (
              <li key={`${g.name}-${g.date}`}>
                <span className="font-semibold">{g.name}</span> — {g.date.slice(5).replace('-', '/')}{' '}
                {g.slots
                  .map(
                    (s) =>
                      `${SHIFT_LABELS[s.shift] ?? s.shift}/${s.bus?.busNumber ?? '차량미배정'}(${s.route?.routeNumber ?? '-'}번)`,
                  )
                  .join(' + ')}
              </li>
            ))}
            {duplicateInfo.groups.length > 8 && <li>… 외 {duplicateInfo.groups.length - 8}건</li>}
          </ul>
          <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/70">
            차량별 보기에서 해당 칸이 빨간 테두리로 표시됩니다. 이름을 눌러 한쪽 배정을 바꾸거나 삭제하세요.
          </p>
        </div>
      )}

      {/* ─── 미등록 기사 안내 — 어느 뷰에서 보고 있든 노출한다.
              (이전엔 게시 양식일 때만 떠서, 차량별·일일배차에서 빈 칸의
               원인을 알 수 없었다) ─── */}
      {missingDrivers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 print:hidden dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            기초 데이터에 없는 이름 {missingDrivers.length}명 — 배차 {vacancy.unregistered}칸이 비어 있습니다
          </p>
          <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-300/90">
            {missingDrivers.slice(0, 8).join(', ')}
            {missingDrivers.length > 8 && ` 외 ${missingDrivers.length - 8}명`}
          </p>
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
            배차는 <strong>기초 데이터에 등록된 기사</strong>로만 짤 수 있습니다. 시스템이 이름만 보고
            기사를 만들지는 않습니다 — 실제 직원이면 기초 데이터에서 사번과 함께 등록한 뒤 아래
            [다시 맞추기]를 누르시고, 엑셀 오타라면 이름을 고쳐 다시 가져오세요.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => navigate('/dashboard/data?tab=drivers')}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
            >
              기초 데이터에서 기사 등록
            </button>
            <button
              onClick={() => registerMissing.mutate()}
              disabled={registerMissing.isPending || schedule?.status !== 'DRAFT'}
              title={schedule?.status !== 'DRAFT' ? '초안 상태에서만 가능합니다' : undefined}
              className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:bg-transparent dark:text-amber-300"
            >
              {registerMissing.isPending ? '맞추는 중…' : '기초 데이터와 다시 맞추기'}
            </button>
          </div>
        </div>
      )}

      {/* ─── 공석 경고 — 운행 차량인데 아무도 없는 칸. 버스가 못 나간다 ─── */}
      {vacancy.vacant > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 print:hidden dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            ⚠ 공석 {vacancy.vacant}칸 — 배정된 기사가 없어 그 버스는 운행할 수 없습니다
          </p>
          <p className="mt-1 text-xs text-red-700 dark:text-red-400">
            일일배차 보기에서 빨간 <strong>공석</strong> 칸을 눌러 기사를 배정하거나, 실제로 안 내보내는
            차량이면 차량별 보기에서 <strong>감차</strong>로 표시하세요. 공석이 남아 있으면 발행이 차단됩니다.
          </p>
        </div>
      )}

      {/* ─── 게시 양식 배차표 (AI 엔진 생성분) ─── */}
      {!isLoading && !isError && schedule && showPosting && postingView && (
        <PostingScheduleGrid
          view={postingView}
          onDownloadDay={async (date) => {
            try {
              const res = await schedulesApi.exportDaily(schedule.id, date);
              const url = URL.createObjectURL(res.data as Blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `일일배차표_${date}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);
            } catch {
              toast.error('내려받기에 실패했습니다.');
            }
          }}
          onCellClick={(p) =>
            setEditCell({
              date: p.date, vehicle: p.vehicle, shift: p.shift,
              currentName: p.driver?.name ?? null,
            })
          }
        />
      )}

      {editCell && schedule && (
        <CellEditModal
          scheduleId={schedule.id}
          target={editCell}
          onClose={() => setEditCell(null)}
        />
      )}

      {/* ─── 차량별 배차표 (행=차번, 날짜당 오전/오후) — 순번 없이 항상 동작 ─── */}
      {!isLoading && !isError && schedule && showVehicle && (
        <VehicleScheduleGrid
          slots={
            filterRouteId
              ? schedule.slots.filter((s) => s.route?.id === filterRouteId)
              : schedule.slots
          }
          busGroups={busGroupMap}
          year={year}
          month={month}
          daysInMonth={daysInMonth}
          editable={schedule.status === 'DRAFT'}
          onSlotClick={openSlotForEdit}
          vehicleOff={vehicleOffSet}
          onToggleVehicleOff={
            schedule.status === 'DRAFT'
              ? (busNumber, date, off) => vehicleOffMutation.mutate({ busNumber, date, off })
              : undefined
          }
          duplicateSlotIds={duplicateInfo.slotIds}
          unregisteredAt={unregisteredAt}
        />
      )}

      {/* ─── 일일배차표 (엑셀 일일배차/프린터용 시트의 화면판) ─── */}
      {!isLoading && !isError && schedule && effectiveViewMode === 'daily' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              onClick={() => {
                const d = new Date(`${effectiveDailyDate}T00:00:00`);
                if (d.getDate() > 1) setDailyDate(format(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1), 'yyyy-MM-dd'));
              }}
              disabled={effectiveDailyDate.endsWith('-01')}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              aria-label="전날"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              value={effectiveDailyDate}
              min={`${monthPrefix}-01`}
              max={`${monthPrefix}-${String(daysInMonth).padStart(2, '0')}`}
              onChange={(e) => e.target.value && setDailyDate(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
            <button
              onClick={() => {
                const d = new Date(`${effectiveDailyDate}T00:00:00`);
                if (d.getDate() < daysInMonth) setDailyDate(format(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), 'yyyy-MM-dd'));
              }}
              disabled={effectiveDailyDate.endsWith(`-${String(daysInMonth).padStart(2, '0')}`)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              aria-label="다음날"
            >
              <ChevronRight size={16} />
            </button>
            {todayKey.startsWith(monthPrefix) && (
              <button
                onClick={() => setDailyDate(todayKey)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                오늘
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  const res = await schedulesApi.exportDaily(schedule.id, effectiveDailyDate);
                  const url = URL.createObjectURL(res.data as Blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `일일배차표_${effectiveDailyDate}.xlsx`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  toast.error('내려받기에 실패했습니다.');
                }
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <Download size={14} /> 엑셀 받기
            </button>
          </div>
          <DailyDispatchGrid
            slots={
              filterRouteId
                ? schedule.slots.filter((s) => s.route?.id === filterRouteId)
                : schedule.slots
            }
            date={effectiveDailyDate}
            busGroups={busGroupMap}
            vehicleOff={vehicleOffSet}
            postingSlotNo={postingSlotNo}
            unregisteredAt={dailyUnregistered}
            spareStandby={spareStandby}
            editable={schedule.status === 'DRAFT'}
            onSlotClick={openSlotForEdit}
            duplicateSlotIds={duplicateInfo.slotIds}
          />
        </div>
      )}

      {/* ─── 캘린더/그리드 배차표 (기사별) ─── */}
      {!isLoading && !isError && schedule && effectiveViewMode === 'driver' && (
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
                  // 담당 차량이 바뀌는 지점에 굵은 선 — 같은 차번 두 명이 한 짝이라는
                  // 경계를 눈으로 구분한다. (실물 승무기사 표와 같은 구조)
                  const myBus = busOfDriver.get(driver.id);
                  const prevBus = idx > 0 ? busOfDriver.get(filteredDrivers[idx - 1].id) : undefined;
                  const busChanged = idx > 0 && myBus !== prevBus;

                  // 기사별 통계
                  const driverWorkCount = Array.from(slotMap.values()).filter((s) => !s.isRestDay).length;
                  const driverRestCount = Array.from(slotMap.values()).filter((s) => s.isRestDay).length;

                  return (
                    <tr
                      key={driver.id}
                      className={`${rowBg} hover:bg-blue-50/40 dark:hover:bg-blue-900/20 transition-colors ${
                        busChanged ? 'border-t-2 border-t-gray-300 dark:border-t-gray-600' : ''
                      }`}
                    >
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
                              {/* 담당 차량 — 같은 차번 두 명이 짝꿍이다.
                                  이게 없으면 위아래로 붙어 있다는 이유만으로
                                  다른 차 기사를 짝꿍으로 오해하게 된다. */}
                              {busOfDriver.get(driver.id) && (
                                <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                                  {busOfDriver.get(driver.id)}호
                                </span>
                              )}
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
                        const isVacation = !!slot?.isRestDay && approvedDayoffKeys.has(`${driver.id}|${dateKey}`);
                        const { label, sub, colors, isEmpty } = getCellInfo(slot, isVacation);
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
                                ? `${slot.driver.name} | ${slot.route?.routeNumber || '-'}번 ${slot.route?.name || ''} | ${slot.bus?.busNumber || '차량미배정'} | ${slot.status === 'DROPPED' ? '드랍' : slot.isRestDay ? (isVacation ? '휴무 (휴가 반영)' : '휴무') : SHIFT_LABELS[slot.shift] || slot.shift}${slot.notes ? ` | ${slot.notes}` : ''}${friendlyFairnessNote(slot.fairnessNote) ? ` | ${friendlyFairnessNote(slot.fairnessNote)}` : ''}${slot.isManualOverride ? ' | [수동변경]' : ''}`
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
                        {/* 중앙값 대비 편차 — 엑셀 배차총괄의 목표 대비 차이 열 */}
                        {workDayMedian > 0 && driverWorkCount > 0 && (
                          <div
                            title={`근무일수 중앙값 ${workDayMedian}일 대비`}
                            className={`text-xs font-semibold ${
                              driverWorkCount - workDayMedian > 0
                                ? 'text-sky-600 dark:text-sky-400'
                                : driverWorkCount - workDayMedian < 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-gray-400 dark:text-gray-500'
                            }`}
                          >
                            {driverWorkCount - workDayMedian > 0 ? '+' : ''}
                            {driverWorkCount - workDayMedian === 0 ? '±0' : driverWorkCount - workDayMedian}
                          </div>
                        )}
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
          <SectionHeader icon={Info} title="범례 (색상 안내)" className="mb-3" />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
            <LegendItem color="bg-blue-100 border-blue-300" label="근무" />
            <LegendItem color="bg-emerald-100 border-emerald-300" label="대타 충원" />
            <LegendItem color="bg-red-100 border-red-300" label="공석 (드랍·결근)" />
            <LegendItem color="bg-gray-50 border-gray-200" label="휴무" />
            <LegendItem color="bg-teal-50 border-teal-200" label="휴가" />
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
            setNewHireIds([]);
            setBlockedByRoute({});
          }}
          title={`${year}년 ${month}월 배차표 생성`}
          maxWidth="max-w-xl"
          icon={<Sparkles size={24} className="text-blue-600" />}
        >
          <div className="space-y-5">
            {/* 만드는 방식 — 엔진이 짜기 / 이미 짠 표 그대로 가져오기 */}
            <div className="flex gap-2">
              {([
                ['generate', 'AI 엔진으로 짜기', '과거 배차표에서 규칙을 이어받아 새로 생성'],
                ['import', '엑셀 그대로 가져오기', '이미 짜 놓은 배차표를 그대로 읽어옴'],
              ] as const).map(([mode, label, desc]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setEngineMode(mode)}
                  className={`flex-1 rounded-lg border p-3 text-left transition ${
                    engineMode === mode
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
                  }`}
                >
                  <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{desc}</span>
                </button>
              ))}
            </div>

            {/* 엑셀 업로드 — 모드에 따라 요구하는 파일이 다르다 */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <label className="block text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">
                {engineMode === 'import' ? '가져올 배차표 엑셀' : '과거 배차표 엑셀'}{' '}
                <span className="text-red-500">*</span>
              </label>
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                {engineMode === 'import' ? (
                  <>
                    이미 완성해 둔 <strong>{year}년 {month}월</strong> 배차표를 올려주세요. 새로 짜지 않고
                    그대로 읽어 옵니다 — 일일배차·차량별·기사별 화면, 인쇄물, 기사앱, 안전 검사가 모두
                    그대로 동작합니다. 월간배차·게시용 두 양식 모두 자동 인식합니다.
                  </>
                ) : (
                  <>
                    직전 월({month === 1 ? year - 1 : year}년 {month === 1 ? 12 : month - 1}월)이 포함된 파일을 올려주세요.
                    순번 로테이션·주말 감차·짝궁 교대를 그대로 이어받습니다.
                  </>
                )}
              </p>
              <input
                ref={engineFileRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => setEngineFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => engineFileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              >
                <Upload size={15} />
                {engineFile ? engineFile.name : '엑셀 선택'}
              </button>
            </div>

            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">
                초안 이름 <span className="text-sm font-normal text-gray-400">(선택 — 비우면 "초안 N" 자동 부여)</span>
              </label>
              <input
                type="text"
                maxLength={50}
                className="input text-base py-3 min-h-[48px]"
                placeholder="예: 신규기사 반영안, 사고기사 제외안"
                value={newDraftName}
                onChange={(e) => setNewDraftName(e.target.value)}
              />
            </div>

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
                신규 기사 <span className="text-sm font-normal text-gray-400">(근무일 하한 면제 · 단독 배차 제한)</span>
              </label>
              <DriverMultiSelect drivers={allUsersList} selected={newHireIds} onChange={setNewHireIds} placeholder="신규 기사 이름 검색" />
            </div>

            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">
                노선별 사고 기사 <span className="text-sm font-normal text-gray-400">(해당 노선 배차 금지)</span>
              </label>
              {routes.length === 0 ? (
                <p className="text-sm text-gray-400">등록된 노선이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {routes.map((r) => (
                    <div key={r.id}>
                      <div className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1.5">{r.routeNumber}번 · {r.name}</div>
                      <DriverMultiSelect
                        drivers={allUsersList}
                        selected={blockedByRoute[r.id] ?? []}
                        onChange={(ids) => setBlockedByRoute((p) => ({ ...p, [r.id]: ids }))}
                        placeholder="사고 기사 이름 검색"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {expiringLicenseDrivers.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Shield size={22} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-base font-semibold text-red-800 dark:text-red-300 mb-1">
                      면허/자격 만료 기사가 있습니다
                    </p>
                    <ul className="text-sm text-red-700 dark:text-red-300 space-y-0.5">
                      {expiringLicenseDrivers.map((d) => (
                        <li key={d.id}>
                          <span className="font-medium">{d.name}</span> ({d.employeeId}) — {d.items.join(' · ')}
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-2">
                      만료일 이후 날짜에는 해당 기사가 자동으로 배차에서 제외됩니다.
                      갱신이 완료된 기사는 기본정보 관리에서 만료일을 먼저 수정해주세요.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 flex items-start gap-3">
              <Info size={22} className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-base text-blue-800 dark:text-blue-300">
                생성할 때마다 새 초안 프로필이 추가됩니다 (월 최대 5개).
                <br />
                기존 초안과 발행된 배차표는 영향받지 않습니다.
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-7">
            <button
              onClick={() => {
                setShowGenerateModal(false);
                setNewHireIds([]);
                setBlockedByRoute({});
              }}
              className="btn-secondary flex-1 text-base py-3 min-h-[52px]"
            >
              취소
            </button>
            <button
              onClick={() => engineGenerateMutation.mutate({})}
              disabled={engineGenerateMutation.isPending || !engineFile}
              className="btn-primary flex-1 text-base py-3 min-h-[52px] inline-flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {engineGenerateMutation.isPending ? (
                <>
                  <Loader2 size={20} className="animate-spin" />{' '}
                  {engineMode === 'import'
                    ? '엑셀을 읽어 배차표로 저장하고 있습니다…'
                    : 'AI가 최적 배차를 계산하고 있습니다... (최대 3분)'}
                </>
              ) : engineMode === 'import' ? (
                <>
                  <Upload size={20} /> 엑셀 그대로 가져오기
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
              <strong>{year}년 {month}월</strong> 배차표
              {schedule?.name ? <> (<strong>{schedule.name}</strong>)</> : null}
              를 발행하시겠습니까?
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
              onClick={() => publishMutation.mutate({})}
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

      {/* 업로드 파일 명단 대조 — 다른 회사·철 지난 파일이 아닌지 먼저 확인 */}
      {rosterMismatch && (
        <Modal onClose={() => setRosterMismatch(null)} title="이 파일이 맞나요?" maxWidth="max-w-md">
          <div className="py-2">
            <AlertTriangle size={48} className="mx-auto text-red-500 mb-4" />
            <p className="text-center text-base text-gray-700 dark:text-gray-300">
              파일에 있는 기사 <strong>{rosterMismatch.totalNames}명</strong> 중{' '}
              <strong className="text-red-600 dark:text-red-400">
                {rosterMismatch.unmatchedNames.length}명({Math.round(rosterMismatch.unmatchedRate * 100)}%)
              </strong>
              이 기초 데이터에 없습니다.
            </p>
            <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
              <strong>다른 회사 배차표</strong>이거나 <strong>오래된 파일</strong>일 가능성이 높습니다.
              배차는 기초 데이터에 등록된 기사로만 짤 수 있습니다.
            </p>
            <div className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {rosterMismatch.unmatchedNames.slice(0, 30).join(', ')}
              {rosterMismatch.unmatchedNames.length > 30 &&
                ` 외 ${rosterMismatch.unmatchedNames.length - 30}명`}
            </div>
            {rosterMismatch.unmatchedVehicles.length > 0 && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                기초 데이터에 없는 차량도 {rosterMismatch.unmatchedVehicles.length}대 있습니다:{' '}
                {rosterMismatch.unmatchedVehicles.slice(0, 10).join(', ')}
              </p>
            )}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setRosterMismatch(null)}
              className="btn-primary flex-1 min-h-[52px] py-3 text-base"
            >
              다른 파일 선택
            </button>
            <button
              onClick={() => engineGenerateMutation.mutate({ confirmMismatch: true })}
              disabled={engineGenerateMutation.isPending}
              className="flex-1 min-h-[52px] rounded-lg border border-red-300 py-3 text-base font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {engineGenerateMutation.isPending ? '저장 중…' : '맞는 파일입니다, 진행'}
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-gray-400">
            진행하면 그 {rosterMismatch.unmatchedNames.length}명의 칸은 비어 있게 되고 발행할 수 없습니다.
          </p>
        </Modal>
      )}

      {/* 재생성 덮어쓰기 확인 — 같은 이름 초안의 작업물이 삭제됨 */}
      {overwriteConfirm && (
        <Modal onClose={() => setOverwriteConfirm(null)} title="초안 덮어쓰기 확인" maxWidth="max-w-md">
          <div className="py-2">
            <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 text-center">
              같은 이름의 초안 <strong>&ldquo;{overwriteConfirm.name}&rdquo;</strong> 이 이미 있습니다.
              <br />
              덮어쓰면 아래 작업물이 <strong className="text-red-600 dark:text-red-400">모두 삭제</strong>되고 되돌릴 수 없습니다.
            </p>
            <ul className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300 space-y-1">
              <li>· 배정 {overwriteConfirm.slotCount}건</li>
              <li>· 수동 수정 {overwriteConfirm.manualOverrideCount}건</li>
              <li>· 감차 표기 {overwriteConfirm.vehicleOffCount}건</li>
            </ul>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 text-center">
              보존하려면 취소 후 초안 이름을 다르게 지정해 생성하세요.
            </p>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setOverwriteConfirm(null)}
              className="btn-primary flex-1 text-base py-3 min-h-[52px]"
            >
              취소 (기존 초안 보존)
            </button>
            <button
              onClick={() => engineGenerateMutation.mutate({ confirmOverwrite: true })}
              disabled={engineGenerateMutation.isPending}
              className="flex-1 text-base py-3 min-h-[52px] rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors font-medium disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {engineGenerateMutation.isPending ? '저장 중…' : '삭제하고 덮어쓰기'}
            </button>
          </div>
        </Modal>
      )}

      {/* 발행 게이트 — 중복 배정·연속근무 초과가 있어 발행이 차단됨 */}
      {publishBlocked && (
        <Modal onClose={() => setPublishBlocked(null)} title="발행 차단 — 안전 검사" maxWidth="max-w-md">
          <div className="py-2">
            <AlertTriangle size={48} className="mx-auto text-red-500 mb-4" />
            <p className="text-base text-gray-700 dark:text-gray-300 mb-3 text-center">
              {publishBlocked.duplicates.length > 0 && (
                <>
                  <strong>같은 날 두 번 배정된 기사 {publishBlocked.duplicates.length}건</strong>
                  <br />
                </>
              )}
              {(publishBlocked.counts?.vacant ?? 0) > 0 && (
                <>
                  <strong className="text-red-600 dark:text-red-400">
                    공석 {publishBlocked.counts!.vacant}칸 — 버스가 나갈 수 없음
                  </strong>
                  <br />
                </>
              )}
              {(publishBlocked.counts?.unregistered ?? 0) > 0 && (
                <>
                  <strong>미등록 기사 칸 {publishBlocked.counts!.unregistered}칸</strong>
                  <br />
                </>
              )}
              {(publishBlocked.counts?.consecutive ?? 0) > 0 && (
                <>
                  <strong>연속근무 한도(6일) 초과 {publishBlocked.counts!.consecutive}건</strong>
                  <br />
                </>
              )}
              이대로 발행하면 운행 못 하는 버스·과로·이중 배정이 그대로 기사에게 전달됩니다.
            </p>
            <ul className="max-h-48 overflow-y-auto rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 space-y-1">
              {publishBlocked.duplicates.slice(0, 6).map((d, i) => (
                <li key={`d${i}`}>
                  중복 — <strong>{d.driverName}</strong> {d.date.slice(5).replace('-', '/')}
                </li>
              ))}
              {publishBlocked.duplicates.length > 6 && (
                <li>… 중복 외 {publishBlocked.duplicates.length - 6}건</li>
              )}
              {publishBlocked.violations.slice(0, 6).map((v, i) => (
                <li key={`v${i}`}>{v.message}</li>
              ))}
              {publishBlocked.violations.length > 6 && (
                <li>… 연속근무 외 {publishBlocked.violations.length - 6}건</li>
              )}
            </ul>
            {publishBlocked.warnings.length > 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                참고: 짧은 휴식(오후→다음날 오전) {publishBlocked.warnings.length}건도 있습니다 —
                발행을 막지는 않지만 확인을 권합니다.
              </p>
            )}
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 text-center">
              차량별·기사별 보기에서 해당 배정을 고친 뒤 다시 발행해주세요.
            </p>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setPublishBlocked(null)}
              className="btn-primary flex-1 text-base py-3 min-h-[52px]"
            >
              돌아가서 수정하기
            </button>
            <button
              onClick={() => publishMutation.mutate({ force: true })}
              disabled={publishMutation.isPending}
              className="flex-1 text-base py-3 min-h-[52px] rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors font-medium disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {publishMutation.isPending ? '발행 중…' : '위험을 알고 강제 발행'}
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
              <strong>{year}년 {month}월</strong> 배차표
              {schedule?.name ? <> (<strong>{schedule.name}</strong> 프로필)</> : null}
              를 삭제하시겠습니까?
            </p>
            {schedule?.status === 'PUBLISHED' && (
              <p className="text-base text-gray-600 dark:text-gray-300 mb-2">
                발행된 배차표입니다. 삭제하면 기사 앱에서 더 이상 보이지 않으며,
                <br />
                삭제 후 새 배차표를 다시 생성·발행할 수 있습니다.
              </p>
            )}
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

      {/* 프로필 이름 변경 모달 */}
      {showRenameModal && schedule && (
        <Modal
          onClose={() => setShowRenameModal(false)}
          title="프로필 이름 변경"
          maxWidth="max-w-md"
          icon={<Edit3 size={22} className="text-blue-600" />}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">이름</label>
              <input
                type="text"
                maxLength={50}
                autoFocus
                className="input text-base py-3 min-h-[48px]"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameValue.trim()) {
                    renameMutation.mutate({ id: schedule.id, name: renameValue.trim() });
                  }
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRenameModal(false)}
                className="btn-secondary flex-1 text-base py-3 min-h-[48px]"
              >
                취소
              </button>
              <button
                onClick={() => renameMutation.mutate({ id: schedule.id, name: renameValue.trim() })}
                disabled={!renameValue.trim() || renameMutation.isPending}
                className="btn-primary flex-1 text-base py-3 min-h-[48px] inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {renameMutation.isPending && <Loader2 size={18} className="animate-spin" />}
                저장
              </button>
            </div>
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
   배차 품질 패널 — 라이브 체크리스트 + AI 생성 지표(있을 때)를 하나로 통합
   ──────────────────────────────────────────────── */

function ScheduleQualityPanel({
  quality: q,
  filledRate,
  result,
  onDriverClick,
}: {
  quality: QualityData;
  filledRate: number;
  result: V2Result | null;
  onDriverClick: (driverId: number) => void;
}) {
  // 카드 접기/펴기 — 화살표 버튼으로 토글
  const [collapsed, setCollapsed] = useState(false);
  const m = result?.metrics ?? {};
  const fairness = result ? Math.round(m.fairnessScore ?? 0) : null;
  const targetPct = Math.round((m.withinTargetRate ?? 0) * 100);
  const violatorCount = m.hardViolationCount ?? 0;
  const exempted = m.exemptedCount ?? 0;
  const workMean = m.workDayMean ?? 0;

  // 라이브 체크 상태
  const checks = [filledRate === 100, q.noBusCount === 0, q.approvedCount === 0 || q.unreflected.length === 0];
  const passCount = checks.filter(Boolean).length;
  const warnCount = checks.filter((c) => !c).length;

  const violators = result?.hardViolators ?? [];
  const unfilled = result?.unfilled ?? [];

  const fairnessColor =
    fairness == null ? '' :
    fairness >= 85 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' :
    fairness >= 60 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' :
    'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';

  // 근무일 균형 행 — AI 결과가 있으면 목표충족·위반 기준, 없으면 편차 기준
  const balanceStatus: 'pass' | 'warn' | 'info' = result
    ? (violatorCount > 0 ? 'warn' : 'pass')
    : (q.spread <= 2 ? 'pass' : 'info');
  const balanceSummary = result
    ? `목표 근무일 충족 ${targetPct}%, 평균 ${workMean.toFixed(1)}일${violatorCount > 0 ? `, 기준 위반 ${violatorCount}명` : ', 위반 없음'}${exempted > 0 ? ` (스페어 ${exempted}명 제외)` : ''}`
    : `기사별 근무 ${q.minWork}~${q.maxWork}일 (편차 ${q.spread}일)`;

  return (
    <div data-print-hide className="card dark:bg-gray-800 p-0 overflow-hidden">
      {/* 헤더 — 클릭 시 카드 접기/펴기 토글 */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors"
      >
        <Shield size={20} className="text-gray-900 dark:text-white shrink-0" />
        <h3 className="text-[18px] font-bold text-gray-900 dark:text-white">배차 품질</h3>
        {fairness != null && (
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-bold ${fairnessColor}`}>
            <Sparkles size={13} /> 공정성 {fairness}
          </span>
        )}
        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">통과 {passCount} · 주의 {warnCount}</span>
        {collapsed
          ? <ChevronDown size={20} className="text-gray-400" />
          : <ChevronUp size={20} className="text-gray-400" />}
      </button>

      {!collapsed && (
      <>
      {/* AI 생성 지표 스트립 (생성 결과가 있을 때만) */}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-100 dark:divide-gray-700 border-b border-gray-100 dark:border-gray-700">
          <MiniStat label="목표 근무일 충족" value={`${targetPct}%`} />
          <MiniStat label="본인 차량 배정" value={`${Math.round((m.homeBusRate ?? 0) * 100)}%`} />
          <MiniStat label="휴무 사이클 준수" value={`${Math.round((m.restCycleCompliance ?? 0) * 100)}%`} />
          <MiniStat label="승인 휴무 반영" value={`${Math.round((m.dayOffSatisfactionRate ?? 0) * 100)}%`} />
        </div>
      )}

      {/* 체크리스트 (현재 배차표 실시간 상태) */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        <ChecklistRow
          status={filledRate === 100 ? 'pass' : 'warn'}
          title="배차 완료율"
          summary={filledRate === 100 ? '모든 근무 슬롯이 배차되었습니다' : `미충원 ${q.unfilledCount}건 (배차율 ${filledRate}%)`}
        >
          {unfilled.length > 0 && (
            <div className="overflow-x-auto max-h-[280px] rounded-lg border border-gray-100 dark:border-white/10">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 dark:bg-white/[0.02] sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">날짜</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">시프트</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">버스</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">사유</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                  {unfilled.map((u, i) => {
                    const shift = u.shift === 'AM' || u.shift === 'MORNING' ? '오전'
                      : u.shift === 'PM' || u.shift === 'AFTERNOON' ? '오후'
                      : u.shift === 'FULL_DAY' ? '종일'
                      : u.shift || '-';
                    return (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                        <td className="px-4 py-2 text-gray-900 dark:text-gray-100 font-mono">{u.date.slice(0, 10)}</td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{shift}</td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-200 font-mono">{u.busId ? `#${u.busId}` : '-'}</td>
                        <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{u.reason || '대체 인력 없음'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ChecklistRow>

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
              ? `승인된 휴가 없음${q.pendingCount > 0 ? `, 미결재 ${q.pendingCount}건` : ''}`
              : q.unreflected.length === 0
                ? `승인 휴가 ${q.approvedCount}건 모두 반영됨${q.pendingCount > 0 ? `, 미결재 ${q.pendingCount}건` : ''}`
                : `승인 휴가 ${q.approvedCount}건 중 ${q.unreflected.length}건 미반영${q.pendingCount > 0 ? `, 미결재 ${q.pendingCount}건` : ''}`
          }
        >
          {q.unreflected.length > 0 && (
            <ul className="space-y-1">
              {q.unreflected.map((u, i) => (
                <li key={i} className="text-[12px] text-gray-600 dark:text-gray-300">
                  <b>{u.name}</b> ({u.employeeId}) — {u.date} 휴가 신청했으나 근무 배정되었습니다
                </li>
              ))}
            </ul>
          )}
        </ChecklistRow>

        <ChecklistRow status={balanceStatus} title="근무일 균형" summary={balanceSummary}>
          {violators.length > 0 && (
            <div className="overflow-x-auto max-h-[280px] rounded-lg border border-gray-100 dark:border-white/10">
              {violators.some((v) => v.workloadEval?.tier === 'UNDER_MIN') && (
                <p className="px-4 py-2.5 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-100 dark:border-amber-500/20">
                  근무일 부족이 여러 명 발생하면 대부분 기사 수에 비해 운행 슬롯이 부족한 경우입니다.
                  배차 정책 설정에서 월 근무일 하한을 낮추거나, 기사·차량·시프트 구성을 확인해보세요.
                </p>
              )}
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 dark:bg-white/[0.02] sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">기사</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">근무일</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">사유</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                  {violators.map((v, i) => {
                    const tier = v.workloadEval?.tier;
                    const reason = tier === 'UNDER_MIN' ? '근무일 부족' : tier === 'OVER_MAX' ? '근무일 초과' : tier || '범위 위반';
                    const clickable = v.driverId !== undefined;
                    return (
                      <tr
                        key={i}
                        onClick={() => clickable && onDriverClick(v.driverId!)}
                        className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] ${clickable ? 'cursor-pointer' : ''}`}
                      >
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">
                          {clickable ? (
                            <span className="text-blue-700 dark:text-blue-300 hover:underline">
                              {v.driverName || v.name || `#${v.driverId}`}
                            </span>
                          ) : (
                            v.driverName || v.name || `#${v.driverId}`
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{v.workDays ?? '-'}일</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ChecklistRow>
      </div>
      </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3">
      <div className="text-[12px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-[20px] font-bold text-gray-900 dark:text-gray-100 mt-0.5">{value}</div>
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
    if (!tier) return violatorEntry.detail || null;
    return tier === 'UNDER_MIN' ? '근무일 부족' : tier === 'OVER_MAX' ? '근무일 초과' : tier;
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
              <b>근무일 기준 위반:</b> {violationLine}
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

// ─────────────────────────────────────────────────────────────
// 기사 다중 선택 (배차표 생성 모달: 신규 기사 / 노선별 사고 기사)
// 선택된 기사는 칩으로 표시, 검색 + 토글 칩으로 추가/제거.
// ─────────────────────────────────────────────────────────────
function DriverMultiSelect({
  drivers,
  selected,
  onChange,
  placeholder,
}: {
  drivers: { id: number; name: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const kw = q.trim().toLowerCase();
  // 검색어가 있을 때만 후보를 보여준다 (전체 나열로 모듈이 복잡해지는 것 방지)
  const filtered = kw ? drivers.filter((d) => d.name.toLowerCase().includes(kw)) : [];

  return (
    <div className="border border-gray-200 dark:border-white/10 rounded-xl p-3 bg-white dark:bg-white/5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((id) => {
            const d = drivers.find((x) => x.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-sm px-2 py-1 rounded-lg"
              >
                {d?.name ?? `#${id}`}
                <button onClick={() => toggle(id)} className="hover:text-blue-900 dark:hover:text-blue-100" aria-label="제거">
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? '기사 이름 검색'}
        className="input text-sm py-2"
      />
      {kw && (
        <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5 mt-2">
          {filtered.length === 0 ? (
            <span className="text-sm text-gray-400 px-1 py-1">검색 결과가 없습니다.</span>
          ) : (
            filtered.map((d) => {
              const on = selected.includes(d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => toggle(d.id)}
                  className={`text-sm px-2.5 py-1 rounded-lg border transition-colors ${
                    on
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/15 text-gray-700 dark:text-gray-200 hover:border-blue-400'
                  }`}
                >
                  {d.name}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
