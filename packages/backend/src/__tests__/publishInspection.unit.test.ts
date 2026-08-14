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
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본: 패턴(운행 계획) 없음 → E2 검사 대상 아님
    mockPrisma.schedulePattern.findMany.mockResolvedValue([]);
    mockPrisma.schedule.findUnique.mockResolvedValue({ notes: null });
  });

  const arrange = (slots: unknown[]) =>
    mockPrisma.scheduleSlot.findMany.mockResolvedValue(slots);

  /** 운행 차량 패턴 */
  const pattern = (date: string, busId: number, busNumber: string) => ({
    date: new Date(`${date}T00:00:00.000Z`),
    busId,
    bus: { busNumber },
  });

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

  // ── E2 빈 자리 (공석) — 버스가 나갈 수 없는 칸 ──

  it('운행 차량인데 오전·오후가 비면 공석 2칸으로 잡는다', async () => {
    arrange([]);
    mockPrisma.schedulePattern.findMany.mockResolvedValue([pattern('2026-09-01', 10, '2292')]);
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.vacant).toBe(2);
    expect(r.counts.unregistered).toBe(0);
    expect(r.errors.filter((e) => e.rule === 'E2')).toHaveLength(2);
    expect(r.errors[0]).toMatchObject({ rule: 'E2', kind: 'VACANT', vehicle: '2292' });
  });

  it('오전만 배정되면 오후 1칸만 공석', async () => {
    arrange([slot(1, '김영수', '2026-09-01', 'MORNING')].map((s) => ({ ...s, busId: 10 })));
    mockPrisma.schedulePattern.findMany.mockResolvedValue([pattern('2026-09-01', 10, '2292')]);
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.vacant).toBe(1);
    expect(r.errors[0].shift).toBe('AFTERNOON');
  });

  it('종일 근무는 오전·오후를 모두 채운 것으로 본다', async () => {
    arrange([{ ...slot(1, '김영수', '2026-09-01', 'FULL_DAY'), busId: 10 }]);
    mockPrisma.schedulePattern.findMany.mockResolvedValue([pattern('2026-09-01', 10, '2292')]);
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.vacant).toBe(0);
  });

  it('감차(operating=false) 차량은 빈 칸이어도 공석이 아니다 — 조회에서 제외', async () => {
    arrange([]);
    await inspectScheduleForPublish(5);
    expect(mockPrisma.schedulePattern.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scheduleId: 5, operating: true } }),
    );
  });

  it('엑셀엔 이름이 있는데 미등록이라 저장 못 한 칸은 UNREGISTERED 로 구분한다', async () => {
    arrange([]);
    mockPrisma.schedulePattern.findMany.mockResolvedValue([pattern('2026-09-01', 10, '2292')]);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      notes: JSON.stringify({
        unmatchedCells: { '2026-09-01|2292|MORNING': '홍길동' },
      }),
    });
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.unregistered).toBe(1);
    expect(r.counts.vacant).toBe(1); // 오후는 이름조차 없음
    const un = r.errors.find((e) => e.kind === 'UNREGISTERED');
    expect(un?.message).toContain('홍길동');
    expect(un?.message).toContain('미등록');
  });

  it('패턴이 없는 옛 배차표는 공석 검사를 하지 않는다 (오탐 방지)', async () => {
    arrange([]);
    mockPrisma.schedulePattern.findMany.mockResolvedValue([]);
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.vacant).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it('목록은 상한을 두되 전체 건수는 counts 로 정확히 보고한다', async () => {
    arrange([]);
    mockPrisma.schedulePattern.findMany.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => pattern('2026-09-01', i + 1, `${2000 + i}`)),
    );
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.vacant).toBe(120);
    expect(r.errors.length).toBeLessThanOrEqual(50);
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
