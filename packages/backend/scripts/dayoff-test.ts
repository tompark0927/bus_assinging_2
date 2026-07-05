/**
 * THROWAWAY — Day-off (승인 휴무) integration test.
 * 1. company-3 기존 휴무 삭제
 * 2. 휴무 0개 기준선 solve
 * 3. 기사별 1~4개 APPROVED 휴무 삽입 (결정적 시드)
 * 4. 휴무 반영 solve
 * 5. 검증: 승인 휴무일에 배정된 슬롯이 0건인가 (noAssignOnApprovedOff)
 * 6. 기준선 대비 지표 비교
 *
 * Run from packages/backend:
 *   npx ts-node --transpile-only scripts/dayoff-test.ts
 */
// @ts-nocheck
/* eslint-disable */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const COMPANY_ID = 3;
const YEAR = 2026;
const MONTH = 7; // July, 31 days
const DAYS = 31;

function summarize(out: any) {
  const m = out.metrics;
  const filled = out.slots.length;
  const unfilled = out.unfilled.length;
  const wd = out.slots.reduce((acc: any, s: any) => { acc[s.driverId] = (acc[s.driverId] ?? 0) + 1; return acc; }, {});
  return {
    filled, unfilled, total: filled + unfilled,
    mean: m.workDayMean, stdev: m.workDayStdev,
    sweetRate: m.withinTargetRate, hard: m.hardViolationCount, exempt: m.exemptedCount,
    homeBus: m.homeBusRate, cross: m.crossRouteRate,
    fairness: m.fairnessScore, constViol: m.constitutionalViolations.length,
    dayOffSat: m.dayOffSatisfactionRate,
  };
}

async function main() {
  const { prisma } = await import('../src/utils/prisma');
  const { solveMonthlyGrid } = await import('../src/agents/_solvers/monthly-grid-solver');
  const { buildSolverInputFromDb } = await import('../src/services/solverDispatchService');
  const { POLICY_PRESETS } = await import('../src/agents/_solvers/types');
  const policy = POLICY_PRESETS.CITY_2SHIFT;

  // 1. clean
  const del = await prisma.dayOffRequest.deleteMany({ where: { companyId: COMPANY_ID } });
  console.log(`[clean] 기존 휴무 ${del.count}건 삭제`);

  // 2. baseline (0 day-off)
  const baseInput = await buildSolverInputFromDb({ companyId: COMPANY_ID, year: YEAR, month: MONTH, policy });
  const baseOut = solveMonthlyGrid(baseInput);
  const baseSum = summarize(baseOut);

  // 3. deterministic day-off generation
  let seed = 987654321;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const drivers = await prisma.user.findMany({
    where: { companyId: COMPANY_ID, role: 'DRIVER', isActive: true },
    select: { id: true, name: true, driverType: true, assignedBusNumber: true },
    orderBy: { id: 'asc' },
  });

  const dayOffMap = new Map<number, Set<string>>();
  const perDayCount: Record<string, number> = {};
  const inserts: any[] = [];
  let totalOffs = 0;
  const histN: Record<number, number> = {};
  for (const d of drivers) {
    const n = 1 + Math.floor(rng() * 4); // 1..4
    histN[n] = (histN[n] ?? 0) + 1;
    const chosen = new Set<number>();
    let guard = 0;
    while (chosen.size < n && guard++ < 100) chosen.add(1 + Math.floor(rng() * DAYS));
    const dateStrs = new Set<string>();
    for (const day of [...chosen].sort((a, b) => a - b)) {
      const ds = `2026-07-${String(day).padStart(2, '0')}`;
      dateStrs.add(ds);
      perDayCount[ds] = (perDayCount[ds] ?? 0) + 1;
      inserts.push({ companyId: COMPANY_ID, driverId: d.id, date: new Date(Date.UTC(2026, 6, day)), status: 'APPROVED', reason: '테스트 휴무' });
      totalOffs++;
    }
    dayOffMap.set(d.id, dateStrs);
  }
  await prisma.dayOffRequest.createMany({ data: inserts });
  console.log(`[insert] 휴무 ${totalOffs}건 삽입 (기사 ${drivers.length}명, 1~4개 분포: ${JSON.stringify(histN)})`);
  const peakDay = Object.entries(perDayCount).sort((a, b) => b[1] - a[1])[0];
  const avgPerDay = (totalOffs / DAYS).toFixed(1);
  console.log(`[분포] 하루 평균 ${avgPerDay}명 휴무, 최다 동시 휴무일 ${peakDay[0]} = ${peakDay[1]}명`);

  // 4. solve WITH day-offs
  const doInput = await buildSolverInputFromDb({ companyId: COMPANY_ID, year: YEAR, month: MONTH, policy });
  const doOut = solveMonthlyGrid(doInput);
  const doSum = summarize(doOut);

  // sanity: confirm the input actually carried the day-offs
  const carried = doInput.drivers.reduce((a: number, d: any) => a + (d.approvedDayOffs?.length ?? 0), 0);
  console.log(`[sanity] solver 입력에 실린 승인휴무 총 ${carried}건 (기대 ${totalOffs})`);

  // 5. VERIFY compliance — no work slot on any approved day-off
  let violations = 0;
  const vsample: string[] = [];
  for (const s of doOut.slots) {
    const offs = dayOffMap.get(s.driverId);
    if (offs && offs.has(s.date)) {
      violations++;
      if (vsample.length < 10) vsample.push(`driver ${s.driverId} @ ${s.date} ${s.shift}`);
    }
  }

  console.log(`\n===== 결과 =====`);
  console.log(`휴무 준수 위반(휴무일에 배정된 슬롯): ${violations}건 ${violations === 0 ? '✅' : '❌ ' + JSON.stringify(vsample)}`);
  console.log(`\n지표 비교 (휴무 0개 → 휴무 ${totalOffs}건):`);
  const rows = [
    ['충원/전체 슬롯', `${baseSum.filled}/${baseSum.total}`, `${doSum.filled}/${doSum.total}`],
    ['미배정(unfilled)', baseSum.unfilled, doSum.unfilled],
    ['근무일 평균', baseSum.mean, doSum.mean],
    ['근무일 편차', baseSum.stdev, doSum.stdev],
    ['sweet 충족률', baseSum.sweetRate, doSum.sweetRate],
    ['하드위반', baseSum.hard, doSum.hard],
    ['자기차 배정률', baseSum.homeBus, doSum.homeBus],
    ['타노선 투입률', baseSum.cross, doSum.cross],
    ['공정성 점수', baseSum.fairness, doSum.fairness],
    ['헌법 위반', baseSum.constViol, doSum.constViol],
    ['휴무 만족률', baseSum.dayOffSat, doSum.dayOffSat],
  ];
  for (const [k, a, b] of rows) console.log(`  ${String(k).padEnd(16)} ${String(a).padStart(10)}  →  ${String(b).padStart(10)}`);

  // per-driver: did anyone lose too many days?
  const wdBase = baseOut.slots.reduce((a: any, s: any) => { a[s.driverId] = (a[s.driverId] ?? 0) + 1; return a; }, {});
  const wdDo = doOut.slots.reduce((a: any, s: any) => { a[s.driverId] = (a[s.driverId] ?? 0) + 1; return a; }, {});
  console.log(`\n기사별 휴무 개수 & 근무일 변화 (앞 12명):`);
  let shown = 0;
  for (const d of drivers) {
    if (shown++ >= 12) break;
    const offs = dayOffMap.get(d.id)!.size;
    console.log(`  #${d.id} ${d.name}(${d.driverType}) 휴무 ${offs}개 | 근무일 ${wdBase[d.id] ?? 0} → ${wdDo[d.id] ?? 0}`);
  }

  console.log(`\n[note] 삽입한 휴무는 DB에 APPROVED 상태로 남아있어 앱에서도 확인 가능합니다.`);
  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
