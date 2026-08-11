/**
 * 미등록 기사 일괄 등록 — 멱등성·이중 배정 방지 단위 테스트
 *
 * ScheduleSlot 에는 유니크 제약이 없어 createMany({ skipDuplicates })가
 * 아무것도 걸러주지 못한다. 재실행·수기 수정·같은 날 이중 배정을
 * 응용 레벨에서 막는지 검증한다. (모의 prisma)
 */

jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { registerMissingDrivers } from '../services/registerMissingDriversService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

const DRAFT = (notes: Record<string, unknown>) => ({
  id: 7,
  notes: JSON.stringify(notes),
  status: 'DRAFT',
});

function arrange({
  unmatchedCells,
  existingUsers = [],
  existingSlots = [],
}: {
  unmatchedCells: Record<string, string>;
  existingUsers?: { id: number; name: string }[];
  existingSlots?: { date: Date; busId: number | null; shift: string; driverId: number }[];
}) {
  jest.clearAllMocks();
  mockPrisma.schedule.findFirst.mockResolvedValue(DRAFT({ unmatchedCells }));
  // user.findMany 는 세 번 불린다: ① 등록 전 이름 확인 ② AI사번 채번 ③ 등록 후 id 매핑
  mockPrisma.user.findMany.mockImplementation(async ({ where, select }: any) => {
    if (where?.employeeId) return []; // AI사번 채번 — 기존 AI### 없음
    if (select?.id) return existingUsers; // id 매핑 (create 반영 후)
    return existingUsers.map((u) => ({ name: u.name })); // 이름 중복 확인
  });
  mockPrisma.user.create.mockImplementation(async ({ data }: any) => {
    const u = { id: 900 + mockPrisma.user.create.mock.calls.length, name: data.name };
    existingUsers.push(u);
    return u;
  });
  mockPrisma.bus.findMany.mockResolvedValue([
    { id: 100, busNumber: '2292', routeId: 1 },
    { id: 101, busNumber: '2298', routeId: 1 },
  ]);
  mockPrisma.scheduleSlot.findMany.mockResolvedValue(existingSlots);
  mockPrisma.scheduleSlot.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.schedule.findUnique.mockResolvedValue({ notes: JSON.stringify({ unmatchedCells }) });
  mockPrisma.schedule.update.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
}

describe('registerMissingDrivers — 멱등성·이중 배정 방지', () => {
  it('빈 칸을 채우고 결과를 보고한다 (정상 경로)', async () => {
    arrange({
      unmatchedCells: {
        '2026-08-01|2292|MORNING': '홍길동',
        '2026-08-01|2298|AFTERNOON': '임꺽정',
      },
    });
    const r = await registerMissingDrivers(1, 7);
    expect(r.created.map((c) => c.name).sort()).toEqual(['임꺽정', '홍길동']);
    expect(r.filledCells).toBe(2);
    expect(r.skippedCells).toBe(0);
    const rows = mockPrisma.scheduleSlot.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
  });

  it('이미 배정이 있는 칸은 덮어쓰지 않는다 (수기 수정 보호)', async () => {
    arrange({
      unmatchedCells: { '2026-08-01|2292|MORNING': '홍길동' },
      existingSlots: [
        // 담당자가 이미 그 칸에 다른 기사를 넣어둠
        { date: new Date('2026-08-01T00:00:00.000Z'), busId: 100, shift: 'MORNING', driverId: 55 },
      ],
    });
    const r = await registerMissingDrivers(1, 7);
    expect(r.filledCells).toBe(0);
    expect(r.skippedCells).toBe(1);
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });

  it('같은 기사가 같은 날 두 칸이면 한 칸만 채운다 (이중 배정 방지)', async () => {
    arrange({
      unmatchedCells: {
        '2026-08-01|2292|MORNING': '홍길동',
        '2026-08-01|2298|AFTERNOON': '홍길동',
        '2026-08-02|2292|MORNING': '홍길동',
      },
    });
    const r = await registerMissingDrivers(1, 7);
    const rows = mockPrisma.scheduleSlot.createMany.mock.calls[0][0].data;
    // 8/1 은 한 칸만, 8/2 는 정상 배정 → 총 2칸
    expect(rows).toHaveLength(2);
    expect(r.filledCells).toBe(2);
    expect(r.skippedCells).toBe(1);
    const aug1 = rows.filter((row: any) => row.date.toISOString().startsWith('2026-08-01'));
    expect(aug1).toHaveLength(1);
  });

  it('그 기사가 이미 그날 근무 중이면 칸을 채우지 않는다', async () => {
    arrange({
      unmatchedCells: { '2026-08-01|2292|MORNING': '기존기사' },
      existingUsers: [{ id: 42, name: '기존기사' }],
      existingSlots: [
        { date: new Date('2026-08-01T00:00:00.000Z'), busId: 101, shift: 'AFTERNOON', driverId: 42 },
      ],
    });
    const r = await registerMissingDrivers(1, 7);
    expect(r.filledCells).toBe(0);
    expect(r.skippedCells).toBe(1);
  });

  it('재실행하면 아무것도 만들지 않는다 (멱등)', async () => {
    // 1차 실행이 unmatchedCells 를 비워 저장했다고 가정
    arrange({ unmatchedCells: {} });
    const r = await registerMissingDrivers(1, 7);
    expect(r).toEqual({ created: [], skipped: [], filledCells: 0, skippedCells: 0 });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });

  it('notes 는 트랜잭션 안에서 다시 읽는다 (동시 쓰기 유실 방지)', async () => {
    arrange({ unmatchedCells: { '2026-08-01|2292|MORNING': '홍길동' } });
    // 트랜잭션 시점의 notes 에 다른 세션이 쓴 키가 들어 있음
    mockPrisma.schedule.findUnique.mockResolvedValue({
      notes: JSON.stringify({ unmatchedCells: {}, otherMeta: 'keep-me' }),
    });
    await registerMissingDrivers(1, 7);
    const saved = JSON.parse(mockPrisma.schedule.update.mock.calls[0][0].data.notes);
    expect(saved.otherMeta).toBe('keep-me');
  });

  it('발행된 배차표는 거부한다', async () => {
    jest.clearAllMocks();
    mockPrisma.schedule.findFirst.mockResolvedValue({
      id: 7, notes: JSON.stringify({ unmatchedCells: { k: '홍길동' } }), status: 'PUBLISHED',
    });
    await expect(registerMissingDrivers(1, 7)).rejects.toThrow('발행된');
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });
});
