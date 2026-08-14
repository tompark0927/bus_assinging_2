/**
 * 기초 데이터와 다시 맞추기 — 지금 등록된 기사의 칸만 채운다.
 *
 * 이 서비스의 가장 중요한 성질은 "기사 계정을 절대 만들지 않는다"이다.
 * 엑셀에 적힌 이름으로 사람을 만들어내면 회사가 등록한 적 없는 기사가
 * 배차표에 들어가고, 오타 하나가 새 직원이 된다.
 */

jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { rematchUnmatchedCells } from '../services/rematchDriversService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

interface Arrange {
  unmatchedCells: Record<string, string>;
  /** 기초 데이터에 등록된 기사 (이름만) */
  existingUsers?: { id: number; name: string }[];
  existingSlots?: { date: Date; busId: number; shift: string; driverId: number }[];
  status?: string;
}

function arrange(a: Arrange) {
  mockPrisma.schedule.findFirst.mockResolvedValue({
    id: 7,
    status: a.status ?? 'DRAFT',
    notes: JSON.stringify({ unmatchedCells: a.unmatchedCells }),
  });
  const users = a.existingUsers ?? [];
  mockPrisma.user.findMany.mockResolvedValue(users);
  mockPrisma.bus.findMany.mockResolvedValue([
    { id: 100, busNumber: '2292', routeId: 1 },
    { id: 101, busNumber: '2298', routeId: 1 },
  ]);
  mockPrisma.scheduleSlot.findMany.mockResolvedValue(a.existingSlots ?? []);
  mockPrisma.scheduleSlot.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.schedule.update.mockResolvedValue({});
  mockPrisma.schedule.findUnique.mockResolvedValue({ notes: '{}' });
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
}

describe('rematchUnmatchedCells', () => {
  beforeEach(() => jest.clearAllMocks());

  it('기사 계정을 절대 만들지 않는다 — 미등록 이름은 그대로 남는다', async () => {
    arrange({
      unmatchedCells: { '2026-08-01|2292|MORNING': '임도형' },
      existingUsers: [], // 기초 데이터에 없음
    });
    const r = await rematchUnmatchedCells(1, 7);

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(r.filledCells).toBe(0);
    expect(r.unmatchedNames).toEqual(['임도형']);
    // 칸은 미등록으로 남아 화면에 주황으로 계속 보인다
    const saved = JSON.parse(mockPrisma.schedule.update.mock.calls[0][0].data.notes);
    expect(saved.unmatchedCells).toEqual({ '2026-08-01|2292|MORNING': '임도형' });
  });

  it('기초 데이터에 등록된 뒤 호출하면 그 칸이 채워진다', async () => {
    arrange({
      unmatchedCells: {
        '2026-08-01|2292|MORNING': '임도형',
        '2026-08-01|2298|AFTERNOON': '최미향',
      },
      existingUsers: [{ id: 41, name: '임도형' }], // 담당자가 임도형만 등록함
    });
    const r = await rematchUnmatchedCells(1, 7);

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(r.filledCells).toBe(1);
    expect(r.matched).toEqual(['임도형']);
    expect(r.unmatchedNames).toEqual(['최미향']);
    const rows = mockPrisma.scheduleSlot.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driverId: 41, busId: 100, shift: 'MORNING' });
  });

  it('동명이인은 추측하지 않고 미등록으로 남긴다', async () => {
    arrange({
      unmatchedCells: { '2026-08-01|2292|MORNING': '김영수' },
      existingUsers: [
        { id: 41, name: '김영수' },
        { id: 42, name: '김영수' },
      ],
    });
    const r = await rematchUnmatchedCells(1, 7);
    expect(r.filledCells).toBe(0);
    expect(r.unmatchedNames).toEqual(['김영수']);
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });

  it('두 번 실행해도 같은 칸을 다시 만들지 않는다 (멱등)', async () => {
    arrange({
      unmatchedCells: { '2026-08-01|2292|MORNING': '임도형' },
      existingUsers: [{ id: 41, name: '임도형' }],
      // 이미 채워진 상태 — 첫 실행 결과
      existingSlots: [
        { date: new Date('2026-08-01T00:00:00.000Z'), busId: 100, shift: 'MORNING', driverId: 41 },
      ],
    });
    const r = await rematchUnmatchedCells(1, 7);
    expect(r.filledCells).toBe(0);
    expect(r.skippedCells).toBe(1);
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });

  it('한 기사가 같은 날 두 칸이면 하나만 채운다 (이중 배정 방지)', async () => {
    arrange({
      unmatchedCells: {
        '2026-08-01|2292|MORNING': '임도형',
        '2026-08-01|2298|AFTERNOON': '임도형',
      },
      existingUsers: [{ id: 41, name: '임도형' }],
    });
    const r = await rematchUnmatchedCells(1, 7);
    expect(r.filledCells).toBe(1);
    expect(r.skippedCells).toBe(1);
  });

  it('발행된 배차표는 거부한다', async () => {
    arrange({ unmatchedCells: { '2026-08-01|2292|MORNING': '임도형' }, status: 'PUBLISHED' });
    await expect(rematchUnmatchedCells(1, 7)).rejects.toThrow('발행된 배차표');
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });

  it('활성 기사(DRIVER)만 조회한다 — 퇴사자에게 배차되지 않게', async () => {
    arrange({ unmatchedCells: { '2026-08-01|2292|MORNING': '임도형' } });
    await rematchUnmatchedCells(1, 7);
    for (const call of mockPrisma.user.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ role: 'DRIVER', isActive: true });
    }
  });

  it('미등록 칸이 없으면 아무것도 하지 않는다', async () => {
    arrange({ unmatchedCells: {} });
    const r = await rematchUnmatchedCells(1, 7);
    expect(r).toEqual({ matched: [], unmatchedNames: [], filledCells: 0, skippedCells: 0 });
  });
});
