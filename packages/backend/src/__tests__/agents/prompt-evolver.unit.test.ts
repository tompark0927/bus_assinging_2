/**
 * PromptEvolver 단위 테스트.
 *
 * 검증 항목:
 *  1. injectCautions: 순수 함수 — 거부 사례를 base prompt 끝에 정확히 추가
 *  2. 0건이면 base 그대로
 *  3. 회사·에이전트별 캐싱 동작 (5분 TTL)
 *  4. 캐시 무효화 (invalidatePromptCache)
 *  5. DB 에러 시 base prompt 폴백
 *  6. 시뮬레이션 시 base prompt 사용 (BaseAgent 측에서 제어 — 여기선 검증 안 함)
 */

const mockFindMany = jest.fn();

jest.mock('../../utils/prisma', () => ({
  prisma: {
    agentDecision: {
      findMany: mockFindMany,
    },
  },
}));

import {
  injectCautions,
  getEvolvedSystemPrompt,
  invalidatePromptCache,
  clearAllPromptCaches,
  getCacheStats,
} from '../../agents/_core/prompt-evolver';

const BASE_PROMPT = 'You are an emergency dispatch agent.';

beforeEach(() => {
  mockFindMany.mockReset();
  clearAllPromptCaches();
});

// ─────────────────────────────────────────────
// injectCautions (순수 함수)
// ─────────────────────────────────────────────

describe('injectCautions', () => {
  it('빈 배열 → base prompt 그대로 반환', () => {
    expect(injectCautions(BASE_PROMPT, [])).toBe(BASE_PROMPT);
  });

  it('1건 거부 → 주의사항 섹션 + 사례 1개 추가', () => {
    const result = injectCautions(BASE_PROMPT, [
      {
        finalAction: '박기사에게 푸시 전송',
        overrideReason: '박기사는 어제 야간 근무했음 — 다른 기사 우선 시도',
        createdAt: new Date('2026-04-01T08:00:00Z'),
      },
    ]);

    expect(result).toContain(BASE_PROMPT);
    expect(result).toContain('과거 거부 사례');
    expect(result).toContain('박기사에게 푸시 전송');
    expect(result).toContain('박기사는 어제 야간 근무했음');
    expect(result).toContain('2026-04-01');
  });

  it('여러 건 → 모두 포함', () => {
    const result = injectCautions(BASE_PROMPT, [
      {
        finalAction: '결정 A',
        overrideReason: '사유 A',
        createdAt: new Date('2026-04-01'),
      },
      {
        finalAction: '결정 B',
        overrideReason: '사유 B',
        createdAt: new Date('2026-04-02'),
      },
      {
        finalAction: '결정 C',
        overrideReason: '사유 C',
        createdAt: new Date('2026-04-03'),
      },
    ]);

    expect(result).toContain('결정 A');
    expect(result).toContain('사유 A');
    expect(result).toContain('결정 B');
    expect(result).toContain('사유 B');
    expect(result).toContain('결정 C');
    expect(result).toContain('사례 1');
    expect(result).toContain('사례 2');
    expect(result).toContain('사례 3');
  });

  it('null overrideReason 도 처리 (빈 문자열로 표시)', () => {
    const result = injectCautions(BASE_PROMPT, [
      {
        finalAction: '결정 X',
        overrideReason: null,
        createdAt: new Date('2026-04-01'),
      },
    ]);
    expect(result).toContain('결정 X');
    // crash 안 함 — 빈 사유로 렌더
    expect(result).toContain('거부 사유:');
  });

  it('긴 텍스트는 잘라냄 (action 200자, reason 300자)', () => {
    const longAction = 'A'.repeat(500);
    const longReason = 'B'.repeat(500);
    const result = injectCautions(BASE_PROMPT, [
      {
        finalAction: longAction,
        overrideReason: longReason,
        createdAt: new Date('2026-04-01'),
      },
    ]);

    // action 은 정확히 200자만
    const aMatches = result.match(/A+/g)?.[0] ?? '';
    expect(aMatches.length).toBeLessThanOrEqual(200);
    // reason 은 정확히 300자만
    const bMatches = result.match(/B+/g)?.[0] ?? '';
    expect(bMatches.length).toBeLessThanOrEqual(300);
  });
});

// ─────────────────────────────────────────────
// getEvolvedSystemPrompt
// ─────────────────────────────────────────────

describe('getEvolvedSystemPrompt', () => {
  it('오버라이드 0건 → base prompt 그대로', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const result = await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);
    expect(result).toBe(BASE_PROMPT);
  });

  it('오버라이드 N건 → injectCautions 결과 반환', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        finalAction: '결정 1',
        overrideReason: '사유 1',
        createdAt: new Date('2026-04-01'),
      },
    ]);

    const result = await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);

    expect(result).toContain(BASE_PROMPT);
    expect(result).toContain('결정 1');
    expect(result).toContain('사유 1');
  });

  it('회사·에이전트 격리: companyId 필터가 쿼리에 포함', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await getEvolvedSystemPrompt(BASE_PROMPT, 'dispatch', 42);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 42,
          agentName: 'dispatch',
          humanOverride: true,
        }),
      })
    );
  });

  it('캐시: 같은 (agent, company) 두 번 호출 → DB 한 번만', async () => {
    mockFindMany.mockResolvedValue([
      {
        finalAction: '결정 1',
        overrideReason: '사유 1',
        createdAt: new Date('2026-04-01'),
      },
    ]);

    const r1 = await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);
    const r2 = await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });

  it('캐시 격리: 다른 회사는 별도 캐시', async () => {
    mockFindMany.mockResolvedValue([]);

    await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);
    await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 2);

    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  it('캐시 격리: 다른 에이전트는 별도 캐시', async () => {
    mockFindMany.mockResolvedValue([]);

    await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);
    await getEvolvedSystemPrompt(BASE_PROMPT, 'dispatch', 1);

    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  it('invalidatePromptCache 호출 후 DB 재조회', async () => {
    mockFindMany.mockResolvedValue([]);

    await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);

    invalidatePromptCache('emergency', 1);

    await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  it('DB 에러 → base prompt 폴백, throw 안 함', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('DB 다운'));
    const result = await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);
    expect(result).toBe(BASE_PROMPT);
  });

  it('최근 90일 필터 + 최대 20건 정렬 적용', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 1);

    const callArg = mockFindMany.mock.calls[0][0];
    expect(callArg.take).toBe(20);
    expect(callArg.orderBy).toEqual({ createdAt: 'desc' });
    expect(callArg.where.createdAt.gte).toBeInstanceOf(Date);
    // 90일 전 ± 1초
    const expectedSince = Date.now() - 90 * 24 * 3600 * 1000;
    expect(Math.abs(callArg.where.createdAt.gte.getTime() - expectedSince)).toBeLessThan(2000);
  });
});

// ─────────────────────────────────────────────
// 캐시 디버그 유틸
// ─────────────────────────────────────────────

describe('cache utilities', () => {
  it('clearAllPromptCaches 후 캐시 비어있음', async () => {
    mockFindMany.mockResolvedValue([]);
    await getEvolvedSystemPrompt(BASE_PROMPT, 'a', 1);
    await getEvolvedSystemPrompt(BASE_PROMPT, 'b', 2);

    expect(getCacheStats().entries).toBe(2);

    clearAllPromptCaches();
    expect(getCacheStats().entries).toBe(0);
  });

  it('getCacheStats: 키 형식 "agentName:companyId"', async () => {
    mockFindMany.mockResolvedValue([]);
    await getEvolvedSystemPrompt(BASE_PROMPT, 'emergency', 99);

    expect(getCacheStats().keys).toContain('emergency:99');
  });
});
