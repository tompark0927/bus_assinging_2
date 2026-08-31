/**
 * 기본 틀 자동 갱신이 담당자 작업을 덮어쓰지 않는가.
 *
 * 하루 1회 도는 틱이 '기본 틀' 초안을 다시 만든다. 그 자체는 의도된 동작이다
 * (근무 주기를 바꾸면 반영돼야 하니까). 문제는 **덮어쓰면 안 되는 경우**다.
 *
 * 특히 스페어: [스페어 자동 배치]는 isManualOverride 를 세우지 않으므로
 * 그 플래그만 보면 "기계가 만든 틀"로 오인해 하루 만에 지워 버린다.
 */
jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { ensureBaseFrameSchedule } from '../services/baseFrameService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

function setup(opts: {
  published?: boolean;
  draft?: boolean;
  overrides?: number;
  spares?: number;
}) {
  mockPrisma.schedule = {
    findFirst: jest.fn(async ({ where }: any) =>
      where.status === 'PUBLISHED'
        ? (opts.published ? { id: 1 } : null)
        : (opts.draft ? { id: 2 } : null),
    ),
  };
  mockPrisma.scheduleSlot = {
    count: jest.fn(async ({ where }: any) =>
      where.isManualOverride ? (opts.overrides ?? 0) : (opts.spares ?? 0),
    ),
    // 건너뛰기를 통과하면 지난달 배차표를 읽으러 간다 — 비워 둔다
    findMany: jest.fn(async () => []),
  };
  mockPrisma.schedulePattern = { findMany: jest.fn(async () => []) };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENGINE_URL = 'http://engine:8100';
});

const run = () => ensureBaseFrameSchedule(5, 1, 2026, 9, null);

describe('기본 틀 자동 갱신 — 건너뛰는 조건', () => {
  it('발행된 달은 건드리지 않는다', async () => {
    setup({ published: true });
    const r = await run();
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('발행');
  });

  it('담당자가 손으로 고친 달은 건드리지 않는다', async () => {
    setup({ draft: true, overrides: 3 });
    const r = await run();
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('직접 고쳐');
  });

  it('스페어가 채워진 달은 건드리지 않는다 (자동 배치는 override 플래그를 안 세운다)', async () => {
    setup({ draft: true, overrides: 0, spares: 259 });
    const r = await run();
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('스페어');
  });

  it('메인만 깔린 틀은 다시 만든다 — 근무 주기를 바꾸면 반영돼야 한다', async () => {
    setup({ draft: true, overrides: 0, spares: 0 });
    const r = await run();
    // 건너뛰지 않고 생성 경로로 넘어간다 (지난달 자료가 없어 여기선 failed)
    expect(r.status).not.toBe('skipped');
    expect(r.reason).toContain('이어받을 수 없음');
  });
});
