/**
 * THROWAWAY — Policy matrix test harness.
 * Runs the monthly-grid solver against REAL company-3 DB data (July 2026),
 * swapping ONE policy setting at a time, and reports how each metric moves.
 * Read-only: never writes to the DB.
 *
 * Run from packages/backend:
 *   npx ts-node --transpile-only scripts/policy-matrix-test.ts
 */
// @ts-nocheck
/* eslint-disable */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const COMPANY_ID = 3;
const YEAR = 2026;
const MONTH = Number(process.env.TEST_MONTH ?? 7);

const clone = (o: any) => JSON.parse(JSON.stringify(o));

async function main() {
  const { solveMonthlyGrid } = await import('../src/agents/_solvers/monthly-grid-solver');
  const { buildSolverInputFromDb } = await import('../src/services/solverDispatchService');
  const { POLICY_PRESETS } = await import('../src/agents/_solvers/types');

  const base = POLICY_PRESETS.CITY_2SHIFT;

  const variants: { key: string; label: string; policy: any }[] = [
    { key: 'T0', label: 'BASELINE CITY_2SHIFT (5/2, 2교대, PAIR, band 18-23/sweet19-22)', policy: clone(base) },
    {
      key: 'T1',
      label: 'workdayBands ↓ 공급맞춤 (hard12-19 / sweet14-17)',
      policy: { ...clone(base), workdayBands: { hardMin: 12, sweetMin: 14, sweetMax: 17, hardMax: 19, belowSweetPenalty: 5, aboveSweetPenalty: 8 } },
    },
    {
      key: 'T2',
      label: 'workdayBands hardMin↑ (hard20-25 / sweet21-24)',
      policy: { ...clone(base), workdayBands: { hardMin: 20, sweetMin: 21, sweetMax: 24, hardMax: 25, belowSweetPenalty: 5, aboveSweetPenalty: 8 } },
    },
    {
      key: 'T3',
      label: 'restCycle 6/1 (연속6근무 1휴, 비연속휴무)',
      policy: { ...clone(base), restCycle: { workDays: 6, restDays: 1, consecutiveRest: false } },
    },
    {
      key: 'T4',
      label: 'restCycle 4/3 (연속4근무 3휴)',
      policy: { ...clone(base), restCycle: { workDays: 4, restDays: 3, consecutiveRest: true } },
    },
    {
      key: 'T5',
      label: 'shiftSystem ONE_SHIFT (1교대, 나머지 그대로 PAIR)',
      policy: { ...clone(base), shiftSystem: { kind: 'ONE_SHIFT', slots: ['FULL_DAY'] } },
    },
    {
      key: 'T6',
      label: 'crewModel TRIO(3) — 차량당 주기사 3명',
      policy: { ...clone(base), crewModel: { kind: 'TRIO', size: 3 } },
    },
    {
      key: 'T7',
      label: 'crewModel SOLO(1) — 차량당 주기사 1명',
      policy: { ...clone(base), crewModel: { kind: 'SOLO', size: 1 } },
    },
    {
      key: 'T8',
      label: 'constitutional guaranteedWeekendOff OFF (월 주말휴무 보장 해제)',
      policy: { ...clone(base), constitutional: { ...clone(base.constitutional), guaranteedWeekendOff: { enabled: false, minPerMonth: 0 } } },
    },
    {
      key: 'T9',
      label: 'FULL PRESET VILLAGE_1SHIFT (6/1, 1교대, SOLO, band 22-27)',
      policy: clone(POLICY_PRESETS.VILLAGE_1SHIFT),
    },
  ];

  const rows: any[] = [];
  for (const v of variants) {
    let input, out, err = null;
    const t0 = process.hrtime.bigint();
    try {
      input = await buildSolverInputFromDb({ companyId: COMPANY_ID, year: YEAR, month: MONTH, policy: v.policy });
      out = solveMonthlyGrid(input);
    } catch (e: any) {
      err = e.message;
    }
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    if (err) {
      rows.push({ key: v.key, label: v.label, ERROR: err });
      console.log(`\n### ${v.key} — ${v.label}\n  ❌ ERROR: ${err}`);
      continue;
    }
    const m = out.metrics;
    const filled = out.slots.length;
    const unfilled = out.unfilled.length;
    const total = filled + unfilled;
    const wd = out.workloads.map((w: any) => w.workDays).sort((a: number, b: number) => a - b);
    const tiers: Record<string, number> = {};
    for (const w of out.workloads) tiers[w.workloadEval.tier] = (tiers[w.workloadEval.tier] ?? 0) + 1;
    const row = {
      key: v.key,
      label: v.label,
      crews: input.crews.length,
      crewSize: v.policy.crewModel.size,
      shiftsPerDay: v.policy.shiftSystem.slots.length,
      totalSlots: total,
      filled,
      unfilled,
      fillRate: total === 0 ? 0 : +(filled / total).toFixed(3),
      nDrivers: wd.length,
      mean: m.workDayMean,
      stdev: m.workDayStdev,
      wdMin: wd[0],
      wdMax: wd[wd.length - 1],
      targetRate: m.withinTargetRate,
      acceptRate: m.withinAcceptableRate,
      hard: m.hardViolationCount,
      exempt: m.exemptedCount,
      homeBus: m.homeBusRate,
      cross: m.crossRouteRate,
      restComp: m.restCycleCompliance,
      weeklyConsist: m.weeklyShiftConsistencyRate,
      fairness: m.fairnessScore,
      constViol: m.constitutionalViolations.length,
      tiers,
      ms: Math.round(ms),
    };
    rows.push(row);
    console.log(`\n### ${v.key} — ${v.label}`);
    console.log(`  slots: ${filled}/${total} filled (unfilled ${unfilled}) | crews ${input.crews.length}×${v.policy.crewModel.size}`);
    console.log(`  workDays: mean ${m.workDayMean} stdev ${m.workDayStdev} [min ${wd[0]} .. max ${wd[wd.length - 1]}] over ${wd.length} drivers`);
    console.log(`  tiers: ${JSON.stringify(tiers)}`);
    console.log(`  sweetRate ${(m.withinTargetRate * 100).toFixed(1)}% | acceptRate ${(m.withinAcceptableRate * 100).toFixed(1)}% | HARD ${m.hardViolationCount} | exempt ${m.exemptedCount}`);
    console.log(`  homeBus ${(m.homeBusRate * 100).toFixed(1)}% | cross ${(m.crossRouteRate * 100).toFixed(1)}% | restComp ${(m.restCycleCompliance * 100).toFixed(1)}% | weeklyConsist ${(m.weeklyShiftConsistencyRate * 100).toFixed(1)}%`);
    console.log(`  fairness ${m.fairnessScore}/100 | constViol ${m.constitutionalViolations.length} | ${Math.round(ms)}ms`);
    if (v.key === 'T0') {
      // baseline per-driver workday histogram
      const hist: Record<number, number> = {};
      for (const x of wd) hist[x] = (hist[x] ?? 0) + 1;
      console.log(`  [baseline workday histogram] ${JSON.stringify(hist)}`);
    }
  }

  console.log('\n\n===== JSON =====');
  console.log(JSON.stringify(rows, null, 1));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
