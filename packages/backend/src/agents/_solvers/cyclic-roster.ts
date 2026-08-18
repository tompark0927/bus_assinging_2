/**
 * 순환 근무표(cyclic roster) 구성 — 2단계 방식.
 *
 * 기존 그리디는 하루씩 순서대로 "오늘 이 칸에 누가 제일 적합한가"를 점수로
 * 골랐다. 오늘 넣을 때 그 사람의 남은 한 달이 어떻게 될지 모르니, 긴 근무
 * 블록과 시프트 일관성 중 한쪽만 지킬 수 있었다. 성민버스 실데이터(108명·
 * 42대·2026년 7월) 측정: 연속일 시프트 전환 12.0%, 메인 84명 중 45%만
 * 모든 블록이 단일 시프트, 오후→다음날 오전(법 제44조의6 연속 휴식 8시간을
 * 위협하는 조합) 110건.
 *
 * 이 모듈은 순서를 뒤집는다.
 *
 *   1단계 — "누가 며칠 일하고 며칠 쉬나"를 먼저 확정한다.
 *            근무 블록 3~5일(5일 우선) · 휴무 블록 2~5일.
 *            짝꿍 2명은 한 덩어리로 움직인다(같은 날 근무, 시프트만 반대).
 *   2단계 — 확정된 패턴 위에 시프트를 얹는다.
 *            블록 하나에 시프트 하나, 다음 블록은 뒤집기.
 *            → 연속 근무일 안에서 시프트가 바뀌는 일이 **구조적으로** 없다.
 *
 * 같은 데이터로 측정한 결과(2026년 7월, 실제 생성 출력):
 *   연속일 시프트 전환   12.0% → 0.0%      (0/1598)
 *   메인 전 블록 단일시프트 45% → 100%     (84/84)
 *   5일 근무 블록        218개 → 306개
 *   오후→다음날 오전     110건 → 0건       (법 제44조의6)
 *   고정차 승무율         38% → 100%
 *   근무일수 분포        16~23일 → 18~22일 (하드 위반 0)
 *   공석                 0 유지
 *
 * 한계도 적어둔다. 근무 블록이 1~2일로 짧게 끊기는 자리가 아직 남는다
 * (1일 56 · 2일 80). 그날 그 차가 안 나가면(운행 계획상 감차) 그 짝꿍도
 * 강제로 쉬어야 하는데, 그 날짜가 블록 한가운데 떨어지면 블록이 쪼개지기
 * 때문이다. 블록 시작 시점에 "다음 감차까지 며칠 남았나"를 보고 고르는
 * 것으로 상당 부분 줄였지만(1일 블록 62→52), 감차 날짜 자체를 휴무와 함께
 * 정하지 않는 한 완전히 없앨 수는 없다. 운행 계획의 차량 지정은 정비·운휴
 * 같은 실제 의미를 담을 수 있어 솔버가 덮어쓰지 않는다.
 *
 * 참고: Er-Rbib et al.(2021) 의 2단계 구성("first making a day-off pattern and
 * second placing daily shifts under the constraint of the day-off pattern"),
 * Optibus·Trapeze 의 roster line 방식.
 */

import {
  checkAssignment,
  formatDate,
  isWeekend,
  parseDate,
  wouldViolateGridRules,
  type ConstraintContext,
} from './constraints';
import type {
  AssignedSlot,
  CompanyPolicy,
  Familiarity,
  SolverBus,
  SolverCrew,
  SolverDriver,
  UnfilledSlot,
} from './types';

/**
 * 블록 길이 규칙은 회사 정책(restCycle·workdayBands)에서 뽑는다.
 *
 * 5/2 를 상수로 박아두면 마을버스(6/1)나 근무일 상한이 다른 회사에서 조용히
 * 어긋난다. 특히 상한을 안 보면 인력이 모자랄 때 "쉬는 날 없이 26일 근무"
 * 같은 배차를 만들어내고도 공석 0 이라고 보고하게 된다 — 그게 제일 나쁘다.
 * 채울 사람이 정말 없으면 그 칸은 공석으로 남겨 인력 부족을 드러내야 한다.
 */
interface CycleRules {
  /** 근무 블록 최소 길이 (수요가 줄면 여기까지 짧아진다) */
  minWork: number;
  /** 근무 블록 최대 길이 = restCycle.workDays */
  maxWork: number;
  /** 휴무 블록 최소 길이 = restCycle.restDays */
  minRest: number;
  /** 휴무 블록 최대 길이 */
  maxRest: number;
  /** 한 달 근무일 상한 = workdayBands.hardMax */
  maxTotalWork: number;
  /** 무페널티 상한 = workdayBands.sweetMax. 블록 하루 연장을 허용할 선. */
  sweetMaxWork: number;
}

function cycleRulesFor(policy: CompanyPolicy, extraRest = 0): CycleRules {
  const maxWork = Math.max(1, policy.restCycle.workDays);
  const minRest = Math.max(1, policy.restCycle.restDays);
  return {
    minWork: Math.min(3, maxWork),
    maxWork,
    minRest,
    maxRest: minRest + 3 + extraRest,
    maxTotalWork: policy.workdayBands.hardMax,
    sweetMaxWork: policy.workdayBands.sweetMax,
  };
}

/**
 * 스페어 조는 주말 수요가 크게 줄어 더 길게 쉴 수 있어야 근무일수가 맞는다.
 * (평일 9조 → 일요일 3조. 상한이 짧으면 억지로 불려나와 편차가 벌어진다)
 */
const SPARE_EXTRA_REST = 3;
/** 한 번 세운 차는 이틀 이상 붙여 세운다 */
const BUS_REST_MIN_DAYS = 2;

export interface CyclicRosterArgs {
  /** 그 달의 날짜 (YYYY-MM-DD, 오름차순) */
  days: string[];
  drivers: SolverDriver[];
  buses: SolverBus[];
  crews: SolverCrew[];
  policy: CompanyPolicy;
  /** 배정하면서 갱신된다 — 이후 단계(메트릭·로컬서치)가 그대로 쓴다 */
  ctx: ConstraintContext;
}

export interface CyclicRosterResult {
  slots: AssignedSlot[];
  unfilled: UnfilledSlot[];
  /** 날짜 → 감차 차량 IDs. 호출자가 SchedulePattern(operating:false)으로 저장한다. */
  restingByDate: Map<string, number[]>;
}

/**
 * 이 방식으로 짤 수 있는 입력인가.
 *
 * 2교대 + 짝꿍(2인 1차) 구조에 맞춰 설계했다. 1교대·격일제·3교대나 단독
 * 승무는 기존 그리디가 담당한다 — 억지로 끼워 맞추면 조용히 나쁜 배차가 나온다.
 */
export function supportsCyclicRoster(policy: CompanyPolicy, crews: SolverCrew[]): boolean {
  if (policy.shiftSystem.kind !== 'TWO_SHIFT') return false;
  if (policy.crewModel.kind !== 'PAIR') return false;
  if (crews.length === 0) return false;
  if (!crews.every((c) => c.driverIds.length === 2)) return false;
  // 야간 연속 제한(noNightStreak)을 오전/오후에 걸어둔 회사는 이 방식과 맞지
  // 않는다. "한 블록 = 한 시프트"가 곧 '연속 N일 같은 시프트'라, 상한이 블록
  // 길이보다 짧으면 블록을 쪼개야 한다 — 그건 그리디가 하는 일이다.
  const night = policy.constitutional?.noNightStreak;
  if (night?.enabled && night.nightShifts.some((sh) => sh === 'AM' || sh === 'PM')) return false;
  return true;
}

// ─────────────────────────────────────────────
// 1단계 — 근무/휴무 패턴
// ─────────────────────────────────────────────

interface LineOptions {
  /** 그날 근무해야 하는 유닛 수 */
  demand: number[];
  /** 시작 위상을 흩뜨리는 값 — 전원이 같은 날 쉬지 않게 한다 */
  seed: number;
  cycle: CycleRules;
  /** forcedRest[i][d] = true 면 유닛 i 는 그날 반드시 쉰다 */
  forcedRest?: boolean[][];
  /**
   * 헌법 룰 중 시프트와 무관한 두 가지를 패턴 단계에서 하드 제약으로 건다.
   * 나중에 고치는 게 아니라 애초에 어기지 않는 패턴을 만드는 편이 안전하다 —
   * 사후 수정은 5일 블록을 부수고, 부순 자리를 또 누군가로 메워야 한다.
   */
  grid?: {
    /** 날짜 → 주 인덱스 (일요일 시작, validateFullGrid 와 같은 기준) */
    weekOfDay: number[];
    /** 날짜 → 주말 여부 */
    isWeekendDay: boolean[];
    /** 주간 최대 근무일 (weeklyMaxWorkDays) */
    maxPerWeek?: number;
    /** 월 최소 주말 휴무일 (guaranteedWeekendOff) */
    minWeekendOff?: number;
  };
}

/**
 * units 개의 근무선을 만든다.
 *
 * 매일 정확히 demand[d] 개 유닛이 근무하도록 맞추는 것이 최우선이다 —
 * 어긋난 만큼 그대로 공석(= 버스가 안 나감)이 되기 때문이다. 그 제약
 * 안에서 블록을 최대한 5일로 길게, 휴무를 최대한 붙여서 준다.
 */
export function buildLines(units: number, opts: LineOptions): boolean[][] {
  const { demand, seed, cycle } = opts;
  const { minWork: MIN_WORK, maxWork: MAX_WORK, minRest: MIN_REST, maxRest } = cycle;
  const days = demand.length;
  const mode: ('WORK' | 'REST')[] = new Array(units).fill('REST');
  // 시작 위상을 다르게 — 전부 같은 날 블록을 시작하면 휴무가 한 날에 몰린다
  const runLen = Array.from({ length: units }, (_, i) => MIN_REST + ((i * 3 + seed) % (maxRest - MIN_REST + 1)));
  const worked = new Array(units).fill(0);
  const sched: boolean[][] = Array.from({ length: units }, () => new Array(days).fill(false));

  // 강제 휴무(그날 그 차가 안 나감)까지 남은 날 — 블록을 시작할 때 미리 본다.
  // 이걸 안 보고 시작하면 이틀 만에 차가 서서 근무 블록이 하루·이틀로 쪼개진다.
  const headroom: number[][] = Array.from({ length: units }, () => new Array(days).fill(days));
  if (opts.forcedRest) {
    for (let i = 0; i < units; i++) {
      let next = days;
      for (let d = days - 1; d >= 0; d--) {
        headroom[i][d] = opts.forcedRest[i][d] ? 0 : next;
        if (opts.forcedRest[i][d]) next = 0;
        next++;
      }
    }
  }

  // 이 인원으로 휴무 사이클을 지키며 매일 감당 가능한 최대치.
  // 수요가 이걸 넘으면 구조적인 인력 부족이라, 블록을 늘려 덮으면 안 된다.
  const sustainable = Math.ceil((units * MAX_WORK) / (MAX_WORK + MIN_REST));

  const grid = opts.grid;
  const nWeeks = grid ? Math.max(0, ...grid.weekOfDay) + 1 : 0;
  const weekWork: number[][] = Array.from({ length: units }, () => new Array(nWeeks).fill(0));
  const weekendOff = new Array(units).fill(0);
  // 오늘 포함 남은 주말 일수 — "이제부터 다 일하면 주말 휴무를 못 채운다"는
  // 마감을 계산하는 데 쓴다
  const weekendLeft = new Array(days).fill(0);
  if (grid) {
    let acc = 0;
    for (let d = days - 1; d >= 0; d--) {
      if (grid.isWeekendDay[d]) acc++;
      weekendLeft[d] = acc;
    }
  }

  for (let d = 0; d < days; d++) {
    const forced = (i: number) => {
      if (opts.forcedRest?.[i]?.[d] === true) return true;
      // 근무일 상한을 넘겨가며 채우지 않는다 — 넘긴 배차는 그 자체로 위반이고,
      // 남는 칸은 공석으로 드러나야 인력이 모자라다는 사실이 보인다.
      if (worked[i] >= cycle.maxTotalWork) return true;
      if (!grid) return false;
      if (grid.maxPerWeek !== undefined && weekWork[i][grid.weekOfDay[d]] >= grid.maxPerWeek) return true;
      if (grid.minWeekendOff !== undefined && grid.isWeekendDay[d]) {
        const stillNeed = grid.minWeekendOff - weekendOff[i];
        // 남은 주말이 필요한 휴무 수와 같아지면 오늘부터는 무조건 쉬어야 한다
        if (stillNeed > 0 && weekendLeft[d] <= stillNeed) return true;
      }
      return false;
    };
    // 주말 휴무를 아직 못 채운 유닛은 주말에 되도록 쉬게 한다.
    // 마감(남은 주말 = 남은 필요 휴무)까지 미루면 마지막 주말에 인원이
    // 한꺼번에 빠져 그날 버스가 못 나간다.
    const needsWeekend = (i: number) =>
      grid?.minWeekendOff !== undefined && grid.isWeekendDay[d] && weekendOff[i] < grid.minWeekendOff
        ? 1
        : 0;
    const pick = (test: (i: number) => boolean) => {
      const out: number[] = [];
      for (let i = 0; i < units; i++) if (!forced(i) && test(i)) out.push(i);
      return out;
    };

    const mustWork = pick((i) => mode[i] === 'WORK' && runLen[i] < MIN_WORK);
    const canContinue = pick((i) => mode[i] === 'WORK' && runLen[i] >= MIN_WORK && runLen[i] < MAX_WORK);
    const forcedIn = pick((i) => mode[i] === 'REST' && runLen[i] >= maxRest);
    const canStart = pick((i) => mode[i] === 'REST' && runLen[i] >= MIN_REST && runLen[i] < maxRest);
    const mustRest = pick((i) => mode[i] === 'REST' && runLen[i] < MIN_REST);

    const today = new Set<number>([...mustWork, ...forcedIn]);
    const short = () => demand[d] - today.size;

    // ① 진행 중인 블록을 이어 5일을 채우는 쪽이 먼저 (짧게 끊긴 블록 우선)
    if (short() > 0) {
      for (const i of [...canContinue].sort((a, b) => runLen[a] - runLen[b] || a - b).slice(0, short())) {
        today.add(i);
      }
    }
    // ② 모자라면 새 블록 — 근무일수가 적고 오래 쉰 유닛부터 (공정성)
    if (short() > 0) {
      // 5일을 채울 여유가 있는 쪽부터 — 여유가 같으면 근무일수가 적고 오래 쉰 쪽
      const room = (i: number) => Math.min(headroom[i][d], MAX_WORK);
      const order = [...canStart].sort(
        (a, b) =>
          needsWeekend(a) - needsWeekend(b) ||
          worked[a] - worked[b] ||
          room(b) - room(a) ||
          runLen[b] - runLen[a] ||
          a - b,
      );
      for (const i of order.slice(0, short())) today.add(i);
    }
    // ③ 최후 수단 — 휴무 이틀을 못 채운 사람을 하루 만에 부른다.
    //    하루 휴무도 위법은 아니지만 공석보다 나을 때만 쓴다.
    if (short() > 0) {
      const order = [...mustRest].sort((a, b) => worked[a] - worked[b] || a - b);
      for (const i of order.slice(0, short())) today.add(i);
    }
    // ④ 그래도 모자라면 근무 블록을 하루만 늘린다.
    //    블록이 여러 유닛에서 같은 날 한꺼번에 끝나면(휴무 사이클이 맞물리면)
    //    그날만 공급이 뚝 떨어진다. 하루 연장은 주간 상한(6일) 안이고, 버스가
    //    안 나가는 것보다 낫다. 이 자리에서만 쓰고 다음 날 바로 쉬게 된다.
    if (short() > 0 && demand[d] <= sustainable) {
      //    단, 이미 많이 일한 사람은 늘리지 않는다 — 인력이 정말 모자라서
      //    생긴 구멍이라면 연장으로 덮지 말고 공석으로 드러내야 한다.
      const ext = pick(
        (i) =>
          mode[i] === 'WORK' &&
          runLen[i] >= MAX_WORK &&
          runLen[i] < MAX_WORK + 1 &&
          worked[i] < cycle.sweetMaxWork,
      );
      const order = ext.sort((a, b) => worked[a] - worked[b] || a - b);
      for (const i of order.slice(0, short())) today.add(i);
    }
    // 초과분 — 5일을 이미 채운 쪽부터 뺀다 (블록을 억지로 늘리지 않는다)
    if (today.size > demand[d]) {
      const droppable = [...today]
        .filter((i) => !mustWork.includes(i))
        .sort(
          (a, b) =>
            needsWeekend(b) - needsWeekend(a) ||
            runLen[b] - runLen[a] ||
            worked[b] - worked[a] ||
            a - b,
        );
      for (const i of droppable) {
        if (today.size <= demand[d]) break;
        today.delete(i);
      }
    }

    for (let i = 0; i < units; i++) {
      if (today.has(i)) {
        runLen[i] = mode[i] === 'WORK' ? runLen[i] + 1 : 1;
        mode[i] = 'WORK';
        sched[i][d] = true;
        worked[i]++;
        if (grid) weekWork[i][grid.weekOfDay[d]]++;
      } else {
        runLen[i] = mode[i] === 'REST' ? runLen[i] + 1 : 1;
        mode[i] = 'REST';
        if (grid?.isWeekendDay[d]) weekendOff[i]++;
      }
    }
  }
  return sched;
}

/** 연속 근무 구간 [시작, 끝] 목록 */
export function blocksOf(row: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let d = 0; d < row.length; d++) {
    if (row[d] && start === null) start = d;
    else if (!row[d] && start !== null) {
      out.push([start, d - 1]);
      start = null;
    }
  }
  if (start !== null) out.push([start, row.length - 1]);
  return out;
}

// ─────────────────────────────────────────────
// 전체 구성
// ─────────────────────────────────────────────

export function buildCyclicRoster(args: CyclicRosterArgs): CyclicRosterResult {
  const { days, drivers, buses, crews, policy, ctx } = args;
  const nDays = days.length;
  const monthStart = parseDate(days[0]);
  const monthEnd = parseDate(days[nDays - 1]);

  // 주 인덱스는 validateFullGrid 와 같은 기준(일요일 시작 달력 주)으로 잡는다
  const weekIndex = new Map<string, number>();
  const weekOfDay = days.map((day) => {
    const dt = parseDate(day);
    const ws = new Date(dt);
    ws.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
    const key = formatDate(ws);
    if (!weekIndex.has(key)) weekIndex.set(key, weekIndex.size);
    return weekIndex.get(key)!;
  });
  const gridRules: NonNullable<LineOptions['grid']> = {
    weekOfDay,
    isWeekendDay: days.map((day) => isWeekend(day)),
    maxPerWeek: policy.constitutional?.weeklyMaxWorkDays?.enabled
      ? policy.constitutional.weeklyMaxWorkDays.maxDays
      : undefined,
    minWeekendOff: policy.constitutional?.guaranteedWeekendOff?.enabled
      ? policy.constitutional.guaranteedWeekendOff.minPerMonth
      : undefined,
  };

  const pairCycle = cycleRulesFor(policy);
  const spareCycle = cycleRulesFor(policy, SPARE_EXTRA_REST);

  const crewByBus = new Map<number, SolverCrew>(crews.map((c) => [c.busId, c]));
  const busById = new Map<number, SolverBus>(buses.map((b) => [b.id, b]));
  // 짝꿍이 없는 차는 이 방식으로 굴릴 수 없다 — 기존 솔버와 같이 건너뛴다
  const managed = buses.filter((b) => crewByBus.has(b.id));

  const busesByRoute = new Map<number, SolverBus[]>();
  for (const b of [...managed].sort((x, y) => (x.busNumber ?? '').localeCompare(y.busNumber ?? '', undefined, { numeric: true }) || x.id - y.id)) {
    const arr = busesByRoute.get(b.routeId) ?? [];
    arr.push(b);
    busesByRoute.set(b.routeId, arr);
  }

  /**
   * 운행 계획에서 가져오는 것은 **대수**뿐이다.
   *
   * operatingDates 가 "그날 이 차가 나간다"까지 지정하지만, 그 차량 선택은
   * 노선 설정에 없는 내부 로테이션 결과일 뿐 바깥에서 의미를 갖지 않는다.
   * 반면 **어느 차를 세우는가**는 그 차 짝꿍의 휴무와 맞물려야 한다 —
   * 차가 쉬는 날과 짝꿍이 쉬는 날이 어긋나면 근무 블록이 하루짜리로 쪼개진다
   * (실측: 5일 블록 364→296개, 1일 블록 22→48개). 대수는 정책이고 차량
   * 선택은 배차 결정이라, 대수만 지키고 차량은 여기서 고른다.
   */
  const mayRun = (bus: SolverBus, day: string) => !bus.operatingDates || bus.operatingDates.includes(day);
  /** 노선별 그날 운행 **대수** — 이건 정책이라 그대로 지킨다 */
  const countPerRouteDay = new Map<number, number[]>();
  for (const [routeId, list] of busesByRoute) {
    countPerRouteDay.set(
      routeId,
      days.map((day) => list.filter((b) => mayRun(b, day)).length),
    );
  }

  // ── 스페어 조 편성 ──
  // 짝꿍이 없는 기사 = 스페어. 2인 1조로 묶어 빈 차 하나를 오전·오후 통째로
  // 맡긴다. 개인 단위로 넣으면 같은 차의 오전/오후 짝이 안 맞아 공석이 남는다.
  const crewMembers = new Set<number>(crews.flatMap((c) => c.driverIds));
  const spareIds = drivers.filter((d) => !crewMembers.has(d.id)).map((d) => d.id);
  const spareCrews: [number, number][] = [];
  for (let i = 0; i + 1 < spareIds.length; i += 2) spareCrews.push([spareIds[i], spareIds[i + 1]]);
  /** 조를 못 이룬 나머지 1명 — 예외 메우기(repair)에서만 쓴다 */
  const leftoverSpares = spareIds.length % 2 === 1 ? [spareIds[spareIds.length - 1]] : [];

  // ── 스페어가 맡을 "빈 차" 수를 매일 일정하게 ──
  //
  // 요일마다 운행 대수가 12/11/10 으로 달라진다. 그 변동을 **메인 쌍의 휴무로
  // 흡수**해야 스페어의 일이 고르게 나온다. 변동을 스페어에게 떠넘기면
  // 일요일엔 놀고 평일엔 몰려서 근무일수가 14~24일로 벌어진다(실측).
  //
  //   총 차-일 B = Σ 운행 대수,  짝꿍 P 조 + 스페어 C 조
  //   모두가 B/(P+C) 일씩 일하게 하려면 빈 차 총량 = C × B/(P+C)
  const totalBusDays = [...countPerRouteDay.values()].reduce((s, arr) => s + arr.reduce((a, b) => a + b, 0), 0);
  const nPairs = crews.length;
  const nSpareCrews = spareCrews.length;
  const totalUncovered =
    nSpareCrews === 0 ? 0 : Math.round((totalBusDays * nSpareCrews) / (nPairs + nSpareCrews));

  // 날짜에 고르게 뿌린 뒤 노선별로 나눈다 (합이 정확히 totalUncovered 가 되게)
  const uncovPerDay = spreadEvenly(totalUncovered, nDays);
  const uncovPerRouteDay = new Map<number, number[]>();
  const routeIds = [...busesByRoute.keys()].sort((a, b) => a - b);
  for (const rid of routeIds) uncovPerRouteDay.set(rid, new Array(nDays).fill(0));
  for (let d = 0; d < nDays; d++) {
    let left = uncovPerDay[d];
    // 노선 순서를 날짜마다 돌려가며 나눠 특정 노선에 몰리지 않게 한다
    for (let k = 0; left > 0 && k < routeIds.length * 4; k++) {
      const rid = routeIds[(d + k) % routeIds.length];
      const cap = countPerRouteDay.get(rid)![d];
      const cur = uncovPerRouteDay.get(rid)![d];
      if (cur >= cap) continue;
      uncovPerRouteDay.get(rid)![d] = cur + 1;
      left--;
    }
  }

  // ── 1단계: 노선별 짝꿍 근무선 ──
  const pairLines = new Map<number, boolean[][]>();
  for (const rid of routeIds) {
    const list = busesByRoute.get(rid)!;
    const counts = countPerRouteDay.get(rid)!;
    const uncov = uncovPerRouteDay.get(rid)!;
    pairLines.set(
      rid,
      buildLines(list.length, {
        demand: counts.map((c, d) => Math.max(0, c - uncov[d])),
        seed: rid,
        cycle: pairCycle,
        grid: gridRules,
        // 노선 설정이 그 차를 아예 못 쓰게 한 날(정비·운휴)은 짝꿍도 강제 휴무
        forcedRest: list.map((b) => days.map((day) => !mayRun(b, day))),
      }),
    );
  }

  // ── 감차 결정: 근무하는 쌍의 차는 반드시 운행, 부족분은 쉬는 쌍의 차에서 ──
  const operating = new Map<string, boolean>(); // `${d}|${busId}`
  const uncoveredBuses: number[][] = Array.from({ length: nDays }, () => []);
  const restingByDate = new Map<string, number[]>();
  for (const rid of routeIds) {
    const list = busesByRoute.get(rid)!;
    const lines = pairLines.get(rid)!;
    for (let d = 0; d < nDays; d++) {
      const need = countPerRouteDay.get(rid)![d];
      const run = new Set<number>();
      for (let i = 0; i < list.length; i++) if (lines[i][d]) run.add(i);

      // 복귀 순서 — 한 번 세운 차는 이틀 이상 붙여 세운다.
      //   0 어제 나갔던 차   1 이틀 이상 쉰 차   2 어제 처음 쉰 차(더 쉬게 둔다)
      const restRun = (i: number) => {
        let r = 0;
        for (let k = d - 1; k >= 0 && operating.get(`${k}|${list[i].id}`) === false; k--) r++;
        return r;
      };
      const off = [];
      for (let i = 0; i < list.length; i++) if (!run.has(i)) off.push(i);
      off.sort((a, b) => {
        const rank = (i: number) => {
          if (d === 0 || operating.get(`${d - 1}|${list[i].id}`) !== false) return 0;
          return restRun(i) >= BUS_REST_MIN_DAYS ? 1 : 2;
        };
        return rank(a) - rank(b) || ((a + d) % list.length) - ((b + d) % list.length);
      });
      for (const i of off) {
        if (run.size >= need) break;
        // 노선 설정이 못 쓰게 한 차는 꺼내지 않는다
        if (!mayRun(list[i], days[d])) continue;
        run.add(i);
        uncoveredBuses[d].push(list[i].id);
      }
      for (let i = 0; i < list.length; i++) {
        const on = run.has(i);
        operating.set(`${d}|${list[i].id}`, on);
        if (!on) {
          const arr = restingByDate.get(days[d]) ?? [];
          arr.push(list[i].id);
          restingByDate.set(days[d], arr);
        }
      }
    }
  }

  // ── 2단계: 블록마다 시프트 하나, 짝꿍은 반대, 다음 블록은 뒤집기 ──
  const planned = new Map<string, number>(); // `${d}|${busId}|${shift}` → driverId
  for (const rid of routeIds) {
    const list = busesByRoute.get(rid)!;
    const lines = pairLines.get(rid)!;
    for (let i = 0; i < list.length; i++) {
      const crew = crewByBus.get(list[i].id)!;
      const [x, y] = crew.driverIds;
      blocksOf(lines[i]).forEach(([s, e], k) => {
        const [am, pm] = k % 2 === 0 ? [x, y] : [y, x];
        for (let d = s; d <= e; d++) {
          planned.set(`${d}|${list[i].id}|AM`, am);
          planned.set(`${d}|${list[i].id}|PM`, pm);
        }
      });
    }
  }

  // ── 스페어 조도 같은 리듬으로 — 빈 차를 오전·오후 통째로 ──
  if (nSpareCrews > 0) {
    const spareLines = buildLines(nSpareCrews, {
      demand: uncoveredBuses.map((a) => a.length),
      seed: 9973,
      cycle: spareCycle,
      grid: gridRules,
    });
    const crewOfDay: [number, number][][] = Array.from({ length: nDays }, () => []);
    spareCrews.forEach(([s1, s2], pi) => {
      blocksOf(spareLines[pi]).forEach(([s, e], k) => {
        const [am, pm] = k % 2 === 0 ? [s1, s2] : [s2, s1];
        for (let d = s; d <= e; d++) crewOfDay[d].push([am, pm]);
      });
    });
    for (let d = 0; d < nDays; d++) {
      // 노선·차번 순으로 맞물려 스페어 조가 같은 노선에 머무는 확률을 높인다
      const targets = [...uncoveredBuses[d]].sort((a, b) => {
        const ba = busById.get(a)!, bb = busById.get(b)!;
        return ba.routeId - bb.routeId || a - b;
      });
      targets.forEach((busId, k) => {
        const crew = crewOfDay[d][k];
        if (!crew) return; // 조가 모자라면 아래 repair 가 개별로 메운다
        planned.set(`${d}|${busId}|AM`, crew[0]);
        planned.set(`${d}|${busId}|PM`, crew[1]);
      });
    }
  }

  // ── 확정 + 예외 반영 ──
  // 휴가 승인·면허 만료·사고 노선 같은 개인 사정은 패턴이 알 수 없다.
  // 계획대로 넣되 규칙에 걸리면 그 칸만 비우고, 아래에서 남은 인력으로 메운다.
  const slots: AssignedSlot[] = [];
  const unfilled: UnfilledSlot[] = [];
  const holes: { d: number; busId: number; routeId: number; shift: 'AM' | 'PM'; reason: string }[] = [];
  const driverById = new Map<number, SolverDriver>(drivers.map((d) => [d.id, d]));

  for (let d = 0; d < nDays; d++) {
    for (const bus of managed) {
      if (operating.get(`${d}|${bus.id}`) !== true) continue;
      for (const shift of ['AM', 'PM'] as const) {
        const driverId = planned.get(`${d}|${bus.id}|${shift}`);
        if (driverId === undefined) {
          holes.push({ d, busId: bus.id, routeId: bus.routeId, shift, reason: '계획 미배정' });
          continue;
        }
        const v = checkAssignment(ctx, driverId, days[d], shift, bus.routeId, policy);
        if (v || wouldViolateGridRules(ctx, driverId, days[d], shift, policy, monthStart, monthEnd)) {
          holes.push({ d, busId: bus.id, routeId: bus.routeId, shift, reason: v?.detail ?? '그리드 룰 위반' });
          continue;
        }
        pushSlot(ctx, slots, driverById.get(driverId)!, days[d], bus, shift);
      }
    }
  }

  // ── 빈 칸 메우기 ──
  // 그날 안 나가는 사람 중에서, 앞뒤 블록의 시프트를 지키는 사람을 먼저.
  // 규칙을 어겨야만 채울 수 있는 칸은 비워둔 채 보고한다.
  const candidatePool = [...drivers].sort((a, b) => a.id - b.id);
  for (const h of holes) {
    const day = days[h.d];
    const prev = h.d > 0 ? days[h.d - 1] : null;
    const best = candidatePool
      .filter((drv) => {
        const mine = ctx.driverSlots.get(drv.id) ?? [];
        // 메우기가 근무일 상한을 넘기거나 근무 블록을 정책보다 길게 늘려서는
        // 안 된다. 여기서 막지 않으면 "공석 0" 을 만들려다 과로 배차가 된다 —
        // 정말 사람이 없으면 공석으로 남겨 인력 부족을 드러내는 게 맞다.
        if (mine.length >= policy.workdayBands.hardMax) return false;
        if (streakWith(mine, day, h.d, days) > policy.restCycle.workDays) return false;
        return (
          !checkAssignment(ctx, drv.id, day, h.shift, h.routeId, policy) &&
          !wouldViolateGridRules(ctx, drv.id, day, h.shift, policy, monthStart, monthEnd)
        );
      })
      .map((drv) => {
        const mine = ctx.driverSlots.get(drv.id) ?? [];
        const prevShift = prev ? mine.find((s) => s.date === prev)?.shift : undefined;
        // 0 전날 같은 시프트(블록 유지) · 1 전날 휴무(새 블록) · 2 시프트 뒤집힘
        const keep = prevShift === undefined ? 1 : prevShift === h.shift ? 0 : 2;
        const home = drv.homeBusId === h.busId ? 0 : drv.homeRouteId === h.routeId ? 1 : 2;
        return { drv, keep, home, load: mine.length };
      })
      .sort((a, b) => a.keep - b.keep || a.home - b.home || a.load - b.load || a.drv.id - b.drv.id)[0];

    if (best) {
      pushSlot(ctx, slots, best.drv, day, busById.get(h.busId)!, h.shift);
    } else {
      unfilled.push({ date: day, busId: h.busId, routeId: h.routeId, shift: h.shift, reason: h.reason });
    }
  }

  void leftoverSpares; // 조를 못 이룬 기사는 위 후보 풀에 그대로 들어간다
  return { slots, unfilled, restingByDate };
}

function pushSlot(
  ctx: ConstraintContext,
  slots: AssignedSlot[],
  driver: SolverDriver,
  date: string,
  bus: SolverBus,
  shift: 'AM' | 'PM',
): void {
  const isHomeBus = driver.homeBusId === bus.id;
  const familiarity: Familiarity = isHomeBus
    ? 'HOME'
    : driver.homeRouteId === bus.routeId
      ? 'SAME_ROUTE'
      : 'CROSS_ROUTE';
  const slot: AssignedSlot = {
    date,
    busId: bus.id,
    routeId: bus.routeId,
    shift,
    driverId: driver.id,
    familiarity,
    isHomeBus,
  };
  slots.push(slot);
  const arr = ctx.driverSlots.get(driver.id) ?? [];
  arr.push(slot);
  ctx.driverSlots.set(driver.id, arr);
}

/** dayIdx 를 근무일로 추가했을 때 만들어지는 연속 근무 길이 */
function streakWith(mine: AssignedSlot[], day: string, dayIdx: number, days: string[]): number {
  const worked = new Set(mine.map((s) => s.date));
  if (worked.has(day)) return 0; // 이미 근무 중 — 다른 검사(중복 배정)가 잡는다
  let len = 1;
  for (let k = dayIdx - 1; k >= 0 && worked.has(days[k]); k--) len++;
  for (let k = dayIdx + 1; k < days.length && worked.has(days[k]); k++) len++;
  return len;
}

/** total 을 n 개 날에 최대한 고르게 나눈다 (합 = total) */
function spreadEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  const out = new Array(n).fill(base);
  // 남는 몫을 앞쪽에 몰지 않고 일정 간격으로 뿌린다
  for (let k = 0; k < extra; k++) out[Math.floor((k * n) / extra)]++;
  return out;
}
