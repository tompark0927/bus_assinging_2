/**
 * DispatchAgent 백테스트 CLI 스크립트.
 *
 * 사용법:
 *   npm run backtest:dispatch                  # 5개 시나리오 (기본)
 *   npm run backtest:dispatch -- --scenarios=10
 *   npm run backtest:dispatch -- --dry-run     # 픽스처만 (Anthropic API 없음)
 *   npm run backtest:dispatch -- --smoke       # StubAgent 사용 (CI 안전)
 *   npm run backtest:dispatch -- --keep        # 픽스처 유지 (디버깅)
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY 가 없으면 자동 dry-run.
 *   --smoke 모드는 API 키 불필요 (StubAgent 사용).
 *
 * 종료 코드:
 *   0 = PHASE 2 출시 기준 충족 (또는 smoke 통과)
 *   1 = 미달
 *   2 = 실행 에러
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { DispatchAgent } from '../src/agents/dispatch.agent';
import {
  DispatchSimulationRunner,
  formatDispatchBacktestReport,
} from '../src/agents/_core/dispatch-simulation';
import {
  generateDispatchScenario,
  type DispatchScenarioFixture,
} from '../src/agents/_core/dispatch-scenario-generator';
import { cleanupAllBacktestFixtures } from '../src/agents/_core/scenario-generator';
import { StubAgent } from '../src/agents/_core/stub-agent';
import { ToolRegistry } from '../src/agents/_core/tool-registry';
import { DISPATCH_TOOLS_V1 } from '../src/agents/_tools/dispatch-tools';
import logger from '../src/utils/logger';

interface CliArgs {
  scenarios: number;
  drivers: number;
  routes: number;
  dryRun: boolean;
  smoke: boolean;
  keep: boolean;
  cleanupOnly: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const idx = args.findIndex((a) => a.startsWith(`--${name}=`));
    if (idx >= 0) return args[idx].split('=')[1];
    if (args.includes(`--${name}`)) return 'true';
    return undefined;
  };

  return {
    scenarios: parseInt(get('scenarios') ?? '5', 10),
    drivers: parseInt(get('drivers') ?? '15', 10),
    routes: parseInt(get('routes') ?? '3', 10),
    dryRun: get('dry-run') === 'true',
    smoke: get('smoke') === 'true',
    keep: get('keep') === 'true',
    cleanupOnly: get('cleanup-only') === 'true',
  };
}

const STANDARD_RULE_TEXTS = [
  '연속 5일 이상 근무 금지',
  '주 52시간 초과 금지',
  '야간 월 8회 이내',
  '주말 월 1회 휴무 보장',
  '회사 분위기 존중',
];

/**
 * StubAgent 시퀀스 — 이상적인 DispatchAgent 흐름.
 * 도구는 실제 호출되어 DB 와 상호작용 — 파이프라인 무결성 검증.
 * (단, 모델 추론 없이 정해진 호출만 → fairness 실제 개선은 없음)
 */
function buildSmokeAgent(scheduleId: number): StubAgent {
  const registry = new ToolRegistry();
  registry.registerAll(DISPATCH_TOOLS_V1);

  return new StubAgent({
    name: 'dispatch_stub',
    tools: registry,
    scriptedCalls: [
      { type: 'static', tool: 'get_drivers', args: {} },
      { type: 'static', tool: 'get_routes', args: {} },
      { type: 'static', tool: 'get_company_rules', args: {} },
      { type: 'static', tool: 'get_dayoff_requests', args: { status: 'PENDING' } },
      { type: 'static', tool: 'detect_constraint_violation', args: { scheduleId } },
      { type: 'static', tool: 'score_fairness', args: { scheduleId } },
      {
        type: 'static',
        tool: 'publish_schedule',
        args: { scheduleId, summary: '[smoke] StubAgent 발행 요청 — 파이프라인 검증' },
      },
    ],
    finalText: '[smoke] StubAgent 파이프라인 검증 완료. 실제 개선 없음.',
  });
}

async function main(): Promise<number> {
  const args = parseArgs();

  console.log('═══════════════════════════════════════════');
  console.log('  DispatchAgent 백테스트');
  console.log('═══════════════════════════════════════════');
  console.log(`시나리오 수:  ${args.scenarios}`);
  console.log(`기사 수:      ${args.drivers}`);
  console.log(`노선 수:      ${args.routes}`);
  const mode = args.cleanupOnly
    ? 'cleanup-only'
    : args.smoke
    ? 'SMOKE (StubAgent, API 없음)'
    : args.dryRun || !process.env.ANTHROPIC_API_KEY
    ? 'DRY-RUN (픽스처만)'
    : 'LIVE (Anthropic API)';
  console.log(`모드:         ${mode}`);
  console.log(`fixture 유지: ${args.keep ? 'YES' : 'NO'}`);
  console.log('═══════════════════════════════════════════');
  console.log('');

  if (args.cleanupOnly) {
    console.log('🧹 모든 백테스트 픽스처 정리 중...');
    const result = await cleanupAllBacktestFixtures();
    console.log(`✅ 회사 ${result.deletedCompanies}개 삭제 완료`);
    return 0;
  }

  console.log(`📦 ${args.scenarios}개 시나리오 픽스처 생성 중...`);
  const fixtures: DispatchScenarioFixture[] = [];
  try {
    for (let i = 0; i < args.scenarios; i++) {
      const fixture = await generateDispatchScenario({
        driverCount: args.drivers,
        routeCount: args.routes,
        baseTime: new Date(Date.now() + i * 1000),
        randomSeed: 1000 + i,
      });
      fixtures.push(fixture);
      console.log(
        `   ${i + 1}/${args.scenarios}: ${fixture.companyCode} ` +
          `(공정성 ${fixture.baseline.fairnessScore}, 위반 ${fixture.baseline.ruleViolationCount}, ` +
          `휴무 ${fixture.baseline.pendingDayoffCount})`
      );
    }
    console.log(`✅ 픽스처 ${fixtures.length}개 생성 완료`);
    console.log('');
  } catch (err) {
    logger.error('[dispatch-backtest] 픽스처 생성 실패', err);
    console.error('❌ 픽스처 생성 실패:', err instanceof Error ? err.message : err);
    for (const f of fixtures) {
      await f.cleanupHandle().catch(() => {});
    }
    return 2;
  }

  let exitCode = 0;
  const isDryRun = args.dryRun || (!args.smoke && !process.env.ANTHROPIC_API_KEY);

  try {
    if (isDryRun) {
      console.log('⚠️  DRY-RUN: 에이전트 미실행, 픽스처만 검증');
      for (const f of fixtures) {
        console.log(
          `  ${f.companyCode}: 공정성=${f.baseline.fairnessScore}, ` +
            `위반=${f.baseline.ruleViolationCount}, 휴무=${f.baseline.pendingDayoffCount}, ` +
            `규칙=${f.baseline.compiledRulesCount}/${f.baseline.totalRulesCount}`
        );
      }
    } else if (args.smoke) {
      console.log('🧪 SMOKE 모드 — StubAgent 로 파이프라인 검증');
      console.log('   (실제 fairness 개선 없음, 호출 흐름과 측정 파이프라인만 확인)');
      console.log('');

      let totalSucceeded = 0;
      let totalFailed = 0;
      for (const fixture of fixtures) {
        const stub = buildSmokeAgent(fixture.scheduleId);
        const runner = new DispatchSimulationRunner(stub);
        const result = await runner.runScenario(fixture, STANDARD_RULE_TEXTS);
        if (result.error) totalFailed++;
        else totalSucceeded++;
        console.log(
          `  ${fixture.companyCode}: ${result.error ? '❌' : '✅'} ` +
            `tools=${result.agentResult.toolCalls.length}, ` +
            `publish=${result.summary.publishCalled ? 'yes' : 'no'}, ` +
            `fairness ${fixture.baseline.fairnessScore} → ${result.finalState.fairnessScore}`
        );
      }
      console.log('');
      console.log(`✅ Smoke 결과: 성공 ${totalSucceeded} / 실패 ${totalFailed}`);
      if (totalFailed > 0) exitCode = 2;
    } else {
      console.log('🤖 DispatchAgent 실행 중... (Anthropic API)');
      console.log('');

      const agent = new DispatchAgent();
      const runner = new DispatchSimulationRunner(agent);

      const startTime = Date.now();
      const report = await runner.backtest(fixtures, STANDARD_RULE_TEXTS);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log('');
      console.log(`⏱️  총 소요 시간: ${elapsed}초`);
      console.log('');
      console.log(formatDispatchBacktestReport(report));

      if (!report.meetsLaunchCriteria) {
        exitCode = 1;
      }
    }
  } catch (err) {
    logger.error('[dispatch-backtest] 실행 중 오류', err);
    console.error('❌ 백테스트 실행 실패:', err instanceof Error ? err.message : err);
    exitCode = 2;
  } finally {
    if (args.keep) {
      console.log('');
      console.log('🔒 픽스처 유지됨 — 정리:');
      console.log('   npm run backtest:dispatch -- --cleanup-only');
      for (const f of fixtures) {
        console.log(`   - ${f.companyCode} (id=${f.companyId})`);
      }
    } else {
      console.log('');
      console.log('🧹 픽스처 정리 중...');
      let cleaned = 0;
      for (const f of fixtures) {
        try {
          await f.cleanupHandle();
          cleaned++;
        } catch (err) {
          logger.error(`[dispatch-backtest] ${f.companyCode} 정리 실패`, err);
        }
      }
      console.log(`✅ ${cleaned}/${fixtures.length} 정리 완료`);
    }
  }

  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('❌ FATAL', err);
    process.exit(99);
  });
