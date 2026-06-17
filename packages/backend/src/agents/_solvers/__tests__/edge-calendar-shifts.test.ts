/**
 * Adversarial edge-case validation: calendar boundaries + all shift systems + determinism.
 *
 * Invariants tested:
 *   INV-1  No crash for any (month, shiftSystem) combo.
 *   INV-2  Day count correct (Feb=28/29, etc.); no slot dated outside the target month.
 *   INV-3  Slot demand accounting; metrics.unfilledCount === unfilled.length; no NaN/Infinity.
 *   INV-4  Determinism: same input twice → identical output.
 *   INV-5  ALTERNATING_DAY: bus only operates on its on-cycle days.
 *   INV-6  quality nightStdev reflects the correct night label (THREE_SHIFT→NIGHT, TWO_SHIFT→PM).
 *
 * Additional dimension coverage:
 *   - Weekend detection at month-start/end boundaries (month starting on Sunday).
 *   - carryOverPattern with extreme consecutiveWorkDays (30), lastWeekDominantShift='MIXED'.
 */

import { solveMonthlyGrid } from '../monthly-grid-solver';
import { scheduleQuality } from '../quality';
import type {
  SolverInput,
  SolverDriver,
  SolverBus,
  SolverCrew,
  CompanyPolicy,
  ShiftSystemPolicy,
  CrewModelPolicy,
} from '../types';
import { POLICY_PRESETS } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSoloDriver(id: number, routeId: number, busId?: number): SolverDriver {
  return {
    id,
    name: `D${id}`,
    homeBusId: busId,
    homeRouteId: routeId,
    approvedDayOffs: [],
    recentFatigueScore: 20,
    isNewHire: false,
    canCrossRoute: false,
  };
}

function makePairDriver(id: number, routeId: number, busId: number, partnerId: number): SolverDriver {
  return {
    id,
    name: `D${id}`,
    homeBusId: busId,
    homeRouteId: routeId,
    partnerId,
    approvedDayOffs: [],
    recentFatigueScore: 20,
    isNewHire: false,
    canCrossRoute: false,
  };
}

function makeTrioDriver(id: number, routeId: number, busId: number): SolverDriver {
  return {
    id,
    name: `D${id}`,
    homeBusId: busId,
    homeRouteId: routeId,
    approvedDayOffs: [],
    recentFatigueScore: 20,
    isNewHire: false,
    canCrossRoute: false,
  };
}

/** Build a custom CompanyPolicy starting from a preset, swapping the shiftSystem. */
function makePolicy(
  shiftSystem: ShiftSystemPolicy,
  crewModel: CrewModelPolicy,
  nightShifts: string[],
): CompanyPolicy {
  const base = POLICY_PRESETS.CITY_2SHIFT;
  return {
    ...base,
    preset: undefined, // custom
    shiftSystem,
    crewModel,
    constitutional: {
      ...base.constitutional,
      noNightStreak: {
        enabled: nightShifts.length > 0,
        maxConsecutive: 3,
        nightShifts,
      },
      // Relax workday rules so the solver can actually fill a 28-day Feb with tight schedules
      weeklyMaxWorkDays: { enabled: true, maxDays: 7 },
    },
    workdayBands: {
      hardMin: 0,
      hardMax: 35,
      sweetMin: 1,
      sweetMax: 30,
      belowSweetPenalty: 0,
      aboveSweetPenalty: 0,
    },
    restCycle: { workDays: 6, restDays: 1, consecutiveRest: false },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO_SHIFT helpers
// ─────────────────────────────────────────────────────────────────────────────

/** 4 buses × 2-driver pair each on route 100. Total 8 drivers. */
function buildTwoShiftInput(year: number, month: number): SolverInput {
  const policy: CompanyPolicy = {
    ...POLICY_PRESETS.CITY_2SHIFT,
    workdayBands: {
      hardMin: 0,
      hardMax: 35,
      sweetMin: 1,
      sweetMax: 30,
      belowSweetPenalty: 0,
      aboveSweetPenalty: 0,
    },
    restCycle: { workDays: 6, restDays: 1, consecutiveRest: false },
    constitutional: {
      ...POLICY_PRESETS.CITY_2SHIFT.constitutional,
      weeklyMaxWorkDays: { enabled: true, maxDays: 7 },
    },
  };

  const buses: SolverBus[] = [
    { id: 1, routeId: 100 },
    { id: 2, routeId: 100 },
    { id: 3, routeId: 100 },
    { id: 4, routeId: 100 },
  ];
  const drivers: SolverDriver[] = [
    makePairDriver(1, 100, 1, 2),
    makePairDriver(2, 100, 1, 1),
    makePairDriver(3, 100, 2, 4),
    makePairDriver(4, 100, 2, 3),
    makePairDriver(5, 100, 3, 6),
    makePairDriver(6, 100, 3, 5),
    makePairDriver(7, 100, 4, 8),
    makePairDriver(8, 100, 4, 7),
  ];
  const crews: SolverCrew[] = [
    { id: 'C1', driverIds: [1, 2], busId: 1, routeId: 100 },
    { id: 'C2', driverIds: [3, 4], busId: 2, routeId: 100 },
    { id: 'C3', driverIds: [5, 6], busId: 3, routeId: 100 },
    { id: 'C4', driverIds: [7, 8], busId: 4, routeId: 100 },
  ];
  return {
    year,
    month,
    drivers,
    buses,
    crews,
    policy,
    localSearchIterations: 100,
    randomSeed: 42,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE_SHIFT helpers
// ─────────────────────────────────────────────────────────────────────────────

/** 4 buses × 1-driver SOLO each on route 200. */
function buildOneShiftInput(year: number, month: number): SolverInput {
  const policy: CompanyPolicy = makePolicy(
    { kind: 'ONE_SHIFT', slots: ['FULL_DAY'] },
    { kind: 'SOLO', size: 1 },
    [],
  );

  const buses: SolverBus[] = [
    { id: 10, routeId: 200 },
    { id: 11, routeId: 200 },
    { id: 12, routeId: 200 },
    { id: 13, routeId: 200 },
  ];
  const drivers: SolverDriver[] = [
    makeSoloDriver(10, 200, 10),
    makeSoloDriver(11, 200, 11),
    makeSoloDriver(12, 200, 12),
    makeSoloDriver(13, 200, 13),
    // Spare (no home bus)
    makeSoloDriver(14, 200),
    makeSoloDriver(15, 200),
  ];
  const crews: SolverCrew[] = [
    { id: 'S1', driverIds: [10], busId: 10, routeId: 200 },
    { id: 'S2', driverIds: [11], busId: 11, routeId: 200 },
    { id: 'S3', driverIds: [12], busId: 12, routeId: 200 },
    { id: 'S4', driverIds: [13], busId: 13, routeId: 200 },
  ];
  return {
    year,
    month,
    drivers,
    buses,
    crews,
    policy,
    localSearchIterations: 100,
    randomSeed: 42,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE_SHIFT helpers
// ─────────────────────────────────────────────────────────────────────────────

/** 2 buses × TRIO each on route 300. 9 drivers total (3 per bus + 3 spares). */
function buildThreeShiftInput(year: number, month: number): SolverInput {
  const policy: CompanyPolicy = makePolicy(
    { kind: 'THREE_SHIFT', slots: ['MORNING', 'AFTERNOON', 'NIGHT'] },
    { kind: 'TRIO', size: 3 },
    ['NIGHT'],
  );

  const buses: SolverBus[] = [
    { id: 20, routeId: 300 },
    { id: 21, routeId: 300 },
  ];
  const drivers: SolverDriver[] = [
    makeTrioDriver(20, 300, 20),
    makeTrioDriver(21, 300, 20),
    makeTrioDriver(22, 300, 20),
    makeTrioDriver(23, 300, 21),
    makeTrioDriver(24, 300, 21),
    makeTrioDriver(25, 300, 21),
    // Spare (no home bus)
    makeSoloDriver(26, 300),
    makeSoloDriver(27, 300),
    makeSoloDriver(28, 300),
  ];
  const crews: SolverCrew[] = [
    { id: 'T1', driverIds: [20, 21, 22], busId: 20, routeId: 300 },
    { id: 'T2', driverIds: [23, 24, 25], busId: 21, routeId: 300 },
  ];
  return {
    year,
    month,
    drivers,
    buses,
    crews,
    policy,
    localSearchIterations: 100,
    randomSeed: 42,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALTERNATING_DAY helpers
// ─────────────────────────────────────────────────────────────────────────────

/** 4 buses × SOLO on route 400, ALTERNATING_DAY with given periodDays. */
function buildAlternatingInput(year: number, month: number, periodDays: number): SolverInput {
  const policy: CompanyPolicy = makePolicy(
    { kind: 'ALTERNATING_DAY', slots: ['ON_DUTY'], periodDays },
    { kind: 'SOLO', size: 1 },
    [],
  );

  const buses: SolverBus[] = [
    { id: 30, routeId: 400 },
    { id: 31, routeId: 400 },
    { id: 32, routeId: 400 },
    { id: 33, routeId: 400 },
  ];
  const drivers: SolverDriver[] = [
    makeSoloDriver(30, 400, 30),
    makeSoloDriver(31, 400, 31),
    makeSoloDriver(32, 400, 32),
    makeSoloDriver(33, 400, 33),
    makeSoloDriver(34, 400),
    makeSoloDriver(35, 400),
  ];
  const crews: SolverCrew[] = [
    { id: 'A1', driverIds: [30], busId: 30, routeId: 400 },
    { id: 'A2', driverIds: [31], busId: 31, routeId: 400 },
    { id: 'A3', driverIds: [32], busId: 32, routeId: 400 },
    { id: 'A4', driverIds: [33], busId: 33, routeId: 400 },
  ];
  return {
    year,
    month,
    drivers,
    buses,
    crews,
    policy,
    localSearchIterations: 100,
    randomSeed: 42,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isInsideMonth(dateStr: string, year: number, month: number): boolean {
  return dateStr.startsWith(`${year}-${String(month).padStart(2, '0')}-`);
}

function hasNaN(output: ReturnType<typeof solveMonthlyGrid>): boolean {
  const m = output.metrics;
  return [
    m.fairnessScore,
    m.workDayStdev,
    m.workDayMean,
    m.withinTargetRate,
    m.withinAcceptableRate,
    m.homeBusRate,
    m.crossRouteRate,
    m.restCycleCompliance,
    m.weeklyShiftConsistencyRate,
    m.weekendStdev,
    m.dayOffSatisfactionRate,
  ].some((v) => v === null || isNaN(v as number) || !isFinite(v as number));
}

// ─────────────────────────────────────────────────────────────────────────────
// INV-2: Expected day counts
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-2: Day enumeration and month boundary', () => {
  const cases: Array<{ label: string; year: number; month: number; expectedDays: number }> = [
    { label: 'Feb non-leap 2026', year: 2026, month: 2, expectedDays: 28 },
    { label: 'Feb leap 2028', year: 2028, month: 2, expectedDays: 29 },
    { label: '30-day month (April 2026)', year: 2026, month: 4, expectedDays: 30 },
    { label: '31-day month (May 2026)', year: 2026, month: 5, expectedDays: 31 },
    { label: 'December 2026', year: 2026, month: 12, expectedDays: 31 },
    { label: 'January 2026', year: 2026, month: 1, expectedDays: 31 },
  ];

  for (const { label, year, month, expectedDays } of cases) {
    test(`${label} → ${expectedDays} days; no slot outside month`, () => {
      const input = buildTwoShiftInput(year, month);
      const output = solveMonthlyGrid(input);

      // All assigned slot dates must be inside the target month
      const outOfBound = output.slots.filter((s) => !isInsideMonth(s.date, year, month));
      expect(outOfBound).toHaveLength(0);

      // All unfilled slot dates must also be inside the target month
      const unfilledOutOfBound = output.unfilled.filter((u) => !isInsideMonth(u.date, year, month));
      expect(unfilledOutOfBound).toHaveLength(0);

      // Distinct slot dates should be a subset of [expectedDays] available dates
      const slotDates = new Set(output.slots.map((s) => s.date));
      const unfilledDates = new Set(output.unfilled.map((u) => u.date));
      const allDates = new Set([...slotDates, ...unfilledDates]);
      expect(allDates.size).toBeLessThanOrEqual(expectedDays);

      // Verify daysInMonth helper agrees
      expect(daysInMonth(year, month)).toBe(expectedDays);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-1 + INV-3: No crash; metrics sane for every (month, shiftSystem) combo
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-1 + INV-3: No crash; no NaN metrics across all months × shift systems', () => {
  const months = [
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
    { year: 2028, month: 2 },
    { year: 2026, month: 4 },
    { year: 2026, month: 5 },
    { year: 2026, month: 12 },
  ];

  describe('TWO_SHIFT', () => {
    for (const { year, month } of months) {
      test(`${year}-${String(month).padStart(2, '0')}`, () => {
        const input = buildTwoShiftInput(year, month);
        const output = solveMonthlyGrid(input);

        // INV-1: No crash (if we're here, no throw)
        expect(output).toBeDefined();

        // INV-3a: unfilledCount consistency
        expect(output.metrics.unfilledCount).toBe(output.unfilled.length);

        // INV-3b: No NaN/Infinity in metrics
        expect(hasNaN(output)).toBe(false);
      });
    }
  });

  describe('ONE_SHIFT', () => {
    for (const { year, month } of months) {
      test(`${year}-${String(month).padStart(2, '0')}`, () => {
        const input = buildOneShiftInput(year, month);
        const output = solveMonthlyGrid(input);
        expect(output).toBeDefined();
        expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
        expect(hasNaN(output)).toBe(false);
      });
    }
  });

  describe('THREE_SHIFT', () => {
    for (const { year, month } of months) {
      test(`${year}-${String(month).padStart(2, '0')}`, () => {
        const input = buildThreeShiftInput(year, month);
        const output = solveMonthlyGrid(input);
        expect(output).toBeDefined();
        expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
        expect(hasNaN(output)).toBe(false);
      });
    }
  });

  describe('ALTERNATING_DAY period=2', () => {
    for (const { year, month } of months) {
      test(`${year}-${String(month).padStart(2, '0')}`, () => {
        const input = buildAlternatingInput(year, month, 2);
        const output = solveMonthlyGrid(input);
        expect(output).toBeDefined();
        expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
        expect(hasNaN(output)).toBe(false);
      });
    }
  });

  describe('ALTERNATING_DAY period=3', () => {
    for (const { year, month } of months) {
      test(`${year}-${String(month).padStart(2, '0')}`, () => {
        const input = buildAlternatingInput(year, month, 3);
        const output = solveMonthlyGrid(input);
        expect(output).toBeDefined();
        expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
        expect(hasNaN(output)).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-3: Slot demand accounting
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-3: Slot demand accounting (total = assigned + unfilled)', () => {
  /**
   * Total slots that COULD be generated = operating days × buses × slotsPerDay.
   * For ALTERNATING_DAY we need to count how many days each bus actually falls on-cycle.
   * Because the solver may further filter by crew availability, we only assert:
   *   output.slots.length + output.unfilled.length >= 0   (trivially true)
   * but also:
   *   every slot has shift in policy.shiftSystem.slots
   */

  test('TWO_SHIFT: every assigned/unfilled slot has shift AM or PM', () => {
    const input = buildTwoShiftInput(2026, 5);
    const output = solveMonthlyGrid(input);
    const valid = new Set(['AM', 'PM']);
    for (const s of output.slots) {
      expect(valid.has(s.shift)).toBe(true);
    }
    for (const u of output.unfilled) {
      expect(valid.has(u.shift)).toBe(true);
    }
  });

  test('ONE_SHIFT: every slot has shift FULL_DAY', () => {
    const input = buildOneShiftInput(2026, 5);
    const output = solveMonthlyGrid(input);
    for (const s of output.slots) expect(s.shift).toBe('FULL_DAY');
    for (const u of output.unfilled) expect(u.shift).toBe('FULL_DAY');
  });

  test('THREE_SHIFT: every slot has shift MORNING, AFTERNOON, or NIGHT', () => {
    const input = buildThreeShiftInput(2026, 5);
    const output = solveMonthlyGrid(input);
    const valid = new Set(['MORNING', 'AFTERNOON', 'NIGHT']);
    for (const s of output.slots) expect(valid.has(s.shift)).toBe(true);
    for (const u of output.unfilled) expect(valid.has(u.shift)).toBe(true);
  });

  test('ALTERNATING_DAY period=2: every slot has shift ON_DUTY', () => {
    const input = buildAlternatingInput(2026, 5, 2);
    const output = solveMonthlyGrid(input);
    for (const s of output.slots) expect(s.shift).toBe('ON_DUTY');
    for (const u of output.unfilled) expect(u.shift).toBe('ON_DUTY');
  });

  test('ALTERNATING_DAY period=3: every slot has shift ON_DUTY', () => {
    const input = buildAlternatingInput(2026, 5, 3);
    const output = solveMonthlyGrid(input);
    for (const s of output.slots) expect(s.shift).toBe('ON_DUTY');
    for (const u of output.unfilled) expect(u.shift).toBe('ON_DUTY');
  });

  test('Feb 2026 TWO_SHIFT: total assigned+unfilled ≤ 28 × buses × 2', () => {
    const input = buildTwoShiftInput(2026, 2);
    const output = solveMonthlyGrid(input);
    const maxSlots = 28 * 4 * 2; // 28 days × 4 buses × 2 shifts
    expect(output.slots.length + output.unfilled.length).toBeLessThanOrEqual(maxSlots);
  });

  test('Feb 2028 TWO_SHIFT: total assigned+unfilled ≤ 29 × buses × 2', () => {
    const input = buildTwoShiftInput(2028, 2);
    const output = solveMonthlyGrid(input);
    const maxSlots = 29 * 4 * 2;
    expect(output.slots.length + output.unfilled.length).toBeLessThanOrEqual(maxSlots);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-4: Determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-4: Determinism — same input → identical output', () => {
  const combos: Array<{ label: string; input: SolverInput }> = [
    { label: 'TWO_SHIFT May 2026', input: buildTwoShiftInput(2026, 5) },
    { label: 'TWO_SHIFT Feb 2026', input: buildTwoShiftInput(2026, 2) },
    { label: 'TWO_SHIFT Feb 2028', input: buildTwoShiftInput(2028, 2) },
    { label: 'ONE_SHIFT Dec 2026', input: buildOneShiftInput(2026, 12) },
    { label: 'THREE_SHIFT Jan 2026', input: buildThreeShiftInput(2026, 1) },
    { label: 'ALTERNATING_DAY p=2 Apr 2026', input: buildAlternatingInput(2026, 4, 2) },
    { label: 'ALTERNATING_DAY p=3 Apr 2026', input: buildAlternatingInput(2026, 4, 3) },
  ];

  for (const { label, input } of combos) {
    test(label, () => {
      const out1 = solveMonthlyGrid(input);
      const out2 = solveMonthlyGrid(input);

      // Same slot arrays (order + content)
      expect(out1.slots.length).toBe(out2.slots.length);
      expect(out1.unfilled.length).toBe(out2.unfilled.length);

      // Deep-equal slot by slot
      for (let i = 0; i < out1.slots.length; i++) {
        expect(out1.slots[i]).toEqual(out2.slots[i]);
      }
      for (let i = 0; i < out1.unfilled.length; i++) {
        expect(out1.unfilled[i]).toEqual(out2.unfilled[i]);
      }

      // Metrics identical
      expect(out1.metrics).toEqual(out2.metrics);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-5: ALTERNATING_DAY — bus only operates on its on-cycle days
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-5: ALTERNATING_DAY bus on-cycle enforcement', () => {
  /**
   * From the solver source (monthly-grid-solver.ts, Phase B):
   *   if (policy.shiftSystem.kind === 'ALTERNATING_DAY') {
   *     const period = policy.shiftSystem.periodDays;
   *     const dayIdx = Math.floor(
   *       (parseDate(day).getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000),
   *     );
   *     if ((dayIdx + bus.id) % period !== 0) continue;
   *   }
   *
   * So bus.id operates on day index dayIdx iff (dayIdx + busId) % period === 0.
   * We verify every assigned/unfilled slot satisfies this.
   */

  for (const periodDays of [2, 3]) {
    for (const { year, month } of [
      { year: 2026, month: 2 },
      { year: 2028, month: 2 },
      { year: 2026, month: 5 },
      { year: 2026, month: 12 },
    ]) {
      test(`period=${periodDays} ${year}-${String(month).padStart(2, '0')}: no slots on off-cycle days`, () => {
        const input = buildAlternatingInput(year, month, periodDays);
        const output = solveMonthlyGrid(input);

        const monthStart = new Date(Date.UTC(year, month - 1, 1));

        // Check assigned slots
        for (const slot of output.slots) {
          const slotDate = new Date(`${slot.date}T00:00:00Z`);
          const dayIdx = Math.round((slotDate.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000));
          const isOnCycle = (dayIdx + slot.busId) % periodDays === 0;
          expect(isOnCycle).toBe(true);
        }

        // Check unfilled slots (they should also only be generated on on-cycle days)
        for (const slot of output.unfilled) {
          const slotDate = new Date(`${slot.date}T00:00:00Z`);
          const dayIdx = Math.round((slotDate.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000));
          const isOnCycle = (dayIdx + slot.busId) % periodDays === 0;
          expect(isOnCycle).toBe(true);
        }
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-6: Night-shift fairness in quality.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('INV-6: quality.scheduleQuality nightStdev uses correct night label', () => {
  test('THREE_SHIFT: nightStdev counts NIGHT shifts (not zero when NIGHT slots exist)', () => {
    const input = buildThreeShiftInput(2026, 5);
    const output = solveMonthlyGrid(input);

    // Confirm there are actually NIGHT slots assigned
    const nightSlots = output.slots.filter((s) => s.shift === 'NIGHT');
    // Skip assertion if solver assigns 0 night slots (edge case for tiny pools)
    if (nightSlots.length === 0) {
      // Still verify nightStdev is 0 and not NaN
      const report = scheduleQuality(input, output);
      expect(isNaN(report.nightStdev)).toBe(false);
      return;
    }

    const report = scheduleQuality(input, output);
    // When NIGHT slots exist and policy has nightSet = {'NIGHT'},
    // nightStdev should be > 0 (unless every driver got exactly the same number of NIGHT shifts,
    // which is possible for small test cases — so we just require it is not NaN).
    expect(isNaN(report.nightStdev)).toBe(false);
    expect(isFinite(report.nightStdev)).toBe(true);

    // More importantly: nightStdev must reflect NIGHT shifts specifically.
    // We manually compute what it should be and compare.
    const driverIds = input.drivers
      .filter((d) => !d.workDayTarget?.exemptReason)
      .map((d) => d.id);

    const nightCountById = new Map<number, number>();
    for (const id of driverIds) nightCountById.set(id, 0);
    for (const s of output.slots) {
      if (s.shift === 'NIGHT' && nightCountById.has(s.driverId)) {
        nightCountById.set(s.driverId, (nightCountById.get(s.driverId) ?? 0) + 1);
      }
    }
    const nightCounts = Array.from(nightCountById.values());
    const mean = nightCounts.reduce((a, b) => a + b, 0) / nightCounts.length;
    const variance = nightCounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / nightCounts.length;
    const expectedStdev = Math.sqrt(variance);

    expect(report.nightStdev).toBeCloseTo(expectedStdev, 5);
  });

  test('TWO_SHIFT: nightStdev counts PM shifts (not MORNING/AFTERNOON)', () => {
    const input = buildTwoShiftInput(2026, 5);
    const output = solveMonthlyGrid(input);

    const pmSlots = output.slots.filter((s) => s.shift === 'PM');
    const report = scheduleQuality(input, output);

    expect(isNaN(report.nightStdev)).toBe(false);
    expect(isFinite(report.nightStdev)).toBe(true);

    if (pmSlots.length > 0) {
      // Manually recompute nightStdev as PM counts
      const driverIds = input.drivers
        .filter((d) => !d.workDayTarget?.exemptReason)
        .map((d) => d.id);

      const pmCountById = new Map<number, number>();
      for (const id of driverIds) pmCountById.set(id, 0);
      for (const s of output.slots) {
        if (s.shift === 'PM' && pmCountById.has(s.driverId)) {
          pmCountById.set(s.driverId, (pmCountById.get(s.driverId) ?? 0) + 1);
        }
      }
      const pmCounts = Array.from(pmCountById.values());
      const mean = pmCounts.reduce((a, b) => a + b, 0) / pmCounts.length;
      const variance = pmCounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / pmCounts.length;
      const expectedStdev = Math.sqrt(variance);

      expect(report.nightStdev).toBeCloseTo(expectedStdev, 5);
    }
  });

  test('ONE_SHIFT: nightStdev is 0 (no night label)', () => {
    const input = buildOneShiftInput(2026, 5);
    const output = solveMonthlyGrid(input);
    const report = scheduleQuality(input, output);
    // ONE_SHIFT has no night label → all night counts are 0 → stdev = 0
    expect(report.nightStdev).toBe(0);
  });

  test('ALTERNATING_DAY period=2: nightStdev is 0 (no night label)', () => {
    const input = buildAlternatingInput(2026, 5, 2);
    const output = solveMonthlyGrid(input);
    const report = scheduleQuality(input, output);
    expect(report.nightStdev).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weekend detection at boundary months
// ─────────────────────────────────────────────────────────────────────────────

describe('Weekend detection at month-start/end boundaries', () => {
  test('2026-02-01 is a Sunday → first day is a weekend day', () => {
    // 2026-02-01 is Sunday (day-of-week = 0)
    const d = new Date(Date.UTC(2026, 1, 1));
    expect(d.getUTCDay()).toBe(0); // Sunday

    const input = buildTwoShiftInput(2026, 2);
    const output = solveMonthlyGrid(input);

    // 2026-02-01 should appear as a weekend day in any slot/workload assigned to it
    const feb1Slots = output.slots.filter((s) => s.date === '2026-02-01');
    // If any slots were assigned on Feb 1, verify they're counted as weekend in workloads
    if (feb1Slots.length > 0) {
      // Any driver who worked 2026-02-01 should have weekendShifts >= 1
      for (const slot of feb1Slots) {
        const wl = output.workloads.find((w) => w.driverId === slot.driverId);
        if (wl) {
          expect(wl.weekendShifts).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test('2026-01-01 is a Thursday → NOT a weekend', () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    expect(d.getUTCDay()).toBe(4); // Thursday — not weekend
  });

  test('2026-04-30 is a Thursday → NOT a weekend', () => {
    const d = new Date(Date.UTC(2026, 3, 30));
    expect(d.getUTCDay()).toBe(4); // Thursday
  });

  test('2026-04-25 is a Saturday → weekend', () => {
    const d = new Date(Date.UTC(2026, 3, 25));
    expect(d.getUTCDay()).toBe(6); // Saturday
    const input = buildTwoShiftInput(2026, 4);
    const output = solveMonthlyGrid(input);

    const apr25Slots = output.slots.filter((s) => s.date === '2026-04-25');
    for (const slot of apr25Slots) {
      const wl = output.workloads.find((w) => w.driverId === slot.driverId);
      if (wl) {
        expect(wl.weekendShifts).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('2026-12-31 is a Thursday → NOT a weekend', () => {
    const d = new Date(Date.UTC(2026, 11, 31));
    expect(d.getUTCDay()).toBe(4); // Thursday
  });

  test('2026-12-26 is a Saturday → weekend', () => {
    const d = new Date(Date.UTC(2026, 11, 26));
    expect(d.getUTCDay()).toBe(6); // Saturday
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// carryOverPattern edge inputs
// ─────────────────────────────────────────────────────────────────────────────

describe('carryOverPattern edge cases', () => {
  function buildInputWithCarryOver(
    year: number,
    month: number,
    consecutiveWorkDays: number,
    lastShift: string | null,
    lastWeekDominantShift: string,
  ): SolverInput {
    const base = buildTwoShiftInput(year, month);
    // Patch driver 1 with carry-over
    const d1 = base.drivers.find((d) => d.id === 1)!;
    const patched: SolverDriver = {
      ...d1,
      carryOverPattern: {
        consecutiveWorkDays,
        lastShift,
        lastWeekDominantShift,
      },
    };
    return {
      ...base,
      drivers: base.drivers.map((d) => (d.id === 1 ? patched : d)),
    };
  }

  test('consecutiveWorkDays=30 (huge): no crash, metrics valid', () => {
    const input = buildInputWithCarryOver(2026, 5, 30, 'AM', 'AM');
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
    expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
    expect(hasNaN(output)).toBe(false);
  });

  test('consecutiveWorkDays=0: no crash', () => {
    const input = buildInputWithCarryOver(2026, 5, 0, null, 'MIXED');
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
    expect(hasNaN(output)).toBe(false);
  });

  test('lastWeekDominantShift=MIXED: no crash, metrics valid', () => {
    const input = buildInputWithCarryOver(2026, 2, 5, 'PM', 'MIXED');
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
    expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
    expect(hasNaN(output)).toBe(false);
  });

  test('lastShift=PM (valid for TWO_SHIFT): no crash', () => {
    const input = buildInputWithCarryOver(2026, 2, 3, 'PM', 'PM');
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
  });

  test('lastShift=null (휴무): no crash', () => {
    const input = buildInputWithCarryOver(2028, 2, 1, null, 'MIXED');
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
  });

  test('consecutiveWorkDays=30 February leap year 2028: no crash, rest cycle handled', () => {
    const input = buildInputWithCarryOver(2028, 2, 30, 'AM', 'MIXED');
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
    expect(output.metrics.unfilledCount).toBe(output.unfilled.length);
    // Driver 1 should likely be blocked from early days due to huge carryOver
    // (they've already worked 30 days consecutively), but no crash is the key.
    expect(hasNaN(output)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: carryOverPattern on THREE_SHIFT and ALTERNATING_DAY (valid values)
// ─────────────────────────────────────────────────────────────────────────────

describe('carryOverPattern valid for non-TWO_SHIFT systems', () => {
  test('THREE_SHIFT lastShift=NIGHT: no crash', () => {
    const base = buildThreeShiftInput(2026, 5);
    const d20 = base.drivers.find((d) => d.id === 20)!;
    const patched: SolverDriver = {
      ...d20,
      carryOverPattern: {
        consecutiveWorkDays: 3,
        lastShift: 'NIGHT',
        lastWeekDominantShift: 'NIGHT',
      },
    };
    const input: SolverInput = {
      ...base,
      drivers: base.drivers.map((d) => (d.id === 20 ? patched : d)),
    };
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
    expect(hasNaN(output)).toBe(false);
  });

  test('ALTERNATING_DAY lastShift=ON_DUTY: no crash', () => {
    const base = buildAlternatingInput(2026, 5, 2);
    const d30 = base.drivers.find((d) => d.id === 30)!;
    const patched: SolverDriver = {
      ...d30,
      carryOverPattern: {
        consecutiveWorkDays: 1,
        lastShift: 'ON_DUTY',
        lastWeekDominantShift: 'ON_DUTY',
      },
    };
    const input: SolverInput = {
      ...base,
      drivers: base.drivers.map((d) => (d.id === 30 ? patched : d)),
    };
    const output = solveMonthlyGrid(input);
    expect(output).toBeDefined();
    expect(hasNaN(output)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: scheduleQuality compositeScore must not be NaN or outside [0,100]
// ─────────────────────────────────────────────────────────────────────────────

describe('scheduleQuality compositeScore is valid for all shift systems', () => {
  const inputs: Array<{ label: string; input: SolverInput }> = [
    { label: 'TWO_SHIFT May 2026', input: buildTwoShiftInput(2026, 5) },
    { label: 'ONE_SHIFT Feb 2026', input: buildOneShiftInput(2026, 2) },
    { label: 'THREE_SHIFT Feb 2028', input: buildThreeShiftInput(2028, 2) },
    { label: 'ALTERNATING p=2 Dec 2026', input: buildAlternatingInput(2026, 12, 2) },
    { label: 'ALTERNATING p=3 Jan 2026', input: buildAlternatingInput(2026, 1, 3) },
  ];

  for (const { label, input } of inputs) {
    test(label, () => {
      const output = solveMonthlyGrid(input);
      const report = scheduleQuality(input, output);
      expect(isNaN(report.compositeScore)).toBe(false);
      expect(isFinite(report.compositeScore)).toBe(true);
      expect(report.compositeScore).toBeGreaterThanOrEqual(0);
      expect(report.compositeScore).toBeLessThanOrEqual(100);
    });
  }
});
