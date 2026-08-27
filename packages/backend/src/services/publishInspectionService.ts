import { prisma } from '../utils/prisma';
import { serviceTypeLabel } from '../utils/serviceType';
import { parseScheduleMeta } from './vehicleOffService';
import { operatingCells } from './operatingPlanService';
import { loadCompanyPolicy } from './solverDispatchService';

/**
 * 발행 전 안전 검산 — 저장된 배차표(ScheduleSlot)를 직접 검사한다.
 *
 * 규칙은 엔진 inspector.py 의 E2/E3/W1 과 같은 시맨틱이다. 엔진의 검산은
 * 업로드한 엑셀에만 돌기 때문에, 담당자가 앱 안에서 고친 최종본이 규칙을
 * 어겨도 아무도 모른 채 발행되던 구멍을 여기서 막는다. (발행 게이트가
 * 엔진 프로세스에 의존하면 엔진 장애 = 발행 불가가 되므로, 네트워크 호출
 * 없이 백엔드 안에서 검사한다.)
 *
 * E2 빈 자리 — 운행하는 차량인데 기사가 없는 칸. **버스가 안 나간다는 뜻**이라
 *   배차표로서 미완성이다. 의도적으로 안 내보내는 차는 감차(operating=false)로
 *   표시되며 검사에서 빠진다. 빈 칸의 원인을 두 가지로 나눠 보고한다:
 *     UNREGISTERED — 엑셀엔 이름이 있는데 기초 데이터에 계정이 없어 저장 못 함
 *                    (해결: '미등록 기사 한번에 등록' 한 번)
 *     VACANT       — 이름 자체가 없음 (해결: 사람을 배정해야 함)
 * E3 연속근무 — 최대 연속 근무일 초과 (주 52시간제의 실무 안전선)
 * E4 면허·자격 만료 — 만료일이 지난 기사를 그 날짜에 배정. **무면허 운행**이라
 *   가장 무거운 위반이다. AI 엔진은 면허를 보지 않고 배차하므로(엔진에 그
 *   개념이 없다) 여기가 유일한 방어선이다.
 * E5 승인 휴무 배정 — 회사가 승인해 준 휴무일에 배정. 기사앱에는 '승인'으로
 *   떠 있는데 배차표엔 근무로 들어가 있는 상태 — 현장에서 그대로 사고가 된다.
 * W1 짧은 휴식 — 오후 근무 뒤 다음날 오전 근무. 여객자동차 운수사업법
 *   시행규칙 제44조의6: 퇴근 전 마지막 운행 종료 ~ 다음 출근 첫 운행 사이
 *   8시간(광역급행·직행좌석 10시간) 이상 보장 — 이 조합이 그 간격을 위협한다.
 * W2 주말휴무 부족 — 한 달 동안 토·일 휴무가 정책 하한에 못 미친다.
 *
 * E4·E5·W2 는 [배차 설정]의 헌법 룰 토글(noExpiredLicense /
 * noExpiredQualification / noAssignOnApprovedOff / guaranteedWeekendOff)을
 * 따른다 — 꺼 둔 회사에서는 검사하지 않는다.
 *
 * 연속근무 상한은 [배차 설정]의 헌법 룰 weeklyMaxWorkDays 를 따른다 —
 * 담당자가 설정 화면에서 바꾼 값이 생성(엔진)과 발행 게이트에서 같이 먹어야
 * 하기 때문이다. 정책을 못 읽으면 엔진 기본값(6)으로 검사한다.
 */

/** 폴백 — 엔진 기본값과 동일 (inspector.py: max_consecutive_days=6) */
const DEFAULT_MAX_CONSECUTIVE_DAYS = 6;

/** 검산에 필요한 정책값 — 배차 설정이 단일 소스, 못 읽으면 안전한 기본값 */
interface InspectionPolicy {
  maxConsecutiveDays: number;
  checkExpiredLicense: boolean;
  checkExpiredQualification: boolean;
  checkApprovedOff: boolean;
  minWeekendOff: number; // 0 = 검사 안 함
}

const DEFAULT_INSPECTION_POLICY: InspectionPolicy = {
  maxConsecutiveDays: DEFAULT_MAX_CONSECUTIVE_DAYS,
  checkExpiredLicense: true,
  checkExpiredQualification: true,
  checkApprovedOff: true,
  minWeekendOff: 1,
};

async function inspectionPolicyFor(companyId: number | undefined): Promise<InspectionPolicy> {
  if (!companyId) return DEFAULT_INSPECTION_POLICY;
  try {
    const policy = await loadCompanyPolicy(companyId);
    const c = policy.constitutional;
    const weekly = c?.weeklyMaxWorkDays;
    const weekend = c?.guaranteedWeekendOff;
    return {
      maxConsecutiveDays:
        weekly?.enabled && Number.isFinite(weekly.maxDays)
          ? Math.min(10, Math.max(3, Math.round(weekly.maxDays)))
          : DEFAULT_MAX_CONSECUTIVE_DAYS,
      checkExpiredLicense: c?.noExpiredLicense?.enabled ?? true,
      checkExpiredQualification: c?.noExpiredQualification?.enabled ?? true,
      checkApprovedOff: c?.noAssignOnApprovedOff?.enabled ?? true,
      minWeekendOff: weekend?.enabled ? Math.max(0, Math.round(weekend.minPerMonth ?? 1)) : 0,
    };
  } catch {
    // 정책 로드 실패로 발행 검산을 막지는 않는다
    return DEFAULT_INSPECTION_POLICY;
  }
}

/** 응답에 담는 목록 상한 — 전체 건수는 counts 로 따로 준다 */
const MAX_LIST = 50;

export interface PublishViolation {
  rule: 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'W1' | 'W2';
  severity: 'error' | 'warn';
  /** E2 하위 구분 — 해결 방법이 다르다 */
  kind?: 'UNREGISTERED' | 'VACANT';
  driverId?: number;
  driverName?: string;
  /** E2 — 빈 칸의 차량번호 */
  vehicle?: string;
  shift?: 'MORNING' | 'AFTERNOON';
  /** YYYY-MM-DD — E3는 연속 구간 시작일, W1은 오후 근무일, E2는 그 날 */
  date: string;
  message: string;
}

export interface PublishInspection {
  /** 발행을 막는 위반 (표시용, 최대 MAX_LIST개) */
  errors: PublishViolation[];
  /** 발행을 막지 않는 경고 (표시용, 최대 MAX_LIST개) */
  warnings: PublishViolation[];
  counts: {
    /** 이름조차 없는 빈 칸 */
    vacant: number;
    /** 이름은 있으나 기초 데이터 미등록이라 저장 못 한 칸 */
    unregistered: number;
    consecutive: number;
    shortRest: number;
    /** 면허·자격 만료 상태로 배정된 (기사×사유) 건수 */
    expiredLicense: number;
    /** 승인된 휴무일에 배정된 건수 */
    approvedOff: number;
    /** 월 최소 주말휴무에 못 미치는 기사 수 */
    weekendOff: number;
    /** 이 배차표의 노선 종류와 다른 기사가 배정된 건수 */
    serviceTypeMismatch: number;
  };
}

const SHIFT_KO: Record<string, string> = { MORNING: '오전', AFTERNOON: '오후' };
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const md = (key: string) => key.slice(5).replace('-', '/');
const nextDay = (key: string) => {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return dateKey(d);
};


export async function inspectScheduleForPublish(scheduleId: number): Promise<PublishInspection> {
  // 실제로 운행하는 슬롯만 — 휴무·드랍·결근은 근무가 아니다
  // (발행 게이트의 중복 검사와 같은 술어. 드랍/결근 칸은 E2 에서 '빈 칸'으로 잡힌다)
  const [slots, patterns, schedule] = await Promise.all([
    prisma.scheduleSlot.findMany({
      where: {
        scheduleId,
        isRestDay: false,
        status: { notIn: ['DROPPED', 'ABSENT'] },
      },
      select: {
        driverId: true,
        date: true,
        shift: true,
        busId: true,
        driver: {
          select: {
            name: true, licenseExpiresAt: true, qualificationExpiresAt: true,
            serviceType: true,
          },
        },
      },
    }),
    // 그날 운행해야 하는 (날짜×차량) — 패턴 우선, 없으면 활성 차량×전일
    operatingCells(scheduleId),
    prisma.schedule.findUnique({
      where: { id: scheduleId },
      select: { notes: true, companyId: true, year: true, month: true, serviceType: true },
    }),
  ]);

  // 검산 기준 — 배차 설정(헌법 룰)이 단일 소스
  const pol = await inspectionPolicyFor(schedule?.companyId);
  const maxConsecutiveDays = pol.maxConsecutiveDays;

  // 승인된 휴무 (기사ID|날짜) — 이 달 것만. 기사앱엔 '승인'인데 배차표엔
  // 근무로 남아 있는 상태를 잡는다.
  const approvedOff = new Set<string>();
  if (pol.checkApprovedOff && schedule?.companyId && schedule.year && schedule.month) {
    const from = new Date(Date.UTC(schedule.year, schedule.month - 1, 1));
    const to = new Date(Date.UTC(schedule.year, schedule.month, 1));
    const offs = await prisma.dayOffRequest.findMany({
      where: {
        companyId: schedule.companyId,
        status: 'APPROVED',
        date: { gte: from, lt: to },
      },
      select: { driverId: true, date: true },
    });
    for (const o of offs) approvedOff.add(`${o.driverId}|${dateKey(o.date)}`);
  }

  const errors: PublishViolation[] = [];
  const warnings: PublishViolation[] = [];
  const counts = {
    vacant: 0, unregistered: 0, consecutive: 0, shortRest: 0,
    expiredLicense: 0, approvedOff: 0, weekendOff: 0, serviceTypeMismatch: 0,
  };

  // 기사별 근무일 집합 + (기사, 날짜)별 시프트 집합 + (날짜, 차량, 시프트) 채움 여부
  const workDays = new Map<number, Set<string>>();
  const shiftsOn = new Map<string, Set<string>>(); // "driverId|date" → shifts
  const nameOf = new Map<number, string>();
  const filledCell = new Set<string>(); // "date|busId|shift"
  for (const s of slots) {
    const dk = dateKey(s.date);
    nameOf.set(s.driverId, s.driver.name);
    if (!workDays.has(s.driverId)) workDays.set(s.driverId, new Set());
    workDays.get(s.driverId)!.add(dk);
    const key = `${s.driverId}|${dk}`;
    if (!shiftsOn.has(key)) shiftsOn.set(key, new Set());
    // 종일(FULL_DAY)은 오전+오후 둘 다로 취급 — 보수적으로 검사한다
    const shifts = s.shift === 'FULL_DAY' ? ['MORNING', 'AFTERNOON'] : [s.shift];
    for (const sh of shifts) {
      shiftsOn.get(key)!.add(sh);
      if (s.busId != null) filledCell.add(`${dk}|${s.busId}|${sh}`);
    }
  }

  // ── E2 빈 자리 — 운행 차량인데 기사가 없는 칸 ──
  const meta = parseScheduleMeta(schedule?.notes ?? null);
  const unmatchedCells = (meta.unmatchedCells ?? {}) as Record<string, string>;
  for (const p of patterns) {
    const dk = dateKey(p.date);
    const busNo = p.busNumber;
    for (const sh of ['MORNING', 'AFTERNOON'] as const) {
      if (filledCell.has(`${dk}|${p.busId}|${sh}`)) continue;
      const pendingName = unmatchedCells[`${dk}|${busNo}|${sh}`];
      const kind = pendingName ? 'UNREGISTERED' : 'VACANT';
      if (kind === 'UNREGISTERED') counts.unregistered++;
      else counts.vacant++;
      if (errors.length < MAX_LIST) {
        errors.push({
          rule: 'E2',
          severity: 'error',
          kind,
          vehicle: busNo,
          shift: sh,
          date: dk,
          message: pendingName
            ? `${busNo}호 ${md(dk)} ${SHIFT_KO[sh]} — ${pendingName} (기초 데이터 미등록)`
            : `${busNo}호 ${md(dk)} ${SHIFT_KO[sh]} — 배정 없음, 버스가 나갈 수 없습니다`,
        });
      }
    }
  }

  // ── E3 연속근무 — inspector.py 와 동일: 달력상 연속된 근무일 run 이
  // MAX+1 에 도달하는 순간 1건 보고, 빈 날을 만나면 run 리셋 ──
  const consecutive: PublishViolation[] = [];
  for (const [driverId, days] of workDays) {
    const sorted = [...days].sort();
    let run: string[] = [];
    let cursor = sorted[0];
    const end = sorted[sorted.length - 1];
    while (cursor <= end) {
      if (days.has(cursor)) run.push(cursor);
      else run = [];
      if (run.length === maxConsecutiveDays + 1) {
        counts.consecutive++;
        consecutive.push({
          rule: 'E3',
          severity: 'error',
          driverId,
          driverName: nameOf.get(driverId) ?? `기사#${driverId}`,
          date: run[0],
          message:
            `${nameOf.get(driverId)} — ${md(run[0])}부터 ` +
            `연속 ${maxConsecutiveDays + 1}일 근무. 중간에 휴무를 넣어야 합니다.`,
        });
      }
      cursor = nextDay(cursor);
    }
  }

  // 심각도 순으로 목록 앞자리를 다투는 위반들 — 공석(E2)에 밀려 안 보이면 안 된다
  const expired: PublishViolation[] = [];
  const onApprovedOff: PublishViolation[] = [];

  // ── E4 면허·자격 만료 — 만료일이 지난 날짜에 배정 (무면허 운행) ──
  // 기사×사유 단위로 1건만 보고한다. 한 사람이 20일 배정돼 있다고 20줄이
  // 뜨면 정작 다른 위반이 목록에서 밀려난다.
  if (pol.checkExpiredLicense || pol.checkExpiredQualification) {
    const firstBad = new Map<string, { driverId: number; label: string; date: string; until: string }>();
    for (const s of slots) {
      const dk = dateKey(s.date);
      const checks: [boolean, Date | null, string][] = [
        [pol.checkExpiredLicense, s.driver.licenseExpiresAt, '운전면허'],
        [pol.checkExpiredQualification, s.driver.qualificationExpiresAt, '버스운전자격'],
      ];
      for (const [enabled, expiry, label] of checks) {
        if (!enabled || !expiry) continue;
        const until = dateKey(expiry);
        if (dk <= until) continue; // 만료일 당일까지는 유효
        const key = `${s.driverId}|${label}`;
        const prev = firstBad.get(key);
        if (!prev || dk < prev.date) {
          firstBad.set(key, { driverId: s.driverId, label, date: dk, until });
        }
      }
    }
    for (const v of firstBad.values()) {
      counts.expiredLicense++;
      expired.push({
        rule: 'E4',
        severity: 'error',
        driverId: v.driverId,
        driverName: nameOf.get(v.driverId) ?? `기사#${v.driverId}`,
        date: v.date,
        message:
          `${nameOf.get(v.driverId)} — ${v.label}이 ${v.until} 만료인데 ` +
          `${md(v.date)}부터 배정돼 있습니다. 갱신 확인 전에는 배차할 수 없습니다.`,
      });
    }
  }

  // ── E5 승인 휴무 배정 — 회사가 승인한 휴무일인데 근무로 들어가 있다 ──
  if (approvedOff.size > 0) {
    for (const s of slots) {
      const dk = dateKey(s.date);
      if (!approvedOff.has(`${s.driverId}|${dk}`)) continue;
      counts.approvedOff++;
      if (onApprovedOff.length < MAX_LIST) {
        onApprovedOff.push({
          rule: 'E5',
          severity: 'error',
          driverId: s.driverId,
          driverName: s.driver.name,
          date: dk,
          message:
            `${s.driver.name} — ${md(dk)}은 승인된 휴무일인데 배정돼 있습니다. ` +
            `기사앱에는 '승인'으로 표시됩니다.`,
        });
      }
    }
  }

  // ── E6 노선 종류 불일치 — 간선 배차표에 지선 기사가 들어가 있다 ──
  // 생성·셀편집·공석채우기가 모두 종류로 걸러내지만, 기사의 종류를 나중에
  // 바꾸면 이미 저장된 배차표가 어긋난다. 발행이 마지막 방어선이다.
  const serviceMismatch: PublishViolation[] = [];
  if (schedule?.serviceType) {
    const seen = new Set<number>();
    for (const s of slots) {
      const ds = s.driver.serviceType;
      if (!ds || ds === schedule.serviceType) continue;
      counts.serviceTypeMismatch++;
      if (seen.has(s.driverId)) continue; // 기사당 한 번만 보고 — 한 달치가 다 걸린다
      seen.add(s.driverId);
      if (serviceMismatch.length < MAX_LIST) {
        serviceMismatch.push({
          rule: 'E6',
          severity: 'error',
          driverId: s.driverId,
          driverName: s.driver.name,
          date: dateKey(s.date),
          message:
            `${s.driver.name} — ${serviceTypeLabel(ds)} 기사인데 ` +
            `${serviceTypeLabel(schedule.serviceType)} 배차표에 배정돼 있습니다. ` +
            '기사의 노선 종류를 고치거나 이 칸을 비워주세요.',
        });
      }
    }
  }

  // ── W2 주말휴무 부족 — 토·일 중 쉬는 날이 정책 하한에 못 미친다 ──
  if (pol.minWeekendOff > 0 && schedule?.year && schedule.month) {
    const weekendDays: string[] = [];
    const cursorDate = new Date(Date.UTC(schedule.year, schedule.month - 1, 1));
    while (cursorDate.getUTCMonth() === schedule.month - 1) {
      const dow = cursorDate.getUTCDay();
      if (dow === 0 || dow === 6) weekendDays.push(dateKey(cursorDate));
      cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
    }
    for (const [driverId, days] of workDays) {
      const off = weekendDays.filter((d) => !days.has(d)).length;
      if (off >= pol.minWeekendOff) continue;
      counts.weekendOff++;
      if (warnings.length < MAX_LIST) {
        warnings.push({
          rule: 'W2',
          severity: 'warn',
          driverId,
          driverName: nameOf.get(driverId) ?? `기사#${driverId}`,
          date: weekendDays[0] ?? `${schedule.year}-${String(schedule.month).padStart(2, '0')}-01`,
          message:
            `${nameOf.get(driverId)} — 이 달 주말 휴무 ${off}일. ` +
            `정책 하한 ${pol.minWeekendOff}일에 못 미칩니다.`,
        });
      }
    }
  }

  // ── W1 짧은 휴식 — 오후 근무 다음날 오전 근무 (퇴근~출근 8시간 위협) ──
  for (const [key, shifts] of shiftsOn) {
    if (!shifts.has('AFTERNOON')) continue;
    const [driverIdStr, dk] = key.split('|');
    const driverId = Number(driverIdStr);
    const nk = nextDay(dk);
    if (shiftsOn.get(`${driverId}|${nk}`)?.has('MORNING')) {
      counts.shortRest++;
      if (warnings.length < MAX_LIST) {
        warnings.push({
          rule: 'W1',
          severity: 'warn',
          driverId,
          driverName: nameOf.get(driverId) ?? `기사#${driverId}`,
          date: dk,
          message:
            `${nameOf.get(driverId)} — ${md(dk)} 오후 근무 뒤 ${md(nk)} 오전 근무. ` +
            `늦은 퇴근 뒤 새벽 출근으로 연속 휴식 8시간(법 제44조의6)이 위협받습니다.`,
        });
      }
    }
  }

  const byDate = (a: PublishViolation, b: PublishViolation) =>
    a.date === b.date
      ? (a.driverName ?? a.vehicle ?? '').localeCompare(b.driverName ?? b.vehicle ?? '', 'ko')
      : a.date.localeCompare(b.date);

  // 위험한 순서대로 앞에 놓는다 — 무면허(E4) > 과로(E3) > 승인휴무 무시(E5) >
  // 공석(E2). 목록은 MAX_LIST 에서 잘리므로 순서가 곧 '무엇을 먼저 보여줄까'다.
  expired.sort(byDate);
  consecutive.sort(byDate);
  onApprovedOff.sort(byDate);
  serviceMismatch.sort(byDate);
  errors.sort(byDate);
  const merged = [
    ...expired, ...consecutive, ...onApprovedOff, ...serviceMismatch, ...errors,
  ].slice(0, MAX_LIST);
  warnings.sort(byDate);

  return { errors: merged, warnings, counts };
}
