/**
 * 솔버 측정 하니스 CLI — 순수(in-memory), DB·LLM 없음.
 *
 * 실행:
 *   npm run backtest:solver
 *   npm run backtest:solver -- --json --out=scripts/backtest/baselines/solver-baseline.json
 *   npm run backtest:solver -- --baseline=scripts/backtest/baselines/solver-baseline.json
 *
 * 종료 코드: 0 = 게이트 통과, 1 = 미달.
 */
import fs from 'fs';
import path from 'path';
import { SCENARIO_SUITE } from '../../src/agents/_solvers/bench/scenarios';
import {
  runSuite,
  aggregate,
  evaluateGates,
  compareToBaseline,
  DEFAULT_GATES,
  type Aggregate,
} from '../../src/agents/_solvers/bench/harness';

function getFlag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=')[1];
  return process.argv.includes(`--${name}`) ? 'true' : undefined;
}

const results = runSuite(SCENARIO_SUITE);
const agg = aggregate(results);
const gate = evaluateGates(results, DEFAULT_GATES);

const sep = '═'.repeat(78);
console.log(sep);
console.log(`솔버 측정 하니스 — ${results.length}개 시나리오`);
console.log(sep);
for (const r of results) {
  if (r.error) {
    console.log(`  ✗ ${r.label}: ERROR ${r.error}`);
  } else {
    const q = r.quality!;
    console.log(
      `  ${r.label}: 종합 ${q.compositeScore} | 근무stdev ${q.workDayStdev.toFixed(2)} | ` +
        `미배정 ${(q.unfilledRate * 100).toFixed(1)}% | 하드 ${q.hardViolationCount} | ` +
        `유휴 ${q.idleDriverCount} | SPARE활용 ${q.spareUtilizationRate === null ? '-' : (q.spareUtilizationRate * 100).toFixed(0) + '%'} | ${r.elapsedMs}ms`,
    );
  }
}
console.log(sep);
const fmt = (s: { min: number; p25: number; median: number; mean: number; max: number }) =>
  `min ${s.min.toFixed(2)} / p25 ${s.p25.toFixed(2)} / median ${s.median.toFixed(2)} / mean ${s.mean.toFixed(2)} / max ${s.max.toFixed(2)}`;
console.log(`종합점수      ${fmt(agg.compositeScore)}`);
console.log(`근무일 stdev  ${fmt(agg.workDayStdev)}`);
console.log(`미배정률      ${fmt(agg.unfilledRate)}`);
console.log(`restCycle     ${fmt(agg.restCycleCompliance)}`);
console.log(sep);
console.log(`게이트: ${gate.passed ? '✓ 통과' : '✗ 미달'}`);
for (const f of gate.failures) console.log(`  ✗ ${f}`);
console.log(sep);

const baselinePath = getFlag('baseline');
if (baselinePath) {
  const base = JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf-8')) as Aggregate;
  const delta = compareToBaseline(agg, base);
  console.log('baseline 대비 (중앙값 델타):');
  for (const [k, v] of Object.entries(delta)) {
    const arrow = v.delta > 0 ? '▲' : v.delta < 0 ? '▼' : '=';
    console.log(`  ${k}: ${v.baseline.toFixed(3)} → ${v.current.toFixed(3)} (${arrow}${Math.abs(v.delta).toFixed(3)})`);
  }
  console.log(sep);
}

if (getFlag('json') || getFlag('out')) {
  const outPath = getFlag('out');
  const payload = JSON.stringify(agg, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), payload);
    console.log(`집계 JSON 저장: ${outPath}`);
  } else {
    console.log(payload);
  }
}

process.exit(gate.passed ? 0 : 1);
