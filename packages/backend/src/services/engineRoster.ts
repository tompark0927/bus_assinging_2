import type { ServiceType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';

/**
 * 엔진에 넘길 **기사 명단** — 기초 데이터가 진실이다.
 *
 * 예전에는 엔진이 "누가 있고 누가 메인인가"를 지난달 배차표에서 추론했다
 * (한 차량을 10일 이상, 그게 전체 근무의 절반 이상이면 고정기사). 그러면
 * 되먹임이 생긴다 — 지난달에 적게 일한 사람은 '고정기사 아님'으로 밀려
 * 이번 달 기본 틀에서 빠지고, 그래서 또 적게 받고, 그 결과가 다시 다음 달
 * 추론의 입력이 된다. 한 번 어긋나면 그 달을 아무리 고쳐도 되돌아오지 않는다.
 *
 *   사장님 2026-09-02: "8월 배차 보고 9월 짜니 아무리 고쳐도 9월이 이상하고,
 *   9월 보고 10월 짜니 고친 것 같지가 않다. 첫 단추부터 잘못 끼웠다."
 *
 * 실제로 안정선·이금자·임미정(기초 데이터상 메인)이 지난달 10일 근무에 그쳐
 * 스페어로 밀렸고, 그 달 배차표가 다시 다음 달의 근거가 됐다.
 *
 * 엔진의 키는 **이름**이라 동명이인은 넘기지 않는다 — 넘기면 두 사람의 근무가
 * 한 이름으로 합쳐진다. (배차에서 동명이인을 보류하는 기존 규칙과 같다)
 */

export interface EngineRosterEntry {
  name: string;
  /** 기초 데이터의 기사 구분 — 메인이면 기본 틀에 정·부로 들어간다 */
  main: boolean;
  /** 기초 데이터의 담당 차량. 없으면 엔진이 지난달 실적에서 추론한다 */
  home_vehicle: string | null;
}

export async function rosterForEngine(
  companyId: number,
  serviceType: ServiceType | null,
): Promise<EngineRosterEntry[]> {
  const drivers = await prisma.user.findMany({
    where: { companyId, role: 'DRIVER', isActive: true },
    select: { name: true, driverType: true, serviceType: true, assignedBusNumber: true },
  });

  // 노선 종류 게이트 — 간선 배차표에 지선 기사를 세우지 않는다.
  // 구분 미지정 기사는 통과(엔진 저장 경로의 배정 규칙과 같다).
  const eligible = drivers.filter(
    (d) => !serviceType || !d.serviceType || d.serviceType === serviceType,
  );

  const seen = new Map<string, number>();
  for (const d of eligible) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
  const ambiguous = [...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  if (ambiguous.length) {
    logger.warn(
      `[engineRoster] 동명이인 ${ambiguous.join(', ')} 은 엔진 명단에서 제외 ` +
        '(엔진 키가 이름이라 두 사람의 근무가 한 이름으로 합쳐진다)',
    );
  }
  const ambiguousSet = new Set(ambiguous);

  return eligible
    .filter((d) => !ambiguousSet.has(d.name))
    .map((d) => ({
      name: d.name,
      main: d.driverType === 'MAIN',
      home_vehicle: d.assignedBusNumber?.trim() || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
