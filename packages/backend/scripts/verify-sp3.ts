/**
 * THROWAWAY VERIFICATION SCRIPT — SP3 adversarial probe
 * DO NOT COMMIT. Answers probes 3, 4, 5.
 *
 * Run: /path/to/ts-node --project tsconfig.scripts.json scripts/verify-sp3.ts
 * Or via the root ts-node with --transpile-only.
 */

// @ts-nocheck
/* eslint-disable */

import { solveMonthlyGrid } from '../src/agents/_solvers/monthly-grid-solver';
import { validateFullGrid } from '../src/agents/_solvers/constraints';
import { SCENARIO_SUITE, buildScenario } from '../src/agents/_solvers/bench/scenarios';
import { scheduleQuality } from '../src/agents/_solvers/quality';

function pad(n: number): string { return String(n).padStart(2, '0'); }

// ── Probe 3 + 4: Slot conservation and per-scenario unfilled ──
console.log('\n=== PROBE 3: Slot Conservation ===');
console.log('label | demand | assigned | unfilled | assigned+unfilled | conserved?');
console.log('------|--------|----------|----------|-------------------|----------');

let allConserved = true;

const results: Array<{label: string; unfilledRate: number; constViol: number; slots: number; unfilled: number; demand: number}> = [];

for (const spec of SCENARIO_SUITE) {
  const input = buildScenario(spec);
  const output = solveMonthlyGrid(input);

  // Compute demand: sum of operating slots across all buses
  // Each bus has operatingDates; each date has N shifts per policy
  const shiftCount = input.policy.shiftSystem.slots.length;
  let demand = 0;
  for (const bus of input.buses) {
    demand += bus.operatingDates.length * shiftCount;
  }

  const assigned = output.slots.length;
  const unfilled = output.unfilled.length;
  const total = assigned + unfilled;
  const conserved = total === demand;
  if (!conserved) allConserved = false;

  const q = scheduleQuality(input, output);
  results.push({ label: spec.label, unfilledRate: q.unfilledRate, constViol: q.constitutionalViolationCount, slots: assigned, unfilled, demand });

  console.log(`${spec.label.padEnd(22)} | ${demand} | ${assigned} | ${unfilled} | ${total} | ${conserved ? 'YES' : 'NO ← VIOLATION!'}`);
}

console.log(`\nAll scenarios conserved: ${allConserved ? 'YES ✓' : 'NO ✗ — SLOT DROPS DETECTED'}`);

// ── Probe 5: Independent re-validation ──
console.log('\n=== PROBE 5: Independent validateFullGrid per scenario ===');
console.log('label | R1(noNightStreak) | R2(weeklyMaxWork) | R9(weekendOff) | total');
console.log('------|------------------|------------------|---------------|------');

let grandTotalViol = 0;
for (const spec of SCENARIO_SUITE) {
  const input = buildScenario(spec);
  const output = solveMonthlyGrid(input);
  const monthStart = new Date(Date.UTC(spec.year, spec.month - 1, 1));
  const monthEnd = new Date(Date.UTC(spec.year, spec.month, 0));
  const violations = validateFullGrid(input.drivers, output.slots, monthStart, monthEnd, input.policy);

  const r1 = violations.filter(v => v.ruleKey === 'noNightStreak').length;
  const r2 = violations.filter(v => v.ruleKey === 'weeklyMaxWorkDays').length;
  const r9 = violations.filter(v => v.ruleKey === 'guaranteedWeekendOff').length;
  const total = violations.length;
  grandTotalViol += total;

  console.log(`${spec.label.padEnd(22)} | R1=${r1} | R2=${r2} | R9=${r9} | total=${total}`);
}
console.log(`\nGrand total constitutional violations across all scenarios: ${grandTotalViol}`);
console.log(`Expected 0 — ${grandTotalViol === 0 ? 'CONFIRMED ✓' : 'FAILED ✗ — violations found!'}`);

// ── Manual reconstruction: one driver's weekend-offs ──
console.log('\n=== PROBE 5b: Manual reconstruction — village-tight#1001 weekend-offs ===');
{
  const spec = SCENARIO_SUITE.find(s => s.label === 'village-tight#1001')!;
  const input = buildScenario(spec);
  const output = solveMonthlyGrid(input);
  const monthStart = new Date(Date.UTC(spec.year, spec.month - 1, 1));
  const monthEnd = new Date(Date.UTC(spec.year, spec.month, 0));

  // Count total weekend days in month
  let totalWeekendDays = 0;
  const cur = new Date(monthStart);
  while (cur <= monthEnd) {
    const day = cur.getUTCDay();
    if (day === 0 || day === 6) totalWeekendDays++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const isWeekend = (iso: string) => { const d = new Date(iso); const day = d.getUTCDay(); return day === 0 || day === 6; };
  const weekendRule = input.policy.constitutional?.guaranteedWeekendOff;
  const minWeekendOff = weekendRule?.minPerMonth ?? 0;

  console.log(`Total weekend days in ${spec.year}-${pad(spec.month)}: ${totalWeekendDays}, minPerMonth: ${minWeekendOff}`);
  console.log('driver | workedWeekends | weekendOffs | meets-min?');

  let violations = 0;
  for (const driver of input.drivers.slice(0, 10)) {
    const dSlots = output.slots.filter(s => s.driverId === driver.id);
    const workedWeekends = dSlots.filter(s => isWeekend(s.date)).length;
    const offs = totalWeekendDays - workedWeekends;
    const ok = offs >= minWeekendOff;
    if (!ok) violations++;
    console.log(`  ${driver.name.padEnd(15)} | ${workedWeekends} | ${offs} | ${ok ? 'YES' : 'NO ← VIOLATION!'}`);
  }
  console.log(`Weekend-off violations (first 10 drivers): ${violations}`);
}

// ── Probe 4: unfilledRate per scenario (current HEAD) ──
console.log('\n=== PROBE 4: Per-scenario unfilledRate (current HEAD post-fix) ===');
for (const r of results) {
  console.log(`${r.label.padEnd(22)} | unfilled=${r.unfilled} | rate=${(r.unfilledRate*100).toFixed(1)}% | constViol=${r.constViol}`);
}

console.log('\n=== DONE ===');
