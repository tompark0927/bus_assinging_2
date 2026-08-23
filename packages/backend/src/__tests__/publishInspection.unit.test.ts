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
    // 기본: 패턴 없음 + 활성 차량도 없음 → 운행해야 할 칸이 0
    mockPrisma.schedulePattern.findMany.mockResolvedValue([]);
    mockPrisma.bus.findMany.mockResolvedValue([]);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      notes: null, companyId: 1, year: 2026, month: 9,
    });
    // 승인 휴무 없음이 기본 — E5 를 보는 테스트에서만 따로 채운다
    mockPrisma.dayOffRequest.findMany.mockResolvedValue([]);
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

  it('패턴이 없는 솔버 배차표도 활성 차량×전일 기준으로 공석을 잡는다', async () => {
    arrange([]);
    mockPrisma.schedulePattern.findMany.mockResolvedValue([]); // 패턴 없음
    mockPrisma.bus.findMany.mockResolvedValue([{ id: 10, busNumber: '2292' }]);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      notes: null, companyId: 1, year: 2026, month: 9, // 9월 30일
    });
    const r = await inspectScheduleForPublish(5);
    // 1대 × 30일 × 2교대 = 60칸 전부 공석
    expect(r.counts.vacant).toBe(60);
  });

  it('패턴 없는 배차표에서도 명시적 감차는 제외한다', async () => {
    arrange([]);
    mockPrisma.schedulePattern.findMany
      .mockResolvedValueOnce([])                                              // operating:true 없음
      .mockResolvedValueOnce([{ date: new Date('2026-09-01T00:00:00.000Z'), busId: 10 }]); // 감차 1일
    mockPrisma.bus.findMany.mockResolvedValue([{ id: 10, busNumber: '2292' }]);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      notes: null, companyId: 1, year: 2026, month: 9,
    });
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.vacant).toBe(58); // 60 - 감차 하루(2칸)
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

  it('활성 차량이 없으면 공석 검사 대상도 없다', async () => {
    arrange([]);
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

  // ── E4 면허·자격 만료 ──
  it('면허 만료 뒤 날짜에 배정되면 E4 (기사×사유 1건으로 묶는다)', async () => {
    arrange(
      run(1, '김영수', 10, 5).map((x) => ({
        ...x,
        driver: { name: '김영수', licenseExpiresAt: new Date('2026-09-11T00:00:00.000Z') },
      })),
    );
    const r = await inspectScheduleForPublish(5);
    const e4 = r.errors.filter((e) => e.rule === 'E4');
    expect(e4).toHaveLength(1);
    expect(r.counts.expiredLicense).toBe(1);
    // 만료일 당일(9/11)까지는 유효 — 첫 위반은 9/12
    expect(e4[0].date).toBe('2026-09-12');
  });

  it('만료일 당일까지만 배정돼 있으면 위반이 아니다', async () => {
    arrange(
      run(1, '김영수', 8, 4).map((x) => ({  // 9/8~9/11
        ...x,
        driver: { name: '김영수', qualificationExpiresAt: new Date('2026-09-11T00:00:00.000Z') },
      })),
    );
    const r = await inspectScheduleForPublish(5);
    expect(r.errors.filter((e) => e.rule === 'E4')).toHaveLength(0);
  });

  it('만료일이 없으면 검사하지 않는다', async () => {
    arrange(run(1, '김영수', 1, 3));
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.expiredLicense).toBe(0);
  });

  // ── E5 승인 휴무 배정 ──
  it('승인된 휴무일에 배정돼 있으면 E5', async () => {
    arrange(run(1, '김영수', 1, 3));
    mockPrisma.dayOffRequest.findMany.mockResolvedValue([
      { driverId: 1, date: new Date('2026-09-02T00:00:00.000Z') },
    ]);
    const r = await inspectScheduleForPublish(5);
    const e5 = r.errors.filter((e) => e.rule === 'E5');
    expect(e5).toHaveLength(1);
    expect(e5[0].date).toBe('2026-09-02');
    expect(r.counts.approvedOff).toBe(1);
  });

  it('다른 기사의 승인 휴무는 영향 없다', async () => {
    arrange(run(1, '김영수', 1, 3));
    mockPrisma.dayOffRequest.findMany.mockResolvedValue([
      { driverId: 2, date: new Date('2026-09-02T00:00:00.000Z') },
    ]);
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.approvedOff).toBe(0);
  });

  // ── W2 주말휴무 부족 ──
  it('한 달 내내 주말에도 일하면 W2 경고 (발행은 막지 않는다)', async () => {
    arrange(run(1, '김영수', 1, 30));
    const r = await inspectScheduleForPublish(5);
    const w2 = r.warnings.filter((w) => w.rule === 'W2');
    expect(w2).toHaveLength(1);
    expect(r.counts.weekendOff).toBe(1);
    expect(r.errors.filter((e) => e.rule === 'W2')).toHaveLength(0);
  });

  it('주말에 하루라도 쉬면 W2 아님', async () => {
    arrange(run(1, '김영수', 1, 4)); // 9/5(토)·9/6(일) 휴무
    const r = await inspectScheduleForPublish(5);
    expect(r.counts.weekendOff).toBe(0);
  });
});
