import { ShiftType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';

/**
 * 배차표 셀 편집 — 담당자가 "이 칸은 이 사람" 하고 바꾸는 흐름.
 *
 * 이 기능은 단순한 수정이 아니라 **학습 입력**이다. 담당자가 왜 바꿨는지
 * (overrideCode)를 함께 받아 두면, 같은 유형이 반복될 때 그 회사의 숨은
 * 규칙(예: 특정 두 기사는 같은 차 금지)을 역으로 뽑아 다음 달 생성에
 * 반영할 수 있다. 사유 없이 받으면 아무것도 못 배운다.
 *
 * 후보 추천은 엔진이 아니라 DB에서 직접 계산한다 — 저장된 배차표에는
 * 엔진의 임시 초안(draft)이 남아 있지 않기 때문.
 */

/** 담당자가 고른 수정 사유. 규칙 승격의 근거가 된다. */
export const OVERRIDE_CODES = {
  BETTER_FIT: '이 사람이 더 적합',
  PAIR_CONFLICT: '이 둘은 같이 두면 안 됨',
  ROUTE_UNFIT: '이 노선/차량은 이 사람에게 안 맞음',
  PERSONAL: '개인 사정 (그날만)',
  PREFERENCE: '본인 희망',
  OTHER: '기타',
} as const;

export type OverrideCode = keyof typeof OVERRIDE_CODES;

export interface CellCandidate {
  id: number;
  name: string;
  employeeId: string | null;
  driverType: string | null;
  /** 이 칸에 넣기 곤란한 이유 — 있으면 UI가 경고로 보여준다 (막지는 않는다) */
  warnings: string[];
  /** 추천 근거 — 왜 위에 있는지 */
  reasons: string[];
  /** 정렬용 (낮을수록 위) */
  score: number;
}

const SHIFT_KO: Record<string, string> = { MORNING: '오전', AFTERNOON: '오후', FULL_DAY: '전일' };

function toShift(v: string): ShiftType {
  const s = v.toUpperCase();
  if (s === 'MORNING' || s === 'AM' || s === 'A') return ShiftType.MORNING;
  if (s === 'AFTERNOON' || s === 'PM' || s === 'P') return ShiftType.AFTERNOON;
  return ShiftType.FULL_DAY;
}

/**
 * 특정 칸(날짜×차량×시프트)에 넣을 수 있는 기사 후보.
 *
 * 막지 않고 '경고'로만 알린다 — 담당자가 규칙을 알면서도 일부러 넣어야 할
 * 때가 있기 때문(급한 결원 등). 판단은 사람이 한다.
 */
export async function getCellCandidates(
  companyId: number,
  scheduleId: number,
  dateStr: string,
  vehicle: string,
  shiftRaw: string,
): Promise<{ current: { id: number; name: string } | null; candidates: CellCandidate[] }> {
  const shift = toShift(shiftRaw);
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const bus = await prisma.bus.findFirst({
    where: { companyId, busNumber: vehicle },
    select: { id: true, routeId: true },
  });
  if (!bus) throw new Error(`차량 ${vehicle} 을(를) 찾을 수 없습니다.`);

  const [drivers, monthSlots] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, role: 'DRIVER' },
      select: { id: true, name: true, employeeId: true, driverType: true },
      orderBy: { name: 'asc' },
    }),
    // 이 배차표 전체를 한 번에 읽어 연속근무·중복 판정에 쓴다
    prisma.scheduleSlot.findMany({
      where: { scheduleId },
      select: { driverId: true, date: true, shift: true, busId: true },
    }),
  ]);

  const byDriver = new Map<number, Map<string, { shift: string; busId: number | null }>>();
  const busCount = new Map<number, Map<number, number>>();
  for (const s of monthSlots) {
    const key = s.date.toISOString().slice(0, 10);
    const m = byDriver.get(s.driverId) ?? new Map();
    m.set(key, { shift: s.shift, busId: s.busId });
    byDriver.set(s.driverId, m);
    if (s.busId) {
      const bc = busCount.get(s.driverId) ?? new Map();
      bc.set(s.busId, (bc.get(s.busId) ?? 0) + 1);
      busCount.set(s.driverId, bc);
    }
  }

  const current = monthSlots.find(
    (s) => s.busId === bus.id && s.shift === shift &&
      s.date.toISOString().slice(0, 10) === dateStr,
  );
  const currentDriver = current
    ? drivers.find((d) => d.id === current.driverId) ?? null
    : null;

  const shiftDays = (n: number) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const candidates: CellCandidate[] = drivers.map((d) => {
    const days = byDriver.get(d.id) ?? new Map();
    const warnings: string[] = [];
    const reasons: string[] = [];
    let score = 0;

    // 그날 이미 다른 자리에 있는가
    const today = days.get(dateStr);
    if (today && !(current && current.driverId === d.id)) {
      warnings.push(`이미 그날 ${SHIFT_KO[today.shift] ?? today.shift} 근무 중`);
      score += 1000;
    }

    // 연속 근무 (이 칸에 넣었다고 가정)
    let run = 1;
    for (let i = 1; i <= 10; i++) { if (days.has(shiftDays(-i))) run++; else break; }
    for (let i = 1; i <= 10; i++) { if (days.has(shiftDays(i))) run++; else break; }
    if (run > 6) {
      warnings.push(`투입 시 연속 ${run}일 근무`);
      score += 300;
    }

    // 전날 오후 → 오늘 오전
    const prev = days.get(shiftDays(-1));
    if (shift === ShiftType.MORNING && prev?.shift === ShiftType.AFTERNOON) {
      warnings.push('전날 오후 근무 (휴게 부족)');
      score += 120;
    }

    // 이 차량을 평소 모는 사람인가
    const bc = busCount.get(d.id);
    const onThisBus = bc?.get(bus.id) ?? 0;
    const total = [...(bc?.values() ?? [])].reduce((a, b) => a + b, 0);
    if (onThisBus > 0 && total > 0 && onThisBus / total >= 0.5) {
      reasons.push(`${vehicle} 고정기사`);
      score -= 500;
    } else if (onThisBus > 0) {
      reasons.push(`${vehicle} 탑승 ${onThisBus}회`);
      score -= onThisBus * 5;
    }

    // 그날 비어 있는 사람 우대
    if (!today) {
      reasons.push('그날 미배정');
      score -= 50;
    }
    // 월 근무일수가 적은 사람 우대 (부담 균등)
    score += (days.size ?? 0) * 2;
    if (d.driverType === 'SPARE') reasons.push('예비(S/P)');

    return {
      id: d.id, name: d.name, employeeId: d.employeeId,
      driverType: d.driverType, warnings, reasons, score,
    };
  });

  candidates.sort((a, b) => a.score - b.score);
  return {
    current: currentDriver ? { id: currentDriver.id, name: currentDriver.name } : null,
    candidates,
  };
}

/**
 * 셀의 기사를 교체(또는 신규 배정)한다.
 * 그 칸만 바뀐다 — 나머지 배차는 절대 건드리지 않는다.
 */
export async function setCellDriver(
  companyId: number,
  scheduleId: number,
  params: {
    date: string; vehicle: string; shift: string;
    driverId: number | null;   // null 이면 배정 해제
    code?: OverrideCode; note?: string; actorId: number;
  },
) {
  const shift = toShift(params.shift);
  const date = new Date(`${params.date}T00:00:00.000Z`);

  const [bus, schedule] = await Promise.all([
    prisma.bus.findFirst({
      where: { companyId, busNumber: params.vehicle },
      select: { id: true, routeId: true },
    }),
    prisma.schedule.findFirst({
      where: { id: scheduleId, companyId },
      select: { id: true, status: true },
    }),
  ]);
  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');
  // 발행본을 여기서 고치면 기사가 이미 본 배차가 알림 없이 바뀐다 —
  // 다른 모든 수정 경로와 같은 규칙으로 막는다.
  if (schedule.status !== 'DRAFT') {
    throw new Error('발행된 배차표는 셀을 수정할 수 없습니다. 먼저 초안으로 되돌려주세요.');
  }
  if (!bus) throw new Error(`차량 ${params.vehicle} 을(를) 찾을 수 없습니다.`);

  const existing = await prisma.scheduleSlot.findFirst({
    where: { scheduleId, busId: bus.id, date, shift },
    select: { id: true, driverId: true },
  });

  // 배정 해제
  if (params.driverId == null) {
    if (existing) await prisma.scheduleSlot.delete({ where: { id: existing.id } });
    return { action: 'cleared' as const, removed: existing?.driverId ?? null };
  }

  // 같은 날 같은 기사가 다른 자리에 있으면 먼저 비운다 (하루 1시프트 원칙)
  await prisma.scheduleSlot.deleteMany({
    where: { scheduleId, date, driverId: params.driverId, NOT: { busId: bus.id } },
  });

  let routeId = bus.routeId;
  if (routeId == null) {
    const r = await prisma.route.findFirst({ where: { companyId }, select: { id: true } });
    if (!r) throw new Error('노선이 등록되어 있지 않습니다.');
    routeId = r.id;
  }

  const data = {
    driverId: params.driverId,
    isManualOverride: true,
    overrideCode: params.code ?? null,
    overrideReason: params.note?.trim() || null,
    overrideBy: params.actorId,
  };

  const slot = existing
    ? await prisma.scheduleSlot.update({ where: { id: existing.id }, data })
    : await prisma.scheduleSlot.create({
        data: { ...data, scheduleId, busId: bus.id, routeId, date, shift },
      });

  logger.info(
    `[cellEdit] schedule=${scheduleId} ${params.date} ${params.vehicle} ` +
      `${shift} → driver=${params.driverId} code=${params.code ?? '-'}`,
  );
  return {
    action: existing ? ('replaced' as const) : ('created' as const),
    removed: existing?.driverId ?? null,
    slotId: slot.id,
  };
}
