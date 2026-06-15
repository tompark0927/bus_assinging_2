import { solveMonthlyGrid } from '../monthly-grid-solver';
import { scheduleQuality, type QualityReport } from '../quality';
import { buildScenario, type ScenarioSpec } from './scenarios';

export interface ScenarioResult {
  label: string;
  spec: ScenarioSpec;
  elapsedMs: number;
  quality?: QualityReport;
  error?: string;
}

export function runSuite(specs: ScenarioSpec[]): ScenarioResult[] {
  return specs.map((spec) => {
    const start = Date.now();
    try {
      const input = buildScenario(spec);
      const output = solveMonthlyGrid(input);
      return { label: spec.label, spec, elapsedMs: Date.now() - start, quality: scheduleQuality(input, output) };
    } catch (err) {
      return { label: spec.label, spec, elapsedMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

const NUMERIC_KEYS = [
  'workDayStdev', 'nightStdev', 'weekendStdev', 'activeDriverRate', 'idleDriverCount',
  'unfilledRate', 'homeBusRate', 'crossRouteRate', 'hardViolationCount',
  'constitutionalViolationCount', 'restCycleCompliance', 'compositeScore',
] as const;
type NumericKey = (typeof NUMERIC_KEYS)[number];

export interface Stat { min: number; p25: number; median: number; mean: number; max: number; }
export type Aggregate = Record<NumericKey, Stat>;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}
function statOf(values: number[]): Stat {
  const xs = [...values].sort((a, b) => a - b);
  const mean = xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
  return { min: xs[0] ?? 0, p25: percentile(xs, 0.25), median: percentile(xs, 0.5), mean, max: xs[xs.length - 1] ?? 0 };
}

export function aggregate(results: ScenarioResult[]): Aggregate {
  const ok = results.filter((r) => r.quality);
  const out = {} as Aggregate;
  for (const key of NUMERIC_KEYS) {
    out[key] = statOf(ok.map((r) => r.quality![key] as number));
  }
  return out;
}

export interface GateSpec {
  maxWorkDayStdevMedian: number;
  maxHardViolationTotal: number;
  maxUnfilledRateMedian: number;
  minRestCycleComplianceMin: number;
  maxConstitutionalTotal: number;
}

export const DEFAULT_GATES: GateSpec = {
  maxWorkDayStdevMedian: 0.8,
  maxHardViolationTotal: 0,
  maxUnfilledRateMedian: 0,
  minRestCycleComplianceMin: 1,
  maxConstitutionalTotal: 0,
};

export interface GateReport { passed: boolean; failures: string[]; }

export function evaluateGates(results: ScenarioResult[], gates: GateSpec): GateReport {
  const ok = results.filter((r) => r.quality);
  const failures: string[] = [];
  const errored = results.filter((r) => r.error);
  if (errored.length > 0) failures.push(`solver errors: ${errored.map((r) => r.label).join(', ')}`);

  const agg = aggregate(ok);
  if (agg.workDayStdev.median > gates.maxWorkDayStdevMedian)
    failures.push(`workDayStdev median ${agg.workDayStdev.median.toFixed(2)} > ${gates.maxWorkDayStdevMedian}`);
  const hardTotal = ok.reduce((s, r) => s + r.quality!.hardViolationCount, 0);
  if (hardTotal > gates.maxHardViolationTotal)
    failures.push(`hardViolationCount total ${hardTotal} > ${gates.maxHardViolationTotal}`);
  if (agg.unfilledRate.median > gates.maxUnfilledRateMedian)
    failures.push(`unfilledRate median ${agg.unfilledRate.median.toFixed(3)} > ${gates.maxUnfilledRateMedian}`);
  if (agg.restCycleCompliance.min < gates.minRestCycleComplianceMin)
    failures.push(`restCycleCompliance min ${agg.restCycleCompliance.min.toFixed(3)} < ${gates.minRestCycleComplianceMin}`);
  const constTotal = ok.reduce((s, r) => s + r.quality!.constitutionalViolationCount, 0);
  if (constTotal > gates.maxConstitutionalTotal)
    failures.push(`constitutionalViolation total ${constTotal} > ${gates.maxConstitutionalTotal}`);

  return { passed: failures.length === 0, failures };
}

export interface DeltaReport {
  [key: string]: { current: number; baseline: number; delta: number };
}

export function compareToBaseline(current: Aggregate, baseline: Aggregate): DeltaReport {
  const out: DeltaReport = {};
  for (const key of NUMERIC_KEYS) {
    const cur = current[key].median;
    const base = baseline[key].median;
    out[key] = { current: cur, baseline: base, delta: cur - base };
  }
  return out;
}
