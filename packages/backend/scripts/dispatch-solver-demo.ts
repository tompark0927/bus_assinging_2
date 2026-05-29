/**
 * Stage 3 v2 솔버 데모 — 성민버스 규모 합성 데이터.
 *
 * 실행:
 *   npx ts-node scripts/dispatch-solver-demo.ts
 *
 * 옵션:
 *   --routes=3 --buses-per-route=14 --extra-pool=20 --month=5 --iters=3000
 *
 * 모델 (실제 데이터 기반):
 *   - 노선 3개 (16번/9번/3-2번)
 *   - 노선당 14대, 차당 페어 2명 = MAIN 84명
 *   - 추가 풀 = 휴무 메꿈용 (다른 차/노선 운행 가능)
 *   - 5/2 룰 적용 → 자동으로 19~22일 근무
 */

import { solveMonthlyGrid } from '../src/agents/_solvers/monthly-grid-solver';
import type {
  SolverDriver,
  SolverInput,
  SolverPartnership,
} from '../src/agents/_solvers/types';

function parseArg(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : fallback;
}

function buildSyntheticInput(): SolverInput {
  const routes = parseArg('routes', 3);
  const busesPerRoute = parseArg('buses-per-route', 14);
  const extraPool = parseArg('extra-pool', 20);
  const month = parseArg('month', 5);
  const year = parseArg('year', 2026);
  const iters = parseArg('iters', 3000);

  const drivers: SolverDriver[] = [];
  const buses: { id: number; routeId: number }[] = [];
  const partnerships: SolverPartnership[] = [];

  let driverId = 1;
  let busId = 1001;
  let pairCounter = 1;

  for (let r = 1; r <= routes; r++) {
    const routeId = r * 100;
    for (let b = 0; b < busesPerRoute; b++) {
      const bId = busId++;
      buses.push({ id: bId, routeId });

      const aId = driverId++;
      const bIdDriver = driverId++;

      drivers.push({
        id: aId,
        name: `R${r}-차${b + 1}-A`,
        homeBusId: bId,
        homeRouteId: routeId,
        partnerId: bIdDriver,
        canCrossRoute: false,
        approvedDayOffs: randomDayOffs(year, month, Math.floor(Math.random() * 2)),
        recentFatigueScore: 20 + Math.random() * 40,
        isNewHire: false,
      });
      drivers.push({
        id: bIdDriver,
        name: `R${r}-차${b + 1}-B`,
        homeBusId: bId,
        homeRouteId: routeId,
        partnerId: aId,
        canCrossRoute: false,
        approvedDayOffs: randomDayOffs(year, month, Math.floor(Math.random() * 2)),
        recentFatigueScore: 20 + Math.random() * 40,
        isNewHire: false,
      });
      partnerships.push({
        id: `P${pairCounter++}`,
        driverAId: aId,
        driverBId: bIdDriver,
        busId: bId,
        routeId,
      });
    }
  }

  // 추가 풀 — 노선별 분배 (특정 노선 SAME_ROUTE 풀에 들어감)
  for (let s = 0; s < extraPool; s++) {
    const routeId = (1 + (s % routes)) * 100;
    drivers.push({
      id: driverId++,
      name: `여유R${routeId / 100}-${s + 1}`,
      homeRouteId: routeId,
      canCrossRoute: false,
      approvedDayOffs: randomDayOffs(year, month, 1 + Math.floor(Math.random() * 2)),
      recentFatigueScore: 15 + Math.random() * 30,
      isNewHire: s === 0,
    });
  }

  // 면제 시나리오 — 신규 입사자(중도 입사) + 산재 복귀자
  // 첫 두 운전자에게 workDayTarget.exemptReason 부여 + 휴무 다수
  if (drivers.length >= 2) {
    drivers[0].name = '박준호';
    drivers[0].workDayTarget = {
      min: 0,
      max: 23,
      softMin: 19,
      softMax: 22,
      exemptReason: 'NEW_HIRE',
      exemptNote: '2026-04-15 입사',
    };
    // 5/1~5/14 까지 입사 전이라 휴무 처리
    const newHireOff: string[] = [];
    for (let d = 1; d <= 14; d++) {
      newHireOff.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    drivers[0].approvedDayOffs = newHireOff;

    drivers[1].name = '이상철';
    drivers[1].workDayTarget = {
      min: 0,
      max: 23,
      softMin: 19,
      softMax: 22,
      exemptReason: 'MEDICAL_LEAVE',
      exemptNote: '산재로 5/1~5/12 휴직',
    };
    const medOff: string[] = [];
    for (let d = 1; d <= 12; d++) {
      medOff.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    drivers[1].approvedDayOffs = medOff;
  }

  return {
    year,
    month,
    drivers,
    buses,
    partnerships,
    localSearchIterations: iters,
  };
}

function randomDayOffs(year: number, month: number, count: number): string[] {
  if (count <= 0) return [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const set = new Set<string>();
  while (set.size < count) {
    const d = 1 + Math.floor(Math.random() * daysInMonth);
    set.add(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return Array.from(set).sort();
}

// ─── main ───
const start = Date.now();
const input = buildSyntheticInput();
const result = solveMonthlyGrid(input);
const elapsed = Date.now() - start;

const sep = '─'.repeat(72);
console.log(sep);
console.log(`입력: ${input.drivers.length}명 운전자 / ${(input.partnerships ?? []).length} 페어 / ${input.buses.length} 차량 / ${new Set(input.buses.map((b) => b.routeId)).size} 노선`);
console.log(`     ${input.year}년 ${input.month}월 (${new Date(input.year, input.month, 0).getDate()}일)`);
console.log(sep);
console.log(result.summary);
console.log(sep);

// 워크로드 분포
const days = result.workloads.map((w) => w.workDays).sort((a, b) => a - b);
const inTarget = result.workloads.filter((w) => w.withinTarget).length;
const homeMostly = result.workloads.filter((w) => w.homeBusDays >= w.workDays * 0.8).length;
console.log(`근무일수 분포: 최소 ${days[0]} / Q1 ${days[Math.floor(days.length * 0.25)]} / 중앙값 ${days[Math.floor(days.length / 2)]} / Q3 ${days[Math.floor(days.length * 0.75)]} / 최대 ${days[days.length - 1]}`);
console.log(`19~22일 충족: ${inTarget}/${result.workloads.length}명 (${(100 * inTarget / result.workloads.length).toFixed(1)}%)`);
console.log(`본인 차량 ≥80% 운행: ${homeMostly}/${result.workloads.length}명 (${(100 * homeMostly / result.workloads.length).toFixed(1)}%)`);

// 헌법 룰 위반 (있으면)
if (result.metrics.constitutionalViolations.length > 0) {
  console.log(sep);
  console.log(`⚠️  헌법 룰 위반 ${result.metrics.constitutionalViolations.length}건 (상위 5):`);
  for (const v of result.metrics.constitutionalViolations.slice(0, 5)) {
    console.log(`   R${v.ruleId} ${v.ruleName}: ${v.detail}`);
  }
}

// 5/2 위반자
const violators = result.workloads.filter((w) => w.violatesRestCycle);
if (violators.length > 0) {
  console.log(sep);
  console.log(`⚠️  5/2 룰 위반 ${violators.length}명 (상위 3):`);
  for (const w of violators.slice(0, 3)) {
    console.log(`   ${w.driverName}: ${w.longestStreak}일 연속 근무`);
  }
}

console.log(sep);
console.log(`⏱  소요시간: ${elapsed}ms`);
console.log(`총 슬롯: ${result.slots.length}개 (HOME ${result.slots.filter((s) => s.familiarity === 'HOME').length} / SAME_ROUTE ${result.slots.filter((s) => s.familiarity === 'SAME_ROUTE').length} / CROSS_ROUTE ${result.slots.filter((s) => s.familiarity === 'CROSS_ROUTE').length} / 미배정 ${result.unfilled.length})`);
