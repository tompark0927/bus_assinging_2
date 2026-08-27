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

/**
 * 실제 사고 회귀 — 담당자가 7월 배차표를 [Excel 내보내기]로 받아 8월 생성에
 * 올렸더니 "차량번호가 하나도 일치하지 않습니다 (예: )"가 떴다. 괄호가 빈 건
 * 파일에서 차량번호를 **한 개도 못 읽었다**는 뜻인데, 메시지는 기초 데이터를
 * 가리켜서 멀쩡한 데이터를 뒤지게 만들었다. 두 경우를 갈라서 말해야 한다.
 */
describe('saveEngineDraft — 차량번호를 못 읽은 경우와 안 맞는 경우를 구분한다', () => {
  beforeEach(() => jest.clearAllMocks());

  it('파일에서 차량번호를 하나도 못 읽으면 양식(파일) 문제로 안내한다', async () => {
    // 파일에 차번이 하나도 없으면 조회는 busNumber IN () 이라 결과가 비어 온다
    // (기초 데이터에 차량이 있든 없든 마찬가지 — 그래서 이건 파일 쪽 문제다)
    arrangeDb(['김영수'], 0);
    // cells 가 비어 있다 = 엔진이 그 시트에서 한 칸도 못 읽었다
    await expect(
      saveEngineDraft(1, 1, { year: 2026, month: 8, cells: {}, confirmOverwrite: true }),
    ).rejects.toThrow('차량번호를 하나도 읽지 못했습니다');
  });

  it('차량번호는 읽었는데 우리 회사 차가 아니면 데이터 문제로 안내한다', async () => {
    arrangeDb(['김영수'], 0); // 파일엔 차번이 있지만 기초 데이터에 그 차가 없다
    await expect(saveEngineDraft(1, 1, payloadWith(['김영수']))).rejects.toThrow(
      '차량번호가 기초 데이터와 하나도 일치하지 않습니다',
    );
  });
});
