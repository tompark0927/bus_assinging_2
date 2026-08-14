import { prisma } from '../utils/prisma';
import { parseScheduleMeta } from './vehicleOffService';
import { operatingCells } from './operatingPlanService';

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
 * W1 짧은 휴식 — 오후 근무 뒤 다음날 오전 근무. 여객자동차 운수사업법
 *   시행규칙 제44조의6: 퇴근 전 마지막 운행 종료 ~ 다음 출근 첫 운행 사이
 *   8시간(광역급행·직행좌석 10시간) 이상 보장 — 이 조합이 그 간격을 위협한다.
 *
 * 정책값은 엔진 기본값과 동일한 상수로 시작한다. 회사별 커스텀이 필요해지면
 * CompanyRule 로 옮긴다.
 */

/** 엔진 기본값과 동일 (inspector.py: max_consecutive_days=6) */
const MAX_CONSECUTIVE_DAYS = 6;

/** 응답에 담는 목록 상한 — 전체 건수는 counts 로 따로 준다 */
const MAX_LIST = 50;

export interface PublishViolation {
  rule: 'E2' | 'E3' | 'W1';
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
        driver: { select: { name: true } },
      },
    }),
    // 그날 운행해야 하는 (날짜×차량) — 패턴 우선, 없으면 활성 차량×전일
    operatingCells(scheduleId),
    prisma.schedule.findUnique({ where: { id: scheduleId }, select: { notes: true } }),
  ]);

  const errors: PublishViolation[] = [];
  const warnings: PublishViolation[] = [];
  const counts = { vacant: 0, unregistered: 0, consecutive: 0, shortRest: 0 };

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
      if (run.length === MAX_CONSECUTIVE_DAYS + 1) {
        counts.consecutive++;
        consecutive.push({
          rule: 'E3',
          severity: 'error',
          driverId,
          driverName: nameOf.get(driverId) ?? `기사#${driverId}`,
          date: run[0],
          message:
            `${nameOf.get(driverId)} — ${md(run[0])}부터 ` +
            `연속 ${MAX_CONSECUTIVE_DAYS + 1}일 근무. 중간에 휴무를 넣어야 합니다.`,
        });
      }
      cursor = nextDay(cursor);
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

  // 연속근무는 건수가 적고 위험도가 높아 목록 앞쪽에 오도록 합친다
  consecutive.sort(byDate);
  errors.sort(byDate);
  const merged = [...consecutive, ...errors].slice(0, MAX_LIST);
  warnings.sort(byDate);

  return { errors: merged, warnings, counts };
}
