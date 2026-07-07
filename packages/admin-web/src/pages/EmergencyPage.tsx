import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  X,
  Clock,
  CheckCircle2,
  Ban,
  Siren,
  Bell,
  Users,
  UserCheck,
  Search,
  ShieldAlert,
  Flame,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { emergencyApi, schedulesApi } from '../services/api';
import { format, formatDistanceToNow, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { parseSlotDate } from '../utils/date';
import PageHeader from '../components/PageHeader';
import SectionHeader from '../components/SectionHeader';
import { emergencyHelp } from '../help/helpContent';

/* ─────────────────────── Types ─────────────────────── */

interface EmergencyDrop {
  id: number;
  reason: string;
  status: 'OPEN' | 'FILLED' | 'CANCELLED';
  escalationLevel: number;
  lastEscalatedAt: string | null;
  createdAt: string;
  filledAt: string | null;
  slot: {
    id: number;
    date: string;
    shift: string;
    route: { routeNumber: string; name: string };
    bus?: { busNumber: string };
  };
  driver: { id: number; name: string; phone: string; employeeId: string };
  filledUser?: { id: number; name: string; employeeId: string };
}

interface ScheduleSlot {
  id: number;
  date: string;
  shift: string;
  status?: string;
  isRestDay?: boolean;
  route: { routeNumber: string; name: string };
  bus?: { busNumber: string };
  driver?: { id: number; name: string; employeeId: string };
}

/* ─────────────────────── Constants ─────────────────────── */

const ESCALATION_CONFIG: Record<
  number,
  { label: string; description: string; color: string; bg: string; icon: typeof Bell }
> = {
  0: { label: '초기', description: '초기 알림 발송', color: 'text-blue-600', bg: 'bg-blue-100', icon: Bell },
  1: { label: '리마인더', description: '리마인더 재발송', color: 'text-yellow-600', bg: 'bg-yellow-100', icon: Bell },
  2: { label: '전체공지', description: '전체 기사 대상 확대', color: 'text-orange-600', bg: 'bg-orange-100', icon: Users },
  3: { label: '관리자경보', description: '관리자 직접 개입 필요', color: 'text-red-600', bg: 'bg-red-100', icon: ShieldAlert },
  4: { label: '최종위기', description: '긴급 / 운행 불가 위험', color: 'text-red-800', bg: 'bg-red-200', icon: Flame },
};

const SHIFT_LABELS: Record<string, string> = {
  MORNING: '오전',
  AFTERNOON: '오후',
  FULL_DAY: '종일',
};

/* ─────────────────────── Component ─────────────────────── */

export default function EmergencyPage() {
  const queryClient = useQueryClient();
  const [selectedSlotId, setSelectedSlotId] = useState<number | ''>('');
  const [selectedDateKey, setSelectedDateKey] = useState<string>('');
  const [dropReason, setDropReason] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [manualFillDrop, setManualFillDrop] = useState<EmergencyDrop | null>(null);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  /* ── Queries ── */
  const {
    data: openData,
    isLoading: openLoading,
    isRefetching: openRefetching,
  } = useQuery<{ drops: EmergencyDrop[]; agentEnabled: boolean }>({
    queryKey: ['emergency', 'OPEN'],
    queryFn: () =>
      emergencyApi.list({ status: 'OPEN' }).then((r) => ({
        drops: r.data.data ?? r.data,
        agentEnabled: Boolean(r.data.agentEnabled),
      })),
    refetchInterval: 10000,
  });
  const openDrops = openData?.drops ?? [];
  const agentEnabled = openData?.agentEnabled ?? false;

  const { data: recentDrops = [], isLoading: recentLoading } = useQuery<EmergencyDrop[]>({
    queryKey: ['emergency', 'recent'],
    queryFn: async () => {
      const [filled, cancelled] = await Promise.all([
        emergencyApi.list({ status: 'FILLED' }).then((r) => r.data.data ?? r.data),
        emergencyApi.list({ status: 'CANCELLED' }).then((r) => r.data.data ?? r.data),
      ]);
      const all = [...(filled as EmergencyDrop[]), ...(cancelled as EmergencyDrop[])];
      // Filter last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return all
        .filter((d) => new Date(d.createdAt) >= sevenDaysAgo)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    refetchInterval: 30000,
  });

  const { data: scheduleData } = useQuery({
    queryKey: ['schedules', year, month],
    queryFn: () => schedulesApi.get(year, month).then((r) => r.data),
    retry: 1,
  });

  // 다음 달 배차표 — 기사 앱과 동일하게 이번 달 + 다음 달의 미래 슬롯을 대상으로 함
  const nextMonthDate = new Date(year, month, 1);
  const nextYear = nextMonthDate.getFullYear();
  const nextMonth = nextMonthDate.getMonth() + 1;
  const { data: nextScheduleData } = useQuery({
    queryKey: ['schedules', nextYear, nextMonth],
    queryFn: () => schedulesApi.get(nextYear, nextMonth).then((r) => r.data),
    retry: 1,
  });

  /* ── Mutations ── */
  const createMutation = useMutation({
    mutationFn: ({ slotId, reason }: { slotId: number; reason: string }) =>
      emergencyApi.create(slotId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency'] });
      toast.success('슬롯 드랍이 생성되었습니다. 쉬는 기사들에게 알림이 발송됩니다.');
      setSelectedSlotId('');
      setDropReason('');
    },
    onError: () => {
      toast.error('슬롯 드랍 생성에 실패했습니다. 다시 시도해주세요.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => emergencyApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency'] });
      toast.success('긴급 슬롯이 취소되었습니다.');
    },
    onError: () => {
      toast.error('취소 처리에 실패했습니다. 다시 시도해주세요.');
    },
  });

  /* ── Derived data ── */
  // 오늘 이후의 드랍 가능한 슬롯을 날짜별로 그룹핑 (기사 앱과 동일한 기준: 휴무 아님 · SCHEDULED · 미래 날짜)
  const upcomingSlotsByDate = useMemo(() => {
    const map = new Map<string, ScheduleSlot[]>();
    const todayStr = format(today, 'yyyy-MM-dd');
    const collect = (data: unknown) => {
      const d = data as { data?: { status?: string; slots?: ScheduleSlot[] }; status?: string; slots?: ScheduleSlot[] } | undefined;
      const sched = d?.data ?? d;
      // 발행 전(DRAFT) 배차표는 기사에게 보이지 않으므로 대타 요청 대상에서 제외
      if (!sched || sched.status === 'DRAFT') return;
      const slots = sched.slots ?? [];
      for (const s of slots) {
        if (!s.driver || s.isRestDay) continue;
        if (s.status && s.status !== 'SCHEDULED') continue;
        const dateKey = s.date?.slice(0, 10);
        if (!dateKey || dateKey < todayStr) continue;
        if (!map.has(dateKey)) map.set(dateKey, []);
        map.get(dateKey)!.push(s);
      }
    };
    collect(scheduleData);
    collect(nextScheduleData);
    return new Map([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  }, [scheduleData, nextScheduleData]);

  const availableDateKeys = useMemo(() => [...upcomingSlotsByDate.keys()], [upcomingSlotsByDate]);
  const effectiveDateKey = selectedDateKey && upcomingSlotsByDate.has(selectedDateKey)
    ? selectedDateKey
    : (availableDateKeys[0] ?? '');
  const slotsForSelectedDate = upcomingSlotsByDate.get(effectiveDateKey) ?? [];


  /* ── Handlers ── */
  const handleCancel = (drop: EmergencyDrop) => {
    if (cancelMutation.isPending) return;
    const confirmed = window.confirm(
      `${drop.driver.name} 기사의 긴급 슬롯을 취소하시겠습니까?\n\n노선: ${drop.slot.route.routeNumber}번\n날짜: ${format(parseSlotDate(drop.slot.date), 'yyyy년 M월 d일', { locale: ko })}`,
    );
    if (confirmed) cancelMutation.mutate(drop.id);
  };

  const handleCreate = () => {
    if (!selectedSlotId || !dropReason.trim()) {
      toast.error('슬롯과 사유를 모두 입력해주세요.');
      return;
    }
    const confirmed = window.confirm(
      '해당 슬롯을 드랍하시겠습니까?\n쉬는 기사들에게 푸시 알림이 발송됩니다.',
    );
    if (confirmed) {
      createMutation.mutate({ slotId: selectedSlotId as number, reason: dropReason.trim() });
    }
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['emergency'] });
  };

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  /* ── Render helpers ── */
  // 운행일까지 남은 일수(D-N). 2일 이내면 긴급으로 취급.
  const daysUntilSlot = (slotDate: string): number => {
    const d = parseSlotDate(slotDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  };

  const renderEscalationBadge = (level: number, urgent: boolean) => {
    // D-2 이내 긴급건은 단계와 무관하게 빨간 "긴급" 뱃지로 표시
    if (urgent) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[15px] font-bold bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <Flame size={16} />
          긴급
        </span>
      );
    }
    const config = ESCALATION_CONFIG[level] ?? ESCALATION_CONFIG[0];
    const Icon = config.icon;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[15px] font-semibold ${config.bg} ${config.color}`}
      >
        <Icon size={16} />
        {config.label}
      </span>
    );
  };

  const renderTimeSince = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ko });
    } catch {
      return '';
    }
  };

  /* ─────────────────────── JSX ─────────────────────── */
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        help={emergencyHelp}
        icon={AlertTriangle}
        title="대타 관리"
        description="슬롯 드랍 및 대타 배정 현황을 관리합니다."
        actions={
          <button
            onClick={handleRefresh}
            disabled={openRefetching}
            className="flex items-center gap-2 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors min-h-[48px]"
          >
            <RefreshCw size={18} className={openRefetching ? 'animate-spin' : ''} />
            새로고침
          </button>
        }
      />

      {/* ─── Real-time Summary Bar ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card flex items-center gap-3 py-4">
          <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
            <Siren size={24} className="text-red-600" />
          </div>
          <div>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">진행중</p>
            <p className="text-2xl font-bold text-red-600">{openDrops.length}건</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 py-4">
          <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
            <CheckCircle2 size={24} className="text-green-600" />
          </div>
          <div>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">오늘 해결</p>
            <p className="text-2xl font-bold text-green-600">
              {recentDrops.filter(d => d.status === 'FILLED' && isToday(new Date(d.filledAt || d.createdAt))).length}건
            </p>
          </div>
        </div>
        {(() => {
          const d2Count = openDrops.filter(d => d.escalationLevel >= 1).length;
          const hot = d2Count > 0;
          return (
            <div className={`card flex items-center gap-3 py-4 ${hot ? 'bg-red-600 border-red-700 dark:bg-red-700 dark:border-red-800 shadow-lg shadow-red-500/30' : ''}`}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${hot ? 'bg-red-500/80' : 'bg-red-100 dark:bg-red-900/30'}`}>
                <Flame size={24} className={hot ? 'text-white' : 'text-red-600'} />
              </div>
              <div>
                <p className={`text-[14px] ${hot ? 'text-red-50 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>D-2 긴급</p>
                <p className={`text-2xl font-bold ${hot ? 'text-white' : 'text-red-600'}`}>{d2Count}건</p>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ─── Section 1: Active Emergency Drops ─── */}
      <section>
        <SectionHeader icon={Siren} title="진행중인 대타 요청" className="mb-4" />

        {openLoading ? (
          <div className="card flex flex-col items-center justify-center py-16">
            <Loader2 size={40} className="text-blue-500 animate-spin mb-4" />
            <p className="text-[16px] text-gray-400 dark:text-gray-500">불러오는 중...</p>
          </div>
        ) : openDrops.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-16 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <CheckCircle2 size={56} className="text-green-500 mb-4" />
            <p className="text-[18px] font-semibold text-green-700 dark:text-green-400">
              현재 진행중인 대타 요청이 없습니다
            </p>
            <p className="text-[15px] text-green-500 dark:text-green-600 mt-1">
              10초마다 자동으로 갱신됩니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {openDrops.map((drop) => {
              const isUrgent = daysUntilSlot(drop.slot.date) <= 2;
              const escalation = ESCALATION_CONFIG[drop.escalationLevel] ?? ESCALATION_CONFIG[0];
              const EscIcon = isUrgent ? Flame : escalation.icon;
              const isExpanded = expandedId === drop.id;

              return (
                <div
                  key={drop.id}
                  className="card border-l-4 border-l-red-500 hover:shadow-lg transition-shadow"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[20px] font-bold text-gray-900 dark:text-white">
                          {format(parseSlotDate(drop.slot.date), 'M월 d일 (EEEE)', { locale: ko })}
                        </span>
                        <span className="inline-flex items-center px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[18px] font-bold">
                          {drop.slot.route.routeNumber}번
                        </span>
                      </div>
                      <p className="text-[16px] text-gray-500 dark:text-gray-400">
                        {drop.slot.route.name} / {SHIFT_LABELS[drop.slot.shift] ?? drop.slot.shift}
                      </p>
                    </div>
                    {renderEscalationBadge(drop.escalationLevel, isUrgent)}
                  </div>

                  {/* Card Body */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] text-gray-400 dark:text-gray-500 w-20 shrink-0">
                        원래 기사
                      </span>
                      <span className="text-[17px] font-semibold text-gray-900 dark:text-white">
                        {drop.driver.name}
                      </span>
                      <span className="text-[14px] text-gray-400">({drop.driver.phone})</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[15px] text-gray-400 dark:text-gray-500 w-20 shrink-0">
                        드랍 사유
                      </span>
                      <span className="text-[16px] text-gray-700 dark:text-gray-300">
                        {drop.reason || '사유 없음'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[15px] text-gray-400 dark:text-gray-500 w-20 shrink-0">
                        경과 시간
                      </span>
                      <span className="text-[16px] font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5">
                        <Clock size={16} />
                        {renderTimeSince(drop.createdAt)}
                      </span>
                    </div>

                    {/* Escalation detail */}
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] text-gray-400 dark:text-gray-500 w-20 shrink-0">
                        단계 상세
                      </span>
                      <div className={`flex items-center gap-1.5 ${isUrgent ? 'text-red-600 dark:text-red-400' : escalation.color}`}>
                        <EscIcon size={16} />
                        <span className="text-[16px] font-medium">
                          {isUrgent ? '긴급 — 즉시 충원 필요 (운행 2일 이내)' : escalation.description}
                        </span>
                      </div>
                    </div>

                    {/* AI 충원 상태 — 에이전트 진행 가시화 */}
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] text-gray-400 dark:text-gray-500 w-20 shrink-0">
                        {agentEnabled ? 'AI 충원' : '충원 상태'}
                      </span>
                      <AgentStatusBadge
                        agentEnabled={agentEnabled}
                        escalationLevel={drop.escalationLevel}
                        lastEscalatedAt={drop.lastEscalatedAt}
                        createdAt={drop.createdAt}
                      />
                    </div>
                  </div>

                  {/* Expanded: escalation history */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <h4 className="text-[14px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                        에스컬레이션 이력
                      </h4>
                      <div className="space-y-2">
                        {Array.from({ length: drop.escalationLevel + 1 }, (_, i) => {
                          const lvl = ESCALATION_CONFIG[i] ?? ESCALATION_CONFIG[0];
                          const LvlIcon = lvl.icon;
                          return (
                            <div key={i} className="flex items-center gap-2">
                              <LvlIcon size={16} className={lvl.color} />
                              <span className={`text-[15px] font-medium ${lvl.color}`}>
                                {lvl.label}
                              </span>
                              <span className="text-[14px] text-gray-400 dark:text-gray-500">
                                - {lvl.description}
                              </span>
                              {i === drop.escalationLevel && (
                                <span className="text-[12px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded-full font-semibold">
                                  현재
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {drop.lastEscalatedAt && (
                        <p className="text-[13px] text-gray-400 mt-3">
                          마지막 에스컬레이션:{' '}
                          {format(new Date(drop.lastEscalatedAt), 'M월 d일 HH:mm', { locale: ko })}
                        </p>
                      )}

                      {/* 알림 발송 대상 기사 */}
                      <NotifiedDriversList dropId={drop.id} />
                    </div>
                  )}

                  {/* Card Actions */}
                  <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <button
                      onClick={() => toggleExpand(drop.id)}
                      className="flex items-center gap-1.5 px-4 py-3 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-[16px] font-medium hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors min-h-[48px]"
                    >
                      <Info size={16} />
                      상세
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      onClick={() => setManualFillDrop(drop)}
                      className="flex items-center gap-1.5 px-5 py-3 bg-emerald-600 text-white rounded-xl text-[16px] font-bold hover:bg-emerald-700 transition-colors min-h-[48px] ml-auto"
                    >
                      <UserCheck size={18} />
                      기사 직접 지정
                    </button>
                    <button
                      onClick={() => handleCancel(drop)}
                      disabled={cancelMutation.isPending}
                      className="flex items-center gap-1.5 px-5 py-3 bg-red-600 text-white rounded-xl text-[16px] font-bold hover:bg-red-700 transition-colors min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <X size={18} />
                      취소
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Section 2: Create New Drop ─── */}
      <section>
        <SectionHeader icon={AlertTriangle} title="새 대타 요청" className="mb-4" />

        <div className="card">
          <p className="text-[16px] text-gray-500 dark:text-gray-400 mb-5">
            날짜를 선택한 뒤 드랍할 슬롯을 선택하고 사유를 입력하세요. (오늘 포함 이후 날짜만 가능)
          </p>

          <div className="space-y-4">
            {/* Date Selector */}
            <div>
              <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-2">
                날짜 선택
              </label>
              {availableDateKeys.length === 0 ? (
                <p className="text-[14px] text-gray-400 dark:text-gray-500">
                  드랍 가능한 슬롯이 없거나 배차표를 불러올 수 없습니다.
                </p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {availableDateKeys.map((dateKey) => {
                    const d = parseSlotDate(dateKey);
                    const isSelected = dateKey === effectiveDateKey;
                    const isTodayChip = dateKey === format(today, 'yyyy-MM-dd');
                    return (
                      <button
                        key={dateKey}
                        onClick={() => {
                          setSelectedDateKey(dateKey);
                          setSelectedSlotId('');
                        }}
                        className={`shrink-0 px-4 py-2.5 rounded-xl border text-[15px] font-medium transition-colors min-h-[48px] ${
                          isSelected
                            ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 ring-2 ring-red-500/20'
                            : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                      >
                        {format(d, 'M/d (EEE)', { locale: ko })}
                        {isTodayChip && <span className="ml-1 text-[12px]">오늘</span>}
                        <span className="ml-1.5 text-[12px] text-gray-400">{upcomingSlotsByDate.get(dateKey)?.length ?? 0}건</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Slot Selector */}
            <div>
              <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-2">
                슬롯 선택
              </label>
              <select
                value={selectedSlotId}
                onChange={(e) =>
                  setSelectedSlotId(e.target.value ? Number(e.target.value) : '')
                }
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-[16px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[48px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="">-- 슬롯을 선택하세요 --</option>
                {slotsForSelectedDate.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.driver?.name} - {slot.route.routeNumber}번 {slot.route.name} ({SHIFT_LABELS[slot.shift] ?? slot.shift})
                  </option>
                ))}
              </select>
              {effectiveDateKey && slotsForSelectedDate.length === 0 && (
                <p className="text-[14px] text-gray-400 dark:text-gray-500 mt-2">
                  선택한 날짜에 드랍 가능한 슬롯이 없습니다.
                </p>
              )}
            </div>

            {/* Reason Input */}
            <div>
              <label className="block text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-2">
                드랍 사유
              </label>
              <input
                type="text"
                value={dropReason}
                onChange={(e) => setDropReason(e.target.value)}
                placeholder="예: 갑작스러운 병가, 개인 사정 등"
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-[16px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[48px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400"
              />
            </div>

            {/* Create Button */}
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending || !selectedSlotId || !dropReason.trim()}
              className="flex items-center justify-center gap-2 w-full px-6 py-4 bg-red-600 text-white rounded-xl text-[18px] font-bold hover:bg-red-700 transition-colors min-h-[56px] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {createMutation.isPending ? (
                <Loader2 size={22} className="animate-spin" />
              ) : (
                <AlertTriangle size={22} />
              )}
              슬롯 드랍
            </button>
          </div>
        </div>
      </section>

      {/* ─── Section 3: Recently Resolved ─── */}
      <section>
        <SectionHeader icon={Clock} title="최근 처리 내역" hint="(최근 7일)" className="mb-4" />

        {recentLoading ? (
          <div className="card flex flex-col items-center justify-center py-12">
            <Loader2 size={32} className="text-blue-500 animate-spin mb-3" />
            <p className="text-[16px] text-gray-400">불러오는 중...</p>
          </div>
        ) : recentDrops.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-12">
            <CheckCircle2 size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-[16px] text-gray-400 dark:text-gray-500">
              최근 7일간 처리된 내역이 없습니다.
            </p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      날짜
                    </th>
                    <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      노선
                    </th>
                    <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      드랍 기사
                    </th>
                    <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      상태
                    </th>
                    <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      대체 기사
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {recentDrops.map((drop) => (
                    <tr
                      key={drop.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      {/* Date */}
                      <td className="px-6 py-4">
                        <div className="text-[16px] font-semibold text-gray-900 dark:text-white">
                          {format(parseSlotDate(drop.slot.date), 'M월 d일', { locale: ko })}
                        </div>
                        <div className="text-[13px] text-gray-400 dark:text-gray-500">
                          {format(parseSlotDate(drop.slot.date), 'EEEE', { locale: ko })}
                        </div>
                      </td>

                      {/* Route */}
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[16px] font-medium">
                          {drop.slot.route.routeNumber}번
                        </span>
                        <div className="text-[13px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {drop.slot.route.name}
                        </div>
                      </td>

                      {/* Original Driver */}
                      <td className="px-6 py-4">
                        <span className="text-[16px] font-medium text-gray-900 dark:text-white">
                          {drop.driver.name}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        {drop.status === 'FILLED' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[15px] font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                            <CheckCircle2 size={16} />
                            해결
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[15px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                            <Ban size={16} />
                            취소
                          </span>
                        )}
                      </td>

                      {/* Filled By */}
                      <td className="px-6 py-4">
                        {drop.status === 'FILLED' && drop.filledUser ? (
                          <span className="text-[16px] font-medium text-green-700 dark:text-green-400">
                            {drop.filledUser.name}
                          </span>
                        ) : (
                          <span className="text-[16px] text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 수동 충원 모달 */}
      {manualFillDrop && (
        <ManualFillModal
          drop={manualFillDrop}
          onClose={() => setManualFillDrop(null)}
          onSuccess={() => {
            setManualFillDrop(null);
            queryClient.invalidateQueries({ queryKey: ['emergency'] });
          }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   알림 발송 대상 기사 목록 — 드랍 상세(펼침)에서 표시
   ──────────────────────────────────────────────── */

interface NotifiedDriver {
  id: number;
  name: string;
  employeeId: string;
  driverType: 'MAIN' | 'SPARE' | null;
  firstNotifiedAt: string;
  count: number;
}

function NotifiedDriversList({ dropId }: { dropId: number }) {
  const { data: notified = [], isLoading } = useQuery<NotifiedDriver[]>({
    queryKey: ['emergency', 'notified-drivers', dropId],
    queryFn: () => emergencyApi.notifiedDrivers(dropId).then((r) => r.data.data ?? []),
  });

  return (
    <div className="mt-4">
      <h4 className="text-[14px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
        알림 발송 대상 ({notified.length}명)
      </h4>
      {isLoading ? (
        <p className="text-[14px] text-gray-400">불러오는 중...</p>
      ) : notified.length === 0 ? (
        <p className="text-[14px] text-gray-400">
          알림을 받은 기사가 없습니다. (해당 날짜에 쉬는 기사·예비 기사가 없었을 수 있습니다)
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {notified.map((d) => (
            <li
              key={d.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[13px]"
              title={`최초 발송: ${format(new Date(d.firstNotifiedAt), 'M월 d일 HH:mm', { locale: ko })}${d.count > 1 ? ` · ${d.count}회 발송` : ''}`}
            >
              <span className="font-medium text-gray-800 dark:text-gray-200">{d.name}</span>
              <span className="text-gray-400">{d.employeeId}</span>
              {d.driverType === 'SPARE' && (
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  스페어
                </span>
              )}
              {d.count > 1 && <span className="text-[11px] text-gray-400">×{d.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   AI 충원 상태 배지 — 에이전트 진행 가시화
   ──────────────────────────────────────────────── */

function AgentStatusBadge({
  agentEnabled,
  escalationLevel,
  lastEscalatedAt,
  createdAt,
}: {
  agentEnabled: boolean;
  escalationLevel: number;
  lastEscalatedAt: string | null;
  createdAt: string;
}) {
  const lastTime = lastEscalatedAt ? new Date(lastEscalatedAt).getTime() : new Date(createdAt).getTime();
  const minutesSince = Math.floor((Date.now() - lastTime) / 60000);

  // AI 에이전트 비활성 — 드랍 시점 1회 알림 후 기사 수락 대기 (진행형 AI 표시는 오해 유발)
  if (!agentEnabled) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[14px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
        <span className="w-2 h-2 rounded-full bg-sky-500" />
        알림 발송됨 — 기사 수락 대기 중 ({minutesSince < 1 ? '방금 발송' : `${minutesSince}분 경과`})
      </div>
    );
  }

  // 상태 결정
  let state: 'starting' | 'running' | 'stalled' | 'failed';
  if (!lastEscalatedAt && escalationLevel === 0) {
    state = minutesSince < 1 ? 'starting' : minutesSince < 5 ? 'running' : 'stalled';
  } else if (escalationLevel >= 4 && minutesSince > 15) {
    state = 'failed';
  } else if (minutesSince > 30) {
    state = 'stalled';
  } else {
    state = 'running';
  }

  const config = {
    starting: {
      label: 'AI 충원 시작 중...',
      cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
      dot: 'bg-blue-500 animate-pulse',
    },
    running: {
      label: `AI 진행 중 (${minutesSince < 1 ? '방금' : `${minutesSince}분 전 시도`})`,
      cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
      dot: 'bg-emerald-500 animate-pulse',
    },
    stalled: {
      label: `${minutesSince}분 동안 진행 없음 — 수동 개입 권장`,
      cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
      dot: 'bg-amber-500',
    },
    failed: {
      label: 'AI 충원 실패 — 수동 배정 필요',
      cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
      dot: 'bg-red-500',
    },
  }[state];

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[14px] font-medium ${config.cls}`}>
      <span className={`w-2 h-2 rounded-full ${config.dot}`} />
      {config.label}
    </div>
  );
}

/* ────────────────────────────────────────────────
   기사 직접 지정 모달
   ──────────────────────────────────────────────── */

interface DriverCandidate {
  id: number;
  name: string;
  employeeId: string;
  driverType: 'MAIN' | 'SPARE' | null;
  isActive: boolean;
}

function ManualFillModal({
  drop,
  onClose,
  onSuccess,
}: {
  drop: EmergencyDrop;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // 해당 날짜에 이미 근무가 있는 기사는 서버에서 제외된 가용 기사만 조회
  const { data: drivers = [], isLoading } = useQuery<DriverCandidate[]>({
    queryKey: ['emergency', 'available-drivers', drop.id],
    queryFn: () => emergencyApi.availableDrivers(drop.id).then((r) => r.data.data),
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return drivers
      .filter((d) => d.isActive && d.id !== drop.driver.id)
      .filter((d) =>
        !t || d.name.toLowerCase().includes(t) || d.employeeId.toLowerCase().includes(t),
      )
      .sort((a, b) => {
        // SPARE 먼저, 그 다음 가나다순
        if (a.driverType !== b.driverType) {
          if (a.driverType === 'SPARE') return -1;
          if (b.driverType === 'SPARE') return 1;
        }
        return a.name.localeCompare(b.name, 'ko');
      });
  }, [drivers, drop.driver.id, q]);

  const fill = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('NO_DRIVER');
      return emergencyApi.manualFill(drop.id, selectedId);
    },
    onSuccess: (res) => {
      const msg = (res.data as { message?: string })?.message || '배정 완료';
      toast.success(msg);
      onSuccess();
    },
    onError: (e: unknown) => {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '배정 중 오류가 발생했습니다.';
      toast.error(m);
    },
  });

  const slotDate = parseSlotDate(drop.slot.date);
  const dateStr = `${slotDate.getMonth() + 1}월 ${slotDate.getDate()}일`;
  const shiftLabel = drop.slot.shift === 'MORNING' ? '오전' : drop.slot.shift === 'AFTERNOON' ? '오후' : '종일';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <UserCheck size={22} className="text-emerald-600" />
            <h3 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100">기사 직접 지정</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"><X size={18} /></button>
        </div>

        {/* 슬롯 정보 */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-white/[0.02] border-b border-gray-200 dark:border-white/10">
          <div className="text-[13px] text-gray-500 dark:text-gray-400 mb-1">대상 슬롯</div>
          <div className="text-[15px] text-gray-900 dark:text-gray-100">
            <b>{dateStr} · {shiftLabel}</b> · {drop.slot.route.routeNumber}번 {drop.slot.route.name}
            {drop.slot.bus?.busNumber && <span className="text-gray-500"> / {drop.slot.bus.busNumber}호</span>}
          </div>
          <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
            드랍한 기사: {drop.driver.name}
          </div>
        </div>

        {/* 검색 */}
        <div className="px-6 pt-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름 또는 사번 검색"
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>

        {/* 기사 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-[14px] text-gray-400">
              해당 날짜에 배정 가능한 기사가 없습니다.
              <br />
              (이미 근무 중인 기사는 목록에서 제외됩니다)
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((d) => {
                const isSelected = selectedId === d.id;
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelectedId(d.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition text-left ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 ring-2 ring-emerald-500/20'
                          : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{d.name}</span>
                          <span className="text-[12px] text-gray-500 dark:text-gray-400">{d.employeeId}</span>
                        </div>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        d.driverType === 'SPARE'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                      }`}>
                        {d.driverType === 'SPARE' ? '스페어 (대체 가용)' : '메인'}
                      </span>
                      {isSelected && <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="text-[12px] text-gray-500 dark:text-gray-400">
            {filtered.length}명 가용 {selectedId && '· 선택됨'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-[14px]"
            >
              취소
            </button>
            <button
              onClick={() => fill.mutate()}
              disabled={!selectedId || fill.isPending}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white inline-flex items-center gap-2 text-[14px] font-medium"
            >
              {fill.isPending && <Loader2 size={16} className="animate-spin" />}
              배정 확정
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
