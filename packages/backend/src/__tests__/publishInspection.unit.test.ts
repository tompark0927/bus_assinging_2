/**
 * 발행 전 법규 검산 (E3 연속근무 · W1 짧은 휴식) 단위 테스트
 *
 * 핵심은 "연속"의 정확성이다 — 기존 validateRestTime 은 ±3일 창에서
 * 비연속 슬롯을 세어 가짜 연속일수를 만들었다. 여기서는 달력상 실제로
 * 이어진 날만 연속으로 센다 (엔진 inspector.py E3 와 동일 시맨틱).
 */

jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { inspectScheduleForPublish } from '../services/publishInspectionService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

function slot(driverId: number, name: string, date: string, shift = 'FULL_DAY') {
  return {
    driverId,
    date: new Date(`${date}T00:00:00.000Z`),
    shift,
    driver: { name },
  };
}

/** day 일자부터 n일 연속 종일 근무 */
function run(driverId: number, name: string, startDay: number, n: number) {
  return Array.from({ length: n }, (_, i) =>
    slot(driverId, name, `2026-09-${String(startDay + i).padStart(2, '0')}`),
  );
}

describe('inspectScheduleForPublish', () => {
  beforeEach(() => jest.clearAllMocks());

  const arrange = (slots: unknown[]) =>
    mockPrisma.scheduleSlot.findMany.mockResolvedValue(slots);

  it('7일 연속 근무 → E3 오류 1건 (시작일 기준)', async () => {
    arrange(run(1, '김영수', 1, 7));
    const r = await inspectScheduleForPublish(5);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ rule: 'E3', driverName: '김영수', date: '2026-09-01' });
  });

  it('6일 근무 후 하루 쉬고 다시 6일 → 위반 없음', async () => {
    arrange([...run(1, '김영수', 1, 6), ...run(1, '김영수', 8, 6)]);
    const r = await inspectScheduleForPublish(5);
    expect(r.errors).toHaveLength(0);
  });

  it('비연속 근무(1·4·7일)는 연속으로 세지 않는다 — validateRestTime 의 오답 케이스', async () => {
    arrange([
      slot(1, '김영수', '2026-09-01'),
      slot(1, '김영수', '2026-09-04'),
      slot(1, '김영수', '2026-09-07'),
    ]);
    const r = await inspectScheduleForPublish(5);
    expect(r.errors).toHaveLength(0);
  });

  it('8일 연속이어도 보고는 1건 (7일째 도달 시점)', async () => {
    arrange(run(1, '김영수', 1, 8));
    const r = await inspectScheduleForPublish(5);
    expect(r.errors).toHaveLength(1);
  });

  it('오후 근무 다음날 오전 근무 → W1 경고', async () => {
    arrange([
      slot(1, '박철수', '2026-09-10', 'AFTERNOON'),
      slot(1, '박철수', '2026-09-11', 'MORNING'),
    ]);
    const r = await inspectScheduleForPublish(5);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ rule: 'W1', driverName: '박철수', date: '2026-09-10' });
    expect(r.errors).toHaveLength(0);
  });

  it('오전→오전, 오후→오후는 경고 없음', async () => {
    arrange([
      slot(1, '박철수', '2026-09-10', 'MORNING'),
      slot(1, '박철수', '2026-09-11', 'MORNING'),
      slot(2, '이민호', '2026-09-10', 'AFTERNOON'),
      slot(2, '이민호', '2026-09-12', 'MORNING'), // 하루 건너뜀
    ]);
    const r = await inspectScheduleForPublish(5);
    expect(r.warnings).toHaveLength(0);
  });

  it('종일(FULL_DAY)은 오전+오후로 취급한다 — 종일 뒤 다음날 오전도 W1', async () => {
    arrange([
      slot(1, '박철수', '2026-09-10', 'FULL_DAY'),
      slot(1, '박철수', '2026-09-11', 'MORNING'),
    ]);
    const r = await inspectScheduleForPublish(5);
    expect(r.warnings).toHaveLength(1);
  });

  it('휴무·드랍·결근은 검사 대상에서 빠진다 (조회 술어)', async () => {
    arrange([]);
    await inspectScheduleForPublish(5);
    expect(mockPrisma.scheduleSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isRestDay: false,
          status: { notIn: ['DROPPED', 'ABSENT'] },
        }),
      }),
    );
  });

  it('기사 여러 명이 섞여도 각자 따로 계산한다', async () => {
    arrange([
      ...run(1, '김영수', 1, 4),
      ...run(2, '박철수', 3, 7), // 박철수만 위반
    ]);
    const r = await inspectScheduleForPublish(5);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].driverName).toBe('박철수');
  });
});
