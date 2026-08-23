import { prisma } from '../utils/prisma';

/**
 * "왜 이 기사가 이 칸에 있나" — 저장된 배차표에서 배정 근거를 재구성한다.
 *
 * 엔진의 explain.py 와 같은 답을 내지만 입력이 다르다. 엔진 쪽은 솔버가
 * 들고 있던 문제/해를 보는 반면, 여기는 **DB에 남은 결과만** 보고 되짚는다.
 * 그래야 (a) 초안이 사라진 뒤에도 (b) 담당자가 손으로 고친 칸까지 설명된다.
 *
 * 이 기능의 목적은 기술 과시가 아니라 **수용**이다. 자기 방식과 다른 배차를
 * 보면 사람은 일단 "틀렸다"고 본다. 이유가 한 줄 붙으면 "아 그래서"가 된다.
 */

export interface ExplainReason {
  code: string;
  text: string;
  /** 결정적일수록 크다 — UI가 요약 한 줄을 고를 때 쓴다 */
  weight: number;
}

export interface CellExplanation {
  driver: string | null;
  summary: string;
  reasons: ExplainReason[];
}

const SHIFT_KO: Record<string, string> = { MORNING: '오전', AFTERNOON: '오후', FULL_DAY: '전일' };
const OVERRIDE_LABEL: Record<string, string> = {
  BETTER_FIT: '이 사람이 더 적합하다고 판단',
  PAIR_CONFLICT: '두 기사를 분리해야 해서',
  ROUTE_UNFIT: '이 노선/차량이 맞지 않아서',
  PERSONAL: '개인 사정',
  PREFERENCE: '본인 희망',
  OTHER: '기타 사유',
};

function iso(d: Date) { return d.toISOString().slice(0, 10); }
/** 한국어 주격 조사 — 받침 있으면 '은', 없으면 '는' */
function topic(w: string) {
  const last = w[w.length - 1];
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${w}는`;
  return `${w}${(code - 0xac00) % 28 !== 0 ? '은' : '는'}`;
}
/** 목적격 — 받침 있으면 '을', 없으면 '를' */
function obj(w: string) {
  const last = w[w.length - 1];
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${w}를`;
  return `${w}${(code - 0xac00) % 28 !== 0 ? '을' : '를'}`;
}
function addDays(dateStr: string, n: number) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export async function explainCell(
  companyId: number,
  scheduleId: number,
  dateStr: string,
  vehicle: string,
  shiftRaw: string,
): Promise<CellExplanation> {
  const shift = shiftRaw.toUpperCase().startsWith('A') && shiftRaw.toUpperCase() !== 'AM'
    ? 'AFTERNOON'
    : shiftRaw.toUpperCase() === 'AM' || shiftRaw.toUpperCase() === 'MORNING' || shiftRaw.toUpperCase() === 'A'
      ? 'MORNING'
      : 'AFTERNOON';

  const bus = await prisma.bus.findFirst({
    where: { companyId, busNumber: vehicle }, select: { id: true },
  });
  if (!bus) throw new Error(`차량 ${vehicle} 을(를) 찾을 수 없습니다.`);

  const [slots, pattern] = await Promise.all([
    prisma.scheduleSlot.findMany({
      where: { scheduleId },
      select: {
        driverId: true, date: true, shift: true, busId: true,
        isManualOverride: true, overrideCode: true, overrideReason: true,
        driver: { select: { id: true, name: true, driverType: true } },
      },
    }),
    prisma.schedulePattern.findFirst({
      where: { scheduleId, busId: bus.id, date: new Date(`${dateStr}T00:00:00.000Z`) },
      select: { displaySlot: true, operating: true, depotGroup: true },
    }),
  ]);

  const target = slots.find(
    (s) => s.busId === bus.id && s.shift === shift && iso(s.date) === dateStr,
  );

  const reasons: ExplainReason[] = [];

  // ── 순번(그날의 출발 순서) ──
  if (pattern) {
    if (!pattern.operating) {
      reasons.push({
        code: 'VEHICLE_REST',
        text: `${vehicle} 차량은 이날 감차로 운행하지 않습니다.`,
        weight: 100,
      });
    } else if (pattern.displaySlot != null) {
      reasons.push({
        code: 'SLOT',
        text: `이날 ${vehicle} 차량의 순번은 ${pattern.displaySlot}번입니다` +
          (pattern.depotGroup ? ` (${pattern.depotGroup}).` : '.'),
        weight: 10,
      });
    }
  }

  if (!target) {
    return {
      driver: null,
      summary: pattern && !pattern.operating
        ? '감차로 운행하지 않는 날입니다.'
        : '아직 배정된 기사가 없습니다.',
      reasons,
    };
  }

  const name = target.driver.name;

  // ── 손으로 고친 칸이면 그게 가장 중요한 근거 ──
  if (target.isManualOverride) {
    const label = target.overrideCode ? OVERRIDE_LABEL[target.overrideCode] : null;
    reasons.push({
      code: 'MANUAL',
      text: `담당자가 직접 지정한 배정입니다` +
        (label ? ` — ${label}` : '') +
        (target.overrideReason ? ` ("${target.overrideReason}")` : '.'),
      weight: 900,
    });
  }

  // ── 기사별 근무 이력 (이 배차표 안에서) ──
  const byDriver = new Map<number, Map<string, { shift: string; busId: number | null }>>();
  const busCount = new Map<number, Map<number, number>>();
  for (const s of slots) {
    const m = byDriver.get(s.driverId) ?? new Map();
    m.set(iso(s.date), { shift: s.shift, busId: s.busId });
    byDriver.set(s.driverId, m);
    if (s.busId) {
      const bc = busCount.get(s.driverId) ?? new Map();
      bc.set(s.busId, (bc.get(s.busId) ?? 0) + 1);
      busCount.set(s.driverId, bc);
    }
  }

  // 본인차량 = 이 달에 가장 많이 탄 차량 (절반 이상이면 고정기사로 본다)
  const homeBusOf = (driverId: number) => {
    const bc = busCount.get(driverId);
    if (!bc) return null;
    let best: number | null = null, n = 0, total = 0;
    for (const [b, c] of bc) { total += c; if (c > n) { n = c; best = b; } }
    return best != null && total > 0 && n / total >= 0.5 ? best : null;
  };

  const myHome = homeBusOf(target.driverId);
  if (myHome === bus.id) {
    reasons.push({
      code: 'OWN_VEHICLE',
      text: `${name} 기사의 고정(본인) 차량입니다.`,
      weight: 800,
    });
  } else if (myHome != null) {
    const homeNum = (await prisma.bus.findUnique({
      where: { id: myHome }, select: { busNumber: true },
    }))?.busNumber;
    reasons.push({
      code: 'OFF_OWN_VEHICLE',
      text: `본인차량(${homeNum ?? '-'})이 아닌 ${vehicle}에 투입되었습니다 — 결원 충원입니다.`,
      weight: 700,
    });
  } else {
    const rode = busCount.get(target.driverId)?.get(bus.id) ?? 0;
    reasons.push({
      code: 'SPARE',
      text: rode > 0
        ? `예비(S/P) 기사이며 이 달 ${vehicle} 차량에 ${rode}회 탔습니다.`
        : '예비(S/P) 기사로 투입되었습니다.',
      weight: 400,
    });
  }

  // ── 짝궁 ──
  const partnerId = [...byDriver.keys()].find(
    (id) => id !== target.driverId && homeBusOf(id) === bus.id,
  );
  const partner = partnerId
    ? slots.find((s) => s.driverId === partnerId)?.driver ?? null
    : null;
  const other = shift === 'MORNING' ? 'AFTERNOON' : 'MORNING';
  const counterpart = slots.find(
    (s) => s.busId === bus.id && s.shift === other && iso(s.date) === dateStr,
  );
  if (counterpart) {
    reasons.push({
      code: 'PAIR',
      text: `같은 차량 ${topic(SHIFT_KO[other])} ` +
        `${counterpart.driverId === partnerId ? '짝궁 ' : ''}${counterpart.driver.name} 기사입니다.`,
      weight: 50,
    });
  }

  // ── 오전/오후가 이렇게 정해진 이유 ──
  const myDays = byDriver.get(target.driverId) ?? new Map();
  let prevDay: string | null = null;
  for (let i = 1; i <= 10; i++) {
    const d = addDays(dateStr, -i);
    if (myDays.has(d)) { prevDay = d; break; }
  }
  if (prevDay) {
    const gap = Math.round(
      (Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${prevDay}T00:00:00Z`)) / 86400000,
    );
    const prevShift = myDays.get(prevDay)!.shift;
    const same = prevShift === shift;
    if (gap === 1) {
      reasons.push({
        code: same ? 'SHIFT_KEEP' : 'SHIFT_CHANGE',
        text: same
          ? `전날에 이어 연속 근무 — ${obj(SHIFT_KO[shift])} 유지했습니다.`
          : `전날 ${SHIFT_KO[prevShift]}에서 ${SHIFT_KO[shift]}으로 바뀌었습니다 (이례적).`,
        weight: 600,
      });
    } else if (gap >= 2 && gap <= 5) {
      // 짝이 그 사이 같이 쉬었는지가 교대 여부를 가른다 (실측 규칙)
      const pDays = partnerId ? byDriver.get(partnerId) ?? new Map() : new Map();
      let jointRest = false;
      for (let g = 1; g < gap; g++) {
        if (!pDays.has(addDays(prevDay, g))) { jointRest = true; break; }
      }
      reasons.push({
        code: jointRest ? 'PARTNER_SWAP' : 'SOLO_LEAVE',
        text: jointRest
          ? `짝궁${partner ? ` ${partner.name}` : ''}과 함께 ${gap - 1}일 쉬고 복귀 → ` +
            (same ? `${obj(SHIFT_KO[shift])} 유지했습니다.` : `${SHIFT_KO[prevShift]}에서 ${SHIFT_KO[shift]}으로 교대했습니다.`)
          : `${gap - 1}일 혼자 쉬고 복귀 — 짝궁이 계속 근무 중이라 ` +
            (same ? `${obj(SHIFT_KO[shift])} 유지했습니다.` : `${SHIFT_KO[shift]}으로 바뀌었습니다.`),
        weight: 650,
      });
    }
  }

  // ── 연속 근무 상황 ──
  let run = 1;
  for (let i = 1; i <= 12; i++) { if (myDays.has(addDays(dateStr, -i))) run++; else break; }
  for (let i = 1; i <= 12; i++) { if (myDays.has(addDays(dateStr, i))) run++; else break; }
  if (run >= 6) {
    reasons.push({
      code: 'LONG_RUN',
      text: `이 배정을 포함해 연속 ${run}일 근무입니다.`,
      weight: 300,
    });
  }

  // 월 근무일수 (만근 확인용)
  reasons.push({
    code: 'MONTH_DAYS',
    text: `${name} 기사의 이 달 근무일수는 ${myDays.size}일입니다.`,
    weight: 5,
  });

  reasons.sort((a, b) => b.weight - a.weight);
  return {
    driver: name,
    summary: `${name} — ${reasons[0]?.text ?? '배정되었습니다.'}`,
    reasons,
  };
}
