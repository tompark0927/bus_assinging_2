import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock4, BarChart3, Loader2, Info } from 'lucide-react';
import { emergencyApi, schedulesApi } from '../services/api';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

interface EmergencyDrop {
  id: number;
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
  filledAt?: string | null;
  routeId?: number;
  driverId?: number;
}

interface Slot {
  id: number;
  date: string;
  isRestDay: boolean;
  status: 'SCHEDULED' | 'DROPPED' | 'FILLED' | string;
  driverId: number;
  routeId?: number;
  driver?: { id: number; name: string };
  route?: { id: number; routeNumber: string };
}

interface Schedule {
  id: number;
  year: number;
  month: number;
  status: string;
  slots?: Slot[];
}

/* ------------------------------------------------------------------ */
/* Section                                                            */
/* ------------------------------------------------------------------ */

export default function DashboardKPI() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: schedule, isLoading: loadingSched } = useQuery<Schedule | null>({
    queryKey: ['schedule', year, month],
    queryFn: () => schedulesApi.get(year, month).then((r) => r.data.data).catch(() => null),
  });

  const { data: filledDrops = [], isLoading: loadingFilled } = useQuery<EmergencyDrop[]>({
    queryKey: ['emergency', 'filled-30d'],
    queryFn: () => emergencyApi.list({ status: 'FILLED' }).then((r) => r.data.data ?? r.data ?? []),
  });

  /* ─── 1. 결원율 ─── */
  const dropoutKpi = useMemo(() => {
    if (!schedule?.slots || schedule.slots.length === 0) return null;
    const work = schedule.slots.filter((s) => !s.isRestDay);
    const total = work.length;
    const dropped = work.filter((s) => s.status === 'DROPPED').length;
    const filled = work.filter((s) => s.status === 'FILLED').length;
    const incidentRate = total === 0 ? 0 : (dropped + filled) / total;
    return { total, dropped, filled, incidentRate };
  }, [schedule]);

  /* ─── 2. 평균 결원 대응 시간 (분 단위) ─── */
  const responseKpi = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const recent = filledDrops.filter(
      (d) => d.status === 'FILLED' && d.filledAt && new Date(d.createdAt).getTime() >= cutoff,
    );
    if (recent.length === 0) return null;

    const durations = recent
      .map((d) => new Date(d.filledAt!).getTime() - new Date(d.createdAt).getTime())
      .filter((ms) => ms > 0);

    if (durations.length === 0) return null;

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length / 60000;
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] / 60000;
    const fastest = Math.min(...durations) / 60000;

    return { count: recent.length, avgMin: avg, medianMin: median, fastestMin: fastest };
  }, [filledDrops]);

  const isLoading = loadingSched || loadingFilled;

  return (
    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-purple-500" />
          이번 달 운영 KPI
        </h2>
        <span className="text-[12px] text-gray-400">
          {year}.{String(month).padStart(2, '0')} 기준 · 자동 갱신
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-gray-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> 지표 계산 중…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard
            icon={<Activity className="w-4 h-4 text-red-500" />}
            label="결원율"
            help="이번 달 근무 슬롯 중 한 번이라도 결원이 발생한 비율 (DROPPED 또는 FILLED)"
          >
            {dropoutKpi ? (
              <>
                <div className="text-[28px] font-bold text-gray-900 dark:text-gray-100">
                  {(dropoutKpi.incidentRate * 100).toFixed(1)}
                  <span className="text-[15px] font-normal text-gray-400 ml-1">%</span>
                </div>
                <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>총 근무 {dropoutKpi.total.toLocaleString()}슬롯</span>
                  <span className="text-amber-600 dark:text-amber-400">미해결 {dropoutKpi.dropped}건</span>
                  <span className="text-emerald-600 dark:text-emerald-400">채움 {dropoutKpi.filled}건</span>
                </div>
              </>
            ) : (
              <Empty>이번 달 데이터가 없습니다</Empty>
            )}
          </KpiCard>

          <KpiCard
            icon={<Clock4 className="w-4 h-4 text-blue-500" />}
            label="평균 결원 대응 시간"
            help="최근 30일간 FILLED 처리된 대타의 요청 → 수락까지 평균 소요 시간"
          >
            {responseKpi ? (
              <>
                <div className="text-[28px] font-bold text-gray-900 dark:text-gray-100">
                  {formatMin(responseKpi.avgMin)}
                </div>
                <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>샘플 {responseKpi.count}건</span>
                  <span>중앙값 {formatMin(responseKpi.medianMin)}</span>
                  <span>최단 {formatMin(responseKpi.fastestMin)}</span>
                </div>
              </>
            ) : (
              <Empty>최근 30일 데이터 없음</Empty>
            )}
          </KpiCard>

        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

function KpiCard({
  icon,
  label,
  help,
  wide,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  help?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`p-4 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/5 ${wide ? 'md:col-span-1' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-[13px] text-gray-600 dark:text-gray-300 mb-2">
        {icon}
        <span className="font-medium">{label}</span>
        {help && (
          <span title={help} className="ml-auto text-gray-300 dark:text-white/20">
            <Info size={13} />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] text-gray-400 dark:text-gray-500 py-1">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Format                                                             */
/* ------------------------------------------------------------------ */

function formatMin(m: number): string {
  if (m < 1) return '< 1분';
  if (m < 60) return `${Math.round(m)}분`;
  const hr = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return min === 0 ? `${hr}시간` : `${hr}시간 ${min}분`;
}
