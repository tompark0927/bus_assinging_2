/**
 * 업로드 파일 명단 대조 게이트
 *
 * 배차는 기초 데이터에 등록된 사람으로만 짜야 한다. 다른 회사 배차표나
 * 철 지난 파일을 올리면 그 안의 이름이 우리 회사 사람이 아니어서 배차가
 * 통째로 비는데, 저장한 뒤에 알려주면 이미 늦다 — 담당자는 배차표가
 * 만들어졌다고 믿는다. 그래서 저장 전에 멈추는지 검증한다.
 */

jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { saveEngineDraft, RosterMismatchError } from '../services/engineScheduleService';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

/** 기사 이름 n개가 등장하는 하루치 cells (차량은 전부 매칭되도록) */
function payloadWith(names: string[]) {
  const cells: any = { '2026-09-01': {} };
  names.forEach((name, i) => {
    cells['2026-09-01'][`22${String(i).padStart(2, '0')}`] = {
      slot: '1', display_slot: 1, am: name, pm: '',
      underlying: 1, operating: true, group: '가좌출발',
    };
  });
  return { year: 2026, month: 9, cells, confirmOverwrite: true };
}

function arrangeDb(registeredNames: string[], vehicleCount: number) {
  mockPrisma.bus.findMany.mockResolvedValue(
    Array.from({ length: vehicleCount }, (_, i) => ({
      id: i + 1, busNumber: `22${String(i).padStart(2, '0')}`, routeId: 1,
    })),
  );
  mockPrisma.user.findMany.mockResolvedValue(
    registeredNames.map((name, i) => ({ id: i + 1, name, employeeId: `D${i}` })),
  );
}

describe('saveEngineDraft — 명단 대조 게이트', () => {
  beforeEach(() => jest.clearAllMocks());

  it('파일 이름 다수가 기초 데이터에 없으면 저장 전에 멈춘다', async () => {
    // 10명 중 5명만 등록됨 (50% 미매칭)
    const names = Array.from({ length: 10 }, (_, i) => `기사${i}`);
    arrangeDb(names.slice(0, 5), 10);

    await expect(saveEngineDraft(1, 1, payloadWith(names))).rejects.toBeInstanceOf(
      RosterMismatchError,
    );
    // 게이트에서 멈췄으므로 배차표를 만들지 않는다
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('차단 시 근거(총원·미매칭 명단·비율)를 담아 알려준다', async () => {
    const names = ['김영수', '박철수', '이민호', '최지훈'];
    arrangeDb(['김영수'], 4); // 3/4 = 75% 미매칭

    try {
      await saveEngineDraft(1, 1, payloadWith(names));
      throw new Error('던져야 한다');
    } catch (e) {
      const err = e as RosterMismatchError;
      expect(err.details.totalNames).toBe(4);
      expect(err.details.matchedNames).toBe(1);
      expect(err.details.unmatchedNames.sort()).toEqual(['박철수', '이민호', '최지훈']);
      expect(err.details.unmatchedRate).toBeCloseTo(0.75);
      expect(err.message).toContain('다른 회사 파일');
    }
  });

  it('소수만 빠진 경우(임계치 이하)는 통과시킨다 — 신규 입사 몇 명까지 막지 않는다', async () => {
    // 20명 중 2명 미등록 = 10% → 임계치(15%) 이하
    const names = Array.from({ length: 20 }, (_, i) => `기사${i}`);
    arrangeDb(names.slice(0, 18), 20);
    mockPrisma.$transaction.mockResolvedValue(99);

    const r = await saveEngineDraft(1, 1, payloadWith(names));
    expect(r.scheduleId).toBe(99);
    expect(r.unmatched.drivers).toHaveLength(2);
  });

  it('confirmMismatch 를 주면 알고도 진행한다', async () => {
    const names = ['김영수', '박철수', '이민호', '최지훈'];
    arrangeDb(['김영수'], 4);
    mockPrisma.$transaction.mockResolvedValue(77);

    const r = await saveEngineDraft(1, 1, { ...payloadWith(names), confirmMismatch: true });
    expect(r.scheduleId).toBe(77);
  });

  it('동명이인도 미매칭으로 세어 비율에 반영한다 (추측 배정하지 않으므로)', async () => {
    const names = ['김영수', '박철수', '이민호', '최지훈'];
    // 김영수가 2명 → 배정 보류, 나머지 3명은 미등록 → 4/4 미매칭
    mockPrisma.bus.findMany.mockResolvedValue([
      { id: 1, busNumber: '2200', routeId: 1 }, { id: 2, busNumber: '2201', routeId: 1 },
      { id: 3, busNumber: '2202', routeId: 1 }, { id: 4, busNumber: '2203', routeId: 1 },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 1, name: '김영수', employeeId: 'D1' },
      { id: 2, name: '김영수', employeeId: 'D2' },
    ]);

    try {
      await saveEngineDraft(1, 1, payloadWith(names));
      throw new Error('던져야 한다');
    } catch (e) {
      const err = e as RosterMismatchError;
      expect(err.details.unmatchedNames).toContain('김영수');
      expect(err.details.unmatchedRate).toBe(1);
    }
  });
});
