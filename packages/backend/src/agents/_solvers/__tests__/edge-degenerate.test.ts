/**
 * Adversarial edge-case / degenerate-capacity tests for solveMonthlyGrid + scheduleQuality.
 *
 * INVARIANTS under test (ALL must hold for any correct output):
 *   INV-1  No unexpected crash/throw
 *   INV-2  metrics.unfilledCount === unfilled.length
 *   INV-3  slots.length + unfilled.length === total demanded slots (buses × shifts × operating days)
 *   INV-4  restCycleCompliance in [0, 1]
 *   INV-5  No NaN / Infinity in any metric field
 *   INV-6  No phantom assignments (every slot's driverId ∈ input.drivers)
 *   INV-7  scheduleQuality: no throw, compositeScore in [0,100], stdevs ≥ 0, rates in [0,1] or null
 *
 * We do NOT modify the solver. Only this file is created.
 */

import { solveMonthlyGrid } from '../monthly-grid-solver';
import { scheduleQuality } from '../quality';
import type {
  SolverInput,
  SolverDriver,
  SolverBus,
  SolverCrew,
  SolverOutput,
  CompanyPolicy,
} from '../types';
import { POLICY_PRESETS } from '../types';

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

const YEAR = 2026;
const MONTH = 5; // May — 31 days

const CITY = POLICY_PRESETS.CITY_2SHIFT;   // crewModel PAIR size=2, 2 shifts (AM/PM)
const VILLAGE = POLICY_PRESETS.VILLAGE_1SHIFT; // crewModel SOLO size=1, 1 shift

function makeDriver(
  id: number,
  overrides: Partial<SolverDriver> = {},
): SolverDriver {
  return {
    id,
    name: `D${id}`,
    approvedDayOffs: [],
    recentFatigueScore: 0,
    isNewHire: false,
    ...overrides,
  };
}

function makeBus(id: number, routeId: number, operatingDates?: string[]): SolverBus {
  return operatingDates !== undefined
    ? { id, routeId, operatingDates }
    : { id, routeId };
}

function makeCrew(id: string, driverIds: number[], busId: number, routeId: number): SolverCrew {
  return { id, driverIds, busId, routeId };
}

/** Generate all ISO date strings for a given year/month */
function monthDates(year: number, month: number): string[] {
  const days: string[] = [];
  const end = new Date(Date.UTC(year, month, 0)).getUTCDate(); // last day
  for (let d = 1; d <= end; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

/**
 * Compute expected total demanded slot count from the solver's perspective.
 * For each bus: count operating days (all month if no operatingDates), multiply by shift count.
 * For ALTERNATING_DAY, roughly half the days per bus (bus.id-dependent parity).
 */
function expectedDemand(input: SolverInput): number {
  const policy = input.policy ?? POLICY_PRESETS.CITY_2SHIFT;
  const allDays = monthDates(input.year, input.month);
  const shiftCount = policy.shiftSystem.slots.length;
  const crewByBus = new Map<number, SolverCrew>();
  (input.crews ?? []).forEach((c) => crewByBus.set(c.busId, c));

  let total = 0;
  for (const bus of input.buses) {
    // If bus has no crew, solver skips it — no demand
    if (!crewByBus.has(bus.id)) continue;

    const operatingDays = bus.operatingDates !== undefined
      ? bus.operatingDates.filter((d) => allDays.includes(d))
      : allDays;

    if (policy.shiftSystem.kind === 'ALTERNATING_DAY') {
      const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
      const period = (policy.shiftSystem as { periodDays: number }).periodDays;
      let count = 0;
      for (const day of operatingDays) {
        const d = new Date(`${day}T00:00:00Z`);
        const dayIdx = Math.floor((d.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000));
        if ((dayIdx + bus.id) % period === 0) count++;
      }
      total += count * shiftCount;
    } else {
      total += operatingDays.length * shiftCount;
    }
  }
  return total;
}

// ─────────────────────────────────────────────
// Core invariant checker
// ─────────────────────────────────────────────

function assertInvariants(
  label: string,
  input: SolverInput,
  output: SolverOutput,
): void {
  const { slots, unfilled, metrics } = output;
  const driverIds = new Set(input.drivers.map((d) => d.id));
  const busIds = new Set(input.buses.map((b) => b.id));

  // INV-2: unfilledCount matches unfilled array
  expect(metrics.unfilledCount).toBe(unfilled.length);

  // INV-3: total slot accounting
  const demand = expectedDemand(input);
  expect(slots.length + unfilled.length).toBe(demand);

  // INV-4: restCycleCompliance in [0, 1]
  expect(metrics.restCycleCompliance).toBeGreaterThanOrEqual(0);
  expect(metrics.restCycleCompliance).toBeLessThanOrEqual(1);

  // INV-5: no NaN / Infinity in numeric metrics
  const numericFields: (keyof typeof metrics)[] = [
    'fairnessScore', 'workDayStdev', 'workDayMean', 'withinTargetRate',
    'withinAcceptableRate', 'hardViolationCount', 'exemptedCount',
    'homeBusRate', 'crossRouteRate', 'restCycleCompliance',
    'weeklyShiftConsistencyRate', 'weekendStdev', 'dayOffSatisfactionRate',
    'unfilledCount', 'localSearchSwaps',
  ];
  for (const f of numericFields) {
    const val = metrics[f];
    if (typeof val === 'number') {
      expect(Number.isNaN(val)).toBe(false);
      expect(Number.isFinite(val)).toBe(true);
    }
  }

  // INV-6: no phantom assignments
  for (const s of slots) {
    expect(driverIds.has(s.driverId)).toBe(true);
    expect(busIds.has(s.busId)).toBe(true);
  }

  // INV-7: scheduleQuality invariants
  const qReport = scheduleQuality(input, output);
  expect(qReport.compositeScore).toBeGreaterThanOrEqual(0);
  expect(qReport.compositeScore).toBeLessThanOrEqual(100);
  expect(Number.isNaN(qReport.compositeScore)).toBe(false);
  expect(qReport.workDayStdev).toBeGreaterThanOrEqual(0);
  expect(qReport.nightStdev).toBeGreaterThanOrEqual(0);
  expect(qReport.weekendStdev).toBeGreaterThanOrEqual(0);
  expect(qReport.activeDriverRate).toBeGreaterThanOrEqual(0);
  expect(qReport.activeDriverRate).toBeLessThanOrEqual(1);
  expect(qReport.unfilledRate).toBeGreaterThanOrEqual(0);
  expect(qReport.unfilledRate).toBeLessThanOrEqual(1);
  expect(qReport.homeBusRate).toBeGreaterThanOrEqual(0);
  expect(qReport.homeBusRate).toBeLessThanOrEqual(1);
  expect(qReport.crossRouteRate).toBeGreaterThanOrEqual(0);
  expect(qReport.crossRouteRate).toBeLessThanOrEqual(1);
  if (qReport.spareUtilizationRate !== null) {
    expect(qReport.spareUtilizationRate).toBeGreaterThanOrEqual(0);
    expect(qReport.spareUtilizationRate).toBeLessThanOrEqual(1);
  }
  if (qReport.preferenceSatisfactionRate !== null) {
    expect(qReport.preferenceSatisfactionRate).toBeGreaterThanOrEqual(0);
    expect(qReport.preferenceSatisfactionRate).toBeLessThanOrEqual(1);
  }
  if (qReport.dayOffSatisfactionRate !== null) {
    expect(qReport.dayOffSatisfactionRate).toBeGreaterThanOrEqual(0);
    expect(qReport.dayOffSatisfactionRate).toBeLessThanOrEqual(1);
  }
  expect(Number.isNaN(qReport.workDayStdev)).toBe(false);
  expect(Number.isNaN(qReport.nightStdev)).toBe(false);
  expect(Number.isNaN(qReport.weekendStdev)).toBe(false);
  expect(Number.isNaN(qReport.restCycleCompliance)).toBe(false);
}

// ─────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────

describe('edge-degenerate: INV-1 (no unexpected crash)', () => {

  // ── 1. Completely empty input ────────────────────────────────────────────

  test('E-01: 0 drivers, 0 buses, 0 crews, 0 routes — no throw', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [], buses: [], crews: [],
      policy: CITY,
    };
    // normalizeToCrews: buses.length=0, so no throw expected
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-01', input, output);
    expect(output.slots).toHaveLength(0);
    expect(output.unfilled).toHaveLength(0);
  });

  // ── 2. 1 driver / 1 bus / 1 crew (SOLO / VILLAGE) ───────────────────────

  test('E-02: 1 driver, 1 bus, 1 crew (VILLAGE_1SHIFT SOLO) — no throw', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [makeDriver(1, { homeBusId: 1, homeRouteId: 10 })],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1], 1, 10)],
      policy: VILLAGE,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-02', input, output);
  });

  // ── 3. Drivers but no buses ──────────────────────────────────────────────

  test('E-03: 4 drivers but no buses — no throw, 0 demand', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [1, 2, 3, 4].map((id) => makeDriver(id, { homeRouteId: 10 })),
      buses: [],
      crews: [],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-03', input, output);
    expect(output.slots).toHaveLength(0);
    expect(output.unfilled).toHaveLength(0);
  });

  // ── 4. Buses but no drivers ──────────────────────────────────────────────
  //
  // When buses.length > 0 and there are NO crews/partnerships at all,
  // normalizeToCrews() intentionally throws:
  //   "SolverInput: 차량 N대 가 있는데 crews/partnerships 매핑이 없습니다."
  // We treat that as a DOCUMENTED guard (acceptable throw).
  //
  // But if crews IS provided (even empty array []), it no longer throws since
  // input.crews.length === 0 falls through to the buses.length > 0 guard only
  // when crews/partnerships are both missing/undefined.  Actually the code is:
  //   if (input.crews && input.crews.length > 0) return input.crews;   ← misses []
  //   if (input.partnerships && ...) ...
  //   if (input.buses.length > 0) throw
  // So crews=[] still hits the throw because length===0 fails the guard.
  // This test documents the expected throw.

  test('E-04: buses but no drivers, crews=[] — documented throw from normalizeToCrews', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [],
      buses: [makeBus(1, 10)],
      crews: [], // empty array → hits the "buses>0 but no crews" guard
      policy: CITY,
    };
    // The throw is intentional and documented in the code.
    expect(() => solveMonthlyGrid(input)).toThrow(
      /crews\/partnerships 매핑이 없습니다/,
    );
  });

  test('E-04b: buses but no drivers — supply matching crew (driverIds=[]) — documented validateCrewModel throw', () => {
    // A crew with driverIds=[] vs PAIR size=2 should throw from validateCrewModel.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [], 1, 10)], // 0 drivers, PAIR expects 2
      policy: CITY,
    };
    expect(() => solveMonthlyGrid(input)).toThrow(/Crew size mismatch/);
  });

  // ── 5. Buses but no crews (crews undefined) ───────────────────────────────

  test('E-05: 2 buses, 0 crews (undefined) — documented throw from normalizeToCrews', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [makeDriver(1), makeDriver(2)],
      buses: [makeBus(1, 10), makeBus(2, 10)],
      // crews and partnerships both omitted → documented throw
      policy: CITY,
    };
    expect(() => solveMonthlyGrid(input)).toThrow(
      /crews\/partnerships 매핑이 없습니다/,
    );
  });

  // ── 6. All drivers have approvedDayOffs covering every day of the month ──

  test('E-06: every driver approved-off every day — all slots unfilled', () => {
    const allDays = monthDates(YEAR, MONTH);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-06', input, output);
    expect(output.slots).toHaveLength(0);
    expect(output.unfilled.length).toBeGreaterThan(0);
  });

  // ── 7. All drivers have expired licenses ─────────────────────────────────

  test('E-07: all drivers license expired before month start', () => {
    const expiredDate = new Date(Date.UTC(YEAR, MONTH - 2, 1)); // 2 months before
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: expiredDate }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: expiredDate }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-07', input, output);
    // All assigned slots must not use expired drivers
    expect(output.slots).toHaveLength(0);
  });

  // ── 8. All drivers qualificationExpiresAt expired ────────────────────────

  test('E-08: all drivers qualification expired before month start', () => {
    const expiredDate = new Date(Date.UTC(YEAR, MONTH - 2, 1));
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, qualificationExpiresAt: expiredDate }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, qualificationExpiresAt: expiredDate }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-08', input, output);
    expect(output.slots).toHaveLength(0);
  });

  // ── 9. All drivers are new hires ─────────────────────────────────────────

  test('E-09: all drivers isNewHire=true', () => {
    // New hires cannot be sent cross-route, but HOME/SAME_ROUTE is fine.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, isNewHire: true }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, isNewHire: true }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-09', input, output);
  });

  // ── 10. All drivers are SPARE (no homeBusId) ─────────────────────────────

  test('E-10: all drivers are SPARE (no homeBusId)', () => {
    // Spare drivers have no homeBusId → homeCandidates will be empty for any crew
    // because crew.driverIds reference drivers not in the driver pool of the crew's bus.
    // The crew still exists with these ids; pickDriver will attempt HOME tier,
    // find the driver by id in ctx.drivers, and proceed.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeRouteId: 10 }), // no homeBusId
        makeDriver(2, { homeRouteId: 10 }), // no homeBusId
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-10', input, output);
  });

  // ── 11. All drivers blocked from their only route ────────────────────────

  test('E-11: all drivers blockedRouteIds covers only route', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10] }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10] }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-11', input, output);
    expect(output.slots).toHaveLength(0);
  });

  // ── 12. Crew size mismatch: crew with 3 drivers under PAIR policy ─────────

  test('E-12: crew with 3 driverIds under PAIR (size=2) — documented throw', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [makeDriver(1), makeDriver(2), makeDriver(3)],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2, 3], 1, 10)], // 3 drivers, PAIR expects 2
      policy: CITY,
    };
    expect(() => solveMonthlyGrid(input)).toThrow(/Crew size mismatch/);
  });

  // ── 13. Crew with 0 drivers under PAIR policy ────────────────────────────

  test('E-13: crew with 0 driverIds under PAIR (size=2) — documented throw', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [], 1, 10)], // 0 drivers, PAIR expects 2
      policy: CITY,
    };
    expect(() => solveMonthlyGrid(input)).toThrow(/Crew size mismatch/);
  });

  // ── 14. Driver referenced in crew but NOT in input.drivers ───────────────

  test('E-14: crew references driverId=99 not in input.drivers', () => {
    // Driver 99 is in the crew but not in the drivers array.
    // checkAssignment returns a sentinel violation for unknown drivers,
    // so pickDriver should skip them — no crash.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 99], 1, 10)], // 99 is NOT in drivers — PAIR size ok
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-14', input, output);
    // No slot should reference ghost driver 99
    const ghostSlots = output.slots.filter((s) => s.driverId === 99);
    expect(ghostSlots).toHaveLength(0);
  });

  // ── 15. Bus referenced in crew but NOT in input.buses ────────────────────

  test('E-15: crew references busId=999 not in input.buses', () => {
    // The crew points to busId=999 but input.buses only has busId=1.
    // crewByBus will have entry for bus 999, but the Phase B loop only iterates
    // over input.buses — bus 999 is never iterated, so no demand for it.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 999, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 999, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)], // bus 999 is NOT here
      crews: [makeCrew('C1', [1, 2], 999, 10)], // crew points to missing bus
      policy: CITY,
    };
    let output!: SolverOutput;
    // normalizeToCrews returns the crew, but bus 999 is not in input.buses loop
    // → no slots generated for it.  Should not crash.
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-15', input, output);
    // Bus 1 has no crew → demand = 0 (crewByBus.get(1) is undefined)
    // Bus 999 has a crew but is not in input.buses → 0 demand
    expect(output.slots).toHaveLength(0);
    expect(output.unfilled).toHaveLength(0);
  });

  // ── 16. Duplicate driver ids ─────────────────────────────────────────────

  test('E-16: duplicate driver ids in input.drivers — no crash', () => {
    // Two entries with id=1. driverMap deduplicates (Map overwrite).
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, name: 'D1-dup' }), // duplicate id
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    // Don't run full assertInvariants with the duplicate driver in driverIds set
    // because demand calculation uses input.buses but phantom-check uses input.drivers.
    // Just verify no crash and metrics sanity.
    expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
    expect(output.metrics.restCycleCompliance).toBeGreaterThanOrEqual(0);
    expect(output.metrics.restCycleCompliance).toBeLessThanOrEqual(1);
  });

  // ── 17. Duplicate bus ids ────────────────────────────────────────────────

  test('E-17: duplicate bus ids in input.buses — no crash', () => {
    // Two buses with id=1. Both will be iterated in Phase B, doubling the demand
    // for bus 1 slots. Should not crash.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10), makeBus(1, 10)], // duplicate busId=1
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    // At minimum: no crash, unfilledCount === unfilled.length
    expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
    expect(Number.isNaN(output.metrics.fairnessScore)).toBe(false);
    expect(Number.isFinite(output.metrics.fairnessScore)).toBe(true);
  });

  // ── 18. localSearchIterations = 0 ────────────────────────────────────────

  test('E-18: localSearchIterations = 0', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 0,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-18', input, output);
  });

  // ── 19. localSearchIterations very large ─────────────────────────────────

  test('E-19: localSearchIterations = 50_000 (large)', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 50_000,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-19', input, output);
  }, 30_000);

  // ── 20. operatingDates = [] for all buses ────────────────────────────────

  test('E-20: operatingDates=[] for all buses — 0 demand, no crash', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10, [])], // empty operating dates
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-20', input, output);
    expect(output.slots).toHaveLength(0);
    expect(output.unfilled).toHaveLength(0);
  });

  // ── 21. operatingDates with dates entirely outside the month ─────────────

  test('E-21: operatingDates only has dates from a different month', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH, // May 2026
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10, ['2026-04-01', '2026-04-15', '2026-06-01'])], // all outside May
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    // The solver only iterates over days in the month; dates from other months are ignored.
    // operatingDates check: bus.operatingDates.includes(day) — day is a May date,
    // none of the operatingDates are May → all days skipped → 0 slots.
    assertInvariants('E-21', input, output);
    expect(output.slots).toHaveLength(0);
    expect(output.unfilled).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────
// INV-3 stricter accounting tests
// ─────────────────────────────────────────────

describe('edge-degenerate: INV-3 slot accounting', () => {

  test('E-22: 2 buses, 1 crew each (CITY_2SHIFT) — slots + unfilled = 31 * 2 * 2', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
      ],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    const days = monthDates(YEAR, MONTH).length; // 31 days in May
    expect(output.slots.length + output.unfilled.length).toBe(days * 2 /* buses */ * 2 /* AM+PM */);
    assertInvariants('E-22', input, output);
  });

  test('E-23: VILLAGE_1SHIFT 1 bus — slots + unfilled = 31 days * 1 shift', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [makeDriver(1, { homeBusId: 1, homeRouteId: 10 })],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1], 1, 10)],
      policy: VILLAGE,
    };
    const output = solveMonthlyGrid(input);
    expect(output.slots.length + output.unfilled.length).toBe(31);
    assertInvariants('E-23', input, output);
  });

  test('E-24: operatingDates covers only 3 days — demand = 3 * shifts', () => {
    const threeDays = ['2026-05-05', '2026-05-10', '2026-05-15'];
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10, threeDays)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    // 3 days × 2 shifts = 6 total
    expect(output.slots.length + output.unfilled.length).toBe(6);
    assertInvariants('E-24', input, output);
  });

});

// ─────────────────────────────────────────────
// INV-4 & INV-5: restCycleCompliance range + no NaN
// ─────────────────────────────────────────────

describe('edge-degenerate: INV-4 restCycleCompliance + INV-5 no NaN', () => {

  test('E-25: 0 drivers 0 buses — restCycleCompliance=1 (by code: empty workloads → 1)', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [], buses: [], crews: [],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    expect(output.metrics.restCycleCompliance).toBe(1);
  });

  test('E-26: all slots unfilled — restCycleCompliance in [0,1], no NaN', () => {
    const allDays = monthDates(YEAR, MONTH);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    expect(output.metrics.restCycleCompliance).toBeGreaterThanOrEqual(0);
    expect(output.metrics.restCycleCompliance).toBeLessThanOrEqual(1);
    for (const val of Object.values(output.metrics)) {
      if (typeof val === 'number') {
        expect(Number.isNaN(val)).toBe(false);
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });

});

// ─────────────────────────────────────────────
// INV-7: scheduleQuality on extreme outputs
// ─────────────────────────────────────────────

describe('edge-degenerate: INV-7 scheduleQuality', () => {

  test('E-27: scheduleQuality on 0 drivers output — no throw, compositeScore in [0,100]', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [], buses: [], crews: [],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    let report: ReturnType<typeof scheduleQuality> | undefined;
    expect(() => { report = scheduleQuality(input, output); }).not.toThrow();
    expect(report!.compositeScore).toBeGreaterThanOrEqual(0);
    expect(report!.compositeScore).toBeLessThanOrEqual(100);
    expect(Number.isNaN(report!.compositeScore)).toBe(false);
    // activeDriverRate: ratedDrivers.length === 0 → code returns 1
    expect(report!.activeDriverRate).toBe(1);
  });

  test('E-28: scheduleQuality on all-unfilled output — no NaN', () => {
    const allDays = monthDates(YEAR, MONTH);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    expect(output.slots).toHaveLength(0);
    let report: ReturnType<typeof scheduleQuality> | undefined;
    expect(() => { report = scheduleQuality(input, output); }).not.toThrow();
    expect(Number.isNaN(report!.compositeScore)).toBe(false);
    expect(Number.isNaN(report!.workDayStdev)).toBe(false);
    expect(Number.isNaN(report!.nightStdev)).toBe(false);
    expect(Number.isNaN(report!.weekendStdev)).toBe(false);
    expect(report!.compositeScore).toBeGreaterThanOrEqual(0);
    expect(report!.compositeScore).toBeLessThanOrEqual(100);
    expect(report!.unfilledRate).toBe(1); // all unfilled
  });

  test('E-29: scheduleQuality on 1-driver fully-idle output', () => {
    // 1 driver with all days off → workDays=0, idleDriverCount=1
    const allDays = monthDates(YEAR, MONTH);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    let report: ReturnType<typeof scheduleQuality> | undefined;
    expect(() => { report = scheduleQuality(input, output); }).not.toThrow();
    expect(report!.idleDriverCount).toBe(2);
    expect(report!.activeDriverRate).toBe(0);
    expect(Number.isNaN(report!.compositeScore)).toBe(false);
    expect(report!.compositeScore).toBeGreaterThanOrEqual(0);
  });

  test('E-30: scheduleQuality when no policy is provided (input.policy=undefined)', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      // policy intentionally omitted → defaults to CITY_2SHIFT
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    let report: ReturnType<typeof scheduleQuality> | undefined;
    // scheduleQuality uses input.policy which is undefined here
    expect(() => { report = scheduleQuality(input, output); }).not.toThrow();
    expect(Number.isNaN(report!.compositeScore)).toBe(false);
    expect(report!.compositeScore).toBeGreaterThanOrEqual(0);
    expect(report!.compositeScore).toBeLessThanOrEqual(100);
  });

});

// ─────────────────────────────────────────────
// INV-6: no phantom assignments
// ─────────────────────────────────────────────

describe('edge-degenerate: INV-6 no phantom assignments', () => {

  test('E-31: phantom driverId in crew — assigned slots only reference known drivers', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      // crew references driver 999 (not in drivers)
      crews: [makeCrew('C1', [1, 99], 1, 10)], // PAIR size=2 but 99 is ghost
      policy: CITY,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    const knownIds = new Set(input.drivers.map((d) => d.id));
    for (const s of output.slots) {
      expect(knownIds.has(s.driverId)).toBe(true);
    }
  });

  test('E-32: normal run — all slots reference valid driver and bus ids', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 20 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20 }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    assertInvariants('E-32', input, output);
  });

});

// ─────────────────────────────────────────────
// Additional: workloadEval / quality rate bounds
// ─────────────────────────────────────────────

describe('edge-degenerate: rate bounds and quality sanity', () => {

  test('E-33: withinTargetRate and withinAcceptableRate in [0,1] for all-unfilled', () => {
    const allDays = monthDates(YEAR, MONTH);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: allDays }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    expect(output.metrics.withinTargetRate).toBeGreaterThanOrEqual(0);
    expect(output.metrics.withinTargetRate).toBeLessThanOrEqual(1);
    expect(output.metrics.withinAcceptableRate).toBeGreaterThanOrEqual(0);
    expect(output.metrics.withinAcceptableRate).toBeLessThanOrEqual(1);
    expect(output.metrics.homeBusRate).toBeGreaterThanOrEqual(0);
    expect(output.metrics.homeBusRate).toBeLessThanOrEqual(1);
    expect(output.metrics.crossRouteRate).toBeGreaterThanOrEqual(0);
    expect(output.metrics.crossRouteRate).toBeLessThanOrEqual(1);
  });

  test('E-34: metrics.fairnessScore in [0, 100]', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    expect(output.metrics.fairnessScore).toBeGreaterThanOrEqual(0);
    expect(output.metrics.fairnessScore).toBeLessThanOrEqual(100);
  });

  test('E-35: weeklyShiftConsistencyRate in [0,1] for 0 slots case', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [], buses: [], crews: [],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    // By code: weeklyShifts.size=0 → weeklyShiftConsistencyRate = 1
    expect(output.metrics.weeklyShiftConsistencyRate).toBe(1);
  });

  test('E-36: VILLAGE_1SHIFT 1 driver fully-booked — no NaN metrics', () => {
    // Only 1 driver with 1 bus, SOLO policy. Driver will be overloaded.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [makeDriver(1, { homeBusId: 1, homeRouteId: 10 })],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1], 1, 10)],
      policy: VILLAGE,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-36', input, output);
  });

  test('E-37: spareUtilizationRate=null when no spare drivers', () => {
    // All drivers have homeBusId — no spares → spareIds empty → spareUtilizationRate=null
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    const report = scheduleQuality(input, output);
    expect(report.spareUtilizationRate).toBeNull();
  });

  test('E-38: scheduleQuality on empty output does not divide by zero (totalSlots=0)', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [], buses: [], crews: [],
      policy: CITY,
    };
    const output = solveMonthlyGrid(input);
    // totalSlots = 0, code has: unfilledRate = totalSlots === 0 ? 0 : ...
    const report = scheduleQuality(input, output);
    expect(report.unfilledRate).toBe(0);
    expect(Number.isNaN(report.unfilledRate)).toBe(false);
  });

  test('E-39: applySwap ctx integrity — INV-6 holds after heavy local-search swaps', () => {
    // Stress the swap path: 4 buses, 8 drivers (2 per bus), same route.
    // Large localSearchIterations forces many swap evaluations.
    // Post-run: every slot's driverId must still reference a known driver.
    const buses = [1, 2, 3, 4].map((id) => makeBus(id, 10));
    const drivers: SolverDriver[] = [];
    const crews: SolverCrew[] = [];
    for (let busIdx = 0; busIdx < 4; busIdx++) {
      const busId = busIdx + 1;
      const dA = makeDriver(busIdx * 2 + 1, { homeBusId: busId, homeRouteId: 10 });
      const dB = makeDriver(busIdx * 2 + 2, { homeBusId: busId, homeRouteId: 10 });
      drivers.push(dA, dB);
      crews.push(makeCrew(`C${busId}`, [dA.id, dB.id], busId, 10));
    }
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers, buses, crews,
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 42,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    assertInvariants('E-39', input, output);
  });

  test('E-40: applySwap with only 2 slots total (minimum swap scenario)', () => {
    // 1 bus, 2 drivers, only 1 operating day → exactly 2 slots (AM + PM).
    // Swap loop picks from 2 slots; exercises swap path at minimum.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10, ['2026-05-15'])], // 1 operating day
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 1000,
    };
    let output!: SolverOutput;
    expect(() => { output = solveMonthlyGrid(input); }).not.toThrow();
    // 1 day * 2 shifts = 2 total demand
    expect(output.slots.length + output.unfilled.length).toBe(2);
    assertInvariants('E-40', input, output);
  });

});
