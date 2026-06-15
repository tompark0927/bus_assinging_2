import { POLICY_PRESETS, type SolverBus, type SolverCrew, type SolverDriver, type SolverInput } from '../types';
import { createRng, rngInt, rngFloat, rngChance, type Rng } from '../../../utils/seededRng';

export type PolicyKey = 'CITY_2SHIFT' | 'VILLAGE_1SHIFT';

export interface ScenarioSpec {
  label: string;
  seed: number;
  policy: PolicyKey;
  routes: number;
  busesPerRoute: number;
  sparesPerRoute: number;
  weekdayOps: number;
  weekendOps: number;
  dayOffDensity: number;
  year: number;
  month: number;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function randomDayOffs(rng: Rng, year: number, month: number, count: number): string[] {
  if (count <= 0) return [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const set = new Set<string>();
  let guard = 0;
  while (set.size < count && guard++ < 100) {
    set.add(`${year}-${pad(month)}-${pad(rngInt(rng, 1, daysInMonth))}`);
  }
  return Array.from(set).sort();
}

function buildOperatingDates(year: number, month: number, weekdayOps: number, weekendOps: number, busPositionInRoute: number, busesInRoute: number): string[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const opsRate = isWeekend ? weekendOps : weekdayOps;
    if (busPositionInRoute < Math.floor(busesInRoute * opsRate)) {
      dates.push(`${year}-${pad(month)}-${pad(d)}`);
    }
  }
  return dates;
}

export function buildScenario(spec: ScenarioSpec): SolverInput {
  const rng = createRng(spec.seed);
  const drivers: SolverDriver[] = [];
  const buses: SolverBus[] = [];
  const crews: SolverCrew[] = [];
  let driverId = 1;
  let busId = 1001;
  let crewCounter = 1;
  const oneShift = spec.policy === 'VILLAGE_1SHIFT';

  for (let r = 1; r <= spec.routes; r++) {
    const routeId = r * 100;
    for (let b = 0; b < spec.busesPerRoute; b++) {
      const bId = busId++;
      buses.push({ id: bId, routeId, operatingDates: buildOperatingDates(spec.year, spec.month, spec.weekdayOps, spec.weekendOps, b, spec.busesPerRoute) });
      const crewDriverIds: number[] = [];
      const crewSize = oneShift ? 1 : 2;
      for (let m = 0; m < crewSize; m++) {
        const id = driverId++;
        crewDriverIds.push(id);
        drivers.push({
          id,
          name: `R${r}-차${b + 1}-${String.fromCharCode(65 + m)}`,
          homeBusId: bId,
          homeRouteId: routeId,
          partnerId: crewSize === 2 ? (m === 0 ? id + 1 : id - 1) : undefined,
          canCrossRoute: false,
          approvedDayOffs: rngChance(rng, spec.dayOffDensity) ? randomDayOffs(rng, spec.year, spec.month, rngInt(rng, 1, 2)) : [],
          recentFatigueScore: rngFloat(rng, 20, 60),
          isNewHire: false,
        });
      }
      crews.push({ id: `C${crewCounter++}`, driverIds: crewDriverIds, busId: bId, routeId });
    }
    for (let s = 0; s < spec.sparesPerRoute; s++) {
      drivers.push({
        id: driverId++,
        name: `R${r}-여유${s + 1}`,
        homeRouteId: routeId,
        canCrossRoute: false,
        approvedDayOffs: rngChance(rng, spec.dayOffDensity) ? randomDayOffs(rng, spec.year, spec.month, rngInt(rng, 1, 2)) : [],
        recentFatigueScore: rngFloat(rng, 15, 45),
        isNewHire: s === 0 && r === 1,
      });
    }
  }

  return {
    year: spec.year,
    month: spec.month,
    drivers,
    buses,
    crews,
    policy: spec.policy === 'VILLAGE_1SHIFT' ? POLICY_PRESETS.VILLAGE_1SHIFT : POLICY_PRESETS.CITY_2SHIFT,
    localSearchIterations: 2000,
  };
}

type Shape = Omit<ScenarioSpec, 'label' | 'seed'>;

const SHAPES: { name: string; shape: Shape }[] = [
  { name: 'city-tight', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 12, sparesPerRoute: 1, weekdayOps: 0.95, weekendOps: 0.8, dayOffDensity: 0.4, year: 2026, month: 5 } },
  { name: 'city-balanced', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 12, sparesPerRoute: 4, weekdayOps: 0.95, weekendOps: 0.75, dayOffDensity: 0.3, year: 2026, month: 5 } },
  { name: 'city-loose', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 12, sparesPerRoute: 7, weekdayOps: 0.9, weekendOps: 0.7, dayOffDensity: 0.2, year: 2026, month: 5 } },
  { name: 'village-tight', shape: { policy: 'VILLAGE_1SHIFT', routes: 2, busesPerRoute: 8, sparesPerRoute: 1, weekdayOps: 0.95, weekendOps: 0.85, dayOffDensity: 0.4, year: 2026, month: 5 } },
  { name: 'village-balanced', shape: { policy: 'VILLAGE_1SHIFT', routes: 2, busesPerRoute: 8, sparesPerRoute: 3, weekdayOps: 0.9, weekendOps: 0.8, dayOffDensity: 0.3, year: 2026, month: 5 } },
  { name: 'small-city', shape: { policy: 'CITY_2SHIFT', routes: 1, busesPerRoute: 6, sparesPerRoute: 2, weekdayOps: 0.95, weekendOps: 0.75, dayOffDensity: 0.3, year: 2026, month: 5 } },
  { name: 'large-city', shape: { policy: 'CITY_2SHIFT', routes: 3, busesPerRoute: 14, sparesPerRoute: 4, weekdayOps: 0.95, weekendOps: 0.75, dayOffDensity: 0.3, year: 2026, month: 5 } },
];

const SEEDS = [1001, 2002, 3003];

export const SCENARIO_SUITE: ScenarioSpec[] = SHAPES.flatMap(({ name, shape }) =>
  SEEDS.map((seed) => ({ ...shape, label: `${name}#${seed}`, seed })),
);
