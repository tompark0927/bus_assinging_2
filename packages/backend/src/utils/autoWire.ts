import { prisma } from './prisma';
import logger from './logger';

/**
 * 온보딩 직후 AI 자동 생성(솔버)이 바로 돌 수 있도록
 *   1) 노선에 배정되지 않은 버스를 노선에 고르게 분배(routeId)
 *   2) 담당 차량(assignedBusNumber)이 없는 MAIN 기사에게 차번을 배정 (자기 노선의 버스 우선)
 * 하는 "합리적 기본배정".
 *
 * 엑셀에서 버스↔노선, 기사↔차량 관계가 안 들어온 경우의 기본값이며,
 * 이미 배정된 항목(routeId / assignedBusNumber 있는 것)은 건드리지 않아 수동 설정을 보존한다.
 * 관리자는 기초 데이터에서 언제든 조정할 수 있다.
 */
export async function autoWireBusesAndCrews(
  companyId: number,
): Promise<{ busesWired: number; driversWired: number }> {
  const routes = await prisma.route.findMany({
    where: { companyId, isActive: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const buses = await prisma.bus.findMany({
    where: { companyId, isActive: true },
    orderBy: { id: 'asc' },
    select: { id: true, routeId: true, busNumber: true },
  });
  if (routes.length === 0 || buses.length === 0) {
    return { busesWired: 0, driversWired: 0 };
  }

  // 1) 노선 미배정 버스를 노선에 라운드로빈 분배
  let busesWired = 0;
  for (let i = 0; i < buses.length; i++) {
    if (buses[i].routeId == null) {
      const routeId = routes[i % routes.length].id;
      buses[i].routeId = routeId;
      await prisma.bus.update({ where: { id: buses[i].id }, data: { routeId } });
      busesWired++;
    }
  }

  // 노선별 버스 목록
  const busesByRoute = new Map<number, { id: number; busNumber: string }[]>();
  for (const b of buses) {
    if (b.routeId == null) continue;
    const arr = busesByRoute.get(b.routeId) ?? [];
    arr.push({ id: b.id, busNumber: b.busNumber });
    busesByRoute.set(b.routeId, arr);
  }
  const allRouteBuses = buses
    .filter((b) => b.routeId != null)
    .map((b) => ({ id: b.id, busNumber: b.busNumber }));

  // 2) 담당 차량이 없는 MAIN 기사에게 차번 배정 (자기 노선의 버스 우선, 라운드로빈)
  const drivers = await prisma.user.findMany({
    where: {
      companyId,
      role: 'DRIVER',
      isActive: true,
      driverType: 'MAIN',
      OR: [{ assignedBusNumber: null }, { assignedBusNumber: '' }],
    },
    select: {
      id: true,
      routeAssignments: { where: { isActive: true }, select: { routeId: true }, take: 1 },
    },
    orderBy: { id: 'asc' },
  });

  const rr = new Map<number, number>(); // 노선별 라운드로빈 인덱스
  let driversWired = 0;
  for (const d of drivers) {
    const routeId = d.routeAssignments[0]?.routeId ?? routes[0].id;
    const routeBuses = busesByRoute.get(routeId) ?? allRouteBuses;
    if (routeBuses.length === 0) continue;
    const idx = (rr.get(routeId) ?? 0) % routeBuses.length;
    rr.set(routeId, idx + 1);
    await prisma.user.update({
      where: { id: d.id },
      data: { assignedBusNumber: routeBuses[idx].busNumber },
    });
    driversWired++;
  }

  logger.info(`[autoWire] company ${companyId}: 버스 ${busesWired}대·기사 ${driversWired}명 자동 기본배정`);
  return { busesWired, driversWired };
}
