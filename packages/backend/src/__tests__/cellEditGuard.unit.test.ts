/**
 * 셀 편집 발행본 가드 — PUT /schedules/by-id/:id/cell 이 유일하게
 * PUBLISHED 검사를 빠뜨렸던 경로였다. 발행본을 여기서 고치면 기사가
 * 이미 본 배차가 알림 없이 바뀐다.
 */

jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { setCellDriver } from '../services/cellEditService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

describe('setCellDriver — 발행본 가드', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.bus.findFirst.mockResolvedValue({ id: 100, routeId: 1 });
  });

  it('발행된 배차표는 거부하고 아무것도 쓰지 않는다', async () => {
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 5, status: 'PUBLISHED' });
    await expect(
      setCellDriver(1, 5, {
        date: '2026-08-01', vehicle: '2292', shift: 'MORNING',
        driverId: 42, actorId: 1,
      }),
    ).rejects.toThrow('발행된 배차표');
    expect(mockPrisma.scheduleSlot.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleSlot.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleSlot.create).not.toHaveBeenCalled();
  });

  it('보관(ARCHIVED) 배차표도 거부한다', async () => {
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 5, status: 'ARCHIVED' });
    await expect(
      setCellDriver(1, 5, {
        date: '2026-08-01', vehicle: '2292', shift: 'MORNING',
        driverId: 42, actorId: 1,
      }),
    ).rejects.toThrow('발행된 배차표');
  });
});
