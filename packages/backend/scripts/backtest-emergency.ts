/**
 * EmergencyAgent 백테스트 CLI 스크립트.
 *
 * 사용법:
 *   npm run backtest:emergency                 # 30개 시나리오 (기본)
 *   npm run backtest:emergency -- --drops=50   # 50개 시나리오
 *   npm run backtest:emergency -- --dry-run    # 픽스처 생성·정리만 (Anthropic API 호출 안 함)
 *   npm run backtest:emergency -- --keep       # 픽스처 유지 (디버깅용)
 *   npm run backtest:emergency -- --cleanup-only  # 모든 BT 회사 일괄 정리
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY 가 설정되어 있어야 실제 에이전트 실행 가능.
 *   미설정 시 자동으로 dry-run 처리.
 *
 * 산출물:
 *   - 콘솔에 한국어 백테스트 보고서 출력
 *   - PHASE 1 출시 기준 충족 여부 표시
 *   - 종료 코드: 통과=0, 미달=1, 실행 에러=2 (CI 통합용)
 */

import dotenv from 'dotenv';
import path from 'path';

// .env 우선 로드
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { EmergencyAgent } from '../src/agents/emergency.agent';
import { SimulationRunner, formatBacktestReport } from '../src/agents/_core/simulation';
import {
  generateScenarioFixture,
  cleanupAllBacktestFixtures,
} from '../src/agents/_core/scenario-generator';
import { StubAgent } from '../src/agents/_core/stub-agent';
import { ToolRegistry } from '../src/agents/_core/tool-registry';
import { EMERGENCY_TOOLS_V1 } from '../src/agents/_tools/emergency-tools';
import logger from '../src/utils/logger';

// ─────────────────────────────────────────────
// CLI 인자 파싱
// ─────────────────────────────────────────────

interface CliArgs {
  drops: number;
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
    drops: parseInt(get('drops') ?? '30', 10),
    drivers: parseInt(get('drivers') ?? '20', 10),
    routes: parseInt(get('routes') ?? '5', 10),
    dryRun: get('dry-run') === 'true',
    smoke: get('smoke') === 'true',
    keep: get('keep') === 'true',
    cleanupOnly: get('cleanup-only') === 'true',
  };
}

/**
 * 단일 드랍을 처리하는 StubAgent — 이상적인 EmergencyAgent 흐름을 모방.
 * dropId 별로 인스턴스 생성. 시뮬레이션 모드에서 외부 효과 도구는 stub 결과만 반환.
 */
function buildEmergencySmokeAgent(dropId: number): StubAgent {
  const registry = new ToolRegistry();
  registry.registerAll(EMERGENCY_TOOLS_V1);

  return new StubAgent({
    name: 'emergency_stub',
    tools: registry,
    scriptedCalls: [
      { type: 'static', tool: 'get_drop_context', args: { dropId } },
      // 컨텍스트에서 date/shift 추출
      {
        type: 'dynamic',
        tool: 'list_off_duty_drivers',
        argsBuilder: (prior) => {
          const ctxCall = prior.find((c) => c.tool === 'get_drop_context');
          const result = ctxCall?.result as { slot?: { date?: string; shift?: string } } | undefined;
          if (!result?.slot?.date || !result.slot.shift) {
            throw new Error('drop context 미수신');
          }
          return { date: result.slot.date, shift: result.slot.shift };
        },
      },
      // 후보 점수화
      {
        type: 'dynamic',
        tool: 'score_acceptance_likelihood',
        argsBuilder: (prior) => {
          const offDuty = prior.find((c) => c.tool === 'list_off_duty_drivers');
          const result = offDuty?.result as
            | { offDutyDrivers?: Array<{ id: number }>; date?: string }
            | undefined;
          const ids = result?.offDutyDrivers?.map((d) => d.id) ?? [];
          if (ids.length === 0) throw new Error('휴무 기사 없음');
          // list_off_duty_drivers 의 echo 에는 date 가 없으므로 prior 에서 다시 추출
          const ctxCall = prior.find((c) => c.tool === 'get_drop_context');
          const ctxResult = ctxCall?.result as { slot?: { date?: string } } | undefined;
          return { driverIds: ids, date: ctxResult?.slot?.date ?? '2026-04-15' };
        },
        skipOnError: true,
      },
      // 푸시 (시뮬 stub) — Top-3
      {
        type: 'dynamic',
        tool: 'send_targeted_push',
        argsBuilder: (prior) => {
          const scored = prior.find((c) => c.tool === 'score_acceptance_likelihood');
          const result = scored?.result as
            | { ranked?: Array<{ driverId: number }> }
            | undefined;
          const top3 = (result?.ranked ?? []).slice(0, 3).map((r) => r.driverId);
          if (top3.length === 0) throw new Error('점수화 결과 없음');
          return {
            dropId,
            driverIds: top3,
            title: '[smoke] 대타 요청',
            body: '[smoke] StubAgent 요청',
          };
        },
        skipOnError: true,
      },
      // postmortem (정상 종료)
      {
        type: 'static',
        tool: 'generate_postmortem',
        args: { dropId, outcome: 'EXPIRED', totalPushesSent: 3, notes: 'smoke run' },
      },
    ],
    finalText: '[smoke] EmergencyAgent 파이프라인 검증 완료.',
  });
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs();

  console.log('═══════════════════════════════════════════');
  console.log('  EmergencyAgent 백테스트');
  console.log('═══════════════════════════════════════════');
  console.log(`드랍 수:     ${args.drops}`);
  console.log(`기사 수:     ${args.drivers}`);
  console.log(`노선 수:     ${args.routes}`);
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

  // 1. 픽스처 생성
  console.log('📦 합성 픽스처 생성 중...');
  const fixture = await generateScenarioFixture({
    driverCount: args.drivers,
    routeCount: args.routes,
    dropCount: args.drops,
    baseTime: new Date(),
    urgencyMix: { critical: 0.2, high: 0.3, normal: 0.5 },
    generateActualOutcomes: true,
  });
  console.log(`✅ 회사 ${fixture.companyCode} 생성 — ${fixture.scenarios.length}개 시나리오 준비`);
  console.log('');

  let exitCode = 0;
  const isDryRun = args.dryRun || (!args.smoke && !process.env.ANTHROPIC_API_KEY);

  try {
    if (isDryRun) {
      console.log('⚠️  dry-run 모드 — Anthropic API 호출 없이 픽스처만 검증');
      console.log(`✅ 시나리오 ${fixture.scenarios.length}개 정상 생성`);
      console.log('');
      console.log('각 시나리오 요약:');
      for (const s of fixture.scenarios.slice(0, 5)) {
        console.log(
          `  - ${s.id}: drop=${s.dropId} virtualNow=${s.virtualNow.toISOString()} ` +
            `actual=${s.actualOutcome?.accepted ? 'accepted' : 'failed'}`
        );
      }
      if (fixture.scenarios.length > 5) {
        console.log(`  ... 외 ${fixture.scenarios.length - 5}개`);
      }
    } else if (args.smoke) {
      console.log('🧪 SMOKE 모드 — StubAgent 로 파이프라인 검증');
      console.log('   (실제 LLM 추론 없음, 도구 호출 흐름과 측정만 검증)');
      console.log('');

      let succeeded = 0;
      let failed = 0;
      // 각 시나리오마다 StubAgent + Runner (StubAgent 는 dropId 별 인스턴스 필요)
      for (const scenario of fixture.scenarios.slice(0, Math.min(5, fixture.scenarios.length))) {
        const stub = buildEmergencySmokeAgent(scenario.dropId);
        const runner = new SimulationRunner(stub);
        const result = await runner.runScenario(scenario);
        if (result.error) failed++;
        else succeeded++;
        console.log(
          `  ${scenario.id}: ${result.error ? '❌' : '✅'} ` +
            `tools=${result.agentResult.toolCalls.length} ` +
            `urgency=${result.decision.recognizedUrgency ?? '?'}`
        );
      }
      console.log('');
      console.log(`✅ Smoke 결과: 성공 ${succeeded} / 실패 ${failed}`);
      if (failed > 0) exitCode = 2;
    } else {
      // 2. 백테스트 실행
      console.log('🤖 EmergencyAgent 실행 중... (Anthropic API 호출)');
      const agent = new EmergencyAgent();
      const runner = new SimulationRunner(agent, {
        acceptanceRateThreshold: 0.7,
        costPerScenarioCeiling: 200,
      });

      const startTime = Date.now();
      const report = await runner.backtest(fixture.scenarios);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log('');
      console.log(`⏱️  총 소요 시간: ${elapsed}초`);
      console.log('');
      console.log(formatBacktestReport(report));

      if (!report.meetsLaunchCriteria) {
        exitCode = 1;
      }
    }
  } catch (err) {
    logger.error('[backtest] 실행 중 오류', err);
    console.error('❌ 백테스트 실행 실패:', err instanceof Error ? err.message : err);
    exitCode = 2;
  } finally {
    // 3. 정리 (--keep 옵션 없을 때만)
    if (args.keep) {
      console.log('');
      console.log(`🔒 픽스처 유지됨 — 정리하려면:`);
      console.log(`   npm run backtest:emergency -- --cleanup-only`);
      console.log(`   회사 코드: ${fixture.companyCode}, ID: ${fixture.companyId}`);
    } else {
      console.log('');
      console.log('🧹 픽스처 정리 중...');
      try {
        await fixture.cleanupHandle();
        console.log('✅ 정리 완료');
      } catch (err) {
        logger.error('[backtest] 정리 실패', err);
        console.error('⚠️  정리 실패 — 수동 정리 필요:');
        console.error(`   npm run backtest:emergency -- --cleanup-only`);
      }
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
