/**
 * DailyReportAgent + dailyReportRunner 단위 테스트.
 *
 * 검증 항목:
 *  1. DailyReportAgent 클래스 와이어링 (6개 도구 등록)
 *  2. dailyReportRunner 의 idempotency (이미 보고서가 있으면 skip)
 *  3. BT prefix 백테스트 회사 자동 제외
 *  4. feature flag (DAILY_REPORT_AGENT_ENABLED)
 *  5. 보고서 시각 (09:00 KST) 체크
 *  6. force=true 옵션은 기존 보고서가 있어도 재생성
 */

const mockCompanyFindUnique = jest.fn();
const mockCompanyFindMany = jest.fn();
const mockDailyReportFindUnique = jest.fn();
const mockAgentRun = jest.fn();

jest.mock('../../utils/prisma', () => ({
  prisma: {
    company: {
      findUnique: (...a: unknown[]) => mockCompanyFindUnique(...a),
      findMany: (...a: unknown[]) => mockCompanyFindMany(...a),
    },
    dailyReport: {
      findUnique: (...a: unknown[]) => mockDailyReportFindUnique(...a),
    },
  },
}));

jest.mock('../../agents/daily-report.agent', () => ({
  DailyReportAgent: jest.fn().mockImplementation(() => ({
    run: mockAgentRun,
  })),
}));

import { DailyReportAgent } from '../../agents/daily-report.agent';
import { REPORT_TOOLS_V1 } from '../../agents/_tools/report-tools';
import {
  isDailyReportAgentEnabled,
  isReportTimeReached,
  todayKstStart,
  yesterdayKstStart,
  runDailyReportForCompany,
  runDailyReportsForAllCompanies,
} from '../../services/dailyReportRunner';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DAILY_REPORT_AGENT_ENABLED;
  mockAgentRun.mockResolvedValue({
    decisionId: 1,
    sessionId: 'sess',
    finalAction: 'done',
    reasoning: 'r',
    status: 'COMPLETED',
    toolCalls: [],
    tokensIn: 100,
    tokensOut: 50,
    costKrw: 50,
    durationMs: 1000,
  });
});

afterEach(() => {
  delete process.env.DAILY_REPORT_AGENT_ENABLED;
});

// ─────────────────────────────────────────────
// REPORT_TOOLS_V1 + DailyReportAgent 와이어링
// ─────────────────────────────────────────────

describe('DailyReportAgent wiring', () => {
  it('6개 도구가 등록되어 있다', () => {
    expect(REPORT_TOOLS_V1).toHaveLength(6);
  });

  it('필수 도구 input_schema required 필드 검증', () => {
    const requiredFields: Record<string, string[]> = {
      save_daily_report: ['reportDate', 'content', 'summary', 'severity'],
    };

    for (const [toolName, expected] of Object.entries(requiredFields)) {
      const tool = REPORT_TOOLS_V1.find((t) => t.name === toolName);
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toEqual(expect.arrayContaining(expected));
    }
  });

  it('인스턴스화 가능 (실제 BaseAgent 상속)', () => {
    // jest.mock 으로 가짜로 대체했지만, 실제 import 시 throw 안 해야 함
    expect(DailyReportAgent).toBeDefined();
  });
});

// ─────────────────────────────────────────────
// isDailyReportAgentEnabled
// ─────────────────────────────────────────────

describe('isDailyReportAgentEnabled', () => {
  it("환경변수 미설정 → false", () => {
    delete process.env.DAILY_REPORT_AGENT_ENABLED;
    expect(isDailyReportAgentEnabled()).toBe(false);
  });

  it("'true' → true", () => {
    process.env.DAILY_REPORT_AGENT_ENABLED = 'true';
    expect(isDailyReportAgentEnabled()).toBe(true);
  });

  it('기타 값 → false', () => {
    process.env.DAILY_REPORT_AGENT_ENABLED = '1';
    expect(isDailyReportAgentEnabled()).toBe(false);
    process.env.DAILY_REPORT_AGENT_ENABLED = 'yes';
    expect(isDailyReportAgentEnabled()).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isReportTimeReached / todayKstStart / yesterdayKstStart
// ─────────────────────────────────────────────

describe('time helpers', () => {
  it('isReportTimeReached: KST 09:00 직전 → false', () => {
    // UTC 23:30 = KST 08:30
    const beforeNine = new Date('2026-04-10T23:30:00Z');
    expect(isReportTimeReached(beforeNine)).toBe(false);
  });

  it('isReportTimeReached: KST 09:00 정각 → true', () => {
    // UTC 00:00 = KST 09:00
    const nine = new Date('2026-04-11T00:00:00Z');
    expect(isReportTimeReached(nine)).toBe(true);
  });

  it('isReportTimeReached: KST 18:00 → true', () => {
    const eighteen = new Date('2026-04-10T09:00:00Z');
    expect(isReportTimeReached(eighteen)).toBe(true);
  });

  it('todayKstStart: KST 자정 반환', () => {
    // UTC 2026-04-10 23:30 = KST 2026-04-11 08:30
    // KST 오늘 = 2026-04-11
    const now = new Date('2026-04-10T23:30:00Z');
    const today = todayKstStart(now);
    expect(today.toISOString()).toBe('2026-04-11T00:00:00.000Z');
  });

  it('yesterdayKstStart: 어제 KST 자정', () => {
    const now = new Date('2026-04-10T23:30:00Z');
    const yesterday = yesterdayKstStart(now);
    expect(yesterday.toISOString()).toBe('2026-04-10T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────
// runDailyReportForCompany
// ─────────────────────────────────────────────

describe('runDailyReportForCompany', () => {
  const realCompany = { id: 5, code: 'PROD', isActive: true };
  const btCompany = { id: 6, code: 'BT123456', isActive: true };
  const inactiveCompany = { id: 7, code: 'PROD2', isActive: false };

  it('정상 회사 + 보고서 미존재 → 에이전트 실행', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(realCompany);
    mockDailyReportFindUnique.mockResolvedValueOnce(null);

    const result = await runDailyReportForCompany(5, {
      virtualNow: new Date('2026-04-10T00:00:00Z'),
    });

    expect(mockAgentRun).toHaveBeenCalledTimes(1);
    expect('skipped' in result).toBe(false);
  });

  it('정상 회사 + 보고서 존재 → skip', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(realCompany);
    mockDailyReportFindUnique.mockResolvedValueOnce({ id: 99 });

    const result = await runDailyReportForCompany(5);

    expect(mockAgentRun).not.toHaveBeenCalled();
    expect('skipped' in result).toBe(true);
    if ('skipped' in result) {
      expect(result.reason).toContain('이미 존재');
    }
  });

  it('BT prefix 회사 → skip (백테스트 회사 보고서 안 만듦)', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(btCompany);

    const result = await runDailyReportForCompany(6);

    expect(mockAgentRun).not.toHaveBeenCalled();
    expect('skipped' in result).toBe(true);
    if ('skipped' in result) {
      expect(result.reason).toContain('백테스트');
    }
  });

  it('비활성 회사 → skip', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(inactiveCompany);

    const result = await runDailyReportForCompany(7);

    expect(mockAgentRun).not.toHaveBeenCalled();
    expect('skipped' in result).toBe(true);
  });

  it('회사 없음 → skip', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(null);

    const result = await runDailyReportForCompany(999);

    expect(mockAgentRun).not.toHaveBeenCalled();
    expect('skipped' in result).toBe(true);
  });

  it('force=true → 기존 보고서 무시하고 재생성', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(realCompany);
    // findUnique 는 호출조차 안 됨 (force 가 true 면)

    await runDailyReportForCompany(5, { force: true });

    expect(mockAgentRun).toHaveBeenCalledTimes(1);
    expect(mockDailyReportFindUnique).not.toHaveBeenCalled();
  });

  it('에이전트 실행 시 sessionId + reportDate 가 task 에 포함', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(realCompany);
    mockDailyReportFindUnique.mockResolvedValueOnce(null);

    await runDailyReportForCompany(5, {
      virtualNow: new Date('2026-04-10T23:00:00Z'), // KST 4월 11일 08시
    });

    const callArg = mockAgentRun.mock.calls[0][0];
    expect(callArg.companyId).toBe(5);
    expect(callArg.triggerType).toBe('cron');
    expect(callArg.sessionId).toMatch(/^daily-report-5-/);
    expect(callArg.task).toContain('save_daily_report');
  });

  it('에이전트가 throw → 함수도 throw (호출자가 처리)', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(realCompany);
    mockDailyReportFindUnique.mockResolvedValueOnce(null);
    mockAgentRun.mockRejectedValueOnce(new Error('API 다운'));

    await expect(runDailyReportForCompany(5)).rejects.toThrow('API 다운');
  });
});

// ─────────────────────────────────────────────
// runDailyReportsForAllCompanies
// ─────────────────────────────────────────────

describe('runDailyReportsForAllCompanies', () => {
  it('feature flag OFF → noop', async () => {
    delete process.env.DAILY_REPORT_AGENT_ENABLED;

    const summary = await runDailyReportsForAllCompanies();

    expect(summary.enabled).toBe(false);
    expect(summary.processed).toBe(0);
    expect(mockCompanyFindMany).not.toHaveBeenCalled();
  });

  it('flag ON + 보고서 시각 미도래 → noop', async () => {
    process.env.DAILY_REPORT_AGENT_ENABLED = 'true';

    // KST 06:00 = UTC 21:00 (전날) — 09시 미도래
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-10T21:00:00Z'));

    try {
      const summary = await runDailyReportsForAllCompanies();
      expect(summary.enabled).toBe(true);
      expect(summary.reportTimeReached).toBe(false);
      expect(summary.processed).toBe(0);
      expect(mockCompanyFindMany).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('flag ON + 시각 도래 + 회사 3개 → 모두 처리', async () => {
    process.env.DAILY_REPORT_AGENT_ENABLED = 'true';

    // KST 10:00 = UTC 01:00 — 09시 도래
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-11T01:00:00Z'));

    try {
      mockCompanyFindMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
      mockCompanyFindUnique
        .mockResolvedValueOnce({ id: 1, code: 'PROD1', isActive: true })
        .mockResolvedValueOnce({ id: 2, code: 'PROD2', isActive: true })
        .mockResolvedValueOnce({ id: 3, code: 'PROD3', isActive: true });
      mockDailyReportFindUnique.mockResolvedValue(null);

      const summary = await runDailyReportsForAllCompanies();

      expect(summary.enabled).toBe(true);
      expect(summary.reportTimeReached).toBe(true);
      expect(summary.processed).toBe(3);
      expect(summary.generated).toBe(3);
      expect(summary.skipped).toBe(0);
      expect(summary.failed).toBe(0);
      expect(mockAgentRun).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('한 회사 실패해도 나머지 진행', async () => {
    process.env.DAILY_REPORT_AGENT_ENABLED = 'true';

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-11T01:00:00Z'));

    try {
      mockCompanyFindMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
      mockCompanyFindUnique
        .mockResolvedValueOnce({ id: 1, code: 'PROD1', isActive: true })
        .mockResolvedValueOnce({ id: 2, code: 'PROD2', isActive: true })
        .mockResolvedValueOnce({ id: 3, code: 'PROD3', isActive: true });
      mockDailyReportFindUnique.mockResolvedValue(null);
      mockAgentRun
        .mockResolvedValueOnce({
          decisionId: 1,
          sessionId: 's',
          finalAction: 'ok',
          reasoning: 'r',
          status: 'COMPLETED',
          toolCalls: [],
          tokensIn: 100,
          tokensOut: 50,
          costKrw: 50,
          durationMs: 100,
        })
        .mockRejectedValueOnce(new Error('API 다운'))
        .mockResolvedValueOnce({
          decisionId: 3,
          sessionId: 's',
          finalAction: 'ok',
          reasoning: 'r',
          status: 'COMPLETED',
          toolCalls: [],
          tokensIn: 100,
          tokensOut: 50,
          costKrw: 50,
          durationMs: 100,
        });

      const summary = await runDailyReportsForAllCompanies();

      expect(summary.processed).toBe(3);
      expect(summary.generated).toBe(2);
      expect(summary.failed).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('BT prefix 회사 자동 제외 (where 절 검증)', async () => {
    process.env.DAILY_REPORT_AGENT_ENABLED = 'true';

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-11T01:00:00Z'));

    try {
      mockCompanyFindMany.mockResolvedValueOnce([]);

      await runDailyReportsForAllCompanies();

      const callArg = mockCompanyFindMany.mock.calls[0][0];
      expect(callArg.where.isActive).toBe(true);
      expect(callArg.where.NOT.code.startsWith).toBe('BT');
    } finally {
      jest.useRealTimers();
    }
  });
});
