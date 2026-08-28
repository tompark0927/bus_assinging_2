import { prisma } from '../utils/prisma';
import type { ServiceType } from '@prisma/client';
import { resolveMonthScheduleId } from './scheduleService';

/**
 * 저장된 배차표 → 엔진 cells.
 *
 * "지난달 배차표로 이번 달 짜기"에 엑셀 왕복이 필요할 이유가 없다. 지난달
 * 배차표는 이미 DB 에 있고, 엔진으로 만든 것이라면 순번(SchedulePattern)까지
 * 저장돼 있다. 담당자가 내보내기 → 다시 업로드를 하면 그 왕복에서 순번이
 * 떨어져 나가 "로테이션 추론 실패"로 막히는데, 애초에 돌 필요가 없는 길이다.
 *
 * 엔진 `/import`·`/generate` 응답의 cells 와 **같은 형식**으로 만든다:
 *   { "2026-07-01": { "2506": { display_slot, underlying, am, pm, operating, group } } }
 */

export interface EngineCells {
  [dateIso: string]: {
    [vehicleNumber: string]: {
      slot: string | null;
      display_slot: number | null;
      underlying: number | null;
      am: string;
      pm: string;
      operating: boolean;
      group: string | null;
    };
  };
}

export interface ScheduleAsCells {
  scheduleId: number;
  year: number;
  month: number;
  cells: EngineCells;
  groups: { name: string; vehicles: string[] }[];
  /** 순번(SchedulePattern)이 실제로 저장돼 있는가 — 없으면 이어받을 게 없다 */
  hasSlotPatterns: boolean;
  vehicleCount: number;
  dateCount: number;
  filledCells: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 그 달의 대표 배차표(발행본 우선 → 최근 초안)를 cells 로 만든다.
 * 없으면 null.
 */
export async function monthScheduleAsCells(
  companyId: number,
  year: number,
  month: number,
  serviceType: ServiceType | null = null,
): Promise<ScheduleAsCells | null> {
  const scheduleId = await resolveMonthScheduleId(companyId, year, month, undefined, serviceType);
  if (scheduleId === null) return null;

  const [slots, patterns] = await Promise.all([
    prisma.scheduleSlot.findMany({
      where: { scheduleId },
      select: {
        date: true, shift: true, isRestDay: true, status: true,
        driver: { select: { name: true } },
        bus: { select: { busNumber: true } },
        route: { select: { routeNumber: true } },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.schedulePattern.findMany({
      where: { scheduleId },
      select: {
        date: true, displaySlot: true, underlyingSlot: true, operating: true,
        depotGroup: true, bus: { select: { busNumber: true } },
      },
    }),
  ]);

  const cells: EngineCells = {};
  const groupOf = new Map<string, string>();      // 차량 → 그룹(출발지 또는 노선)
  const vehicles = new Set<string>();

  const cellAt = (dateIso: string, vehicle: string) => {
    const byVehicle = (cells[dateIso] ??= {});
    return (byVehicle[vehicle] ??= {
      slot: null, display_slot: null, underlying: null,
      am: '', pm: '', operating: true, group: null,
    });
  };

  // 1) 순번 패턴 — 감차(operating=false)일에도 언더라잉은 계속 돈다.
  //    다음 달을 이어받는 근거가 바로 이 값이다.
  let hasSlotPatterns = false;
  for (const p of patterns) {
    const v = p.bus?.busNumber;
    if (!v) continue;
    const c = cellAt(iso(p.date), v);
    c.display_slot = p.displaySlot ?? null;
    // underlyingSlot 0 은 "순번 없이 저장된 감차 기록" — 순번으로 치지 않는다
    c.underlying = p.underlyingSlot || null;
    c.operating = p.operating;
    if (p.depotGroup) { c.group = p.depotGroup; groupOf.set(v, p.depotGroup); }
    if (p.displaySlot || p.underlyingSlot) hasSlotPatterns = true;
    vehicles.add(v);
  }

  // 2) 기사 배정 — 휴무·드랍·결근은 그 칸을 비운다(엔진이 공석으로 본다)
  let filledCells = 0;
  for (const s of slots) {
    const v = s.bus?.busNumber;
    if (!v) continue;
    vehicles.add(v);
    const c = cellAt(iso(s.date), v);
    const working = !s.isRestDay && s.status !== 'DROPPED' && s.status !== 'ABSENT';
    const name = working ? (s.driver?.name ?? '') : '';
    if (s.shift === 'MORNING') c.am = name;
    else if (s.shift === 'AFTERNOON') c.pm = name;
    else { c.am = name; c.pm = name; } // FULL_DAY
    if (name) filledCells++;
    // 출발지그룹이 없으면 노선을 그룹으로 쓴다 — 로테이션은 그 안에서 돈다
    if (!groupOf.has(v) && s.route?.routeNumber) groupOf.set(v, s.route.routeNumber);
  }

  // 그룹을 못 정한 차량은 한 덩어리로 묶는다 (그룹이 없으면 순번 판정이 안 된다)
  for (const v of vehicles) if (!groupOf.has(v)) groupOf.set(v, '전체');
  for (const [dateIso, byVehicle] of Object.entries(cells)) {
    void dateIso;
    for (const [v, c] of Object.entries(byVehicle)) {
      if (!c.group) c.group = groupOf.get(v) ?? null;
      if (c.slot == null && c.display_slot != null) c.slot = String(c.display_slot);
    }
  }

  const byGroup = new Map<string, string[]>();
  for (const [v, g] of groupOf) {
    const list = byGroup.get(g) ?? [];
    list.push(v);
    byGroup.set(g, list);
  }
  const groups = [...byGroup.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true }))
    .map(([name, vs]) => ({
      name,
      vehicles: vs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }));

  return {
    scheduleId, year, month, cells, groups, hasSlotPatterns,
    vehicleCount: vehicles.size,
    dateCount: Object.keys(cells).length,
    filledCells,
  };
}

/**
 * 노선별 요일 운행 대수 — 엔진에 그대로 넘긴다.
 *
 * 감차를 지난달 실적에서 되짚으면 평일 상시 감차를 공휴일로 오해해 대수가
 * 뭉개진다(성민: 등록 14대, 평일 12·토 11·일공휴일 10). 회사가 기초 데이터에
 * 직접 적어 둔 값이 언제나 더 정확하므로 그걸 쓴다.
 *
 * 키는 엔진의 그룹 이름과 맞춰야 한다 — cells 의 group 이 노선번호이므로
 * 여기서도 노선번호를 키로 쓴다.
 */
export async function routeOperatingCounts(
  companyId: number,
  serviceType: ServiceType | null = null,
): Promise<Record<string, { weekday?: number; sat?: number; sunhol?: number; fleet: number }>> {
  const routes = await prisma.route.findMany({
    where: { companyId, isActive: true, ...(serviceType ? { serviceType } : {}) },
    select: {
      routeNumber: true, weekdayBuses: true, saturdayBuses: true, holidayBuses: true,
      _count: { select: { buses: true } },
      buses: { where: { isActive: true }, select: { id: true } },
    },
  });
  const out: Record<string, { weekday?: number; sat?: number; sunhol?: number; fleet: number }> = {};
  for (const r of routes) {
    // 하나도 설정 안 한 노선은 넘기지 않는다 — "전 차량 매일 운행"이 그 회사의
    // 실제 운영일 수 있고, 반쪽짜리 값으로 덮어쓰면 오히려 틀어진다
    if (r.weekdayBuses == null && r.saturdayBuses == null && r.holidayBuses == null) continue;
    out[r.routeNumber] = {
      ...(r.weekdayBuses != null ? { weekday: r.weekdayBuses } : {}),
      ...(r.saturdayBuses != null ? { sat: r.saturdayBuses } : {}),
      ...(r.holidayBuses != null ? { sunhol: r.holidayBuses } : {}),
      fleet: r.buses.length,
    };
  }
  return out;
}
