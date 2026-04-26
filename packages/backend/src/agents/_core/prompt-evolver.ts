/**
 * PromptEvolver — 인간 거부 패턴을 다음 결정의 학습 컨텍스트로 주입.
 *
 * 작동 방식:
 *   1) BaseAgent.run() 직전에 getEvolvedSystemPrompt(baseSystemPrompt, agentName, companyId) 호출
 *   2) 함수가 최근 N개의 humanOverride=true 결정을 조회
 *   3) 각 결정의 finalAction + overrideReason 을 "주의사항" 으로 포맷
 *   4) baseSystemPrompt 끝에 "## 과거 거부 사례 (학습된 주의사항)" 섹션 추가
 *   5) 결과를 반환 (BaseAgent 는 이 evolved prompt 로 모델 호출)
 *
 * 핵심 설계 결정:
 *   - LLM 요약 없이 거부 사례를 그대로 보여줌 (단순·투명·디버그 가능)
 *   - 회사별 격리: 같은 에이전트라도 회사마다 다른 주의사항 (전국 SaaS 의 핵심)
 *   - 만료 기간: 최근 90일만 (오래된 거부는 점점 weight ↓)
 *   - 최대 개수: 20건 (토큰 비용 제한)
 *   - 캐싱: 회사별 5분 메모리 캐시 (DB 부하 ↓)
 *   - 개수 0건이면 base prompt 그대로 반환 (불필요한 텍스트 추가 안 함)
 */

import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';

const MAX_OVERRIDES_TO_INJECT = 20;
const MAX_AGE_DAYS = 90;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

interface CacheEntry {
  evolvedPrompt: string;
  fetchedAt: number;
}

// 회사별 + 에이전트별 캐시 키
function cacheKey(agentName: string, companyId: number): string {
  return `${agentName}:${companyId}`;
}

const cache = new Map<string, CacheEntry>();

/**
 * 캐시 무효화 — 새 오버라이드가 기록되면 호출되어야 함.
 * agentDecisionController.overrideAgentDecision 에서 호출.
 */
export function invalidatePromptCache(agentName: string, companyId: number): void {
  cache.delete(cacheKey(agentName, companyId));
}

/**
 * 모든 캐시 비우기 — 테스트 전후에 사용.
 */
export function clearAllPromptCaches(): void {
  cache.clear();
}

/**
 * 최근 거부 패턴을 베이스 프롬프트에 주입하여 진화된 프롬프트를 반환.
 *
 * @param baseSystemPrompt 에이전트의 기본 시스템 프롬프트
 * @param agentName 에이전트 식별자 ('emergency', 'dispatch' 등)
 * @param companyId 회사 ID (멀티테넌시 격리)
 * @returns 진화된 시스템 프롬프트
 */
export async function getEvolvedSystemPrompt(
  baseSystemPrompt: string,
  agentName: string,
  companyId: number
): Promise<string> {
  const key = cacheKey(agentName, companyId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.evolvedPrompt;
  }

  let evolved: string;
  try {
    const since = new Date(Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000);

    const overrides = await prisma.agentDecision.findMany({
      where: {
        companyId,
        agentName,
        humanOverride: true,
        overrideReason: { not: null },
        createdAt: { gte: since },
      },
      select: {
        finalAction: true,
        overrideReason: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_OVERRIDES_TO_INJECT,
    });

    if (overrides.length === 0) {
      evolved = baseSystemPrompt;
    } else {
      evolved = injectCautions(baseSystemPrompt, overrides);
    }
  } catch (err) {
    logger.error('[PromptEvolver] 오버라이드 조회 실패, base prompt 사용', err);
    evolved = baseSystemPrompt;
  }

  cache.set(key, { evolvedPrompt: evolved, fetchedAt: Date.now() });
  return evolved;
}

/**
 * 베이스 프롬프트에 거부 사례 섹션을 추가.
 * 순수 함수 — 단위 테스트 가능.
 */
export function injectCautions(
  baseSystemPrompt: string,
  overrides: Array<{ finalAction: string; overrideReason: string | null; createdAt: Date }>
): string {
  if (overrides.length === 0) return baseSystemPrompt;

  const lines: string[] = [];
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 🧠 과거 거부 사례 (학습된 주의사항)');
  lines.push('');
  lines.push(
    '관리자가 다음과 같은 결정을 거부한 적이 있습니다. **같은 실수를 반복하지 마세요**.'
  );
  lines.push(`(최근 ${MAX_AGE_DAYS}일, 최대 ${MAX_OVERRIDES_TO_INJECT}건)`);
  lines.push('');

  overrides.forEach((o, i) => {
    const date = o.createdAt.toISOString().slice(0, 10);
    const action = o.finalAction.slice(0, 200);
    const reason = (o.overrideReason ?? '').slice(0, 300);
    lines.push(`### 사례 ${i + 1} (${date})`);
    lines.push(`- **결정:** ${action}`);
    lines.push(`- **거부 사유:** ${reason}`);
    lines.push('');
  });

  lines.push('위 사례들의 공통 패턴을 인식하고, 비슷한 상황에서 다른 접근을 시도하세요.');

  return baseSystemPrompt + lines.join('\n');
}

/**
 * 캐시 상태 조회 — 디버그·테스트용.
 */
export function getCacheStats(): { entries: number; keys: string[] } {
  return {
    entries: cache.size,
    keys: Array.from(cache.keys()),
  };
}
