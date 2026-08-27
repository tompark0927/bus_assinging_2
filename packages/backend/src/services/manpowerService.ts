import { prisma } from '../utils/prisma';
import { driverScopeFor } from '../utils/serviceType';
import type { ServiceType } from '@prisma/client';
import { buildOperatingPlan } from './operatingPlanService';
import { loadCompanyPolicy } from './solverDispatchService';

/**
 * 인력 계산 — "이 배차를 돌리려면 몇 명이 필요한가".
 *
 * 2026년 업계 최대 현안이 이 질문 하나다. 노사정이 노선버스를 격일제에서
 * 1일 2교대로 개편하기로 합의했고, 경기도는 그 전환에 기존 대비 1.5~2배의
 * 운전인력이 필요하다고 보고 2026년에만 2,200명을 양성한다. 전환을 앞둔
 * 회사가 제일 먼저 알아야 하는 숫자다.
 *
 * 계산은 단순하다. 한 달에 채워야 하는 근무 칸수는 운행 계획에서 이미
 * 나온다(노선별 요일 운행 대수 × 2교대 × 날짜). 한 사람이 한 달에 며칠
 * 나오는지는 근무 사이클이 정한다.
 *
 *   가동률 = 근무일 / (근무일 + 휴무일)          예) 5/2 → 5/7 = 0.714
 *   1인 월 근무일 = 가동률 × 그 달 일수           예) 0.714 × 31 = 22.1일
 *   필요 인원 = 필요 칸수 / 1인 월 근무일
 *
 * 이 표가 있으면 "5일 근무 2일 휴무로 가고 싶다"는 요구에 몇 명이 더
 * 필요한지(또는 남는지) 즉답할 수 있다. 성민 실측으로는 2,160칸에 108명이라
 * 5/2 기준 97.5명이면 되고 10명이 남는다 — 그래서 전원 5/2 를 주면 태울
 * 자리가 모자라고, 남는 가동률이 4~5일 휴무로 흘렀다(cyclic-roster.ts 참고).
 */

/** 화면에 보여줄 근무 사이클 후보 — 2교대 실무에서 쓰는 조합 */
const CANDIDATE_CYCLES: { workDays: number; restDays: number }[] = [
  { workDays: 6, restDays: 1 },
  { workDays: 5, restDays: 2 },
  { workDays: 4, restDays: 2 },
  { workDays: 5, restDays: 3 },
  { workDays: 3, restDays: 2 },
  { workDays: 4, restDays: 3 },
];

export interface CyclePlan {
  workDays: number;
  restDays: number;
  /** "5일 근무 / 2일 휴무" */
  label: string;
  /** 근무일 / (근무일 + 휴무일) */
  dutyRatio: number;
  /** 1인당 월 근무일수 */
  monthlyWorkDays: number;
  /** 이 사이클로 돌리는 데 필요한 인원 */
  requiredDrivers: number;
  /** 현재 인원 − 필요 인원 (양수 = 여유, 음수 = 부족) */
  gap: number;
  /** 회사 정책의 월 근무일 상한(hardMax)을 넘는가 — 넘으면 못 쓴다 */
  exceedsPolicyMax: boolean;
  /** 현재 인력에 가장 가까운 사이클 (권장) */
  isBestFit: boolean;
}

export interface ManpowerPlan {
  year: number;
  month: number;
  daysInMonth: number;
  /** 한 달에 채워야 하는 근무 칸수 (= 운행 대수 × 교대 × 날짜) */
  totalCells: number;
  /** 노선별 요일 운행 대수를 하나도 설정하지 않았다면 true — 이때 숫자는 과대 추정 */
  unconfigured: boolean;
  /** 현재 활성 기사 수 */
  currentDrivers: number;
  mainDrivers: number;
  spareDrivers: number;
  /** 지금 인력으로 나누면 1인당 며칠인가 */
  perDriverDays: number;
  /** 그 근무일수를 만드는 가동률 */
  currentDutyRatio: number;
  routes: {
    routeNumber: string;
    registered: number;
    weekday: number;
    saturday: number;
    holiday: number;
  }[];
  cycles: CyclePlan[];
  /** 회사 정책의 월 근무일 범위 (참고 표시용) */
  policyBand: { hardMin: number; hardMax: number; sweetMin: number; sweetMax: number };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** 가동률은 소수 셋째 자리까지 — 0.714 처럼 읽히게 (부동소수 잔재 제거) */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function computeManpowerPlan(
  companyId: number,
  year: number,
  month: number,
  /**
   * 간선/지선/광역 — 지정하면 그 종류의 노선·기사만으로 계산한다.
   * 안 나누면 "간선 10명 부족 + 지선 10명 남음"이 상쇄돼 '적정'으로 보인다.
   */
  serviceType: ServiceType | null = null,
): Promise<ManpowerPlan> {
  const [plan, policy, drivers] = await Promise.all([
    buildOperatingPlan(companyId, year, month, serviceType),
    loadCompanyPolicy(companyId),
    prisma.user.findMany({
      where: { companyId, role: 'DRIVER', isActive: true, ...driverScopeFor(serviceType) },
      select: { driverType: true },
    }),
  ]);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentDrivers = drivers.length;
  const mainDrivers = drivers.filter((d) => d.driverType === 'MAIN').length;
  const spareDrivers = drivers.filter((d) => d.driverType === 'SPARE').length;

  const totalCells = plan.totalCells;
  const perDriverDays = currentDrivers > 0 ? totalCells / currentDrivers : 0;
  const currentDutyRatio = daysInMonth > 0 ? perDriverDays / daysInMonth : 0;

  const bands = policy.workdayBands;
  const raw = CANDIDATE_CYCLES.map((c) => {
    const dutyRatio = c.workDays / (c.workDays + c.restDays);
    const monthlyWorkDays = dutyRatio * daysInMonth;
    const requiredDrivers = monthlyWorkDays > 0 ? totalCells / monthlyWorkDays : 0;
    return {
      ...c,
      label: `${c.workDays}일 근무 / ${c.restDays}일 휴무`,
      dutyRatio: round3(dutyRatio),
      monthlyWorkDays: round1(monthlyWorkDays),
      requiredDrivers: round1(requiredDrivers),
      gap: round1(currentDrivers - requiredDrivers),
      exceedsPolicyMax: monthlyWorkDays > bands.hardMax,
    };
  });

  // 지금 인력에 가장 가까운 사이클 하나만 권장 표시.
  // 정책 상한을 넘는 사이클은 애초에 쓸 수 없으므로 후보에서 뺀다.
  const eligible = raw.filter((c) => !c.exceedsPolicyMax);
  const best =
    eligible.length > 0
      ? eligible.reduce((a, b) =>
          Math.abs(a.requiredDrivers - currentDrivers) <= Math.abs(b.requiredDrivers - currentDrivers)
            ? a
            : b,
        )
      : null;

  return {
    year,
    month,
    daysInMonth,
    totalCells,
    unconfigured: plan.unconfigured,
    currentDrivers,
    mainDrivers,
    spareDrivers,
    perDriverDays: round1(perDriverDays),
    currentDutyRatio: round3(currentDutyRatio),
    routes: plan.summary,
    cycles: raw.map((c) => ({ ...c, isBestFit: best !== null && c.label === best.label })),
    policyBand: {
      hardMin: bands.hardMin,
      hardMax: bands.hardMax,
      sweetMin: bands.sweetMin,
      sweetMax: bands.sweetMax,
    },
  };
}
