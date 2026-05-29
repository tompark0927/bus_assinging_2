/**
 * Stage 2 데모 — 마을버스 (1교대 + SOLO + 6/1).
 *
 * 실행:
 *   npx ts-node scripts/dispatch-solver-village-demo.ts
 */

import { solveMonthlyGrid } from '../src/agents/_solvers/monthly-grid-solver';
import {
  POLICY_PRESETS,
  type SolverCrew,
  type SolverDriver,
} from '../src/agents/_solvers/types';

const policy = POLICY_PRESETS.VILLAGE_1SHIFT;
const year = 2026;
const month = 5;

// 마을버스 노선 1개, 8대, 차당 1명 (SOLO) + 여유 풀 4명
const drivers: SolverDriver[] = [];
const buses: { id: number; routeId: number }[] = [];
const crews: SolverCrew[] = [];

let id = 1;
for (let b = 0; b < 8; b++) {
  const busId = 1000 + b;
  const dId = id++;
  drivers.push({
    id: dId,
    name: `마을${b + 1}`,
    homeBusId: busId,
    homeRouteId: 100,
    canCrossRoute: false,
    approvedDayOffs:
      b % 3 === 0 ? [`${year}-05-${String(5 + b).padStart(2, '0')}`] : [],
    recentFatigueScore: 20 + Math.random() * 30,
    isNewHire: false,
  });
  buses.push({ id: busId, routeId: 100 });
  crews.push({ id: `C${b + 1}`, driverIds: [dId], busId, routeId: 100 });
}

// 여유 풀 (휴무 메꿈용, homeBusId 없음, 같은 노선)
for (let s = 0; s < 4; s++) {
  drivers.push({
    id: id++,
    name: `여유${s + 1}`,
    homeRouteId: 100,
    canCrossRoute: false,
    approvedDayOffs: [],
    recentFatigueScore: 15 + Math.random() * 20,
    isNewHire: false,
  });
}

const start = Date.now();
const result = solveMonthlyGrid({
  year,
  month,
  drivers,
  buses,
  crews,
  policy,
  localSearchIterations: 1500,
});
const elapsed = Date.now() - start;

const sep = '─'.repeat(72);
console.log(sep);
console.log(
  `입력: ${drivers.length}명 (${crews.length} SOLO crew + ${drivers.length - crews.length} 여유) / ${buses.length}대 / 1 노선`,
);
console.log(`정책: VILLAGE_1SHIFT (1교대, SOLO, 6/1)`);
console.log(sep);
console.log(result.summary);
console.log(sep);

const days = result.workloads.map((w) => w.workDays).sort((a, b) => a - b);
const inTarget = result.workloads.filter((w) => w.withinTarget).length;
console.log(
  `근무일 분포: 최소 ${days[0]} / 중앙값 ${days[Math.floor(days.length / 2)]} / 최대 ${days[days.length - 1]}`,
);
console.log(
  `${policy.workdayBands.sweetMin}~${policy.workdayBands.sweetMax}일 sweet 충족: ${inTarget}/${result.workloads.length}명`,
);
const shiftKinds = new Set(result.slots.map((s) => s.shift));
console.log(`사용된 시프트 종류: ${[...shiftKinds].join(', ')}`);
console.log(
  `총 슬롯: ${result.slots.length} / 미배정 ${result.unfilled.length}`,
);
console.log(`⏱ 소요시간: ${elapsed}ms`);
