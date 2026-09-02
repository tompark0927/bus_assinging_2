/**
 * 엔진 튜닝 정책 저장소 — 단일 소스는 DB.
 *
 * 특히 확인할 것:
 *   - DB 에 있으면 엔진을 부르지 않는다 (엔진이 꺼져 있어도 동작)
 *   - DB 가 비었고 엔진 파일에 구 정책이 있으면 한 번 옮긴다 (lazy migration)
 *   - 카탈로그에 없는 키는 거부한다 (오타·스키마 드리프트 방지)
 */
jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import {
  loadEnginePolicy,
  saveEnginePolicy,
  EnginePolicyValidationError,
} from '../services/enginePolicyStore';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;
const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENGINE_URL = 'http://engine:8100';
  (global as any).fetch = mockFetch;
});

const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe('loadEnginePolicy', () => {
  it('DB 에 있으면 엔진을 부르지 않는다', async () => {
    mockPrisma.company.findUnique.mockResolvedValue({
      policy: {
        workdayBands: { hardMin: 18 },
        __engineTuning: { values: { fairness_lambda: 7 }, holidays: ['2026-08-15'], special_reductions: [] },
      },
    });
    const p = await loadEnginePolicy(1);
    expect(p.values).toEqual({ fairness_lambda: 7 });
    expect(p.holidays).toEqual(['2026-08-15']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('DB 가 비면 엔진 파일 정책을 한 번 옮긴다', async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ policy: { workdayBands: { hardMin: 18 } } });
    mockFetch.mockResolvedValue(
      ok({ is_default: false, policy: { values: { rotation_step: -1 }, holidays: [], special_reductions: [] } }),
    );
    const p = await loadEnginePolicy(1);
    expect(p.values).toEqual({ rotation_step: -1 });
    // 운영 정책은 그대로 두고 엔진 튜닝만 얹혀야 한다
    const saved = mockPrisma.company.update.mock.calls[0][0].data.policy;
    expect(saved.workdayBands).toEqual({ hardMin: 18 });
    expect(saved.__engineTuning.values).toEqual({ rotation_step: -1 });
  });

  it('엔진도 기본값이면 빈 문서 — 카탈로그 기본값을 쓴다', async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ policy: null });
    mockFetch.mockResolvedValue(ok({ is_default: true, policy: { values: {} } }));
    const p = await loadEnginePolicy(1);
    expect(p.values).toEqual({});
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
  });

  it('엔진이 꺼져 있어도 빈 문서로 진행한다', async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ policy: null });
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(loadEnginePolicy(1)).resolves.toEqual({
      values: {}, holidays: [], special_reductions: [],
    });
  });
});

describe('saveEnginePolicy', () => {
  const catalog = ok({ settings: [{ key: 'fairness_lambda' }, { key: 'rotation_step' }] });

  it('카탈로그에 없는 키는 거부한다', async () => {
    mockFetch.mockResolvedValue(catalog);
    await expect(
      saveEnginePolicy(1, { values: { fairness_lambda: 3, oops_typo: 1 } }),
    ).rejects.toBeInstanceOf(EnginePolicyValidationError);
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
  });

  it('날짜 형식이 아닌 공휴일은 버린다', async () => {
    mockFetch.mockResolvedValue(catalog);
    mockPrisma.company.findUnique.mockResolvedValue({ policy: { restCycle: { workDays: 5 } } });
    const saved = await saveEnginePolicy(1, {
      values: { rotation_step: -1 },
      holidays: ['2026-08-15', '광복절', ''],
      special_reductions: [['2026-09-01', '2026-09-03', '아시아드'], ['bad', 'x', 'y']],
    });
    expect(saved.holidays).toEqual(['2026-08-15']);
    expect(saved.special_reductions).toEqual([['2026-09-01', '2026-09-03', '아시아드']]);
    // 운영 정책은 보존된다
    const written = mockPrisma.company.update.mock.calls[0][0].data.policy;
    expect(written.restCycle).toEqual({ workDays: 5 });
  });

  it('정책 형식이 아니면 400', async () => {
    await expect(saveEnginePolicy(1, null)).rejects.toBeInstanceOf(EnginePolicyValidationError);
  });
});
