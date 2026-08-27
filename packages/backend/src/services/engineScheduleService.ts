import { Prisma, ShiftType } from '@prisma/client';
import type { ServiceType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { serviceTypeLabel } from '../utils/serviceType';

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
  /** 명단 불일치를 알고도 진행 — 없으면 RosterMismatchError */
  confirmMismatch?: boolean;
  /** 간선/지선/광역 — 이 초안이 속할 탭. null = 구분 없음(전체) */
  serviceType?: ServiceType | null;
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

/**
 * 업로드한 파일의 기사 명단이 기초 데이터와 너무 안 맞을 때 던진다.
 *
 * 다른 회사 배차표나 오래된 파일을 올리면 그 안의 이름들이 우리 회사에 없는
 * 사람이라 배차가 통째로 비어버린다. 저장한 뒤에 알려주면 이미 늦다 —
 * 담당자는 "배차표가 만들어졌다"고 믿고, 남의 회사 명단이 우리 배차표 자리에
 * 앉아 있게 된다. 그래서 저장 전에 멈추고 근거를 보여준다.
 */
export class RosterMismatchError extends Error {
  constructor(
    public readonly details: {
      totalNames: number;
      matchedNames: number;
      unmatchedNames: string[];
      unmatchedRate: number;   // 0~1
      totalVehicles: number;
      unmatchedVehicles: string[];
    },
  ) {
    super(
      `파일의 기사 ${details.totalNames}명 중 ${details.unmatchedNames.length}명` +
        `(${Math.round(details.unmatchedRate * 100)}%)이 기초 데이터에 없습니다. ` +
        '다른 회사 파일이거나 오래된 파일이 아닌지 확인해 주세요.',
    );
    this.name = 'RosterMismatchError';
  }
}

/** 이 비율을 넘으면 저장을 막는다 — 사람 몇 명 누락과 '남의 회사 파일'을 가르는 선 */
const MISMATCH_BLOCK_RATE = 0.15;

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
  /**
   * 이 배차표의 노선 종류와 맞지 않아 배정하지 않은 기사.
   * (예: 간선 배차표인데 파일에 지선 기사가 있음 — 기초 데이터가 틀렸거나
   *  파일이 틀렸거나 둘 중 하나라 담당자가 판단해야 한다)
   */
  serviceTypeMismatch: { name: string; driverServiceType: string }[];
}

/** 엔진이 기사명 자리에 넣는 비-기사 토큰 (휴무·결행 표기) */
const NON_DRIVER_TOKENS = new Set([
  '휴', 'O휴', '0휴', 'o휴', '○휴', '연차', '병가', '사후', '교육',
  '결행', '미운행', '운휴', '○', 'O', '',
]);

/** 파일에 등장한 이름 중 회사에 실제로 등록되어 있는 사람 수 (종류 불일치 포함) */
function totalKnownNames(
  fileNames: Set<string>,
  matched: Map<string, number>,
  ambiguous: Map<string, unknown>,
  mismatched: Set<string>,
): number {
  let n = 0;
  for (const name of fileNames) {
    if (matched.has(name) || ambiguous.has(name) || mismatched.has(name)) n++;
  }
  return n;
}

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
  // 동명 초안 판정은 같은 노선 종류 안에서만 한다 — 간선 초안이 지선 초안을
  // 덮어쓰면 안 된다.
  const serviceType = payload.serviceType ?? null;

  // ── 0. 같은 이름 초안 덮어쓰기 확인 게이트 ──
  // 아래 트랜잭션은 동명 초안을 통째로 삭제한다. 담당자가 쌓아둔 감차
  // 표기·수동 수정이 클릭 한 번에 사라지는 사고를 막기 위해, 명시적
  // 승인(confirmOverwrite) 없이는 삭제될 내용을 알려주며 중단한다.
  if (!payload.confirmOverwrite) {
    const existingDraft = await prisma.schedule.findFirst({
      where: { companyId, year, month, serviceType, name, status: 'DRAFT' },
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
      select: { id: true, name: true, employeeId: true, serviceType: true },
    }),
  ]);

  const busByNumber = new Map(buses.map((b) => [b.busNumber, b]));

  // ── 노선 종류 게이트 ──
  // 간선 기사는 간선 배차표에만 있어야 한다. 종류가 정해진 배차표에 다른 종류
  // 기사가 들어오면 배정하지 않고 그 이름을 돌려준다 — 조용히 넣으면 지선
  // 기사가 간선 배차표에서 일하게 되고, 조용히 버리면 그 칸이 왜 비었는지
  // 아무도 모른다. (구분 미지정 기사는 이 배차표 종류로 보고 통과시킨다:
  //  엑셀에 이름이 오른 이상 담당자가 이 표에 넣을 사람으로 지목한 것이다)
  const serviceTypeMismatch: { name: string; driverServiceType: string }[] = [];
  const eligibleDrivers = drivers.filter((d) => {
    if (!serviceType || !d.serviceType || d.serviceType === serviceType) return true;
    serviceTypeMismatch.push({ name: d.name, driverServiceType: d.serviceType });
    return false;
  });
  if (serviceTypeMismatch.length) {
    logger.warn(
      `[engineSchedule] ${serviceTypeLabel(serviceType)} 배차표에 다른 종류 기사 ` +
        `${serviceTypeMismatch.length}명 — 배정 제외: ` +
        serviceTypeMismatch.map((m) => `${m.name}(${serviceTypeLabel(m.driverServiceType as never)})`).join(', '),
    );
  }

  // 동명이인은 **배정하지 않는다**. 첫 계정으로 추측 배정하면 김영수 A는
  // 과다 배차되고 김영수 B는 배차표·급여에서 사라지는데, 둘 다 조용히
  // 일어난다. 대신 그 이름의 셀을 미매칭으로 남겨 화면에 주황으로 드러내고,
  // 후보 사번 목록을 함께 돌려줘 담당자가 구분(개명·사번 표기)하게 한다.
  const byName = new Map<string, { id: number; employeeId: string }[]>();
  for (const d of eligibleDrivers) {
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
  // 종류 불일치는 "기초 데이터에 없음"이 아니다 — 등록은 되어 있고 이 표에 못
  // 들어갈 뿐이라, 미등록 목록에 섞으면 담당자가 엉뚱한 곳을 고치게 된다.
  const mismatchNames = new Set(serviceTypeMismatch.map((m) => m.name));
  const unmatchedDrivers = [...driverNames].filter(
    (n) => !driverByName.has(n) && !byName.has(n) && !mismatchNames.has(n),
  );

  // ── 종류가 통째로 어긋난 파일 방어 ──
  // 간선 탭에서 지선 배차표 파일을 올리면 전원이 걸러져 '배정 0건'인 빈
  // 배차표가 조용히 저장된다. 회사에 등록된 이름 중 절반 넘게 다른 종류면
  // 파일을 잘못 고른 것으로 보고 멈춘다.
  const knownNames = totalKnownNames(driverNames, driverByName, byName, mismatchNames);
  if (serviceType && knownNames > 0 && mismatchNames.size / knownNames > 0.5) {
    const other = serviceTypeMismatch[0].driverServiceType as ServiceType;
    throw new Error(
      `${serviceTypeLabel(serviceType)} 배차표인데 파일의 기사 대부분(${mismatchNames.size}/${knownNames}명)이 ` +
        `${serviceTypeLabel(other)} 기사입니다. ${serviceTypeLabel(other)} 탭에서 올리거나 ` +
        '기초 데이터 > 기사의 노선 종류를 확인해 주세요.',
    );
  }

  // 매칭된 차량이 하나도 없으면 저장해봐야 빈 배차표다 — 원인을 알려주고 중단.
  // 원인이 둘로 갈리는데 예전에는 둘 다 "기초 데이터를 확인하세요"로 안내해
  // 담당자가 멀쩡한 기초 데이터를 뒤지게 만들었다. 파일에서 차량번호를 하나도
  // 못 읽은 경우(양식 문제)와, 읽었는데 우리 회사 차가 아닌 경우(데이터 문제)를
  // 갈라서 말한다.
  if (busByNumber.size === 0) {
    if (vehicleNumbers.size === 0) {
      throw new Error(
        '파일에서 차량번호를 하나도 읽지 못했습니다. 배차 내용이 있는 시트인지, ' +
          '배차표 양식(행=차량, 칸=기사 이름)이 맞는지 확인해 주세요. ' +
          'Busync 에서 내보낸 파일이라면 "일별 상세" 시트가 함께 있어야 읽을 수 있습니다.',
      );
    }
    throw new Error(
      `파일의 차량번호가 기초 데이터와 하나도 일치하지 않습니다 ` +
        `(파일: ${[...vehicleNumbers].slice(0, 5).join(', ')}). ` +
        '다른 회사 파일이 아닌지, 기초 데이터의 차량번호가 엑셀과 같은지 확인해 주세요.',
    );
  }

  // ── 명단 대조 게이트 ──
  // 배차는 기초 데이터에 등록된 사람으로만 짜야 한다. 파일에 있는 이름이라도
  // 우리 회사 사람이 아니면 쓸 수 없으므로, 안 맞는 비율이 높으면 "잘못된
  // 파일"로 보고 저장 전에 멈춘다. (다른 회사 배차표·철 지난 파일 방어)
  const unresolvedNames = [...unmatchedDrivers, ...ambiguousNames.map((a) => a.name)];
  const totalNames = driverNames.size;
  const unmatchedRate = totalNames > 0 ? unresolvedNames.length / totalNames : 0;
  if (!payload.confirmMismatch && unmatchedRate > MISMATCH_BLOCK_RATE) {
    throw new RosterMismatchError({
      totalNames,
      matchedNames: totalNames - unresolvedNames.length,
      unmatchedNames: unresolvedNames.slice(0, 100),
      unmatchedRate,
      totalVehicles: vehicleNumbers.size,
      unmatchedVehicles: unmatchedVehicles.slice(0, 50),
    });
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
      where: { companyId, year, month, serviceType, name, status: 'DRAFT' },
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
        companyId, year, month, name, serviceType, status: 'DRAFT', createdBy,
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
    serviceTypeMismatch,
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
