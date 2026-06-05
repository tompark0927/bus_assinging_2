import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Calendar,
  AlertTriangle,
  Users,
  Bus,
  ChevronRight,
  CalendarOff,
  Activity,
  Loader2,
  ShieldAlert,
  Clock,
  LayoutDashboard,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  schedulesApi,
  dayOffApi,
  emergencyApi,
  usersApi,
  busesApi,
  routesApi,
} from '../services/api';
import DashboardKPI from '../components/DashboardKPI';
import { parseSlotDate } from '../utils/date';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

interface Slot {
  id: number;
  date: string;
  isRestDay: boolean;
  shift: string;
  status: string;
  driverId: number;
  driver?: { id: number; name: string };
}

interface Schedule {
  id: number;
  year: number;
  month: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt?: string | null;
  createdAt?: string;
  slots?: Slot[];
}

interface DayOffRequest {
  id: number;
  driverId: number;
  date: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason?: string;
  createdAt?: string;
  driver?: { name: string };
}

interface EmergencyDrop {
  id: number;
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  driver?: { name: string };
  // 백엔드는 날짜·노선·버스를 slot 안에 중첩해서 반환
  slot?: {
    date?: string;
    shift?: string;
    route?: { routeNumber: string };
    bus?: { busNumber: string };
  };
}

interface Driver {
  id: number;
  name: string;
  isActive: boolean;
  driverType?: 'MAIN' | 'SPARE' | null;
  licenseExpiresAt?: string | null;
  qualificationExpiresAt?: string | null;
}

/* ────────────────────────────────────────────
   Page
   ──────────────────────────────────────────── */

export default function DashboardPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const todayKey = `${year}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  // 다음 달
  const nextDate = new Date(year, month, 1);
  const nextYear = nextDate.getFullYear();
  const nextMonth = nextDate.getMonth() + 1;

  // 이번 달 마지막 날까지 D-N
  const monthEndDate = new Date(year, month, 0);
  const daysToMonthEnd = Math.ceil((monthEndDate.getTime() - now.getTime()) / 86400000);

  /* ── 데이터 조회 ────────────────────────────────── */

  const { data: schedule, isLoading: schedLoading } = useQuery<Schedule | null>({
    queryKey: ['schedule', year, month],
    queryFn: () => schedulesApi.get(year, month).then((r) => r.data.data).catch(() => null),
  });

  const { data: nextSchedule } = useQuery<Schedule | null>({
    queryKey: ['schedule', nextYear, nextMonth],
    queryFn: () => schedulesApi.get(nextYear, nextMonth).then((r) => r.data.data).catch(() => null),
  });

  const { data: pendingDayOffs = [] } = useQuery<DayOffRequest[]>({
    queryKey: ['dayoff', 'pending'],
    queryFn: () => dayOffApi.list({ status: 'PENDING' }).then((r) => r.data.data).catch(() => []),
  });

  const { data: approvedDayOffs = [] } = useQuery<DayOffRequest[]>({
    queryKey: ['dayoff', 'approved'],
    queryFn: () => dayOffApi.list({ status: 'APPROVED' }).then((r) => r.data.data).catch(() => []),
  });

  const { data: openEmergencies = [] } = useQuery<EmergencyDrop[]>({
    queryKey: ['emergency', 'open'],
    queryFn: () => emergencyApi.list({ status: 'OPEN' }).then((r) => r.data.data).catch(() => []),
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ['users', 'DRIVER'],
    queryFn: () => usersApi.list({ role: 'DRIVER' }).then((r) => r.data.data).catch(() => []),
  });
  const { data: buses = [] } = useQuery<Array<{ id: number; isActive: boolean }>>({
    queryKey: ['buses'],
    queryFn: () => busesApi.list().then((r) => r.data.data).catch(() => []),
  });
  const { data: routes = [] } = useQuery<Array<{ id: number; isActive: boolean }>>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data).catch(() => []),
  });

  /* ── 파생 데이터 ──────────────────────────────── */

  const counts = useMemo(() => ({
    drivers: drivers.filter((d) => d.isActive).length,
    main: drivers.filter((d) => d.isActive && d.driverType === 'MAIN').length,
    spare: drivers.filter((d) => d.isActive && d.driverType === 'SPARE').length,
    buses: buses.filter((b) => b.isActive).length,
    routes: routes.filter((r) => r.isActive).length,
  }), [drivers, buses, routes]);

  // 면허/자격 만료 D-30 이내
  const expiringDrivers = useMemo(() => {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    return drivers
      .filter((d) => d.isActive)
      .map((d) => {
        const lic = d.licenseExpiresAt ? new Date(d.licenseExpiresAt) : null;
        const qual = d.qualificationExpiresAt ? new Date(d.qualificationExpiresAt) : null;
        const earliest = [lic, qual].filter((x): x is Date => x !== null).sort((a, b) => a.getTime() - b.getTime())[0];
        if (!earliest || earliest > horizon || earliest < now) return null;
        const days = Math.ceil((earliest.getTime() - now.getTime()) / 86400000);
        const kind = lic && earliest.getTime() === lic.getTime() ? '면허' : '자격증';
        return { driver: d, days, kind, date: earliest };
      })
      .filter((x): x is { driver: Driver; days: number; kind: string; date: Date } => x !== null)
      .sort((a, b) => a.days - b.days);
  }, [drivers]);

  // 오늘의 OPEN 대타 (출발 임박)
  const todayOpenEmergencies = useMemo(
    () => openEmergencies.filter((e) => (e.slot?.date ?? '').startsWith(todayKey)),
    [openEmergencies, todayKey],
  );

  // 다가오는 승인 휴무 (오늘 ~ +7일)
  const upcomingDayOffs = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const horizon = new Date(now); horizon.setDate(horizon.getDate() + 7);
    const filtered = approvedDayOffs.filter((d) => {
      const dt = parseSlotDate(d.date);
      return dt >= now && dt < horizon;
    }).sort((a, b) => a.date.localeCompare(b.date));
    // 날짜별 그룹
    const map = new Map<string, DayOffRequest[]>();
    for (const d of filtered) {
      const k = d.date.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return [...map.entries()].slice(0, 4);
  }, [approvedDayOffs]);

// 다음 달 미생성 + 월말 D-7 이내 → 경고
  const showNextMonthWarning = !nextSchedule && daysToMonthEnd <= 7 && daysToMonthEnd >= 0;

  // 휴무 신청 SLA — 가장 오래된 PENDING이 며칠 됐는지
  const oldestPendingDays = useMemo(() => {
    if (pendingDayOffs.length === 0) return 0;
    const ages = pendingDayOffs
      .map((d) => d.createdAt ? Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000) : 0)
      .sort((a, b) => b - a);
    return ages[0] ?? 0;
  }, [pendingDayOffs]);

  /* ── 렌더 ────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader icon={LayoutDashboard} title="대시보드" description={todayStr} />

      {/* 1. 즉시 처리 필요 — 빨간 영역 */}
      {(todayOpenEmergencies.length > 0 || expiringDrivers.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {todayOpenEmergencies.length > 0 && (
            <UrgentCard
              icon={<AlertTriangle className="w-6 h-6" />}
              tone="red"
              title={`오늘 충원 못한 대타 ${todayOpenEmergencies.length}건`}
              desc="출발 시간 전에 채워주지 않으면 결행 위험이 있습니다."
              to="/dashboard/emergency"
              ctaLabel="지금 처리"
            />
          )}
          {expiringDrivers.length > 0 && (
            <UrgentCard
              icon={<ShieldAlert className="w-6 h-6" />}
              tone="amber"
              title={`면허·자격 만료 임박 ${expiringDrivers.length}명`}
              desc={`가장 가까운 만료: ${expiringDrivers[0].driver.name} (${expiringDrivers[0].kind} D-${expiringDrivers[0].days})`}
              to="/dashboard/data"
              ctaLabel="기사 확인"
            />
          )}
        </div>
      )}

      {/* 2. 이번 달 배차표 — 큰 카드 */}
      <SectionCard
        icon={<Calendar className="w-5 h-5 text-blue-500" />}
        title={`${year}년 ${month}월 배차표`}
        right={<ScheduleStatusBadge schedule={schedule} loading={schedLoading} />}
        to="/dashboard/schedule"
        ctaLabel={schedule ? '배차표 열기' : '생성하기'}
      >
        {schedLoading ? (
          <Loading />
        ) : !schedule ? (
          <div className="text-[15px] text-gray-500 dark:text-gray-400">
            아직 이번 달 배차표가 생성되지 않았습니다. 지금 만들어보세요.
          </div>
        ) : (
          <ScheduleSummary schedule={schedule} totalDrivers={counts.drivers} />
        )}
      </SectionCard>

      {/* 3. 다음 달 준비 경고 */}
      {showNextMonthWarning && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-amber-800 dark:text-amber-200">
              {nextYear}년 {nextMonth}월 배차표 미생성 (이번 달 마감 D-{daysToMonthEnd})
            </div>
            <p className="text-[14px] text-amber-700 dark:text-amber-300 mt-0.5">
              다음 달 시작 전까지 배차표를 만들어 발행해야 기사들이 일정을 확인할 수 있습니다.
            </p>
          </div>
          <Link
            to="/dashboard/schedule"
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[14px] font-medium inline-flex items-center gap-1 shrink-0"
          >
            지금 만들기 <ChevronRight size={14} />
          </Link>
        </div>
      )}

      {/* 4. 운영 큐 — 2-column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          icon={<CalendarOff className="w-5 h-5 text-amber-500" />}
          title="휴무 신청 검토"
          right={
            <div className="flex items-center gap-2">
              {oldestPendingDays >= 2 && (
                <span className="text-[12px] font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full">
                  {oldestPendingDays}일 대기
                </span>
              )}
              <Badge color={pendingDayOffs.length > 0 ? 'amber' : 'gray'}>{pendingDayOffs.length}건</Badge>
            </div>
          }
          to="/dashboard/dayoff"
          ctaLabel="검토하기"
        >
          {pendingDayOffs.length === 0 ? (
            <Empty>대기 중인 휴무 신청이 없습니다</Empty>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/10">
              {pendingDayOffs.slice(0, 5).map((d) => {
                const ageDays = d.createdAt
                  ? Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000)
                  : 0;
                return (
                  <li key={d.id} className="py-2.5 text-[15px] flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{d.driver?.name || `#${d.driverId}`}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500 dark:text-gray-400">{d.date.slice(0, 10)}</span>
                    {ageDays >= 1 && (
                      <span className={`ml-auto text-[12px] px-1.5 py-0.5 rounded-full ${
                        ageDays >= 3 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                      }`}>
                        D+{ageDays}
                      </span>
                    )}
                  </li>
                );
              })}
              {pendingDayOffs.length > 5 && (
                <li className="py-2 text-[13px] text-gray-400">외 {pendingDayOffs.length - 5}건</li>
              )}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          title="진행 중인 대타"
          right={<Badge color={openEmergencies.length > 0 ? 'red' : 'gray'}>{openEmergencies.length}건</Badge>}
          to="/dashboard/emergency"
          ctaLabel="관리하기"
        >
          {openEmergencies.length === 0 ? (
            <Empty>진행 중인 대타 요청이 없습니다</Empty>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/10">
              {openEmergencies.slice(0, 5).map((e) => {
                const dateStr = e.slot?.date ?? '';
                const isToday = dateStr.startsWith(todayKey);
                return (
                  <li key={e.id} className="py-2.5 text-[15px] flex items-center gap-2">
                    {isToday && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                    <span className="font-medium text-gray-900 dark:text-gray-100">{e.driver?.name || '-'}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500 dark:text-gray-400">{dateStr.slice(0, 10) || '-'}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">{e.slot?.route?.routeNumber}번</span>
                    {e.slot?.bus?.busNumber && <span className="text-gray-400">/ {e.slot.bus.busNumber}호</span>}
                  </li>
                );
              })}
              {openEmergencies.length > 5 && (
                <li className="py-2 text-[13px] text-gray-400">외 {openEmergencies.length - 5}건</li>
              )}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* 5. 다가오는 휴무 (1주일 내) */}
      {upcomingDayOffs.length > 0 && (
        <SectionCard
          icon={<CalendarOff className="w-5 h-5 text-blue-500" />}
          title="다가오는 승인 휴무 (D-7)"
          right={<Badge color="blue">{upcomingDayOffs.reduce((sum, [, list]) => sum + list.length, 0)}건</Badge>}
          to="/dashboard/dayoff"
          ctaLabel="전체 보기"
        >
          <div className="space-y-2">
            {upcomingDayOffs.map(([date, list]) => {
              const d = new Date(date);
              const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={date} className="flex items-start gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-white/[0.02]">
                  <div className={`shrink-0 text-center w-12 ${isWeekend ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>
                    <div className="text-[20px] font-bold leading-none">{d.getDate()}</div>
                    <div className="text-[11px] mt-0.5">{dayOfWeek}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((req) => (
                        <span key={req.id} className="text-[13px] bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 px-2 py-0.5 rounded-full text-gray-700 dark:text-gray-200">
                          {req.driver?.name || `#${req.driverId}`}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* 6. 운영 KPI */}
      <DashboardKPI />

      {/* 7. 운영 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CountCard
          icon={<Users className="w-5 h-5 text-blue-500" />}
          label="활성 기사"
          value={counts.drivers}
          unit="명"
          sub={`메인 ${counts.main} · 스페어 ${counts.spare}`}
          to="/dashboard/data"
        />
        <CountCard
          icon={<Bus className="w-5 h-5 text-emerald-500" />}
          label="운행 버스"
          value={counts.buses}
          unit="대"
          sub={`노선 ${counts.routes}개`}
          to="/dashboard/data"
        />
      </div>

      {/* 7. 빠른 진입 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickLink to="/dashboard/schedule" icon={<Calendar size={18} />} label="배차표 관리" />
        <QuickLink to="/dashboard/emergency" icon={<AlertTriangle size={18} />} label="대타 관리" />
        <QuickLink to="/dashboard/dayoff" icon={<CalendarOff size={18} />} label="휴무 요청" />
        <QuickLink to="/dashboard/today" icon={<Bus size={18} />} label="오늘 운행" />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────── */

function UrgentCard({ icon, tone, title, desc, to, ctaLabel }: {
  icon: React.ReactNode;
  tone: 'red' | 'amber';
  title: string;
  desc: string;
  to: string;
  ctaLabel: string;
}) {
  const cls = tone === 'red'
    ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300'
    : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300';
  const btnCls = tone === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700';
  return (
    <div className={`border rounded-2xl p-4 flex items-start gap-3 ${cls}`}>
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[16px] font-semibold">{title}</div>
        <p className="text-[14px] opacity-90 mt-0.5">{desc}</p>
      </div>
      <Link
        to={to}
        className={`px-3 py-1.5 rounded-lg ${btnCls} text-white text-[14px] font-medium inline-flex items-center gap-1 shrink-0`}
      >
        {ctaLabel} <ChevronRight size={14} />
      </Link>
    </div>
  );
}

function ScheduleStatusBadge({ schedule, loading }: { schedule: Schedule | null | undefined; loading: boolean }) {
  if (loading) return null;
  if (!schedule) return <Badge color="gray">미생성</Badge>;
  if (schedule.status === 'DRAFT') return <Badge color="amber">초안</Badge>;
  if (schedule.status === 'PUBLISHED') return <Badge color="green">발행됨</Badge>;
  return <Badge color="gray">{schedule.status}</Badge>;
}

function ScheduleSummary({ schedule, totalDrivers }: { schedule: Schedule; totalDrivers: number }) {
  const slotCount = schedule.slots?.length ?? 0;
  const work = schedule.slots?.filter((s) => !s.isRestDay).length ?? 0;
  const dropped = schedule.slots?.filter((s) => s.status === 'DROPPED').length ?? 0;
  const filled = schedule.slots?.filter((s) => s.status === 'FILLED').length ?? 0;
  const meta = schedule.publishedAt
    ? `${new Date(schedule.publishedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 발행`
    : schedule.createdAt
    ? `${new Date(schedule.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 생성`
    : '';

  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
        <Stat label="전체 슬롯" value={slotCount.toLocaleString()} />
        <Stat label="근무 슬롯" value={work.toLocaleString()} />
        <Stat label="포함 기사" value={`${totalDrivers}명`} />
        {dropped > 0 && <Stat label="드랍" value={`${dropped}건`} color="amber" />}
        {filled > 0 && <Stat label="대타 채움" value={`${filled}건`} color="emerald" />}
      </div>
      {meta && <div className="text-[13px] text-gray-400 dark:text-gray-500 mt-3">{meta}</div>}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: 'amber' | 'emerald' }) {
  const valCls = color === 'amber'
    ? 'text-amber-700 dark:text-amber-300'
    : color === 'emerald'
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-gray-900 dark:text-gray-100';
  return (
    <div>
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`ml-1.5 font-bold ${valCls}`}>{value}</span>
    </div>
  );
}

function CountCard({ icon, label, value, unit, sub, to }: { icon: React.ReactNode; label: string; value: number; unit: string; sub?: string; to: string }) {
  return (
    <Link
      to={to}
      className="block bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-5 hover:border-blue-300 dark:hover:border-blue-500/40 transition"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[14px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
          {icon}{label}
        </span>
        <ChevronRight size={16} className="text-gray-300" />
      </div>
      <div className="text-[32px] font-bold text-gray-900 dark:text-gray-100">
        {value}<span className="text-[15px] font-normal text-gray-400 ml-1">{unit}</span>
      </div>
      {sub && <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{sub}</div>}
    </Link>
  );
}

function SectionCard({ icon, title, right, to, ctaLabel, children }: { icon: React.ReactNode; title: string; right?: React.ReactNode; to?: string; ctaLabel?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
          {icon}{title}
        </h2>
        <div className="flex items-center gap-2">
          {right}
          {to && (
            <Link to={to} className="text-[14px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5">
              {ctaLabel}<ChevronRight size={14} />
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function QuickLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 px-4 py-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl hover:border-blue-400 dark:hover:border-blue-500/50 hover:bg-blue-50 dark:hover:bg-blue-500/5 transition text-[15px] text-gray-700 dark:text-gray-200"
    >
      {icon}<span>{label}</span>
    </Link>
  );
}

function Badge({ color, children }: { color: 'green' | 'amber' | 'red' | 'blue' | 'gray'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  }[color];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${cls}`}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-4 text-[14px] text-gray-400 dark:text-gray-500">{children}</div>;
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-gray-400 text-[14px]">
      <Loader2 size={14} className="animate-spin" />로딩 중…
    </div>
  );
}

// 미사용 import 방지
const _act = Activity;
void _act;
