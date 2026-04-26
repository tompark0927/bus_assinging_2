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
  ShieldAlert,
  Flame,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
  Loader2,
  Ticket,
  ArrowRight,
} from 'lucide-react';
import { emergencyApi, schedulesApi, goldenTicketsApi } from '../services/api';
import { format, formatDistanceToNow, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import toast from 'react-hot-toast';

/* ─────────────────────── Types ─────────────────────── */

interface EmergencyDrop {
  id: number;
  reason: string;
  status: 'OPEN' | 'FILLED' | 'CANCELLED';
  escalationLevel: number;
  lastEscalatedAt: string | null;
  createdAt: string;
  filledAt: string | null;
  goldenTicketUsed?: boolean;
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
  route: { routeNumber: string; name: string };
  bus?: { busNumber: string };
  driver?: { id: number; name: string; employeeId: string };
}

interface GoldenTicket {
  id: number;
  status: string;
  issuedAt: string;
  usedAt: string | null;
  driver?: { name: string };
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
  const [dropReason, setDropReason] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  /* ── Queries ── */
  const {
    data: openDrops = [],
    isLoading: openLoading,
    isRefetching: openRefetching,
  } = useQuery<EmergencyDrop[]>({
    queryKey: ['emergency', 'OPEN'],
    queryFn: () => emergencyApi.list({ status: 'OPEN' }).then((r) => r.data.data ?? r.data),
    refetchInterval: 10000,
  });

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
  });

  const { data: goldenTicketsData } = useQuery({
    queryKey: ['goldenTickets'],
    queryFn: () => goldenTicketsApi.list().then((r) => r.data.data ?? r.data),
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
  const todaySlots: ScheduleSlot[] = useMemo(() => {
    if (!scheduleData) return [];
    const slots = scheduleData.data?.slots ?? scheduleData.slots ?? [];
    const todayStr = format(today, 'yyyy-MM-dd');
    return slots.filter((s: ScheduleSlot) => s.date?.startsWith(todayStr) && s.driver);
  }, [scheduleData]);

  const goldenTickets: GoldenTicket[] = useMemo(() => {
    if (!goldenTicketsData) return [];
    return Array.isArray(goldenTicketsData) ? goldenTicketsData : [];
  }, [goldenTicketsData]);

  const goldenTicketSummary = useMemo(() => {
    const total = goldenTickets.length;
    const used = goldenTickets.filter((t) => t.status === 'USED' || t.usedAt).length;
    const active = goldenTickets.filter((t) => t.status === 'ACTIVE' && !t.usedAt).length;
    return { total, used, active };
  }, [goldenTickets]);

  /* ── Handlers ── */
  const handleCancel = (drop: EmergencyDrop) => {
    if (cancelMutation.isPending) return;
    const confirmed = window.confirm(
      `${drop.driver.name} 기사의 긴급 슬롯을 취소하시겠습니까?\n\n노선: ${drop.slot.route.routeNumber}번\n날짜: ${format(new Date(drop.slot.date), 'yyyy년 M월 d일', { locale: ko })}`,
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
  const renderEscalationBadge = (level: number) => {
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">대타 관리</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-[16px]">
            당일 슬롯 드랍 및 대타 배정 현황을 관리합니다.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={openRefetching}
          className="flex items-center gap-2 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors min-h-[48px]"
        >
          <RefreshCw size={18} className={openRefetching ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

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
        <div className="card flex items-center gap-3 py-4">
          <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
            <ShieldAlert size={24} className="text-orange-600" />
          </div>
          <div>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">레벨 3+ 긴급</p>
            <p className="text-2xl font-bold text-orange-600">
              {openDrops.filter(d => d.escalationLevel >= 3).length}건
            </p>
          </div>
        </div>
        <div className="card flex items-center gap-3 py-4">
          <div className="w-12 h-12 rounded-xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center shrink-0">
            <Ticket size={24} className="text-yellow-600" />
          </div>
          <div>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">활성 티켓</p>
            <p className="text-2xl font-bold text-yellow-600">{goldenTicketSummary.active}장</p>
          </div>
        </div>
      </div>

      {/* ─── Section 1: Active Emergency Drops ─── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Siren size={22} className="text-red-500" />
          진행중인 대타 요청
        </h2>

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
              const escalation = ESCALATION_CONFIG[drop.escalationLevel] ?? ESCALATION_CONFIG[0];
              const EscIcon = escalation.icon;
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
                          {format(new Date(drop.slot.date), 'M월 d일 (EEEE)', { locale: ko })}
                        </span>
                        <span className="inline-flex items-center px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[18px] font-bold">
                          {drop.slot.route.routeNumber}번
                        </span>
                      </div>
                      <p className="text-[16px] text-gray-500 dark:text-gray-400">
                        {drop.slot.route.name} / {SHIFT_LABELS[drop.slot.shift] ?? drop.slot.shift}
                      </p>
                    </div>
                    {renderEscalationBadge(drop.escalationLevel)}
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
                      <div className={`flex items-center gap-1.5 ${escalation.color}`}>
                        <EscIcon size={16} />
                        <span className="text-[16px] font-medium">
                          {escalation.description}
                        </span>
                      </div>
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
                      onClick={() => handleCancel(drop)}
                      disabled={cancelMutation.isPending}
                      className="flex items-center gap-1.5 px-5 py-3 bg-red-600 text-white rounded-xl text-[16px] font-bold hover:bg-red-700 transition-colors min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
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
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <AlertTriangle size={22} className="text-orange-500" />
          새 대타 요청
        </h2>

        <div className="card">
          <p className="text-[16px] text-gray-500 dark:text-gray-400 mb-5">
            오늘 배정된 슬롯 중에서 드랍할 슬롯을 선택하고 사유를 입력하세요.
          </p>

          <div className="space-y-4">
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
                {todaySlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.driver?.name} - {slot.route.routeNumber}번 {slot.route.name} ({SHIFT_LABELS[slot.shift] ?? slot.shift})
                  </option>
                ))}
              </select>
              {todaySlots.length === 0 && (
                <p className="text-[14px] text-gray-400 dark:text-gray-500 mt-2">
                  오늘 배정된 슬롯이 없거나 배차표를 불러올 수 없습니다.
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
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Clock size={22} className="text-gray-400" />
          최근 처리 내역
          <span className="text-[14px] font-normal text-gray-400 dark:text-gray-500">
            (최근 7일)
          </span>
        </h2>

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
                    <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      비고
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
                          {format(new Date(drop.slot.date), 'M월 d일', { locale: ko })}
                        </div>
                        <div className="text-[13px] text-gray-400 dark:text-gray-500">
                          {format(new Date(drop.slot.date), 'EEEE', { locale: ko })}
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

                      {/* Golden Ticket */}
                      <td className="px-6 py-4">
                        {drop.goldenTicketUsed && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-semibold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                            <Ticket size={14} />
                            황금 티켓
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
      </section>

      {/* ─── Section 4: Golden Ticket Dashboard ─── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Ticket size={22} className="text-yellow-500" />
          황금 티켓 현황
        </h2>

        <div className="card">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-4 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <p className="text-[14px] font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                총 발급
              </p>
              <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-300">
                {goldenTicketSummary.total}
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <p className="text-[14px] font-medium text-green-600 dark:text-green-400 mb-1">
                사용됨
              </p>
              <p className="text-3xl font-bold text-green-700 dark:text-green-300">
                {goldenTicketSummary.used}
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-[14px] font-medium text-blue-600 dark:text-blue-400 mb-1">
                활성
              </p>
              <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                {goldenTicketSummary.active}
              </p>
            </div>
          </div>

          <a
            href="/dispatch-settings"
            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-[16px] font-medium hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors min-h-[48px] border border-gray-200 dark:border-gray-600"
          >
            배차 설정에서 자세히 보기
            <ArrowRight size={18} />
          </a>
        </div>
      </section>
    </div>
  );
}
