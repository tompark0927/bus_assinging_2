/**
 * GET /companies/policy — 운영 정책 조회.
 *
 * 회귀 방지: 엔진 튜닝만 저장돼 있고 운영 정책은 한 번도 저장하지 않은 회사가
 * 있다. 그때 응답에서 `__engineTuning` 을 빼면 빈 객체 `{}` 만 남는데, 이걸
 * 그대로 내려보내면 배차 설정 화면이 `policy.shiftSystem.kind` 를 읽다가
 * 통째로 흰 화면이 된다 ("Cannot read properties of undefined (reading 'kind')").
 * 데모 회사에서 실제로 재현됐다.
 */
jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { getCompanyPolicy } from '../controllers/companiesController';
import { DEFAULT_POLICY, POLICY_PRESETS } from '../agents/_solvers/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

function ctx(policy: unknown, code = 'DEMO') {
  mockPrisma.company = {
    findUnique: jest.fn().mockResolvedValue({ code, policy }),
  };
  const req: any = { user: { companyId: 1 } };
  const json = jest.fn();
  const res: any = { json, status: jest.fn().mockReturnValue({ json }) };
  return { req, res, json };
}

beforeEach(() => jest.clearAllMocks());

describe('getCompanyPolicy', () => {
  it('엔진 튜닝만 있는 회사는 기본 프리셋을 받는다 (빈 객체를 주면 화면이 죽는다)', async () => {
    const { req, res, json } = ctx({ __engineTuning: { values: { fairness_lambda: 7 } } });
    await getCompanyPolicy(req, res);

    const { policy, isDefault } = json.mock.calls[0][0].data;
    expect(isDefault).toBe(true);
    expect(policy).toEqual(DEFAULT_POLICY);
    // 화면이 읽는 필드가 실제로 있어야 한다
    expect(policy.shiftSystem?.kind).toBeDefined();
    expect(policy.crewModel?.kind).toBeDefined();
  });

  it('정책을 저장한 적 없으면(policy=null) 기본 프리셋', async () => {
    const { req, res, json } = ctx(null);
    await getCompanyPolicy(req, res);

    const { policy, isDefault } = json.mock.calls[0][0].data;
    expect(isDefault).toBe(true);
    expect(policy.shiftSystem?.kind).toBeDefined();
  });

  it('마을버스 회사 코드는 1교대 프리셋', async () => {
    const { req, res, json } = ctx(null, 'VILLAGE1');
    await getCompanyPolicy(req, res);

    expect(json.mock.calls[0][0].data.policy).toEqual(POLICY_PRESETS.VILLAGE_1SHIFT);
  });

  it('저장된 운영 정책이 있으면 그대로, 엔진 튜닝만 걷어낸다', async () => {
    const saved = {
      ...DEFAULT_POLICY,
      __engineTuning: { values: { fairness_lambda: 7 } },
    };
    const { req, res, json } = ctx(saved);
    await getCompanyPolicy(req, res);

    const { policy, isDefault } = json.mock.calls[0][0].data;
    expect(isDefault).toBe(false);
    expect(policy).not.toHaveProperty('__engineTuning');
    expect(policy.shiftSystem?.kind).toBe(DEFAULT_POLICY.shiftSystem.kind);
  });
});
