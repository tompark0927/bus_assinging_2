/**
 * Adversarial edge-case tests for pure helpers and scheduleQuality.
 *
 * Targets:
 *   - computeRecentFatigue   (solverDispatchService)
 *   - computeCarryOverPattern (solverDispatchService)
 *   - mapPreferredRouteIds   (solverDispatchService)
 *   - newHireWorkdayTarget   (solverDispatchService)
 *   - scheduleQuality        (quality.ts)
 *
 * No DB / Prisma required — only pure logic imports.
 */

import {
  computeRecentFatigue,
  computeCarryOverPattern,
  mapPreferredRouteIds,
  newHireWorkdayTarget,
} from '../../../services/solverDispatchService';
import { scheduleQuality } from '../quality';
import type { SolverInput, SolverOutput, AssignedSlot, SolverDriver } from '../types';
import { POLICY_PRESETS } from '../types';

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

function makeDriver(id: number, extra: Partial<SolverDriver> = {}): SolverDriver {
  return {
    id,
    name: `D${id}`,
    homeBusId: 100 + id,
    homeRouteId: 1,
    approvedDayOffs: [],
    recentFatigueScore: 30,
    isNewHire: false,
    ...extra,
  };
}

function makeSlot(driverId: number, date: string, shift = 'AM'): AssignedSlot {
  return {
    date,
    busId: 100 + driverId,
    routeId: 1,
    shift,
    driverId,
    familiarity: 'HOME',
    isHomeBus: true,
  };
}

function makeOutput(slots: AssignedSlot[], unfilledCount = 0): SolverOutput {
  return {
    slots,
    unfilled: Array.from({ length: unfilledCount }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      busId: 999,
      routeId: 1,
      shift: 'AM',
      reason: 'no candidate',
    })),
    workloads: [],
    metrics: {
      fairnessScore: 80,
      workDayStdev: 0,
      workDayMean: 20,
      withinTargetRate: 1,
      withinAcceptableRate: 1,
      hardViolationCount: 0,
      exemptedCount: 0,
      homeBusRate: 1,
      crossRouteRate: 0,
      restCycleCompliance: 1,
      weeklyShiftConsistencyRate: 1,
      weekendStdev: 0,
      dayOffSatisfactionRate: 1,
      constitutionalViolations: [],
      unfilledCount,
      localSearchSwaps: 0,
    },
    summary: '',
  };
}

function makeInput(drivers: SolverDriver[]): SolverInput {
  return {
    year: 2026,
    month: 5,
    drivers,
    buses: [],
    crews: [],
    policy: POLICY_PRESETS.CITY_2SHIFT,
  };
}

// ─────────────────────────────────────────────────────────────
// computeRecentFatigue
// ─────────────────────────────────────────────────────────────

describe('computeRecentFatigue', () => {
  it('empty slots → returns 30 (neutral default)', () => {
    const result = computeRecentFatigue([], new Map());
    expect(result).toBe(30);
  });

  it('empty slots → always exactly 30, never NaN/Infinity', () => {
    const result = computeRecentFatigue([], new Map([[1, 5]]));
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(30);
  });

  it('routeId absent from map → treated as fatigue=3 (mid)', () => {
    // Single slot for route 99 (not in map). fatigue=3 → base=(3-1)/4*100=50, intensity=1/22≈0.045 → score≈2
    const result = computeRecentFatigue([{ routeId: 99 }], new Map());
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
    // Verify default-3 path: base=50, intensity=1/22, score=round(50/22)=2
    expect(result).toBe(Math.round(50 * (1 / 22)));
  });

  it('fatigue value = 1 (minimum) → score ≥ 0', () => {
    const m = new Map([[1, 1]]);
    const slots = Array.from({ length: 22 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    expect(result).toBe(0); // (1-1)/4*100 = 0
  });

  it('fatigue value = 5 (maximum) → score = 100 at 22+ slots', () => {
    const m = new Map([[1, 5]]);
    const slots = Array.from({ length: 22 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    expect(result).toBe(100);
  });

  it('fatigue value > 5 (out-of-range high) → result is finite and 0..100 (clamp test)', () => {
    const m = new Map([[1, 99]]);
    const slots = Array.from({ length: 22 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('fatigue value = 0 (out-of-range low) → result finite and 0..100', () => {
    const m = new Map([[1, 0]]);
    const slots = Array.from({ length: 22 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('negative fatigue value → result finite and 0..100', () => {
    const m = new Map([[1, -5]]);
    const slots = Array.from({ length: 22 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('non-integer fatigue (e.g. 2.7) → result is integer in 0..100', () => {
    const m = new Map([[1, 2.7]]);
    const slots = Array.from({ length: 22 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('thousands of slots → clamped at intensity=1 (no score > 100)', () => {
    const m = new Map([[1, 5]]);
    const slots = Array.from({ length: 1000 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    expect(result).toBe(100); // intensity clamped at 1
  });

  it('single slot with max fatigue route → result is finite 0..100', () => {
    const m = new Map([[7, 5]]);
    const result = computeRecentFatigue([{ routeId: 7 }], m);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('NaN fatigue value is guarded and falls back to DEFAULT_FATIGUE=3 [REGRESSION]', () => {
    // Math.max(0, NaN) = NaN in JavaScript — so the clamp does NOT protect against NaN input.
    // Previously: if a route in the DB has fatigueScore=NaN (corrupt data),
    //   computeRecentFatigue returned NaN instead of a safe fallback.
    // Fixed in: fix(solver): guard NaN fatigue
    //   An explicit Number.isNaN guard now replaces NaN values with DEFAULT_FATIGUE=3
    //   before any arithmetic, ensuring the result is always a finite 0-100 integer.
    const m = new Map([[1, NaN]]);
    const slots = Array.from({ length: 10 }, () => ({ routeId: 1 }));
    const result = computeRecentFatigue(slots, m);
    // NaN is replaced by DEFAULT_FATIGUE=3, so the score must be finite
    expect(Number.isNaN(result)).toBe(false); // guard working: NaN not propagated
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
    // With fatigue=3 (DEFAULT_FATIGUE): base=(3-1)/4*100=50, intensity=10/22≈0.4545
    // score = round(50 * 10/22) = round(500/22) = round(22.7...) = 23
    expect(result).toBe(Math.round(50 * (10 / 22)));
  });

  it('zero slots → always 30 (not 0, not NaN)', () => {
    expect(computeRecentFatigue([], new Map([[1, 5]]))).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────
// computeCarryOverPattern
// ─────────────────────────────────────────────────────────────

describe('computeCarryOverPattern', () => {
  it('empty slots → returns undefined', () => {
    expect(computeCarryOverPattern([], '2026-04-30')).toBeUndefined();
  });

  it('all slots are rest days → consecutiveWorkDays=0, lastShift=null, lastWeekDominantShift valid', () => {
    const slots = [
      { date: '2026-04-28', shift: 'AM', isRestDay: true },
      { date: '2026-04-29', shift: 'AM', isRestDay: true },
      { date: '2026-04-30', shift: 'AM', isRestDay: true },
    ];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(0);
    expect(result!.lastShift).toBeNull();
    expect(result!.consecutiveWorkDays).toBeGreaterThanOrEqual(0);
    // lastWeekDominantShift must be a string (no crash)
    expect(typeof result!.lastWeekDominantShift).toBe('string');
  });

  it('streak broken by a gap day → counts only contiguous tail', () => {
    // Worked 4/28, gap 4/29, worked 4/30
    const slots = [
      { date: '2026-04-28', shift: 'AM', isRestDay: false },
      { date: '2026-04-29', shift: 'AM', isRestDay: true }, // gap
      { date: '2026-04-30', shift: 'AM', isRestDay: false },
    ];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(1); // only 4/30 (gap breaks streak at 4/29)
  });

  it('slots unsorted (out-of-date-order input) → still returns correct consecutiveWorkDays', () => {
    // Worked 4/28, 4/29, 4/30 — supplied out of order
    const slots = [
      { date: '2026-04-30', shift: 'PM', isRestDay: false },
      { date: '2026-04-28', shift: 'AM', isRestDay: false },
      { date: '2026-04-29', shift: 'AM', isRestDay: false },
    ];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(3);
    expect(result!.lastShift).toBe('PM'); // PM present on last day
  });

  it('single worked slot on prevMonthEnd → consecutiveWorkDays=1, lastShift set', () => {
    const slots = [{ date: '2026-04-30', shift: 'AM', isRestDay: false }];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(1);
    expect(result!.lastShift).toBe('AM');
  });

  it('slots spanning >7 days (full month) → consecutiveWorkDays ≥ 0', () => {
    const slots = Array.from({ length: 22 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      shift: 'AM',
      isRestDay: false,
    }));
    // gap on day 23-30 — last 8 days are missing
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBeGreaterThanOrEqual(0);
    // 4/30 not in worked → streak = 0
    expect(result!.consecutiveWorkDays).toBe(0);
  });

  it('prevMonthEnd at year boundary (2025-12-31) → no crash, correct dates', () => {
    // 12/31: only AM slot; 12/30: only PM slot
    // lastShift is determined by the *last day* (12/31) which has only 'AM' → 'AM'
    // consecutiveWorkDays: both days worked consecutively → 2
    const slots = [
      { date: '2025-12-31', shift: 'AM', isRestDay: false },
      { date: '2025-12-30', shift: 'PM', isRestDay: false },
    ];
    const result = computeCarryOverPattern(slots, '2025-12-31');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(2);
    // 12/31 has only 'AM' → lastShift='AM' (no PM on that day to prefer)
    expect(result!.lastShift).toBe('AM');
    // lastWeekDominantShift: last 7 days has 1 AM + 1 PM → tie → MIXED
    expect(result!.lastWeekDominantShift).toBe('MIXED');
  });

  it('duplicate-date slots (same date worked, two slots) → PM preferred as lastShift', () => {
    const slots = [
      { date: '2026-04-30', shift: 'AM', isRestDay: false },
      { date: '2026-04-30', shift: 'PM', isRestDay: false },
    ];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.lastShift).toBe('PM');
    expect(result!.consecutiveWorkDays).toBe(1);
  });

  it('tie in lastWeekDominantShift → returns MIXED', () => {
    // 3 AM, 3 PM in last week → tie → MIXED
    const slots = [
      { date: '2026-04-25', shift: 'AM', isRestDay: false },
      { date: '2026-04-26', shift: 'AM', isRestDay: false },
      { date: '2026-04-27', shift: 'AM', isRestDay: false },
      { date: '2026-04-28', shift: 'PM', isRestDay: false },
      { date: '2026-04-29', shift: 'PM', isRestDay: false },
      { date: '2026-04-30', shift: 'PM', isRestDay: false },
    ];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.lastWeekDominantShift).toBe('MIXED');
  });

  it('no work in last 7 days but work earlier → fallback to most-recent shift', () => {
    // Only work on 4/01 (far from end 4/30, outside last 7 days)
    const slots = [{ date: '2026-04-01', shift: 'AM', isRestDay: false }];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(result!.consecutiveWorkDays).toBe(0); // 4/30 not worked
    // lastWeekDominantShift falls back to most recent shift = 'AM'
    expect(result!.lastWeekDominantShift).toBe('AM');
  });

  it('result.consecutiveWorkDays is always >= 0', () => {
    const testCases = [
      [],
      [{ date: '2026-04-30', shift: 'AM', isRestDay: true }],
      [{ date: '2026-04-30', shift: 'AM', isRestDay: false }],
    ];
    for (const slots of testCases) {
      const result = computeCarryOverPattern(slots, '2026-04-30');
      if (result !== undefined) {
        expect(result.consecutiveWorkDays).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('lastWeekDominantShift is always a string (never undefined/null)', () => {
    const slots = [{ date: '2026-04-30', shift: 'FULL_DAY', isRestDay: false }];
    const result = computeCarryOverPattern(slots, '2026-04-30');
    expect(result).toBeDefined();
    expect(typeof result!.lastWeekDominantShift).toBe('string');
    expect(result!.lastWeekDominantShift).not.toBeNull();
    expect(result!.lastWeekDominantShift).not.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// mapPreferredRouteIds
// ─────────────────────────────────────────────────────────────

describe('mapPreferredRouteIds', () => {
  it('empty array → returns []', () => {
    expect(mapPreferredRouteIds([])).toEqual([]);
  });

  it('sorted by ascending priority (lower = more preferred)', () => {
    const prefs = [
      { routeId: 3, priority: 3 },
      { routeId: 1, priority: 1 },
      { routeId: 2, priority: 2 },
    ];
    expect(mapPreferredRouteIds(prefs)).toEqual([1, 2, 3]);
  });

  it('duplicate routeIds → both appear in output in priority order', () => {
    const prefs = [
      { routeId: 5, priority: 2 },
      { routeId: 5, priority: 1 },
    ];
    const result = mapPreferredRouteIds(prefs);
    expect(result).toEqual([5, 5]);
  });

  it('same priority ties → both included, deterministic order for stable sort', () => {
    const prefs = [
      { routeId: 10, priority: 1 },
      { routeId: 20, priority: 1 },
    ];
    const result = mapPreferredRouteIds(prefs);
    // Both must be present
    expect(result).toHaveLength(2);
    expect(result).toContain(10);
    expect(result).toContain(20);
    // Calling again must return same order (deterministic)
    expect(mapPreferredRouteIds(prefs)).toEqual(result);
  });

  it('negative priority → handled without crash, sorted correctly', () => {
    const prefs = [
      { routeId: 7, priority: -1 },
      { routeId: 8, priority: 0 },
      { routeId: 9, priority: 1 },
    ];
    const result = mapPreferredRouteIds(prefs);
    expect(result).toEqual([7, 8, 9]);
  });

  it('does not mutate the original prefs array', () => {
    const prefs = [
      { routeId: 3, priority: 3 },
      { routeId: 1, priority: 1 },
    ];
    const original = prefs.map((p) => ({ ...p }));
    mapPreferredRouteIds(prefs);
    expect(prefs).toEqual(original);
  });

  it('single element → returns [routeId]', () => {
    expect(mapPreferredRouteIds([{ routeId: 42, priority: 0 }])).toEqual([42]);
  });
});

// ─────────────────────────────────────────────────────────────
// newHireWorkdayTarget
// ─────────────────────────────────────────────────────────────

describe('newHireWorkdayTarget', () => {
  const bands = POLICY_PRESETS.CITY_2SHIFT.workdayBands;
  // CITY_2SHIFT: hardMin=18, hardMax=23, sweetMin=19, sweetMax=22

  it('isNewHire=false → returns undefined', () => {
    expect(newHireWorkdayTarget(false, bands)).toBeUndefined();
  });

  it('isNewHire=true → returns DriverWorkdayTarget with exemptReason=NEW_HIRE', () => {
    const result = newHireWorkdayTarget(true, bands);
    expect(result).toBeDefined();
    expect(result!.exemptReason).toBe('NEW_HIRE');
  });

  it('isNewHire=true → min maps to bands.hardMin', () => {
    const result = newHireWorkdayTarget(true, bands);
    expect(result!.min).toBe(bands.hardMin);
  });

  it('isNewHire=true → max maps to bands.hardMax', () => {
    const result = newHireWorkdayTarget(true, bands);
    expect(result!.max).toBe(bands.hardMax);
  });

  it('isNewHire=true → softMin maps to bands.sweetMin', () => {
    const result = newHireWorkdayTarget(true, bands);
    expect(result!.softMin).toBe(bands.sweetMin);
  });

  it('isNewHire=true → softMax maps to bands.sweetMax', () => {
    const result = newHireWorkdayTarget(true, bands);
    expect(result!.softMax).toBe(bands.sweetMax);
  });

  it('isNewHire=true → exemptNote is a non-empty string', () => {
    const result = newHireWorkdayTarget(true, bands);
    expect(typeof result!.exemptNote).toBe('string');
    expect(result!.exemptNote!.length).toBeGreaterThan(0);
  });

  it('VILLAGE_1SHIFT bands also map correctly', () => {
    const villageBands = POLICY_PRESETS.VILLAGE_1SHIFT.workdayBands;
    const result = newHireWorkdayTarget(true, villageBands);
    expect(result!.min).toBe(villageBands.hardMin);
    expect(result!.max).toBe(villageBands.hardMax);
    expect(result!.softMin).toBe(villageBands.sweetMin);
    expect(result!.softMax).toBe(villageBands.sweetMax);
  });
});

// ─────────────────────────────────────────────────────────────
// scheduleQuality — adversarial edge cases
// ─────────────────────────────────────────────────────────────

describe('scheduleQuality — all drivers exempt (ratedDrivers empty)', () => {
  function makeExemptDriver(id: number): SolverDriver {
    return makeDriver(id, {
      workDayTarget: {
        min: 18,
        max: 23,
        softMin: 19,
        softMax: 22,
        exemptReason: 'NEW_HIRE',
      },
    });
  }

  it('no division-by-zero: activeDriverRate is finite and defined', () => {
    const drivers = [makeExemptDriver(1), makeExemptDriver(2), makeExemptDriver(3)];
    const slots = [makeSlot(1, '2026-05-01'), makeSlot(2, '2026-05-01')];
    const q = scheduleQuality(makeInput(drivers), makeOutput(slots));
    expect(Number.isFinite(q.activeDriverRate)).toBe(true);
    expect(q.activeDriverRate).toBeDefined();
  });

  it('compositeScore is finite, defined, and in [0, 100]', () => {
    const drivers = [makeExemptDriver(1), makeExemptDriver(2)];
    const slots = [makeSlot(1, '2026-05-01')];
    const q = scheduleQuality(makeInput(drivers), makeOutput(slots));
    expect(Number.isFinite(q.compositeScore)).toBe(true);
    expect(q.compositeScore).toBeGreaterThanOrEqual(0);
    expect(q.compositeScore).toBeLessThanOrEqual(100);
  });

  it('workDayStdev is 0 (no rated drivers to measure)', () => {
    const drivers = [makeExemptDriver(1)];
    const q = scheduleQuality(makeInput(drivers), makeOutput([makeSlot(1, '2026-05-01')]));
    expect(q.workDayStdev).toBe(0);
  });

  it('nightStdev and weekendStdev are 0 (no rated drivers)', () => {
    const drivers = [makeExemptDriver(1)];
    const q = scheduleQuality(makeInput(drivers), makeOutput([makeSlot(1, '2026-05-01')]));
    expect(q.nightStdev).toBe(0);
    expect(q.weekendStdev).toBe(0);
  });

  it('idleDriverCount = 0 (exempt drivers excluded from idle counting)', () => {
    // All exempt, none worked → ratedDrivers empty → idle = 0
    const drivers = [makeExemptDriver(1), makeExemptDriver(2)];
    const q = scheduleQuality(makeInput(drivers), makeOutput([]));
    expect(q.idleDriverCount).toBe(0);
  });

  it('activeDriverRate = 1 when ratedDrivers is empty (code: ratedDrivers.length===0 ? 1 : ...)', () => {
    const drivers = [makeExemptDriver(1)];
    const q = scheduleQuality(makeInput(drivers), makeOutput([]));
    expect(q.activeDriverRate).toBe(1);
  });

  it('spareUtilizationRate: when all spares are exempt → null (no rated spares)', () => {
    const exemptSpare = makeDriver(1, {
      homeBusId: undefined,
      workDayTarget: { min: 0, max: 23, softMin: 19, softMax: 22, exemptReason: 'NEW_HIRE' },
    });
    const q = scheduleQuality(makeInput([exemptSpare]), makeOutput([]));
    // No rated spares → spareIds empty → spareUtilizationRate = null
    expect(q.spareUtilizationRate).toBeNull();
  });
});

describe('scheduleQuality — preferredRouteIds edge cases', () => {
  it('driver with preferredRouteIds=[] (empty array) → excluded from preferenceSatisfactionRate', () => {
    const d = makeDriver(1, { preferredRouteIds: [] });
    const q = scheduleQuality(makeInput([d]), makeOutput([makeSlot(1, '2026-05-01')]));
    // No drivers with non-empty prefs → null
    expect(q.preferenceSatisfactionRate).toBeNull();
  });

  it('driver with preferredRouteIds=undefined → excluded from preferenceSatisfactionRate', () => {
    const d = makeDriver(1); // no preferredRouteIds set
    const q = scheduleQuality(makeInput([d]), makeOutput([makeSlot(1, '2026-05-01')]));
    expect(q.preferenceSatisfactionRate).toBeNull();
  });

  it('preferenceSatisfactionRate is never NaN when some drivers have prefs and some do not', () => {
    const d1 = makeDriver(1, { preferredRouteIds: [1] });
    const d2 = makeDriver(2, { preferredRouteIds: [] });
    const d3 = makeDriver(3); // undefined
    const slots = [makeSlot(1, '2026-05-01'), makeSlot(2, '2026-05-01'), makeSlot(3, '2026-05-01')];
    const q = scheduleQuality(makeInput([d1, d2, d3]), makeOutput(slots));
    if (q.preferenceSatisfactionRate !== null) {
      expect(Number.isNaN(q.preferenceSatisfactionRate)).toBe(false);
      expect(q.preferenceSatisfactionRate).toBeGreaterThanOrEqual(0);
      expect(q.preferenceSatisfactionRate).toBeLessThanOrEqual(1);
    }
  });

  it('driver with prefs but zero assigned slots → not counted in rate (driverSlots.length===0 guard)', () => {
    const d1 = makeDriver(1, { preferredRouteIds: [1] }); // pref but no slots
    const d2 = makeDriver(2, { preferredRouteIds: [1] });
    const slots = [makeSlot(2, '2026-05-01')]; // only d2 gets a slot
    const q = scheduleQuality(makeInput([d1, d2]), makeOutput(slots));
    // Only d2 is counted (d1 has 0 slots). d2 gets route 1 which matches pref → 1.0
    expect(q.preferenceSatisfactionRate).toBeCloseTo(1.0, 5);
    expect(Number.isNaN(q.preferenceSatisfactionRate!)).toBe(false);
  });

  it('mixed pref drivers — preferenceSatisfactionRate ∈ [0,1]', () => {
    const d1 = makeDriver(1, { preferredRouteIds: [99] }); // pref route 99, never assigned to it
    const slots = [{ ...makeSlot(1, '2026-05-01'), routeId: 1 }]; // assigned to route 1, not 99
    const q = scheduleQuality(makeInput([d1]), makeOutput(slots));
    expect(q.preferenceSatisfactionRate).toBeCloseTo(0, 5); // 0 matching
    expect(q.preferenceSatisfactionRate).toBeGreaterThanOrEqual(0);
    expect(q.preferenceSatisfactionRate).toBeLessThanOrEqual(1);
  });
});

describe('scheduleQuality — preferredDayOffs adversarial', () => {
  it('driver worked ALL preferred day-offs → dayOffSatisfactionRate=0', () => {
    const d = makeDriver(1, { preferredDayOffs: ['2026-05-10', '2026-05-11'] });
    const slots = [
      makeSlot(1, '2026-05-10'),
      makeSlot(1, '2026-05-11'),
    ];
    const q = scheduleQuality(makeInput([d]), makeOutput(slots));
    expect(q.dayOffSatisfactionRate).toBeCloseTo(0, 5);
    expect(q.dayOffSatisfactionRate).toBeGreaterThanOrEqual(0);
  });

  it('dayOffSatisfactionRate is never NaN even when prefTotal > 0', () => {
    const d = makeDriver(1, { preferredDayOffs: ['2026-05-10'] });
    const slots = [makeSlot(1, '2026-05-10')]; // worked on pref day → 0/1
    const q = scheduleQuality(makeInput([d]), makeOutput(slots));
    expect(Number.isNaN(q.dayOffSatisfactionRate)).toBe(false);
  });
});

describe('scheduleQuality — exemptedCount echoes output.metrics.exemptedCount', () => {
  it('exemptedCount in report mirrors what the solver output reports', () => {
    const d = makeDriver(1);
    const out = makeOutput([makeSlot(1, '2026-05-01')]);
    out.metrics.exemptedCount = 3; // arbitrary solver-reported value
    const q = scheduleQuality(makeInput([d]), out);
    expect(q.exemptedCount).toBe(3);
  });

  it('exemptedCount larger than driver count does not crash', () => {
    const drivers = [makeDriver(1)];
    const out = makeOutput([makeSlot(1, '2026-05-01')]);
    out.metrics.exemptedCount = 999; // absurdly large
    expect(() => scheduleQuality(makeInput(drivers), out)).not.toThrow();
    const q = scheduleQuality(makeInput(drivers), out);
    expect(q.exemptedCount).toBe(999);
  });
});

describe('scheduleQuality — unfilled adversarial', () => {
  it('huge unfilled count → unfilledRate ∈ [0,1]', () => {
    const d = makeDriver(1);
    const out = makeOutput([makeSlot(1, '2026-05-01')], 999);
    const q = scheduleQuality(makeInput([d]), out);
    expect(q.unfilledRate).toBeGreaterThanOrEqual(0);
    expect(q.unfilledRate).toBeLessThanOrEqual(1);
  });

  it('all slots unfilled, none assigned → unfilledRate=1', () => {
    const d = makeDriver(1);
    const out = makeOutput([], 10);
    const q = scheduleQuality(makeInput([d]), out);
    expect(q.unfilledRate).toBe(1);
  });

  it('compositeScore with huge unfilled still ∈ [0,100]', () => {
    const d = makeDriver(1);
    const out = makeOutput([], 1000);
    const q = scheduleQuality(makeInput([d]), out);
    expect(q.compositeScore).toBeGreaterThanOrEqual(0);
    expect(q.compositeScore).toBeLessThanOrEqual(100);
  });
});

describe('scheduleQuality — slots referencing unknown driverIds', () => {
  it('slot for driverId not in input.drivers → does not crash, counts are finite', () => {
    const d = makeDriver(1);
    // Slot for driver 999 who doesn't exist in the input
    const ghostSlot: AssignedSlot = {
      date: '2026-05-01',
      busId: 999,
      routeId: 1,
      shift: 'AM',
      driverId: 999, // not in drivers list
      familiarity: 'CROSS_ROUTE',
      isHomeBus: false,
    };
    const out = makeOutput([ghostSlot]);
    expect(() => scheduleQuality(makeInput([d]), out)).not.toThrow();
    const q = scheduleQuality(makeInput([d]), out);
    expect(Number.isFinite(q.compositeScore)).toBe(true);
    expect(Number.isFinite(q.workDayStdev)).toBe(true);
  });
});

describe('scheduleQuality — composite score invariants', () => {
  it('compositeScore is always in [0, 100]', () => {
    const extremeCases: Array<[SolverInput, SolverOutput]> = [
      // Zero drivers
      [makeInput([]), makeOutput([])],
      // Many violations
      (() => {
        const drivers = [makeDriver(1), makeDriver(2)];
        const out = makeOutput([], 100);
        out.metrics.hardViolationCount = 50;
        out.metrics.constitutionalViolations = Array.from({ length: 50 }, () => ({
          ruleKey: 'noNightStreak' as const,
          ruleId: 1,
          ruleName: 'test',
          driverId: 1,
          detail: 'adversarial',
        }));
        out.metrics.restCycleCompliance = 0;
        return [makeInput(drivers), out] as [SolverInput, SolverOutput];
      })(),
      // Perfect score case
      (() => {
        const drivers = [makeDriver(1)];
        const slots = Array.from({ length: 20 }, (_, i) =>
          makeSlot(1, `2026-05-${String(i + 1).padStart(2, '0')}`),
        );
        return [makeInput(drivers), makeOutput(slots)] as [SolverInput, SolverOutput];
      })(),
    ];

    for (const [input, output] of extremeCases) {
      const q = scheduleQuality(input, output);
      expect(q.compositeScore).toBeGreaterThanOrEqual(0);
      expect(q.compositeScore).toBeLessThanOrEqual(100);
      expect(Number.isFinite(q.compositeScore)).toBe(true);
    }
  });

  it('all numeric rates in report are either null or in [0,1]', () => {
    const drivers = [makeDriver(1), makeDriver(2)];
    const slots = [makeSlot(1, '2026-05-01'), makeSlot(2, '2026-05-01')];
    const q = scheduleQuality(makeInput(drivers), makeOutput(slots));

    const rates: Array<number | null> = [
      q.activeDriverRate,
      q.unfilledRate,
      q.homeBusRate,
      q.crossRouteRate,
      q.preferenceSatisfactionRate,
      q.dayOffSatisfactionRate,
      q.restCycleCompliance,
      q.spareUtilizationRate,
    ];

    for (const rate of rates) {
      if (rate !== null) {
        expect(Number.isFinite(rate)).toBe(true);
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it('all stdevs in report are ≥ 0', () => {
    const drivers = [makeDriver(1), makeDriver(2)];
    const slots = [makeSlot(1, '2026-05-01'), makeSlot(2, '2026-05-01')];
    const q = scheduleQuality(makeInput(drivers), makeOutput(slots));
    expect(q.workDayStdev).toBeGreaterThanOrEqual(0);
    expect(q.nightStdev).toBeGreaterThanOrEqual(0);
    expect(q.weekendStdev).toBeGreaterThanOrEqual(0);
  });

  it('never throws for any combination of empty inputs', () => {
    expect(() => scheduleQuality(makeInput([]), makeOutput([]))).not.toThrow();
    expect(() => scheduleQuality(makeInput([makeDriver(1)]), makeOutput([]))).not.toThrow();
    expect(() => scheduleQuality(makeInput([]), makeOutput([makeSlot(1, '2026-05-01')]))).not.toThrow();
  });
});
