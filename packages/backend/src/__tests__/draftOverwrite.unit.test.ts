/**
 * 엔진 초안 덮어쓰기 확인 게이트
 *
 * saveEngineDraft 는 같은 (회사, 연, 월, 이름) 초안을 통째로 삭제하고
 * 새로 만든다. 이름이 기본값('AI 엔진 초안')이라 충돌이 일반적인 경우인데,
 * 확인 없이 진행하면 감차 표기·수동 수정이 클릭 한 번에 사라진다.
 * confirmOverwrite 없이는 삭제될 내용을 담아 거부하는지 검증한다.
 */

jest.mock('../utils/prisma');
jest.mock('../services/registerMissingDriversService', () => ({
  registerMissingDrivers: jest.fn().mockResolvedValue({
    created: [], skipped: [], filledCells: 0, skippedCells: 0,
  }),
}));

import { prisma } from '../utils/prisma';
import { saveEngineDraft, DraftOverwriteConflict } from '../services/engineScheduleService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

const PAYLOAD = {
  year: 2026, month: 9,
  cells: {
    '2026-09-01': {
      '2292': {
        slot: '1', display_slot: 1, am: '홍길동', pm: '임꺽정',
        underlying: 1, operating: true, group: '가좌출발',
      },
    },
  },
};

describe('saveEngineDraft — 덮어쓰기 확인 게이트', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('같은 이름 초안이 있고 confirmOverwrite 가 없으면 삭제될 내용과 함께 거부한다', async () => {
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 33 });
    mockPrisma.scheduleSlot.count
      .mockResolvedValueOnce(410)  // 전체 배정
      .mockResolvedValueOnce(12);  // 수동 수정
    mockPrisma.schedulePattern.count.mockResolvedValue(3); // 감차

    await expect(saveEngineDraft(1, 1, PAYLOAD)).rejects.toMatchObject({
      name: 'DraftOverwriteConflict',
      details: {
        existingDraftId: 33,
        slotCount: 410,
        manualOverrideCount: 12,
        vehicleOffCount: 3,
      },
    });
    // 게이트에서 멈췄으므로 아무것도 쓰지 않는다
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
  });

  it('감차 개수는 operating=false 행만 센다', async () => {
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 33 });
    mockPrisma.scheduleSlot.count.mockResolvedValue(0);
    mockPrisma.schedulePattern.count.mockResolvedValue(0);

    await expect(saveEngineDraft(1, 1, PAYLOAD)).rejects.toBeInstanceOf(DraftOverwriteConflict);
    expect(mockPrisma.schedulePattern.count).toHaveBeenCalledWith({
      where: { scheduleId: 33, operating: false },
    });
  });

  it('같은 이름 초안이 없으면 게이트를 통과한다', async () => {
    // 게이트 조회 → 없음. 이후 매칭 단계로 진행하다 차량 미매칭으로 중단되는
    // 기존 에러 경로를 그대로 탄다 (게이트가 정상 진행을 막지 않는다는 증명).
    mockPrisma.schedule.findFirst.mockResolvedValue(null);
    mockPrisma.bus.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await expect(saveEngineDraft(1, 1, PAYLOAD)).rejects.toThrow('차량번호가 하나도 일치하지');
    expect(mockPrisma.scheduleSlot.count).not.toHaveBeenCalled();
  });

  it('confirmOverwrite=true 면 게이트 조회 없이 진행한다', async () => {
    mockPrisma.bus.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await expect(
      saveEngineDraft(1, 1, { ...PAYLOAD, confirmOverwrite: true }),
    ).rejects.toThrow('차량번호가 하나도 일치하지');
    // 게이트의 동명 초안 조회가 실행되지 않았다
    expect(mockPrisma.schedule.findFirst).not.toHaveBeenCalled();
  });
});
