import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bus,
  Sun,
  Sunset,
  Clock,
  AlertTriangle,
  ChevronRight,
  Loader2,
  MapPin,
} from 'lucide-react';
import { schedulesApi, emergencyApi, routesApi } from '../services/api';
import PageHeader from '../components/PageHeader';
import { todayOperationHelp } from '../help/helpContent';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

interface Slot {
  id: number;
  date: string;
  driverId: number;
  routeId: number;
  busId: number | null;
  shift: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
  status: 'SCHEDULED' | 'DROPPED' | 'FILLED' | 'COMPLETED' | 'ABSENT';
  isRestDay: boolean;
  driver?: { id: number; name: string; employeeId: string };
  route?: { id: number; routeNumber: string; name: string };
  bus?: { id: number; busNumber: string };
}

interface Route {
  id: number;
  routeNumber: string;
  name: string;
  isActive: boolean;
}

interface EmergencyDrop {
  id: number;
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  driver?: { name: string };
  filler?: { name: string } | null;
  // 백엔드는 날짜를 slot 안에 중첩해서 반환
  slot?: { date?: string; shift?: string };
}

/* ────────────────────────────────────────────
   Page
   ──────────────────────────────────────────── */

export default function TodayOperationPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const friendlyDate = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const { data: schedule, isLoading: schedLoading } = useQuery<{ slots: Slot[]; status: string } | null>({
    queryKey: ['schedule', 'today-operation', year, month],
    // 운행 현황은 발행된 배차표만 대상 — 초안 프로필 데이터가 노출되면 안 됨
    queryFn: () =>
      schedulesApi.get(year, month)
        .then((r) => {
          const s = r.data.data as { slots: Slot[]; status: string } | null;
          return s && s.status === 'PUBLISHED' ? s : null;
        })
        .catch(() => null),
  });

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data).catch(() => []),
  });

  const { data: emergencies = [] } = useQuery<EmergencyDrop[]>({
    queryKey: ['emergency', 'today', todayStr],
    queryFn: () => emergencyApi.list().then((r) => r.data.data).catch(() => []),
  });

  const todaySlots = useMemo(() => {
    if (!schedule?.slots) return [];
    return schedule.slots.filter((s) => s.date.startsWith(todayStr) && !s.isRestDay);
  }, [schedule, todayStr]);

  const todayEmergencies = useMemo(
    () => emergencies.filter((e) => (e.slot?.date ?? '').startsWith(todayStr)),
    [emergencies, todayStr],
  );

  const stats = useMemo(() => {
    const total = todaySlots.length;
    const dropped = todaySlots.filter((s) => s.status === 'DROPPED').length;
    const absent = todaySlots.filter((s) => s.status === 'ABSENT').length;
    const filled = todaySlots.filter((s) => s.status === 'FILLED').length;
    const ok = todaySlots.filter((s) => s.status === 'SCHEDULED' || s.status === 'COMPLETED').length;
    return { total, dropped, absent, filled, ok };
  }, [todaySlots]);

  const byRoute = useMemo(() => {
    const groups = new Map<number, { route: Route | undefined; slots: Slot[] }>();
    for (const s of todaySlots) {
      const r = routes.find((rt) => rt.id === s.routeId);
      if (!groups.has(s.routeId)) groups.set(s.routeId, { route: r, slots: [] });
      groups.get(s.routeId)!.slots.push(s);
    }
    return [...groups.values()].sort((a, b) =>
      (a.route?.routeNumber || '').localeCompare(b.route?.routeNumber || '', 'ko', { numeric: true }),
    );
  }, [todaySlots, routes]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader icon={Bus} title="오늘 운행 현황" description={friendlyDate} help={todayOperationHelp} />

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="전체 슬롯" value={stats.total} />
        <SummaryCard label="정상" value={stats.ok} />
        <SummaryCard label="대타 채움" value={stats.filled} />
        <SummaryCard label="드랍 대기" value={stats.dropped} />
        <SummaryCard label="결근" value={stats.absent} />
      </div>

      {/* 진행 중 대타 알림 */}
      {todayEmergencies.filter((e) => e.status === 'OPEN').length > 0 && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-red-700 dark:text-red-300">
              충원 필요 대타 {todayEmergencies.filter((e) => e.status === 'OPEN').length}건
            </div>
            <p className="text-[14px] text-red-600 dark:text-red-400 mt-0.5">
              지금 처리하지 않으면 운행 결행 가능성이 있습니다.
            </p>
          </div>
          <Link
            to="/dashboard/emergency"
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[14px] font-medium inline-flex items-center gap-1"
          >
            관리하기 <ChevronRight size={14} />
          </Link>
        </div>
      )}

      {/* 노선별 운행 */}
      {schedLoading ? (
        <Loading />
      ) : !schedule ? (
        <EmptyState
          icon={<Bus className="w-12 h-12 text-gray-300" />}
          title="이번 달 배차표가 아직 없습니다"
          desc="배차표를 먼저 생성해주세요."
          ctaTo="/dashboard/schedule"
          ctaLabel="배차표 만들러 가기"
        />
      ) : todaySlots.length === 0 ? (
        <EmptyState
          icon={<Sun className="w-12 h-12 text-amber-300" />}
          title="오늘은 운행 슬롯이 없습니다"
          desc="공휴일이거나 모든 기사가 휴무일 수 있어요."
        />
      ) : (
        <div className="space-y-4">
          {byRoute.map(({ route, slots }) => (
            <RouteSection key={route?.id ?? 0} route={route} slots={slots} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────── */

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-4">
      <div className="text-[13px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-[28px] font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</div>
    </div>
  );
}

function RouteSection({ route, slots }: { route: Route | undefined; slots: Slot[] }) {
  const morning = slots.filter((s) => s.shift === 'MORNING');
  const afternoon = slots.filter((s) => s.shift === 'AFTERNOON');
  const fullDay = slots.filter((s) => s.shift === 'FULL_DAY');

  return (
    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 dark:bg-white/[0.02] border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-blue-500" />
        <span className="font-semibold text-gray-900 dark:text-gray-100">{route?.routeNumber || '?'}번</span>
        <span className="text-gray-500 text-[15px]">{route?.name}</span>
        <span className="ml-auto text-[13px] text-gray-500">
          {slots.length}슬롯 운행 중
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100 dark:divide-white/10">
        {fullDay.length > 0 && (
          <ShiftBlock title="종일" icon={<Clock className="w-4 h-4 text-blue-500" />} slots={fullDay} />
        )}
        {(morning.length > 0 || fullDay.length === 0) && (
          <ShiftBlock title="오전" icon={<Sun className="w-4 h-4 text-amber-500" />} slots={morning} />
        )}
        {(afternoon.length > 0 || fullDay.length === 0) && (
          <ShiftBlock title="오후" icon={<Sunset className="w-4 h-4 text-orange-500" />} slots={afternoon} />
        )}
      </div>
    </section>
  );
}

function ShiftBlock({ title, icon, slots }: { title: string; icon: React.ReactNode; slots: Slot[] }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-1.5 mb-3 text-[14px] font-medium text-gray-700 dark:text-gray-200">
        {icon}{title}
        <span className="text-gray-400 ml-auto">{slots.length}대</span>
      </div>
      {slots.length === 0 ? (
        <div className="text-[13px] text-gray-400 py-2">운행 없음</div>
      ) : (
        <ul className="space-y-1.5">
          {slots.map((s) => (
            <SlotRow key={s.id} slot={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SlotRow({ slot }: { slot: Slot }) {
  const statusBadge = (() => {
    switch (slot.status) {
      case 'COMPLETED':
        return <Badge color="gray">완료</Badge>;
      case 'DROPPED':
        return <Badge color="amber">드랍</Badge>;
      case 'FILLED':
        return <Badge color="emerald">대타</Badge>;
      case 'ABSENT':
        return <Badge color="red">결근</Badge>;
      default:
        return <Badge color="blue">정상</Badge>;
    }
  })();

  return (
    <li className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.02] text-[14px]">
      <span className="font-mono text-[13px] text-gray-500 w-12 truncate">{slot.bus?.busNumber || '-'}</span>
      <span className="font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
        {slot.driver?.name || '-'}
      </span>
      {statusBadge}
    </li>
  );
}

function Badge({ color, children }: { color: 'blue' | 'green' | 'emerald' | 'amber' | 'red' | 'gray'; children: React.ReactNode }) {
  const cls = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  }[color];
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${cls}`}>{children}</span>;
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
    </div>
  );
}

function EmptyState({ icon, title, desc, ctaTo, ctaLabel }: { icon: React.ReactNode; title: string; desc: string; ctaTo?: string; ctaLabel?: string }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-12 flex flex-col items-center text-center">
      <div className="mb-4">{icon}</div>
      <h3 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{desc}</p>
      {ctaTo && ctaLabel && (
        <Link to={ctaTo} className="mt-5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[15px] font-medium inline-flex items-center gap-1">
          {ctaLabel}<ChevronRight size={16} />
        </Link>
      )}
    </div>
  );
}
