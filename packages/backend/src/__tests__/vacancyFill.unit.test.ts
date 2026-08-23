/**
 * 공석 채우기 — 운행 차량인데 기사가 없는 칸을 남은 인력으로 메운다.
 *
 * 핵심은 "억지로 채우지 않는다"는 것. 규칙을 어겨야만 채울 수 있는 칸은
 * 비워둔 채 보고해야 한다 — 채우는 게 목적이 되면 시스템이 과로 배차를
 * 스스로 만들어내게 된다.
 */

jest.mock('../utils/prisma');
jest.mock('../services/operatingPlanService', () => ({
  operatingCells: jest.fn(),
}));

import { prisma } from '../utils/prisma';
import { operatingCells } from '../services/operatingPlanService';
import { fillVacancies } from '../services/vacancyFillService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;
const mockCells = operatingCells as jest.Mock;

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function arrange(opts: {
  cells: { date: string; busId: number; busNumber: string }[];
  slots?: { driverId: number; date: string; shift: string; busId: number }[];
  drivers?: { id: number; name: string }[];
  status?: string;
}) {
  mockPrisma.schedule.findFirst.mockResolvedValue({ id: 9, status: opts.status ?? 'DRAFT' });
  mockCells.mockResolvedValue(opts.cells.map((c) => ({ ...c, date: D(c.date) })));
  mockPrisma.scheduleSlot.findMany.mockResolvedValue(
    (opts.slots ?? []).map((s) => ({ ...s, date: D(s.date) })),
  );
  mockPrisma.user.findMany.mockResolvedValue(
    opts.drivers ?? [{ id: 1, name: '김영수' }, { id: 2, name: '박철수' }],
  );
  mockPrisma.bus.findMany.mockResolvedValue([
    { id: 100, busNumber: '2292', routeId: 7 },
    { id: 101, busNumber: '2298', routeId: 7 },
  ]);
  mockPrisma.scheduleSlot.createMany.mockResolvedValue({ count: 0 });
}

const created = () =>
  (mockPrisma.scheduleSlot.createMany.mock.calls[0]?.[0].data ?? []) as any[];

describe('fillVacancies', () => {
  beforeEach(() => jest.clearAllMocks());

  it('빈 칸을 채우고 차량의 노선을 그대로 쓴다', async () => {
    arrange({ cells: [{ date: '2026-07-26', busId: 100, busNumber: '2292' }] });
    const r = await fillVacancies(1, 9);
    expect(r.filled).toBe(2); // 오전 + 오후
    expect(created()[0]).toMatchObject({ busId: 100, routeId: 7, shift: 'MORNING' });
    expect(created()[1]).toMatchObject({ shift: 'AFTERNOON' });
    // 같은 사람을 오전·오후에 겹쳐 넣지 않는다
    expect(created()[0].driverId).not.toBe(created()[1].driverId);
  });

  it('이미 채워진 칸은 건드리지 않는다', async () => {
    arrange({
      cells: [{ date: '2026-07-26', busId: 100, busNumber: '2292' }],
      slots: [{ driverId: 1, date: '2026-07-26', shift: 'MORNING', busId: 100 }],
    });
    const r = await fillVacancies(1, 9);
    expect(r.filled).toBe(1); // 오후만
    expect(created()[0].shift).toBe('AFTERNOON');
  });

  it('같은 날 이미 근무 중인 기사는 후보에서 뺀다', async () => {
    arrange({
      cells: [{ date: '2026-07-26', busId: 100, busNumber: '2292' }],
      slots: [{ driverId: 1, date: '2026-07-26', shift: 'MORNING', busId: 101 }],
      drivers: [{ id: 1, name: '김영수' }],
    });
    const r = await fillVacancies(1, 9);
    // 김영수는 그날 이미 근무 → 채울 사람이 없다
    expect(r.filled).toBe(0);
    expect(r.stillVacant).toHaveLength(2);
  });

  it('연속근무 6일을 넘기게 되는 기사는 쓰지 않는다', async () => {
    const days = ['20', '21', '22', '23', '24', '25'].map((d) => ({
      driverId: 1, date: `2026-07-${d}`, shift: 'MORNING', busId: 101,
    }));
    arrange({
      cells: [{ date: '2026-07-26', busId: 100, busNumber: '2292' }],
      slots: days,
      drivers: [{ id: 1, name: '김영수' }],
    });
    const r = await fillVacancies(1, 9);
    expect(r.filled).toBe(0);
    expect(r.stillVacant).toHaveLength(2);
  });

  it('전날 오후 근무자는 다음날 오전에 넣지 않는다 (법 제44조의6)', async () => {
    arrange({
      cells: [{ date: '2026-07-26', busId: 100, busNumber: '2292' }],
      slots: [{ driverId: 1, date: '2026-07-25', shift: 'AFTERNOON', busId: 101 }],
      drivers: [{ id: 1, name: '김영수' }, { id: 2, name: '박철수' }],
    });
    await fillVacancies(1, 9);
    const morning = created().find((c) => c.shift === 'MORNING');
    expect(morning.driverId).toBe(2); // 김영수는 오전 불가
  });

  it('근무일수가 적은 기사를 먼저 쓴다 (쏠림 방지)', async () => {
    arrange({
      cells: [{ date: '2026-07-26', busId: 100, busNumber: '2292' }],
      slots: [
        { driverId: 1, date: '2026-07-01', shift: 'MORNING', busId: 101 },
        { driverId: 1, date: '2026-07-03', shift: 'MORNING', busId: 101 },
      ],
      drivers: [{ id: 1, name: '많이일한사람' }, { id: 2, name: '적게일한사람' }],
    });
    await fillVacancies(1, 9);
    expect(created()[0].driverId).toBe(2);
  });

  it('발행된 배차표는 거부한다', async () => {
    arrange({ cells: [], status: 'PUBLISHED' });
    await expect(fillVacancies(1, 9)).rejects.toThrow('초안');
  });

  it('채울 게 없으면 쓰지 않는다', async () => {
    arrange({
      cells: [{ date: '2026-07-26', busId: 100, busNumber: '2292' }],
      slots: [
        { driverId: 1, date: '2026-07-26', shift: 'MORNING', busId: 100 },
        { driverId: 2, date: '2026-07-26', shift: 'AFTERNOON', busId: 100 },
      ],
    });
    const r = await fillVacancies(1, 9);
    expect(r.filled).toBe(0);
    expect(mockPrisma.scheduleSlot.createMany).not.toHaveBeenCalled();
  });
});
