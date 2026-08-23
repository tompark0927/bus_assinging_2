import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, X } from 'lucide-react';
import { schedulesApi } from '../services/api';

/**
 * 인력 계산 — "이 배차를 돌리려면 몇 명이 필요한가".
 *
 * 노선별 요일 운행 대수에서 나온 한 달 필요 칸수를, 근무 사이클별 가동률로
 * 나눠 필요 인원을 낸다. 격일제에서 1일 2교대로 넘어가는 회사가 제일 먼저
 * 묻는 숫자다 — "2교대 가면 몇 명 더 뽑아야 하나".
 */

interface CyclePlan {
  workDays: number;
  restDays: number;
  label: string;
  dutyRatio: number;
  monthlyWorkDays: number;
  requiredDrivers: number;
  gap: number;
  exceedsPolicyMax: boolean;
  isBestFit: boolean;
}

interface ManpowerPlan {
  year: number;
  month: number;
  daysInMonth: number;
  totalCells: number;
  unconfigured: boolean;
  currentDrivers: number;
  mainDrivers: number;
  spareDrivers: number;
  perDriverDays: number;
  currentDutyRatio: number;
  routes: { routeNumber: string; registered: number; weekday: number; saturday: number; holiday: number }[];
  cycles: CyclePlan[];
  policyBand: { hardMin: number; hardMax: number; sweetMin: number; sweetMax: number };
}

interface Props {
  year: number;
  month: number;
  onClose: () => void;
}

export default function ManpowerModal({ year, month, onClose }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['manpower', year, month],
    queryFn: async () => {
      const res = await schedulesApi.manpower(year, month);
      return res.data.data as ManpowerPlan;
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="인력 계산"
    >
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-800 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
            <Users size={22} />
            인력 계산 · {year}년 {month}월
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
              <Loader2 size={20} className="animate-spin" />
              계산 중...
            </div>
          )}
          {error && (
            <p className="py-12 text-center text-red-600 dark:text-red-400">
              인력 계산에 실패했습니다. 잠시 후 다시 시도해주세요.
            </p>
          )}

          {data && (
            <>
              {data.unconfigured && (
                <p className="mb-5 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                  노선별 요일 운행 대수가 설정되지 않아 <b>전 차량이 매일 운행</b>하는 것으로 계산했습니다.
                  기초 데이터 &gt; 노선에서 평일·토요일·휴일 대수를 입력하면 정확해집니다.
                </p>
              )}

              {/* ─── 지금 상태 ─── */}
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="한 달 필요 칸수" value={`${data.totalCells.toLocaleString()}칸`} hint="운행 대수 × 2교대 × 날짜" />
                <Stat label="현재 기사" value={`${data.currentDrivers}명`} hint={`메인 ${data.mainDrivers} · 스페어 ${data.spareDrivers}`} />
                <Stat label="1인당 근무일" value={`${data.perDriverDays}일`} hint={`${data.daysInMonth}일 중`} />
                <Stat label="가동률" value={`${Math.round(data.currentDutyRatio * 100)}%`} hint="근무일 ÷ 달력일" />
              </div>

              {/* ─── 사이클별 필요 인원 ─── */}
              <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                근무 형태별 필요 인원
              </h4>
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">근무 형태</th>
                      <th className="px-4 py-2.5 text-right font-medium">1인 월 근무일</th>
                      <th className="px-4 py-2.5 text-right font-medium">필요 인원</th>
                      <th className="px-4 py-2.5 text-right font-medium">현재 인력 대비</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.cycles.map((c) => (
                      <tr
                        key={c.label}
                        className={
                          c.exceedsPolicyMax
                            ? 'text-gray-400 dark:text-gray-500'
                            : c.isBestFit
                              ? 'bg-blue-50 dark:bg-blue-900/20 font-medium'
                              : ''
                        }
                      >
                        <td className="px-4 py-2.5">
                          {c.label}
                          {c.isBestFit && (
                            <span className="ml-2 rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                              현재 인력에 적합
                            </span>
                          )}
                          {c.exceedsPolicyMax && (
                            <span className="ml-2 text-[11px]">월 {data.policyBand.hardMax}일 상한 초과</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.monthlyWorkDays}일</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.requiredDrivers}명</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {c.exceedsPolicyMax ? (
                            '—'
                          ) : c.gap >= 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400">{c.gap}명 여유</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">{-c.gap}명 부족</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                필요 인원 = 한 달 필요 칸수 ÷ (가동률 × {data.daysInMonth}일). 가동률은 근무일 ÷ (근무일 + 휴무일)입니다.
                회사 정책상 월 근무일은 {data.policyBand.hardMin}~{data.policyBand.hardMax}일이며, 그 범위를 넘는 형태는 쓸 수 없습니다.
              </p>

              {/* ─── 노선별 운행 대수 ─── */}
              {data.routes.length > 0 && (
                <>
                  <h4 className="mb-2 mt-6 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    노선별 운행 대수 (계산 근거)
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-400">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium">노선</th>
                          <th className="px-4 py-2.5 text-right font-medium">등록</th>
                          <th className="px-4 py-2.5 text-right font-medium">평일</th>
                          <th className="px-4 py-2.5 text-right font-medium">토요일</th>
                          <th className="px-4 py-2.5 text-right font-medium">휴일</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {data.routes.map((r) => (
                          <tr key={r.routeNumber}>
                            <td className="px-4 py-2.5">{r.routeNumber}번</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{r.registered}대</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{r.weekday}대</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{r.saturday}대</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{r.holiday}대</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  );
}
