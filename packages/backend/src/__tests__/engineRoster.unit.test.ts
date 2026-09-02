/**
 * 엔진에 넘기는 기사 명단이 **기초 데이터**를 그대로 옮기는가.
 *
 * 이 명단이 없으면 엔진은 지난달 배차표에서 "누가 메인인가"를 추론한다 —
 * 지난달에 적게 일한 메인이 스페어로 밀리고, 그 결과가 다시 다음 달 추론의
 * 입력이 되는 되먹임이 생긴다(사장님 2026-09-02: "첫 단추부터 잘못 끼웠다").
 */
jest.mock('../utils/prisma');

import { prisma } from '../utils/prisma';
import { rosterForEngine } from '../services/engineRoster';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;

function setDrivers(rows: any[]) {
  mockPrisma.user = { findMany: jest.fn(async () => rows) };
}

beforeEach(() => jest.clearAllMocks());

describe('엔진 기사 명단 — 기초 데이터가 진실', () => {
  it('메인/스페어 구분과 담당 차량을 그대로 넘긴다', async () => {
    setDrivers([
      { name: '안정선', driverType: 'MAIN', serviceType: null, assignedBusNumber: '2266' },
      { name: '한동훈', driverType: 'SPARE', serviceType: null, assignedBusNumber: null },
    ]);

    expect(await rosterForEngine(29, null)).toEqual([
      { name: '안정선', main: true, home_vehicle: '2266' },
      { name: '한동훈', main: false, home_vehicle: null },
    ]);
  });

  it('지난달 근무가 적어도 기초 데이터가 메인이면 메인이다', async () => {
    // 되먹임을 끊는 지점 — 실적이 아니라 등록값을 본다
    setDrivers([
      { name: '이금자', driverType: 'MAIN', serviceType: null, assignedBusNumber: '2435' },
    ]);
    const roster = await rosterForEngine(29, null);

    expect(roster[0]).toMatchObject({ name: '이금자', main: true });
    // 조회 조건에 지난달 배차 실적이 끼어들지 않는다
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ companyId: 29, role: 'DRIVER', isActive: true });
  });

  it('노선 종류가 다른 기사는 뺀다 (구분 미지정은 통과)', async () => {
    setDrivers([
      { name: '간선기사', driverType: 'MAIN', serviceType: 'TRUNK', assignedBusNumber: '1' },
      { name: '지선기사', driverType: 'MAIN', serviceType: 'BRANCH', assignedBusNumber: '2' },
      { name: '미지정', driverType: 'MAIN', serviceType: null, assignedBusNumber: '3' },
    ]);

    const names = (await rosterForEngine(29, 'TRUNK' as never)).map((r) => r.name);
    expect(names).toEqual(['간선기사', '미지정']);
  });

  it('동명이인은 넘기지 않는다 — 엔진 키가 이름이라 둘이 합쳐진다', async () => {
    setDrivers([
      { name: '김영수', driverType: 'MAIN', serviceType: null, assignedBusNumber: '11' },
      { name: '김영수', driverType: 'SPARE', serviceType: null, assignedBusNumber: null },
      { name: '박민준', driverType: 'MAIN', serviceType: null, assignedBusNumber: '12' },
    ]);

    expect((await rosterForEngine(29, null)).map((r) => r.name)).toEqual(['박민준']);
  });

  it('빈 문자열 담당 차량은 없는 것으로 본다', async () => {
    setDrivers([
      { name: '임미정', driverType: 'MAIN', serviceType: null, assignedBusNumber: '  ' },
    ]);

    expect((await rosterForEngine(29, null))[0].home_vehicle).toBeNull();
  });
});
