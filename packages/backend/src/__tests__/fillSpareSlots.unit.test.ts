/**
 * [스페어 자동 채우기]가 **빈 칸에만** 넣는가.
 *
 * 예전에는 이 버튼이 초안을 통째로 지우고 다시 만들었다. 메인 배차는 결정론
 * 이라 같은 모양으로 재생산되지만, 담당자가 직접 고친 칸과 수동 감차 표기는
 * 그때 사라졌다 — "관리자가 연차 같은 건 직접 하나하나 추가할 수 있어야
 * 한다"(사장님 2026-09-01)는 규칙과 정면으로 부딪힌다.
 *
 * 여기서 지키는 것은 넷이다.
 *   1) 아무것도 지우지 않는다
 *   2) 이미 사람이 있는 칸은 그대로 둔다
 *   3) 담당자가 세워 둔 차(감차)에는 넣지 않는다
 *   4) 그날 이미 다른 자리에 있는 기사는 이중으로 넣지 않는다 (연차 포함)
 */
jest.mock('../utils/prisma');
jest.mock('../services/baseFrameService', () => ({
  requestEngineCells: jest.fn(),
}));

import { prisma } from '../utils/prisma';
import { requestEngineCells } from '../services/baseFrameService';
import { fillSpareSlots } from '../services/fillSpareSlotsService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;
const mockEngine = requestEngineCells as jest.Mock;

const D = '2026-09-01';
const DATE = new Date(`${D}T00:00:00.000Z`);

/** 엔진 답안지 한 칸 — 6159호에 오전 김철수 / 오후 박영수 */
function engineCells(am: string, pm: string) {
  return {
    [D]: {
      '6159': {
        slot: '1', display_slot: 1, am, pm,
        underlying: 1, operating: true, group: null,
      },
    },
  };
}

function setup(opts: {
  slots?: any[];
  patterns?: any[];
  drivers?: { id: number; name: string; serviceType?: string | null }[];
}) {
  mockPrisma.schedule = {
    findFirst: jest.fn(async () => ({
      id: 7, year: 2026, month: 9, serviceType: null, status: 'DRAFT',
    })),
  };
  mockPrisma.scheduleSlot = {
    findMany: jest.fn(async () => opts.slots ?? []),
    createMany: jest.fn(async () => ({ count: 0 })),
  };
  mockPrisma.schedulePattern = {
    findMany: jest.fn(async () =>
      opts.patterns ?? [{ date: DATE, busId: 11, operating: true }],
    ),
  };
  mockPrisma.bus = {
    findMany: jest.fn(async () => [{ id: 11, busNumber: '6159', routeId: 3 }]),
  };
  mockPrisma.user = {
    findMany: jest.fn(async () =>
      opts.drivers ?? [
        { id: 101, name: '김철수', serviceType: null },
        { id: 102, name: '박영수', serviceType: null },
      ],
    ),
  };
  mockPrisma.route = { findFirst: jest.fn(async () => ({ id: 3 })) };
}

/** createMany 로 실제 들어간 행 */
function inserted() {
  const call = mockPrisma.scheduleSlot.createMany.mock.calls[0];
  return call ? call[0].data : [];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine.mockResolvedValue({ cells: engineCells('김철수', '박영수') });
});

describe('스페어 자동 채우기 — 빈 칸에만 넣는다', () => {
  it('빈 칸은 채운다', async () => {
    setup({ slots: [] });
    const r = await fillSpareSlots(1, 7);

    expect(r.filled).toBe(2);
    expect(inserted()).toEqual([
      expect.objectContaining({ driverId: 101, busId: 11, shift: 'MORNING' }),
      expect.objectContaining({ driverId: 102, busId: 11, shift: 'AFTERNOON' }),
    ]);
    expect(r.remainingEmpty).toBe(0);
  });

  it('아무것도 지우지 않는다', async () => {
    setup({ slots: [] });
    await fillSpareSlots(1, 7);

    expect(mockPrisma.scheduleSlot.deleteMany).toBeUndefined();
    expect(mockPrisma.schedule.delete).toBeUndefined();
  });

  it('이미 사람이 있는 칸은 그대로 둔다', async () => {
    // 담당자가 오전 칸에 다른 사람을 직접 넣어 뒀다
    setup({
      slots: [{
        date: DATE, shift: 'MORNING', busId: 11, driverId: 999, isRestDay: false,
      }],
    });
    const r = await fillSpareSlots(1, 7);

    expect(r.keptOccupied).toBe(1);
    expect(r.filled).toBe(1);                       // 오후 칸만 새로 채운다
    expect(inserted()).toHaveLength(1);
    expect(inserted()[0]).toMatchObject({ shift: 'AFTERNOON', driverId: 102 });
  });

  it('담당자가 세워 둔 차(감차)에는 넣지 않는다', async () => {
    setup({ slots: [], patterns: [{ date: DATE, busId: 11, operating: false }] });
    const r = await fillSpareSlots(1, 7);

    expect(r.skippedVehicleOff).toBe(2);
    expect(r.filled).toBe(0);
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });

  it('그날 연차로 쉬는 기사는 이중으로 넣지 않는다', async () => {
    // 담당자가 김철수의 그날을 휴무로 넣어 뒀는데 엔진 답안지는 근무로 본다
    setup({
      slots: [{
        date: DATE, shift: 'MORNING', busId: null, driverId: 101, isRestDay: true,
      }],
    });
    const r = await fillSpareSlots(1, 7);

    expect(r.skippedDoubleBooked).toBe(1);
    expect(inserted().every((row: any) => row.driverId !== 101)).toBe(true);
  });

  it('기초 데이터에 없는 이름은 넣지 않고 돌려준다', async () => {
    setup({ slots: [], drivers: [{ id: 101, name: '김철수', serviceType: null }] });
    const r = await fillSpareSlots(1, 7);

    expect(r.unregisteredNames).toEqual(['박영수']);
    expect(r.filled).toBe(1);
  });

  it('동명이인은 추측해서 넣지 않는다', async () => {
    setup({
      slots: [],
      drivers: [
        { id: 101, name: '김철수', serviceType: null },
        { id: 103, name: '박영수', serviceType: null },
        { id: 104, name: '박영수', serviceType: null },
      ],
    });
    const r = await fillSpareSlots(1, 7);

    expect(r.unregisteredNames).toEqual(['박영수']);
    expect(inserted()).toHaveLength(1);
  });

  it('발행본은 건드리지 않는다', async () => {
    setup({ slots: [] });
    mockPrisma.schedule.findFirst = jest.fn(async () => ({
      id: 7, year: 2026, month: 9, serviceType: null, status: 'PUBLISHED',
    }));

    await expect(fillSpareSlots(1, 7)).rejects.toThrow('초안에서만');
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });
});
