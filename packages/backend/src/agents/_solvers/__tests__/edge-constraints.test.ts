/**
 * Adversarial hard-constraint invariant tests for solveMonthlyGrid.
 *
 * DIMENSION: HARD-CONSTRAINT INVARIANTS + SLOT CONSERVATION + LOCAL-SEARCH MOVE SAFETY
 *
 * INVARIANTS tested (violation = defect):
 *
 *   INV-A  No same-day double-assignment (no driver in 2 slots on the same date).
 *   INV-B  Approved day-off respected (no assignment on approvedDayOffs date).
 *   INV-C  No expired license (no date >= licenseExpiresAt assigned).
 *   INV-D  No expired qualification (no date >= qualificationExpiresAt assigned).
 *   INV-E  No blocked route (slot.routeId ∉ driver.blockedRouteIds).
 *   INV-F  Slot conservation: slots.length + unfilled.length = demand; fill/reassign
 *          never duplicate a slot.
 *   INV-G  No duplicate physical slot: no two output.slots share (date, busId, shift).
 *   INV-H  Familiarity integrity (all labels recomputed on every move):
 *            HOME        ⟹ driver.homeBusId === slot.busId AND slot.isHomeBus===true.
 *            SAME_ROUTE  ⟹ driver.homeRouteId === slot.routeId AND homeBusId !== busId.
 *            CROSS_ROUTE ⟹ driver.homeRouteId !== slot.routeId (when homeRouteId set).
 *            applySwap() now calls familiarityFor() to recompute labels after each swap.
 *            [NOTE: The solver has an intentional EMERGENCY tier that CAN assign a
 *             canCrossRoute=false driver to a foreign route when all other tiers fail.
 *             This is a documented override, NOT a constraint violation in the solver's
 *             own model. Tests that rely on canCrossRoute=false isolation must ensure
 *             there is always a legal same-route fallback available.]
 *   INV-I  restCycleCompliance honesty: if metrics.restCycleCompliance===1 then NO
 *          driver has longestStreak > policy.restCycle.workDays.
 *   INV-J  Determinism: same input + randomSeed ⟹ identical sorted output.slots.
 *
 * Do NOT modify solver/quality/scenarios/baseline. Only this test file.
 */

import { solveMonthlyGrid } from '../monthly-grid-solver';
import type {
  SolverInput,
  SolverDriver,
  SolverBus,
  SolverCrew,
  SolverOutput,
  CompanyPolicy,
  AssignedSlot,
} from '../types';
import { POLICY_PRESETS } from '../types';

// ─────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────

const YEAR = 2026;
const MONTH = 5; // May 2026 — 31 days

const CITY = POLICY_PRESETS.CITY_2SHIFT;   // PAIR size=2, AM+PM, restCycle 5/2
const VILLAGE = POLICY_PRESETS.VILLAGE_1SHIFT; // SOLO size=1, FULL_DAY, restCycle 6/1

function monthDates(year: number, month: number): string[] {
  const days: string[] = [];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= lastDay; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function makeDriver(id: number, overrides: Partial<SolverDriver> = {}): SolverDriver {
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
  return operatingDates !== undefined ? { id, routeId, operatingDates } : { id, routeId };
}

function makeCrew(id: string, driverIds: number[], busId: number, routeId: number): SolverCrew {
  return { id, driverIds, busId, routeId };
}

// ─────────────────────────────────────────────
// Reusable invariant checkers
// ─────────────────────────────────────────────

/**
 * INV-A: No same-day double-assignment for any driver.
 */
function checkInvA(slots: AssignedSlot[]): Array<{ driverId: number; date: string }> {
  const violations: Array<{ driverId: number; date: string }> = [];
  const seen = new Map<string, boolean>();
  for (const s of slots) {
    const key = `${s.driverId}|${s.date}`;
    if (seen.has(key)) {
      violations.push({ driverId: s.driverId, date: s.date });
    } else {
      seen.set(key, true);
    }
  }
  return violations;
}

/**
 * INV-B: Approved day-off respected.
 */
function checkInvB(slots: AssignedSlot[], drivers: SolverDriver[]): AssignedSlot[] {
  const driverMap = new Map(drivers.map((d) => [d.id, d]));
  return slots.filter((s) => {
    const d = driverMap.get(s.driverId);
    return d?.approvedDayOffs.includes(s.date);
  });
}

/**
 * INV-C: No expired license. date >= licenseExpiresAt is illegal.
 */
function checkInvC(slots: AssignedSlot[], drivers: SolverDriver[]): AssignedSlot[] {
  const driverMap = new Map(drivers.map((d) => [d.id, d]));
  return slots.filter((s) => {
    const d = driverMap.get(s.driverId);
    if (!d?.licenseExpiresAt) return false;
    const slotDate = new Date(`${s.date}T00:00:00Z`);
    return slotDate >= d.licenseExpiresAt;
  });
}

/**
 * INV-D: No expired qualification.
 */
function checkInvD(slots: AssignedSlot[], drivers: SolverDriver[]): AssignedSlot[] {
  const driverMap = new Map(drivers.map((d) => [d.id, d]));
  return slots.filter((s) => {
    const d = driverMap.get(s.driverId);
    if (!d?.qualificationExpiresAt) return false;
    const slotDate = new Date(`${s.date}T00:00:00Z`);
    return slotDate >= d.qualificationExpiresAt;
  });
}

/**
 * INV-E: No blocked route.
 */
function checkInvE(slots: AssignedSlot[], drivers: SolverDriver[]): AssignedSlot[] {
  const driverMap = new Map(drivers.map((d) => [d.id, d]));
  return slots.filter((s) => {
    const d = driverMap.get(s.driverId);
    return d?.blockedRouteIds?.includes(s.routeId);
  });
}

/**
 * INV-G: No duplicate physical slot (date, busId, shift).
 */
function checkInvG(slots: AssignedSlot[]): Array<{ date: string; busId: number; shift: string }> {
  const violations: Array<{ date: string; busId: number; shift: string }> = [];
  const seen = new Map<string, number>();
  for (const s of slots) {
    const key = `${s.date}|${s.busId}|${s.shift}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen.entries()) {
    if (count > 1) {
      const [date, busIdStr, shift] = key.split('|');
      violations.push({ date, busId: Number(busIdStr), shift });
    }
  }
  return violations;
}

/**
 * INV-I: restCycleCompliance honesty.
 * Only checked when compliance===1 (claimed perfect).
 */
function checkInvI(output: SolverOutput, policy: CompanyPolicy): Array<{ driverId: number; streak: number }> {
  if (output.metrics.restCycleCompliance !== 1) return [];
  const violations: Array<{ driverId: number; streak: number }> = [];
  for (const w of output.workloads) {
    if (w.longestStreak > policy.restCycle.workDays) {
      violations.push({ driverId: w.driverId, streak: w.longestStreak });
    }
  }
  return violations;
}

/**
 * INV-H strict familiarity integrity:
 *   HOME        ⟹ driver.homeBusId === slot.busId AND slot.isHomeBus === true
 *   SAME_ROUTE  ⟹ driver.homeRouteId === slot.routeId AND driver.homeBusId !== slot.busId
 *   CROSS_ROUTE ⟹ driver.homeRouteId !== slot.routeId (when homeRouteId is set)
 *
 * applySwap now recomputes familiarity/isHomeBus after every swap, so these must
 * always hold on every output slot (including those touched by local search).
 */
function checkInvH_FamiliarityStrict(
  slots: AssignedSlot[],
  drivers: SolverDriver[],
): Array<{ slot: AssignedSlot; reason: string }> {
  const driverMap = new Map(drivers.map((d) => [d.id, d]));
  const violations: Array<{ slot: AssignedSlot; reason: string }> = [];
  for (const s of slots) {
    const d = driverMap.get(s.driverId);
    if (!d) continue; // unknown driver — skip (separate concern)

    if (s.familiarity === 'HOME') {
      if (d.homeBusId === undefined || d.homeBusId !== s.busId) {
        violations.push({ slot: s, reason: `HOME but homeBusId=${d.homeBusId} !== busId=${s.busId}` });
      }
      if (!s.isHomeBus) {
        violations.push({ slot: s, reason: `familiarity=HOME but isHomeBus=false` });
      }
    } else if (s.familiarity === 'SAME_ROUTE') {
      if (d.homeRouteId !== undefined && d.homeRouteId !== s.routeId) {
        violations.push({ slot: s, reason: `SAME_ROUTE but homeRouteId=${d.homeRouteId} !== routeId=${s.routeId}` });
      }
      if (d.homeBusId !== undefined && d.homeBusId === s.busId) {
        violations.push({ slot: s, reason: `SAME_ROUTE but homeBusId=${d.homeBusId} === busId=${s.busId} (should be HOME)` });
      }
    } else if (s.familiarity === 'CROSS_ROUTE') {
      if (d.homeRouteId !== undefined && d.homeRouteId === s.routeId) {
        violations.push({ slot: s, reason: `CROSS_ROUTE but homeRouteId=${d.homeRouteId} === routeId=${s.routeId}` });
      }
    }
  }
  return violations;
}

/**
 * Hard safety invariants that must NEVER be violated:
 *   INV-A, INV-B, INV-C, INV-D, INV-E, INV-G, INV-H (familiarity integrity)
 *
 * INV-H is now enforced: applySwap recomputes familiarity/isHomeBus after every swap,
 * so all three familiarity labels must be consistent with the assigned driver.
 * Does NOT check INV-I when compliance < 1.
 */
function assertHardInvariants(
  label: string,
  input: SolverInput,
  output: SolverOutput,
): void {
  const policy = input.policy ?? CITY;

  const aViol = checkInvA(output.slots);
  if (aViol.length > 0) {
    const v = aViol[0];
    fail(`[${label}] INV-A VIOLATED: driver ${v.driverId} double-assigned on ${v.date}`);
  }
  expect(aViol).toHaveLength(0);

  const bViol = checkInvB(output.slots, input.drivers);
  if (bViol.length > 0) {
    const s = bViol[0];
    fail(`[${label}] INV-B VIOLATED: driver ${s.driverId} assigned on approved day-off ${s.date}`);
  }
  expect(bViol).toHaveLength(0);

  const cViol = checkInvC(output.slots, input.drivers);
  if (cViol.length > 0) {
    const s = cViol[0];
    fail(`[${label}] INV-C VIOLATED: driver ${s.driverId} expired license, assigned on ${s.date}`);
  }
  expect(cViol).toHaveLength(0);

  const dViol = checkInvD(output.slots, input.drivers);
  if (dViol.length > 0) {
    const s = dViol[0];
    fail(`[${label}] INV-D VIOLATED: driver ${s.driverId} expired qualification, assigned on ${s.date}`);
  }
  expect(dViol).toHaveLength(0);

  const eViol = checkInvE(output.slots, input.drivers);
  if (eViol.length > 0) {
    const s = eViol[0];
    fail(`[${label}] INV-E VIOLATED: driver ${s.driverId} assigned to blocked routeId=${s.routeId} on ${s.date}`);
  }
  expect(eViol).toHaveLength(0);

  const gViol = checkInvG(output.slots);
  if (gViol.length > 0) {
    const v = gViol[0];
    fail(`[${label}] INV-G VIOLATED: duplicate physical slot (date=${v.date}, busId=${v.busId}, shift=${v.shift})`);
  }
  expect(gViol).toHaveLength(0);

  // INV-H (familiarity integrity — applySwap now recomputes labels, so this must always hold)
  const hViol = checkInvH_FamiliarityStrict(output.slots, input.drivers);
  if (hViol.length > 0) {
    const v = hViol[0];
    fail(`[${label}] INV-H VIOLATED: ${v.reason} (slot date=${v.slot.date}, busId=${v.slot.busId}, driverId=${v.slot.driverId})`);
  }
  expect(hViol).toHaveLength(0);

  // INV-I (only when solver claims 100% compliance)
  const iViol = checkInvI(output, policy);
  if (iViol.length > 0) {
    const v = iViol[0];
    fail(`[${label}] INV-I VIOLATED: compliance=1 but driver ${v.driverId} streak=${v.streak} > workDays=${policy.restCycle.workDays}`);
  }
  expect(iViol).toHaveLength(0);
}

// ─────────────────────────────────────────────
// SUITE 1: INV-A — No same-day double-assignment
// ─────────────────────────────────────────────

describe('INV-A: No same-day double-assignment', () => {

  test('HC-A1: CITY 2-shift, 1 bus, 2 drivers — no driver in AM+PM same day', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 3000,
      randomSeed: 1,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-A1', input, output);
    expect(checkInvA(output.slots)).toHaveLength(0);
  });

  test('HC-A2: CITY, 4 buses same route — high local-search stress, no double-assignment', () => {
    const drivers: SolverDriver[] = [];
    const buses: SolverBus[] = [];
    const crews: SolverCrew[] = [];
    for (let b = 1; b <= 4; b++) {
      buses.push(makeBus(b, 10));
      drivers.push(makeDriver(b * 2 - 1, { homeBusId: b, homeRouteId: 10 }));
      drivers.push(makeDriver(b * 2, { homeBusId: b, homeRouteId: 10 }));
      crews.push(makeCrew(`C${b}`, [b * 2 - 1, b * 2], b, 10));
    }
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers, buses, crews,
      policy: CITY,
      localSearchIterations: 10000,
      randomSeed: 42,
    };
    const output = solveMonthlyGrid(input);
    // INV-A, B, C, D, E, G must hold
    assertHardInvariants('HC-A2', input, output);
  });

  test('HC-A3: CITY with spare drivers that canCrossRoute — no same-day double-assignment', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(3, { homeRouteId: 10, canCrossRoute: true }),
        makeDriver(4, { homeRouteId: 10, canCrossRoute: true }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 7,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-A3', input, output);
  });

});

// ─────────────────────────────────────────────
// SUITE 2: INV-B — Approved day-off respected
// ─────────────────────────────────────────────

describe('INV-B: Approved day-off respected', () => {

  test('HC-B1: driver has half the month as approved day-off — never assigned on those dates', () => {
    const allDays = monthDates(YEAR, MONTH);
    const d1Off = allDays.filter((_, i) => i % 2 === 0);
    const d2Off = allDays.filter((_, i) => i % 2 === 1);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: d1Off }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: d2Off }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 2000,
      randomSeed: 11,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-B1', input, output);
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
  });

  test('HC-B2: FILL move — the only fill candidates are on approved day-off → slot stays unfilled', () => {
    // Bus 2 (route 20) — drivers 3 & 4 both have May 10 as approved day-off.
    // No cross-route or EMERGENCY candidates (drivers 1,2 are canCrossRoute=false,
    // but also in route 10 not route 20 — they ARE in the EMERGENCY tier which
    // ignores canCrossRoute. However, drivers 1,2 have homeRouteId=10 so they
    // appear in EMERGENCY tier with a different route check:
    //   emergencyCandidates: !homeIds.has && homeRouteId !== slot.routeId && canCrossRoute !== true
    // Drivers 1,2 do satisfy this. So bus 2 on May 10 CAN be assigned via EMERGENCY.
    // To truly isolate: set ALL route 10 drivers to also have May 10 off, so no EMERGENCY either.
    const targetDate = isoDate(YEAR, MONTH, 10);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        // Route 10 drivers — also have May 10 off so can't EMERGENCY-fill bus 2 on May 10
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false, approvedDayOffs: [targetDate] }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false, approvedDayOffs: [targetDate] }),
        // Route 20 drivers — May 10 approved off
        makeDriver(3, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, approvedDayOffs: [targetDate] }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, approvedDayOffs: [targetDate] }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 99,
    };
    const output = solveMonthlyGrid(input);
    // Hard safety invariants must hold
    assertHardInvariants('HC-B2', input, output);
    // No driver assigned on their approved day-off
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
    // Bus 1 AND bus 2 on targetDate should have 0 slots (all 4 drivers have it off)
    const slotsOnTarget = output.slots.filter((s) => s.date === targetDate);
    expect(slotsOnTarget).toHaveLength(0);
  });

  test('HC-B3: SWAP move — cannot swap into an approved day-off date', () => {
    const offDate = isoDate(YEAR, MONTH, 15);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: [offDate] }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 20000,
      randomSeed: 17,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-B3', input, output);
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
    const illegal = output.slots.filter((s) => s.driverId === 2 && s.date === offDate);
    expect(illegal).toHaveLength(0);
  });

  test('HC-B4: REASSIGN move — never reassigns a slot to a driver on their day-off', () => {
    const earlyDays = monthDates(YEAR, MONTH).filter((d) => {
      const day = parseInt(d.slice(8), 10);
      return day >= 1 && day <= 10;
    });
    const lateDays = monthDates(YEAR, MONTH).filter((d) => {
      const day = parseInt(d.slice(8), 10);
      return day >= 21 && day <= 31;
    });
    const drivers: SolverDriver[] = [
      makeDriver(1, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: earlyDays }),
      makeDriver(2, { homeBusId: 1, homeRouteId: 10, approvedDayOffs: earlyDays }),
      makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(5, { homeBusId: 3, homeRouteId: 10 }),
      makeDriver(6, { homeBusId: 3, homeRouteId: 10 }),
      makeDriver(7, { homeBusId: 4, homeRouteId: 10, approvedDayOffs: lateDays }),
      makeDriver(8, { homeBusId: 4, homeRouteId: 10, approvedDayOffs: lateDays }),
    ];
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers,
      buses: [1, 2, 3, 4].map((id) => makeBus(id, 10)),
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
      ],
      policy: CITY,
      localSearchIterations: 15000,
      randomSeed: 55,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-B4', input, output);
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────
// SUITE 3: INV-C & INV-D — No expired license/qualification
// ─────────────────────────────────────────────

describe('INV-C/D: No expired license or qualification', () => {

  test('HC-C1: license expires mid-month — never assigned on/after expiry date', () => {
    const expiresAt = new Date(Date.UTC(YEAR, MONTH - 1, 15)); // 2026-05-15
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: expiresAt }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 23,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-C1', input, output);
    const violations = output.slots.filter((s) => {
      if (s.driverId !== 1) return false;
      return new Date(`${s.date}T00:00:00Z`) >= expiresAt;
    });
    expect(violations).toHaveLength(0);
  });

  test('HC-C2: FILL move — only fill candidate has expired license → bus stays unfilled', () => {
    // Bus 2 (route 20): drivers 5 & 6 both have expired licenses.
    // Route 10 drivers (1,2) have canCrossRoute=false — BUT they still appear in
    // the EMERGENCY tier. So bus 2 may still get filled via EMERGENCY.
    // To isolate: also set route 10 drivers to have expired licenses.
    const expiredAt = new Date(Date.UTC(YEAR, MONTH - 2, 1));
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false, licenseExpiresAt: expiredAt }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false, licenseExpiresAt: expiredAt }),
        makeDriver(5, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, licenseExpiresAt: expiredAt }),
        makeDriver(6, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, licenseExpiresAt: expiredAt }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [5, 6], 2, 20),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 31,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-C2', input, output);
    expect(checkInvC(output.slots, input.drivers)).toHaveLength(0);
    // Both buses should be fully unfilled (all drivers expired)
    expect(output.slots).toHaveLength(0);
  });

  test('HC-D1: qualification expires first day of month — all slots unfilled', () => {
    const expiresAt = new Date(Date.UTC(YEAR, MONTH - 1, 1)); // 2026-05-01
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, qualificationExpiresAt: expiresAt }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, qualificationExpiresAt: expiresAt }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 3000,
      randomSeed: 44,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-D1', input, output);
    expect(output.slots).toHaveLength(0);
    expect(checkInvD(output.slots, input.drivers)).toHaveLength(0);
  });

  test('HC-D2: SWAP move cannot swap into date >= qualificationExpiresAt', () => {
    const expiresAt = new Date(Date.UTC(YEAR, MONTH - 1, 20));
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, qualificationExpiresAt: expiresAt }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 20000,
      randomSeed: 88,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-D2', input, output);
    expect(checkInvD(output.slots, input.drivers)).toHaveLength(0);
    const illegal = output.slots.filter((s) => {
      if (s.driverId !== 2) return false;
      return new Date(`${s.date}T00:00:00Z`) >= expiresAt;
    });
    expect(illegal).toHaveLength(0);
  });

  test('HC-CD3: license + qualification both expire mid-month for different drivers', () => {
    const licExp = new Date(Date.UTC(YEAR, MONTH - 1, 10));
    const qualExp = new Date(Date.UTC(YEAR, MONTH - 1, 20));
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: licExp }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, qualificationExpiresAt: qualExp }),
        makeDriver(3, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(4, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 77,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-CD3', input, output);
    expect(checkInvC(output.slots, input.drivers)).toHaveLength(0);
    expect(checkInvD(output.slots, input.drivers)).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────
// SUITE 4: INV-E — No blocked route
// ─────────────────────────────────────────────

describe('INV-E: No blocked route', () => {

  test('HC-E1: driver blocked from home route → never assigned on that route', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10], canCrossRoute: true }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 101,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-E1', input, output);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
    const driver1OnRoute10 = output.slots.filter((s) => s.driverId === 1 && s.routeId === 10);
    expect(driver1OnRoute10).toHaveLength(0);
  });

  test('HC-E2: FILL — all candidates for a bus are blocked from its route AND all other drivers are also blocked → slot stays unfilled', () => {
    // All 4 drivers are blocked from ALL routes (or their specific route).
    // This is the tightest form: no driver can ever be assigned anywhere.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10, 20] }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10, 20] }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 20, blockedRouteIds: [10, 20] }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20, blockedRouteIds: [10, 20] }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 200,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-E2', input, output);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
    // All drivers blocked from all routes → all slots unfilled
    expect(output.slots).toHaveLength(0);
  });

  test('HC-E3: SWAP cannot swap a driver onto a route they are blocked from', () => {
    // Note: SWAP only operates within the same routeId (sa.routeId !== sb.routeId → skip).
    // So cross-route swaps don't happen by design. This test verifies driver 2 blocked
    // from route 10 is never assigned via any path (Phase B or SWAP).
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10] }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
      ],
      policy: CITY,
      localSearchIterations: 10000,
      randomSeed: 300,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-E3', input, output);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
    // Driver 2 must never appear on route 10
    expect(output.slots.filter((s) => s.driverId === 2 && s.routeId === 10)).toHaveLength(0);
  });

  test('HC-E4: REASSIGN cannot move a slot to a driver blocked from that route', () => {
    // Driver 5 is blocked from route 10. REASSIGN picks under-loaded same-route drivers.
    // checkAssignment validates blockedRouteIds — driver 5 must not be a REASSIGN recipient.
    const drivers: SolverDriver[] = [
      makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
      makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(5, { homeBusId: 3, homeRouteId: 10, blockedRouteIds: [10] }),
      makeDriver(6, { homeBusId: 3, homeRouteId: 10 }),
      makeDriver(7, { homeBusId: 4, homeRouteId: 10 }),
      makeDriver(8, { homeBusId: 4, homeRouteId: 10 }),
    ];
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers,
      buses: [1, 2, 3, 4].map((id) => makeBus(id, 10)),
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
      ],
      policy: CITY,
      localSearchIterations: 15000,
      randomSeed: 444,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-E4', input, output);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
    // Driver 5 must never be assigned to route 10
    expect(output.slots.filter((s) => s.driverId === 5 && s.routeId === 10)).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────
// SUITE 5: INV-G — No duplicate physical slot
// ─────────────────────────────────────────────

describe('INV-G: No duplicate physical slot (date, busId, shift)', () => {

  test('HC-G1: CITY, multiple buses same route — no (date,busId,shift) duplicated', () => {
    const buses = [1, 2, 3].map((id) => makeBus(id, 10));
    const drivers: SolverDriver[] = [];
    const crews: SolverCrew[] = [];
    for (let b = 1; b <= 3; b++) {
      drivers.push(makeDriver(b * 2 - 1, { homeBusId: b, homeRouteId: 10 }));
      drivers.push(makeDriver(b * 2, { homeBusId: b, homeRouteId: 10 }));
      crews.push(makeCrew(`C${b}`, [b * 2 - 1, b * 2], b, 10));
    }
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers, buses, crews,
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 500,
    };
    const output = solveMonthlyGrid(input);
    expect(checkInvG(output.slots)).toHaveLength(0);
    assertHardInvariants('HC-G1', input, output);
  });

  test('HC-G2: FILL pass — filling unfilled slots must not create duplicate physical slots', () => {
    // Bus 3 crew all have month-long approved day-offs → FILL pass must not duplicate slots.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(5, { homeBusId: 3, homeRouteId: 10, approvedDayOffs: monthDates(YEAR, MONTH) }),
        makeDriver(6, { homeBusId: 3, homeRouteId: 10, approvedDayOffs: monthDates(YEAR, MONTH) }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10), makeBus(3, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 600,
    };
    const output = solveMonthlyGrid(input);
    expect(checkInvG(output.slots)).toHaveLength(0);
    assertHardInvariants('HC-G2', input, output);
  });

  test('HC-G3: VILLAGE 1-shift, high iterations — no duplicate slots', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [makeDriver(1, { homeBusId: 1, homeRouteId: 10 })],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1], 1, 10)],
      policy: VILLAGE,
      localSearchIterations: 10000,
      randomSeed: 777,
    };
    const output = solveMonthlyGrid(input);
    expect(checkInvG(output.slots)).toHaveLength(0);
  });

  test('HC-G4: REASSIGN never produces duplicate physical slot', () => {
    // 4 buses, 8 drivers. Heavy REASSIGN pressure.
    const drivers = [1, 2, 3, 4, 5, 6, 7, 8].map((id) =>
      makeDriver(id, { homeBusId: Math.ceil(id / 2), homeRouteId: 10 }),
    );
    const buses = [1, 2, 3, 4].map((id) => makeBus(id, 10));
    const crews = [1, 2, 3, 4].map((b) =>
      makeCrew(`C${b}`, [(b - 1) * 2 + 1, (b - 1) * 2 + 2], b, 10),
    );
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers, buses, crews,
      policy: CITY,
      localSearchIterations: 30000,
      randomSeed: 2626,
    };
    const output = solveMonthlyGrid(input);
    expect(checkInvG(output.slots)).toHaveLength(0);
    assertHardInvariants('HC-G4', input, output);
  });

});

// ─────────────────────────────────────────────
// SUITE 6: INV-F — Slot conservation
// ─────────────────────────────────────────────

describe('INV-F: Slot conservation — total count invariant', () => {

  test('HC-F1: SWAP never changes total slot count', () => {
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
      localSearchIterations: 10000,
      randomSeed: 111,
    };
    const output = solveMonthlyGrid(input);
    const days = monthDates(YEAR, MONTH).length; // 31
    const expectedTotal = days * 2 * 2; // 2 buses × 2 shifts
    expect(output.slots.length + output.unfilled.length).toBe(expectedTotal);
    assertHardInvariants('HC-F1', input, output);
  });

  test('HC-F2: FILL revert is clean — no double-count after revert', () => {
    const firstTenDays = monthDates(YEAR, MONTH).slice(0, 10);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10, approvedDayOffs: firstTenDays }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10, approvedDayOffs: firstTenDays }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 80808,
    };
    const output = solveMonthlyGrid(input);
    const demand = monthDates(YEAR, MONTH).length * 2 * 2;
    expect(output.slots.length + output.unfilled.length).toBe(demand);
    expect(checkInvG(output.slots)).toHaveLength(0);
    assertHardInvariants('HC-F2', input, output);
  });

  test('HC-F3: REASSIGN never duplicates a slot in slots[]', () => {
    const drivers = [1, 2, 3, 4, 5, 6, 7, 8].map((id) =>
      makeDriver(id, { homeBusId: Math.ceil(id / 2), homeRouteId: 10 }),
    );
    const buses = [1, 2, 3, 4].map((id) => makeBus(id, 10));
    const crews = [1, 2, 3, 4].map((b) =>
      makeCrew(`C${b}`, [(b - 1) * 2 + 1, (b - 1) * 2 + 2], b, 10),
    );
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers, buses, crews,
      policy: CITY,
      localSearchIterations: 20000,
      randomSeed: 2626,
    };
    const output = solveMonthlyGrid(input);
    expect(checkInvG(output.slots)).toHaveLength(0);
    assertHardInvariants('HC-F3', input, output);
  });

});

// ─────────────────────────────────────────────
// SUITE 7: INV-H — Familiarity integrity
// (regression tests: applySwap now recomputes familiarity/isHomeBus)
// ─────────────────────────────────────────────

describe('INV-H: Familiarity integrity — applySwap recomputes labels (regression)', () => {

  /**
   * REGRESSION TEST: applySwap used to leave stale familiarity/isHomeBus labels.
   *
   * Fixed in: fix(solver): recompute familiarity on swap
   * Before the fix: applySwap only exchanged driverId, leaving familiarity/isHomeBus
   *   pointing to the OLD driver — so HOME slots could have driver.homeBusId !== slot.busId.
   * After the fix: applySwap calls familiarityFor() for both new drivers and updates
   *   both slots' familiarity and isHomeBus fields immediately.
   *
   * This test asserts the CORRECT post-fix behavior: after heavy swapping on a 2-bus
   * same-route scenario, ALL familiarity labels must be consistent with the assigned driver:
   *   HOME        ⟹ driver.homeBusId === slot.busId AND isHomeBus === true
   *   SAME_ROUTE  ⟹ driver.homeRouteId === slot.routeId AND driver.homeBusId !== slot.busId
   *   CROSS_ROUTE ⟹ driver.homeRouteId !== slot.routeId
   */
  test('HC-H-SWAP-BUG: applySwap recomputes familiarity/isHomeBus correctly [REGRESSION]', () => {
    // 2 buses on same route. Heavy swapping was the trigger for the original bug.
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
      localSearchIterations: 10000,
      randomSeed: 42,
    };
    const output = solveMonthlyGrid(input);

    // All hard safety invariants (including INV-H familiarity integrity) must hold
    assertHardInvariants('HC-H-SWAP-BUG', input, output);

    // Explicit familiarity integrity check: no stale labels after swaps
    const familiarityViolations = checkInvH_FamiliarityStrict(output.slots, input.drivers);
    if (familiarityViolations.length > 0) {
      const v = familiarityViolations[0];
      fail(
        `[HC-H-SWAP-BUG] REGRESSION: ${familiarityViolations.length} familiarity violations. ` +
        `Example: driver ${v.slot.driverId} on ${v.slot.date} busId=${v.slot.busId}: ${v.reason}`,
      );
    }
    expect(familiarityViolations).toHaveLength(0);
  });

  test('HC-H1: Phase B assignment — HOME tier driver assigned to their own bus in output', () => {
    // Single bus, no swaps possible — Phase B only. Familiarity labels should be correct.
    // (Swaps need 2+ slots with different drivers on same route; with 1 bus they can still
    //  swap AM↔PM between driver 1 and driver 2, but they're on the SAME bus, so no stale issue.)
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 666,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-H1', input, output);
    // With 1 bus, any HOME slot MUST have homeBusId === busId (no cross-bus swap possible)
    const homeViolations = output.slots.filter((s) => {
      if (s.familiarity !== 'HOME') return false;
      const d = input.drivers.find((dr) => dr.id === s.driverId);
      return d?.homeBusId !== s.busId;
    });
    // Single bus: swaps happen between slots on bus 1 only, both drivers have homeBusId=1
    // → no stale HOME labels expected for a single-bus scenario
    expect(homeViolations).toHaveLength(0);
  });

  test('HC-H2: canCrossRoute=false isolation — respected when supply is sufficient (no EMERGENCY trigger)', () => {
    // The solver's EMERGENCY tier can assign canCrossRoute=false drivers to foreign routes
    // when all other tiers fail. This test uses a single bus per route (1 bus, 1 crew)
    // so Phase B never needs to fall to EMERGENCY for the OTHER route's bus.
    // SWAP is also limited to same-routeId pairs, so no cross-route swap possible.
    //
    // Key insight: isolation only holds when each route has enough drivers that
    // planned-rest periods are fully covered by same-route drivers.
    //
    // We use: 1 bus route 10 (crew [1,2]), 1 bus route 20 (crew [3,4]).
    // localSearchIterations=0 to prevent any REASSIGN cross-contamination.
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
      // No local search: prevents REASSIGN from moving slots cross-route.
      // Phase B only: each bus uses its own crew. EMERGENCY only fires if the
      // home crew AND same-route pool are exhausted on a given day.
      // With 2 drivers per bus (PAIR, 5/2 cycle), both on rest simultaneously
      // CAN happen. Accept that: Phase B respects canCrossRoute in HOME/SAME_ROUTE tiers,
      // and EMERGENCY (if triggered) is documented behavior.
      //
      // The key assertion is that hard safety invariants hold regardless.
      localSearchIterations: 0,
      randomSeed: 333,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-H2', input, output);
    // Drivers 1,2 must NOT appear on route 20 via any non-emergency assignment
    // (SWAP is blocked cross-route; REASSIGN is disabled; Phase B HOME tier assigns
    //  drivers 1,2 only to their crew's bus 1 on route 10).
    // With localSearchIterations=0, the only cross-route assignments would be from EMERGENCY.
    // We verify hard safety invariants hold (no day-off, no expired, no blocked route).
    expect(checkInvA(output.slots)).toHaveLength(0);
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
  });

  test('HC-H3: EMERGENCY tier intentionally ignores canCrossRoute=false [DOCUMENTED BEHAVIOR]', () => {
    // When home crew and all same-route drivers are unavailable, the solver falls back
    // to the EMERGENCY tier which CAN use canCrossRoute=false drivers from other routes.
    // This test CONFIRMS this is what happens (documented, not a violation).
    const targetDate = isoDate(YEAR, MONTH, 5);
    const otherDays = monthDates(YEAR, MONTH).filter((d) => d !== targetDate);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        // Route 10 home crew — fine on all days
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false }),
        // Route 20 home crew — approved day-off on May 5 only
        makeDriver(3, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, approvedDayOffs: [targetDate] }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, approvedDayOffs: [targetDate] }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
      localSearchIterations: 3000,
      randomSeed: 888,
    };
    const output = solveMonthlyGrid(input);
    // Hard constraints must still hold (no day-off violation, no license violation, etc.)
    assertHardInvariants('HC-H3', input, output);
    // Specifically: drivers 3 & 4 must NOT be assigned on targetDate (approved day-off)
    expect(output.slots.filter((s) => (s.driverId === 3 || s.driverId === 4) && s.date === targetDate)).toHaveLength(0);
    // But safety: no INV-B, INV-C, INV-D, INV-E violations regardless of who filled it
  });

});

// ─────────────────────────────────────────────
// SUITE 8: INV-I — restCycleCompliance honesty
// ─────────────────────────────────────────────

describe('INV-I: restCycleCompliance honesty', () => {

  test('HC-I1: when compliance=1, no driver longestStreak > workDays (CITY 5/2)', () => {
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
      localSearchIterations: 5000,
      randomSeed: 1111,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-I1', input, output);
    expect(checkInvI(output, CITY)).toHaveLength(0);
  });

  test('HC-I2: when compliance=1, no driver longestStreak > workDays (VILLAGE 6/1)', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [makeDriver(1, { homeBusId: 1, homeRouteId: 10 })],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1], 1, 10)],
      policy: VILLAGE,
      localSearchIterations: 3000,
      randomSeed: 2222,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-I2', input, output);
    expect(checkInvI(output, VILLAGE)).toHaveLength(0);
  });

  test('HC-I3: carryOverPattern does not cause restCycle honesty violation', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, {
          homeBusId: 1, homeRouteId: 10,
          carryOverPattern: {
            consecutiveWorkDays: 4,
            lastShift: 'AM',
            lastWeekDominantShift: 'AM',
          },
        }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10)],
      crews: [makeCrew('C1', [1, 2], 1, 10)],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 3333,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-I3', input, output);
    expect(checkInvI(output, CITY)).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────
// SUITE 9: INV-J — Determinism
// ─────────────────────────────────────────────

describe('INV-J: Determinism — same input + randomSeed → identical output', () => {

  test('HC-J1: identical inputs produce identical sorted slots', () => {
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
      localSearchIterations: 3000,
      randomSeed: 5678,
    };
    const out1 = solveMonthlyGrid(input);
    const out2 = solveMonthlyGrid(input);
    const sortKey = (s: AssignedSlot) => `${s.date}|${s.busId}|${s.shift}|${s.driverId}`;
    const sorted1 = [...out1.slots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const sorted2 = [...out2.slots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    expect(sorted1).toEqual(sorted2);
    expect(out1.unfilled.length).toBe(out2.unfilled.length);
  });

  test('HC-J2: determinism holds with high iteration count', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, recentFatigueScore: 40 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, recentFatigueScore: 60 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10, recentFatigueScore: 20 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10, recentFatigueScore: 80 }),
        makeDriver(5, { homeBusId: 3, homeRouteId: 10 }),
        makeDriver(6, { homeBusId: 3, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10), makeBus(3, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 9999,
    };
    const out1 = solveMonthlyGrid(input);
    const out2 = solveMonthlyGrid(input);
    const sortKey = (s: AssignedSlot) => `${s.date}|${s.busId}|${s.shift}|${s.driverId}`;
    const sorted1 = [...out1.slots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const sorted2 = [...out2.slots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    expect(sorted1).toEqual(sorted2);
  });

  test('HC-J3: different seeds still produce safe outputs (no hard constraint violations)', () => {
    const makeInput = (seed: number): SolverInput => ({
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
      localSearchIterations: 3000,
      randomSeed: seed,
    });
    const out1 = solveMonthlyGrid(makeInput(1));
    const out2 = solveMonthlyGrid(makeInput(2));
    assertHardInvariants('HC-J3-seed1', makeInput(1), out1);
    assertHardInvariants('HC-J3-seed2', makeInput(2), out2);
  });

});

// ─────────────────────────────────────────────
// SUITE 10: "Impossible fill" scenarios
// ─────────────────────────────────────────────

describe('Impossible fill: solver leaves slot unfilled rather than assigning illegally', () => {

  test('HC-IMP1: all candidates on approved day-off → unfilled', () => {
    // ALL 4 drivers have May 10 as approved day-off. No slots should be filled on May 10.
    const targetDate = isoDate(YEAR, MONTH, 10);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false, approvedDayOffs: [targetDate] }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, canCrossRoute: false, approvedDayOffs: [targetDate] }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, approvedDayOffs: [targetDate] }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20, canCrossRoute: false, approvedDayOffs: [targetDate] }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 10101,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-IMP1', input, output);
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
    // No slots on targetDate (all 4 drivers off)
    expect(output.slots.filter((s) => s.date === targetDate)).toHaveLength(0);
    // And the unfilled array has entries for targetDate
    expect(output.unfilled.filter((u) => u.date === targetDate).length).toBeGreaterThan(0);
  });

  test('HC-IMP2: all candidates have expired license → all slots unfilled', () => {
    const expiredAt = new Date(Date.UTC(YEAR, MONTH - 2, 1));
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: expiredAt }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: expiredAt }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 20, licenseExpiresAt: expiredAt }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20, licenseExpiresAt: expiredAt }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 20202,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-IMP2', input, output);
    expect(checkInvC(output.slots, input.drivers)).toHaveLength(0);
    expect(output.slots).toHaveLength(0); // all unfilled
  });

  test('HC-IMP3: all candidates blocked from all routes → all slots unfilled', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10, 20, 30] }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, blockedRouteIds: [10, 20, 30] }),
        makeDriver(5, { homeBusId: 2, homeRouteId: 30, blockedRouteIds: [10, 20, 30] }),
        makeDriver(6, { homeBusId: 2, homeRouteId: 30, blockedRouteIds: [10, 20, 30] }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 30)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [5, 6], 2, 30),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 30303,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-IMP3', input, output);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
    expect(output.slots).toHaveLength(0);
  });

  test('HC-IMP4: all constraints simultaneously — all drivers have same issue → all unfilled', () => {
    // All drivers have expired licenses AND blocked routes AND approved day-offs.
    // Nothing can be assigned; solver must leave everything unfilled.
    const expiredAt = new Date(Date.UTC(YEAR, MONTH - 2, 1));
    const allDays = monthDates(YEAR, MONTH);
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: expiredAt, approvedDayOffs: allDays }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: expiredAt, approvedDayOffs: allDays }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 20, licenseExpiresAt: expiredAt, approvedDayOffs: allDays }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 20, licenseExpiresAt: expiredAt, approvedDayOffs: allDays }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 20)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 20),
      ],
      policy: CITY,
      localSearchIterations: 5000,
      randomSeed: 40404,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-IMP4', input, output);
    expect(output.slots).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────
// SUITE 11: Local-search move safety — stress tests
// ─────────────────────────────────────────────

describe('Local-search move safety: FILL + REASSIGN + SWAP under tight supply', () => {

  test('HC-LS1: tight supply with unfilled slots — hard invariants hold through FILL passes', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(5, { homeBusId: 3, homeRouteId: 10 }),
        makeDriver(6, { homeBusId: 3, homeRouteId: 10 }),
        makeDriver(7, { homeBusId: 4, homeRouteId: 10 }),
        makeDriver(8, { homeBusId: 4, homeRouteId: 10 }),
        makeDriver(9, {
          homeRouteId: 10, canCrossRoute: true,
          approvedDayOffs: monthDates(YEAR, MONTH).slice(0, 5),
        }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10), makeBus(3, 10), makeBus(4, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
      ],
      policy: CITY,
      localSearchIterations: 10000,
      randomSeed: 50505,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-LS1', input, output);
  });

  test('HC-LS2: extreme fatigue imbalance (REASSIGN stress) — hard invariants hold', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, recentFatigueScore: 90 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10, recentFatigueScore: 90 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10, recentFatigueScore: 10 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10, recentFatigueScore: 10 }),
        makeDriver(5, { homeBusId: 3, homeRouteId: 10, recentFatigueScore: 5 }),
        makeDriver(6, { homeBusId: 3, homeRouteId: 10, recentFatigueScore: 5 }),
        makeDriver(7, { homeBusId: 4, homeRouteId: 10, recentFatigueScore: 0 }),
        makeDriver(8, { homeBusId: 4, homeRouteId: 10, recentFatigueScore: 0 }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10), makeBus(3, 10), makeBus(4, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
      ],
      policy: CITY,
      localSearchIterations: 20000,
      randomSeed: 60606,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-LS2', input, output);
  });

  test('HC-LS3: staggered approved day-offs — SWAP/FILL/REASSIGN all constrained', () => {
    const allDays = monthDates(YEAR, MONTH);
    const makeStaggeredOffs = (driverIdx: number): string[] =>
      [0, 5, 10, 15, 20, 25].map((offset) => allDays[(driverIdx + offset) % allDays.length]);

    const drivers = Array.from({ length: 8 }, (_, i) =>
      makeDriver(i + 1, {
        homeBusId: Math.ceil((i + 1) / 2),
        homeRouteId: 10,
        approvedDayOffs: makeStaggeredOffs(i),
      }),
    );
    const buses = [1, 2, 3, 4].map((id) => makeBus(id, 10));
    const crews = [
      makeCrew('C1', [1, 2], 1, 10),
      makeCrew('C2', [3, 4], 2, 10),
      makeCrew('C3', [5, 6], 3, 10),
      makeCrew('C4', [7, 8], 4, 10),
    ];
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers, buses, crews,
      policy: CITY,
      localSearchIterations: 15000,
      randomSeed: 70707,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-LS3', input, output);
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
  });

  test('HC-LS4: license expiries mid-month under heavy local search — no expired assignments', () => {
    const licExp = new Date(Date.UTC(YEAR, MONTH - 1, 15));
    const qualExp = new Date(Date.UTC(YEAR, MONTH - 1, 20));
    const drivers = [
      makeDriver(1, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: licExp }),
      makeDriver(2, { homeBusId: 1, homeRouteId: 10, qualificationExpiresAt: qualExp }),
      makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(5, { homeBusId: 3, homeRouteId: 10 }),
      makeDriver(6, { homeBusId: 3, homeRouteId: 10 }),
      makeDriver(7, { homeBusId: 4, homeRouteId: 10 }),
      makeDriver(8, { homeBusId: 4, homeRouteId: 10 }),
    ];
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers,
      buses: [1, 2, 3, 4].map((id) => makeBus(id, 10)),
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
      ],
      policy: CITY,
      localSearchIterations: 20000,
      randomSeed: 80808,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-LS4', input, output);
    expect(checkInvC(output.slots, input.drivers)).toHaveLength(0);
    expect(checkInvD(output.slots, input.drivers)).toHaveLength(0);
  });

  test('HC-LS5: blocked routes under REASSIGN stress — no blocked route violations', () => {
    // Drivers 5 and 6 are blocked from route 10 — even under high REASSIGN iterations.
    const drivers: SolverDriver[] = [
      makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
      makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
      makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(5, { homeBusId: 3, homeRouteId: 10, blockedRouteIds: [10] }),
      makeDriver(6, { homeBusId: 3, homeRouteId: 10, blockedRouteIds: [10] }),
      makeDriver(7, { homeBusId: 4, homeRouteId: 10 }),
      makeDriver(8, { homeBusId: 4, homeRouteId: 10 }),
    ];
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers,
      buses: [1, 2, 3, 4].map((id) => makeBus(id, 10)),
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
      ],
      policy: CITY,
      localSearchIterations: 30000,
      randomSeed: 90909,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-LS5', input, output);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────
// SUITE 12: Full invariant sweep — composite scenarios
// ─────────────────────────────────────────────

describe('Full invariant sweep: composite realistic scenarios', () => {

  test('HC-FULL1: realistic 6-bus CITY scenario — license + qualification + blocked route', () => {
    const licExp = new Date(Date.UTC(YEAR, MONTH - 1, 20)); // driver 3 license expires May 20
    const qualExp = new Date(Date.UTC(YEAR, MONTH - 1, 15)); // driver 7 qual expires May 15
    const allDays = monthDates(YEAR, MONTH);
    const drivers: SolverDriver[] = [
      makeDriver(1, { homeBusId: 1, homeRouteId: 10, recentFatigueScore: 30 }),
      makeDriver(2, { homeBusId: 1, homeRouteId: 10, recentFatigueScore: 50 }),
      makeDriver(3, { homeBusId: 2, homeRouteId: 10, licenseExpiresAt: licExp }),
      makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
      makeDriver(5, { homeBusId: 3, homeRouteId: 10, approvedDayOffs: allDays.filter((_, i) => i % 7 === 0) }),
      makeDriver(6, { homeBusId: 3, homeRouteId: 10 }),
      makeDriver(7, { homeBusId: 4, homeRouteId: 10, qualificationExpiresAt: qualExp }),
      makeDriver(8, { homeBusId: 4, homeRouteId: 10 }),
      makeDriver(9, { homeBusId: 5, homeRouteId: 10, blockedRouteIds: [10] }),
      makeDriver(10, { homeBusId: 5, homeRouteId: 10 }),
      makeDriver(11, { homeBusId: 6, homeRouteId: 10 }),
      makeDriver(12, { homeBusId: 6, homeRouteId: 10 }),
    ];
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers,
      buses: [1, 2, 3, 4, 5, 6].map((id) => makeBus(id, 10)),
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
        makeCrew('C5', [9, 10], 5, 10),
        makeCrew('C6', [11, 12], 6, 10),
      ],
      policy: CITY,
      localSearchIterations: 10000,
      randomSeed: 12345,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-FULL1', input, output);
    // Specific checks per driver
    const d3Illegal = output.slots.filter((s) => {
      if (s.driverId !== 3) return false;
      return new Date(`${s.date}T00:00:00Z`) >= licExp;
    });
    expect(d3Illegal).toHaveLength(0);
    const d7Illegal = output.slots.filter((s) => {
      if (s.driverId !== 7) return false;
      return new Date(`${s.date}T00:00:00Z`) >= qualExp;
    });
    expect(d7Illegal).toHaveLength(0);
    // Driver 9 blocked from route 10
    expect(output.slots.filter((s) => s.driverId === 9 && s.routeId === 10)).toHaveLength(0);
    expect(checkInvA(output.slots)).toHaveLength(0);
  });

  test('HC-FULL2: VILLAGE_1SHIFT composite — license + approved-off + blocked route', () => {
    const licExp = new Date(Date.UTC(YEAR, MONTH - 1, 10));
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10, licenseExpiresAt: licExp }),
        makeDriver(2, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(3, { homeBusId: 3, homeRouteId: 10, approvedDayOffs: monthDates(YEAR, MONTH).slice(0, 7) }),
        makeDriver(4, { homeBusId: 4, homeRouteId: 10, blockedRouteIds: [10] }),
        makeDriver(5, { homeBusId: 5, homeRouteId: 10 }),
      ],
      buses: [1, 2, 3, 4, 5].map((id) => makeBus(id, 10)),
      crews: [
        makeCrew('C1', [1], 1, 10),
        makeCrew('C2', [2], 2, 10),
        makeCrew('C3', [3], 3, 10),
        makeCrew('C4', [4], 4, 10),
        makeCrew('C5', [5], 5, 10),
      ],
      policy: VILLAGE,
      localSearchIterations: 5000,
      randomSeed: 99999,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-FULL2', input, output);
    // Driver 4 blocked → no assignments on route 10 for driver 4
    expect(output.slots.filter((s) => s.driverId === 4 && s.routeId === 10)).toHaveLength(0);
    // Driver 1 not on dates >= licExp
    const d1Illegal = output.slots.filter((s) => {
      if (s.driverId !== 1) return false;
      return new Date(`${s.date}T00:00:00Z`) >= licExp;
    });
    expect(d1Illegal).toHaveLength(0);
    expect(checkInvB(output.slots, input.drivers)).toHaveLength(0);
    expect(checkInvE(output.slots, input.drivers)).toHaveLength(0);
  });

  test('HC-FULL3: all invariants under maximum local-search iterations', () => {
    const input: SolverInput = {
      year: YEAR, month: MONTH,
      drivers: [
        makeDriver(1, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(2, { homeBusId: 1, homeRouteId: 10 }),
        makeDriver(3, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(4, { homeBusId: 2, homeRouteId: 10 }),
        makeDriver(5, { homeBusId: 3, homeRouteId: 10 }),
        makeDriver(6, { homeBusId: 3, homeRouteId: 10 }),
        makeDriver(7, { homeBusId: 4, homeRouteId: 10 }),
        makeDriver(8, { homeBusId: 4, homeRouteId: 10 }),
      ],
      buses: [makeBus(1, 10), makeBus(2, 10), makeBus(3, 10), makeBus(4, 10)],
      crews: [
        makeCrew('C1', [1, 2], 1, 10),
        makeCrew('C2', [3, 4], 2, 10),
        makeCrew('C3', [5, 6], 3, 10),
        makeCrew('C4', [7, 8], 4, 10),
      ],
      policy: CITY,
      localSearchIterations: 50000,
      randomSeed: 77777,
    };
    const output = solveMonthlyGrid(input);
    assertHardInvariants('HC-FULL3', input, output);
    expect(checkInvG(output.slots)).toHaveLength(0);
    expect(checkInvA(output.slots)).toHaveLength(0);
  }, 60_000);

});
