/**
 * 감차(휴차) 표기 단위 테스트
 *
 * 저장소는 SchedulePattern.operating — 일일배차 엑셀·게시 양식이 이미 읽는
 * 값이라 화면/인쇄물/기사앱이 같은 사실을 보게 된다. 핵심 불변식:
 * "감차 = 그 차·그날 슬롯 0개" (배정이 남아 있으면 이름과 함께 거부).
 */

jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { parseScheduleMeta, setVehicleOff } from '../services/vehicleOffService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

describe('parseScheduleMeta', () => {
  it('JSON meta는 그대로 파싱한다', () => {
    const meta = parseScheduleMeta(JSON.stringify({ source: 'engine', unmatchedCells: { k: '홍길동' } }));
    expect(meta.source).toBe('engine');
  });

  it('빈 notes는 빈 meta', () => {
    expect(parseScheduleMeta(null)).toEqual({});
    expect(parseScheduleMeta('')).toEqual({});
  });

  it('JSON이 아닌 예전 텍스트는 legacyNotes로 보존한다', () => {
    expect(parseScheduleMeta('10월 정기 배차')).toEqual({ legacyNotes: '10월 정기 배차' });
  });

  it('JSON이지만 객체가 아니면 legacyNotes로 보존한다', () => {
    expect(parseScheduleMeta('[1,2]')).toEqual({ legacyNotes: '[1,2]' });
  });
});

describe('setVehicleOff — SchedulePattern.operating 토글', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 5, status: 'DRAFT' });
    mockPrisma.bus.findFirst.mockResolvedValue({ id: 100 });
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([]);
    mockPrisma.schedulePattern.upsert.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  });

  it('배정 없는 칸의 감차 → operating:false upsert (create 분기는 underlyingSlot 0)', async () => {
    const r = await setVehicleOff(1, 5, '2292', '2026-08-01', true);
    expect(r).toEqual({ off: true });
    const arg = mockPrisma.schedulePattern.upsert.mock.calls[0][0];
    expect(arg.where.scheduleId_date_busId).toEqual({
      scheduleId: 5, busId: 100, date: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(arg.update).toEqual({ operating: false });
    expect(arg.create).toMatchObject({ operating: false, underlyingSlot: 0, displaySlot: null });
  });

  it('감차 해제 → operating:true', async () => {
    await setVehicleOff(1, 5, '2292', '2026-08-01', false);
    expect(mockPrisma.schedulePattern.upsert.mock.calls[0][0].update).toEqual({ operating: true });
  });

  it('배정이 남아 있으면 기사 이름과 함께 거부하고 아무것도 쓰지 않는다', async () => {
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([
      { shift: 'MORNING', driver: { name: '김영수' } },
      { shift: 'AFTERNOON', driver: { name: '박철수' } },
    ]);
    await expect(setVehicleOff(1, 5, '2292', '2026-08-01', true)).rejects.toThrow(
      '김영수(오전), 박철수(오후)',
    );
    expect(mockPrisma.schedulePattern.upsert).not.toHaveBeenCalled();
  });

  it('감차 해제는 배정 검사를 하지 않는다', async () => {
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([
      { shift: 'MORNING', driver: { name: '김영수' } },
    ]);
    await expect(setVehicleOff(1, 5, '2292', '2026-08-01', false)).resolves.toEqual({ off: false });
  });

  it('기초 데이터에 없는 차량 → 쓰기 전에 실패', async () => {
    mockPrisma.bus.findFirst.mockResolvedValue(null);
    await expect(setVehicleOff(1, 5, '9999', '2026-08-01', true)).rejects.toThrow('기초 데이터에 없습니다');
    expect(mockPrisma.schedulePattern.upsert).not.toHaveBeenCalled();
  });

  it('발행된 배차표 → 거부', async () => {
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 5, status: 'PUBLISHED' });
    await expect(setVehicleOff(1, 5, '2292', '2026-08-01', true)).rejects.toThrow('초안');
  });

  it('없는 배차표/타사 배차표 → 거부', async () => {
    mockPrisma.schedule.findFirst.mockResolvedValue(null);
    await expect(setVehicleOff(1, 999, '2292', '2026-08-01', true)).rejects.toThrow('찾을 수 없습니다');
  });

  it('잘못된 입력 → 거부', async () => {
    await expect(setVehicleOff(1, 5, '2292', '08-01', true)).rejects.toThrow('YYYY-MM-DD');
    await expect(setVehicleOff(1, 5, '   ', '2026-08-01', true)).rejects.toThrow('차량번호');
  });
});
