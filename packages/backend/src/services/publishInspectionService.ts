import { prisma } from '../utils/prisma';

/**
 * 발행 전 법규 검산 — 저장된 배차표(ScheduleSlot)를 직접 검사한다.
 *
 * 규칙은 엔진 inspector.py 의 E3/W1 과 동일한 시맨틱이다. 엔진의 검산은
 * 업로드한 엑셀에만 돌기 때문에, 담당자가 앱 안에서 고친 최종본이 법규를
 * 어겨도 아무도 모른 채 발행되던 구멍을 여기서 막는다. (발행 게이트가
 * 엔진 프로세스에 의존하면 엔진 장애 = 발행 불가가 되므로, 네트워크 호출
 * 없이 백엔드 안에서 검사한다.)
 *
 * 법적 근거 — 여객자동차 운수사업법 시행규칙 제44조의6(운수종사자의
 * 휴식시간 보장): 퇴근 전 마지막 운행 종료 ~ 다음 출근 첫 운행 사이
 * 8시간(광역급행·직행좌석 10시간) 이상 보장. 오후 근무 뒤 다음날 오전
 * 근무(W1)가 바로 이 간격을 위협하는 조합이다. 연속 근무일 제한(E3)은
 * 주 52시간제(노선버스 특례 제외)의 실무 안전선이다.
 *
 * 정책값은 엔진 기본값과 동일한 상수로 시작한다. 회사별 커스텀이 필요해지면
 * CompanyRule 로 옮긴다.
 */

/** 엔진 기본값과 동일 (inspector.py: max_consecutive_days=6) */
const MAX_CONSECUTIVE_DAYS = 6;

export interface PublishViolation {
  rule: 'E3' | 'W1';
  severity: 'error' | 'warn';
  driverId: number;
  driverName: string;
  /** YYYY-MM-DD — E3는 연속 구간 시작일, W1은 오후 근무일 */
  date: string;
  message: string;
}

export interface PublishInspection {
  errors: PublishViolation[];
  warnings: PublishViolation[];
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const nextDay = (key: string) => {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return dateKey(d);
};

export async function inspectScheduleForPublish(scheduleId: number): Promise<PublishInspection> {
  // 실제로 운행하는 슬롯만 — 휴무·드랍·결근은 근무가 아니다
  // (발행 게이트의 중복 검사와 같은 술어)
  const slots = await prisma.scheduleSlot.findMany({
    where: {
      scheduleId,
      isRestDay: false,
      status: { notIn: ['DROPPED', 'ABSENT'] },
    },
    select: {
      driverId: true,
      date: true,
      shift: true,
      driver: { select: { name: true } },
    },
  });

  const errors: PublishViolation[] = [];
  const warnings: PublishViolation[] = [];

  // 기사별 근무일 집합 + (기사, 날짜)별 시프트 집합
  const workDays = new Map<number, Set<string>>();
  const shiftsOn = new Map<string, Set<string>>(); // "driverId|date" → shifts
  const nameOf = new Map<number, string>();
  for (const s of slots) {
    const dk = dateKey(s.date);
    nameOf.set(s.driverId, s.driver.name);
    if (!workDays.has(s.driverId)) workDays.set(s.driverId, new Set());
    workDays.get(s.driverId)!.add(dk);
    const key = `${s.driverId}|${dk}`;
    if (!shiftsOn.has(key)) shiftsOn.set(key, new Set());
    // 종일(FULL_DAY)은 오전+오후 둘 다로 취급 — 보수적으로 검사한다
    if (s.shift === 'FULL_DAY') {
      shiftsOn.get(key)!.add('MORNING').add('AFTERNOON');
    } else {
      shiftsOn.get(key)!.add(s.shift);
    }
  }

  // ── E3 연속근무 — inspector.py 와 동일: 달력상 연속된 근무일 run 이
  // MAX+1 에 도달하는 순간 1건 보고, 빈 날을 만나면 run 리셋 ──
  for (const [driverId, days] of workDays) {
    const sorted = [...days].sort();
    let run: string[] = [];
    let cursor = sorted[0];
    const end = sorted[sorted.length - 1];
    while (cursor <= end) {
      if (days.has(cursor)) {
        run.push(cursor);
      } else {
        run = [];
      }
      if (run.length === MAX_CONSECUTIVE_DAYS + 1) {
        errors.push({
          rule: 'E3',
          severity: 'error',
          driverId,
          driverName: nameOf.get(driverId) ?? `기사#${driverId}`,
          date: run[0],
          message:
            `${nameOf.get(driverId)} — ${run[0].slice(5).replace('-', '/')}부터 ` +
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
      warnings.push({
        rule: 'W1',
        severity: 'warn',
        driverId,
        driverName: nameOf.get(driverId) ?? `기사#${driverId}`,
        date: dk,
        message:
          `${nameOf.get(driverId)} — ${dk.slice(5).replace('-', '/')} 오후 근무 뒤 ` +
          `${nk.slice(5).replace('-', '/')} 오전 근무. 늦은 퇴근 뒤 새벽 출근으로 ` +
          `연속 휴식 8시간(법 제44조의6)이 위협받는 조합입니다.`,
      });
    }
  }

  errors.sort((a, b) => (a.date === b.date ? a.driverName.localeCompare(b.driverName, 'ko') : a.date.localeCompare(b.date)));
  warnings.sort((a, b) => (a.date === b.date ? a.driverName.localeCompare(b.driverName, 'ko') : a.date.localeCompare(b.date)));
  return { errors, warnings };
}
