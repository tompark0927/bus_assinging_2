import { Prisma, ShiftType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';

/**
 * 배차 엔진(Python) 생성 결과를 DB 배차표로 영속화한다.
 *
 * 엔진은 엑셀 세계의 값(차량번호 문자열, 기사 이름)으로 말하고 DB는 id로
 * 말하므로, 이 서비스가 그 사이를 번역한다. 매칭 실패는 조용히 버리지 않고
 * `unmatched`로 전부 돌려줘 담당자가 기초 데이터를 고칠 수 있게 한다.
 *
 * 저장 구조
 *   Schedule         — 월 단위 초안
 *   SchedulePattern  — (날짜×차량) 순번·언더라잉·운행여부  ← 엔진 1단계
 *   ScheduleSlot     — (날짜×기사) 배정                    ← 엔진 2단계
 */

/** 엔진 /generate 응답의 셀 한 칸 */
export interface EngineCell {
  slot: string | null;
  display_slot: number | null;
  am: string;
  pm: string;
  underlying: number | null;
  operating: boolean;
  group: string | null;
}

export interface EngineDraftPayload {
  year: number;
  month: number;
  name?: string;
  /** { "2026-08-01": { "6159": EngineCell } } */
  cells: Record<string, Record<string, EngineCell>>;
  /** 같은 이름 초안이 있을 때 덮어쓰기 승인 — 없으면 DraftOverwriteConflict */
  confirmOverwrite?: boolean;
}

/**
 * 같은 이름의 초안이 이미 있어 덮어쓰기 확인이 필요할 때 던진다.
 * 이름이 기본값('AI 엔진 초안')이라 충돌이 오히려 일반적인 경우인데,
 * 확인 없이 진행하면 그 달의 감차 표기·수동 수정이 한 번에 사라진다.
 */
export class DraftOverwriteConflict extends Error {
  constructor(
    public readonly details: {
      existingDraftId: number;
      name: string;
      slotCount: number;
      manualOverrideCount: number;
      vehicleOffCount: number;
    },
  ) {
    super(
      `같은 이름의 초안 "${details.name}" 이(가) 이미 있습니다. ` +
        `덮어쓰면 배정 ${details.slotCount}건이 삭제됩니다.`,
    );
    this.name = 'DraftOverwriteConflict';
  }
}

export interface SaveResult {
  scheduleId: number;
  patternCount: number;
  slotCount: number;
  unmatched: {
    /** DB에 없는 차량번호 */
    vehicles: string[];
    /** DB에 없는 기사 이름 — 자동 등록까지 실패한 잔여분 */
    drivers: string[];
  };
  /** 동명이인이라 배정을 보류한 이름 — 담당자가 사번으로 구분해야 한다 */
  ambiguousNames: { name: string; candidates: { id: number; employeeId: string }[] }[];
}

/** 엔진이 기사명 자리에 넣는 비-기사 토큰 (휴무·결행 표기) */
const NON_DRIVER_TOKENS = new Set([
  '휴', 'O휴', '0휴', 'o휴', '○휴', '연차', '병가', '사후', '교육',
  '결행', '미운행', '운휴', '○', 'O', '',
]);

function isDriverName(v: string | null | undefined): v is string {
  if (!v) return false;
  const s = v.trim();
  return s.length > 0 && !NON_DRIVER_TOKENS.has(s);
}

/**
 * 엔진 초안을 저장한다. 같은 (회사, 연, 월, 이름) 초안이 있으면 통째로
 * 교체한다 — 부분 갱신은 로테이션 일관성을 깨뜨릴 수 있어 허용하지 않는다.
 */
export async function saveEngineDraft(
  companyId: number,
  createdBy: number,
  payload: EngineDraftPayload,
): Promise<SaveResult> {
  const { year, month, cells } = payload;
  const name = payload.name?.trim() || 'AI 엔진 초안';

  // ── 0. 같은 이름 초안 덮어쓰기 확인 게이트 ──
  // 아래 트랜잭션은 동명 초안을 통째로 삭제한다. 담당자가 쌓아둔 감차
  // 표기·수동 수정이 클릭 한 번에 사라지는 사고를 막기 위해, 명시적
  // 승인(confirmOverwrite) 없이는 삭제될 내용을 알려주며 중단한다.
  if (!payload.confirmOverwrite) {
    const existingDraft = await prisma.schedule.findFirst({
      where: { companyId, year, month, name, status: 'DRAFT' },
      select: { id: true },
    });
    if (existingDraft) {
      const [slotCount, manualOverrideCount, vehicleOffCount] = await Promise.all([
        prisma.scheduleSlot.count({ where: { scheduleId: existingDraft.id } }),
        prisma.scheduleSlot.count({
          where: { scheduleId: existingDraft.id, isManualOverride: true },
        }),
        prisma.schedulePattern.count({
          where: { scheduleId: existingDraft.id, operating: false },
        }),
      ]);
      throw new DraftOverwriteConflict({
        existingDraftId: existingDraft.id,
        name,
        slotCount,
        manualOverrideCount,
        vehicleOffCount,
      });
    }
  }

  // ── 1. 등장하는 차량번호·기사명 수집 ──
  const vehicleNumbers = new Set<string>();
  const driverNames = new Set<string>();
  for (const byVehicle of Object.values(cells)) {
    for (const [vehicle, cell] of Object.entries(byVehicle)) {
      vehicleNumbers.add(vehicle);
      if (isDriverName(cell.am)) driverNames.add(cell.am.trim());
      if (isDriverName(cell.pm)) driverNames.add(cell.pm.trim());
    }
  }

  // ── 2. DB 매칭 (회사 스코프) ──
  const [buses, drivers] = await Promise.all([
    prisma.bus.findMany({
      where: { companyId, busNumber: { in: [...vehicleNumbers] } },
      select: { id: true, busNumber: true, routeId: true },
    }),
    prisma.user.findMany({
      where: { companyId, name: { in: [...driverNames] } },
      select: { id: true, name: true, employeeId: true },
    }),
  ]);

  const busByNumber = new Map(buses.map((b) => [b.busNumber, b]));
  // 동명이인은 **배정하지 않는다**. 첫 계정으로 추측 배정하면 김영수 A는
  // 과다 배차되고 김영수 B는 배차표·급여에서 사라지는데, 둘 다 조용히
  // 일어난다. 대신 그 이름의 셀을 미매칭으로 남겨 화면에 주황으로 드러내고,
  // 후보 사번 목록을 함께 돌려줘 담당자가 구분(개명·사번 표기)하게 한다.
  const byName = new Map<string, { id: number; employeeId: string }[]>();
  for (const d of drivers) {
    const list = byName.get(d.name) ?? [];
    list.push({ id: d.id, employeeId: d.employeeId });
    byName.set(d.name, list);
  }
  const driverByName = new Map<string, number>();
  const ambiguousNames: { name: string; candidates: { id: number; employeeId: string }[] }[] = [];
  for (const [n, list] of byName) {
    if (list.length === 1) driverByName.set(n, list[0].id);
    else ambiguousNames.push({ name: n, candidates: list });
  }
  if (ambiguousNames.length) {
    logger.warn(
      `[engineSchedule] 동명이인 ${ambiguousNames.length}명 — 배정 보류(미매칭 처리): ` +
        ambiguousNames.map((a) => a.name).join(', '),
    );
  }

  const unmatchedVehicles = [...vehicleNumbers].filter((v) => !busByNumber.has(v));
  const unmatchedDrivers = [...driverNames].filter((n) => !driverByName.has(n) && !byName.has(n));

  // 매칭된 차량이 하나도 없으면 저장해봐야 빈 배차표다 — 원인을 알려주고 중단
  if (busByNumber.size === 0) {
    throw new Error(
      `차량번호가 하나도 일치하지 않습니다 (예: ${[...vehicleNumbers].slice(0, 5).join(', ')}). ` +
        '기초 데이터의 차량번호가 엑셀과 같은지 확인해 주세요.',
    );
  }

  // 노선은 차량에 붙은 것을 쓴다. 차량에 노선이 없으면 회사의 첫 노선으로 대체
  // (ScheduleSlot.routeId 가 NOT NULL 이라 무언가는 있어야 한다)
  let fallbackRouteId: number | null = null;
  if (buses.some((b) => b.routeId == null)) {
    const route = await prisma.route.findFirst({
      where: { companyId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    fallbackRouteId = route?.id ?? null;
    if (fallbackRouteId == null) {
      throw new Error('노선이 하나도 등록되어 있지 않습니다. 기초 데이터에서 노선을 먼저 등록해 주세요.');
    }
  }

  // ── 3. 저장할 행 만들기 ──
  const patternRows: Prisma.SchedulePatternCreateManyInput[] = [];
  const slotRows: Omit<Prisma.ScheduleSlotCreateManyInput, 'scheduleId'>[] = [];
  // 기초 데이터에 없어 저장하지 못한 배정. 그냥 버리면 화면에서 '운행 안 함'
  // 처럼 보여 오해를 부른다 — 이름을 남겨 회색으로라도 보여주기 위함.
  const unmatchedCells: Record<string, string> = {};

  for (const [dateStr, byVehicle] of Object.entries(cells)) {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    for (const [vehicle, cell] of Object.entries(byVehicle)) {
      const bus = busByNumber.get(vehicle);
      if (!bus) continue;
      const routeId = bus.routeId ?? fallbackRouteId!;

      patternRows.push({
        busId: bus.id,
        date,
        displaySlot: cell.display_slot ?? null,
        // 엔진이 언더라잉을 안 준 옛 응답이면 표시 순번으로 대체 (0 = 미상)
        underlyingSlot: cell.underlying ?? cell.display_slot ?? 0,
        operating: cell.operating !== false,
        depotGroup: cell.group ?? null,
        scheduleId: 0, // 아래에서 실제 id로 채운다
      });

      for (const [raw, shift] of [
        [cell.am, ShiftType.MORNING],
        [cell.pm, ShiftType.AFTERNOON],
      ] as const) {
        if (!isDriverName(raw)) continue;
        const driverId = driverByName.get(raw.trim());
        if (!driverId) {
          unmatchedCells[`${dateStr}|${vehicle}|${shift}`] = raw.trim();
          continue;
        }
        slotRows.push({ driverId, routeId, busId: bus.id, date, shift });
      }
    }
  }

  // ── 4. 트랜잭션: 기존 동명 초안 교체 후 일괄 삽입 ──
  const scheduleId = await prisma.$transaction(async (tx) => {
    const existing = await tx.schedule.findFirst({
      where: { companyId, year, month, name, status: 'DRAFT' },
      select: { id: true },
    });
    if (existing) {
      // 패턴은 onDelete: Cascade, 슬롯은 명시 삭제
      await tx.scheduleSlot.deleteMany({ where: { scheduleId: existing.id } });
      await tx.schedulePattern.deleteMany({ where: { scheduleId: existing.id } });
      await tx.schedule.delete({ where: { id: existing.id } });
    }

    const schedule = await tx.schedule.create({
      data: {
        companyId, year, month, name, status: 'DRAFT', createdBy,
        notes: JSON.stringify({
          source: 'engine',
          unmatchedCells,
          unmatchedDrivers: unmatchedDrivers.slice(0, 200),
          // 동명이인 — registerMissingDrivers 가 추측으로 채우지 않도록 기록
          ambiguousNames: ambiguousNames.map((a) => a.name),
        }),
      },
      select: { id: true },
    });

    await tx.schedulePattern.createMany({
      data: patternRows.map((r) => ({ ...r, scheduleId: schedule.id })),
    });
    await tx.scheduleSlot.createMany({
      data: slotRows.map((r) => ({ ...r, scheduleId: schedule.id })),
    });
    return schedule.id;
  }, { timeout: 60_000 });

  logger.info(
    `[engineSchedule] 저장 완료 — schedule=${scheduleId} ${year}-${month} ` +
      `패턴 ${patternRows.length} 슬롯 ${slotRows.length} ` +
      `미매칭(차량 ${unmatchedVehicles.length}/기사 ${unmatchedDrivers.length})`,
  );

  // 기사 계정은 여기서 만들지 않는다.
  //
  // 배차는 **기초 데이터에 등록된 사람으로만** 짜야 한다. 엑셀에 적힌 이름을
  // 근거로 사람 레코드를 자동 생성하면, 회사가 등록한 적 없는 기사가 배차표에
  // 들어가고 그 사람 앞으로 근무·급여·기사앱 계정이 생긴다. 오타 하나가
  // 새 직원이 되기도 한다. 시스템이 사람을 만들어낼 권한은 없다.
  //
  // 그래서 매칭 실패는 조용히 메우지 않고 그대로 드러낸다: 셀은 미등록
  // (주황)으로 남고, 발행 게이트(E2/UNREGISTERED)가 발행을 막는다. 담당자가
  // 기초 데이터에 정식으로 등록하거나 이름을 고쳐야 해소된다.

  return {
    scheduleId,
    patternCount: patternRows.length,
    slotCount: slotRows.length,
    unmatched: { vehicles: unmatchedVehicles, drivers: unmatchedDrivers },
    ambiguousNames,
  };
}

/**
 * 게시 양식 렌더링용 조회 — 행=차량, 열=날짜 → (순번, 오전, 오후).
 * 패턴이 없는 옛 배차표는 빈 배열을 돌려주고, 호출측이 기존 뷰로 폴백한다.
 */
export async function getPostingView(scheduleId: number) {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId }, select: { notes: true },
  });
  let unmatchedCells: Record<string, string> = {};
  try {
    const meta = schedule?.notes ? JSON.parse(schedule.notes) : null;
    if (meta?.unmatchedCells) unmatchedCells = meta.unmatchedCells;
  } catch { /* 옛 배차표는 notes 가 평문 — 무시 */ }

  const [patterns, slots] = await Promise.all([
    prisma.schedulePattern.findMany({
      where: { scheduleId },
      select: {
        date: true, displaySlot: true, operating: true, depotGroup: true,
        bus: { select: { id: true, busNumber: true } },
      },
      orderBy: [{ date: 'asc' }],
    }),
    prisma.scheduleSlot.findMany({
      where: { scheduleId },
      select: {
        id: true, date: true, shift: true, busId: true,
        isManualOverride: true, status: true,
        driver: { select: { id: true, name: true } },
      },
    }),
  ]);

  const driverAt = new Map<string, { id: number; name: string; slotId: number; overridden: boolean }>();
  for (const s of slots) {
    if (!s.busId) continue;
    const key = `${s.date.toISOString().slice(0, 10)}|${s.busId}|${s.shift}`;
    driverAt.set(key, {
      id: s.driver.id, name: s.driver.name, slotId: s.id,
      overridden: s.isManualOverride,
    });
  }

  const groups = new Map<string, string[]>();
  const cells: Record<string, Record<string, unknown>> = {};
  for (const p of patterns) {
    const d = p.date.toISOString().slice(0, 10);
    const g = p.depotGroup ?? '전체';
    if (!groups.has(g)) groups.set(g, []);
    const list = groups.get(g)!;
    if (!list.includes(p.bus.busNumber)) list.push(p.bus.busNumber);

    // 저장된 배정이 없으면, 기초 데이터에 없어 탈락한 이름이라도 돌려준다
    const fallback = (shift: 'MORNING' | 'AFTERNOON') => {
      const name = unmatchedCells[`${d}|${p.bus.busNumber}|${shift}`];
      return name ? { id: 0, name, slotId: 0, overridden: false, unregistered: true } : null;
    };
    cells[d] ??= {};
    cells[d][p.bus.busNumber] = {
      slot: p.displaySlot,
      operating: p.operating,
      am: driverAt.get(`${d}|${p.bus.id}|MORNING`) ?? fallback('MORNING'),
      pm: driverAt.get(`${d}|${p.bus.id}|AFTERNOON`) ?? fallback('AFTERNOON'),
    };
  }

  return {
    groups: [...groups.entries()].map(([name, vehicles]) => ({ name, vehicles })),
    cells,
  };
}
