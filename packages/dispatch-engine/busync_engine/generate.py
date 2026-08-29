"""배차 생성 오케스트레이터 (생성 모드 E2E).

입력: 과거 로스터(규칙·프로필 추론용) + 회사 정책 + 승인 휴무 + 공휴일.
출력: 월간 배차 초안 + 제약 감사 + 공정성 리포트.

흐름 (스펙 4):
  1단계  그룹별 로테이션 규칙·감차 모델 추론 → 차량-순번 패턴 전개
  2단계  CP-SAT 기사 배정 (정책의 하드/소프트 스위치 반영)
  3단계  감사(H1~H6) → 위반 시 게시 차단, 공정성 리포트 첨부
"""
from __future__ import annotations

import calendar as _calendar
import datetime as dt
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Optional

from .audit import AuditReport, audit
from .config import DayClass, ReductionCalendar, ReductionMode
from .fairness import FairnessReport, build_report
from .importer.inference import (
    RotationRule,
    infer_reduction_model,
    infer_rotation,
    replay_underlying,
    slot_map,
)
from .models import CellState, DayEntry, DepotGroup, MonthlyRoster
from .policy import CompanyPolicy
from .rotation import DisplayMode, PatternMatrix, expand_pattern
from .solver import AssignmentProblem, Assignment, SolverWeights, solve


@dataclass
class GenerationResult:
    roster: MonthlyRoster                  # 생성된 배차표 (렌더러 입력)
    assignment: Assignment
    problem: AssignmentProblem             # 설명(explain)·국소수리(repair) 입력
    audit: AuditReport
    fairness: FairnessReport
    patterns: dict[str, PatternMatrix] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def policy_to_weights(policy: CompanyPolicy) -> SolverWeights:
    strength = int(policy.get("shift_continuity_strength"))
    w = SolverWeights()
    w.keep_shift = max(strength * 8, 1)
    w.swap_after_leave = max(strength * 4, 1)
    w.weekday_pref = 20 if policy.get("weekday_preference_enabled") else 0
    w.vehicle_affinity = 8 if policy.get("spare_affinity_enabled") else 0
    w.group_affinity = 0 if policy.get("spare_cross_group") else 200
    w.fairness_lambda = int(policy.get("fairness_lambda"))
    return w


ROUTE_KEY_RE = re.compile(r"^\s*([0-9A-Za-z가-힣\-]+?)번?(?:\s|$)")


def _route_key(group_name: str) -> str:
    """그룹 이름에서 노선 번호를 뽑는다 — '16번 가좌출발' → '16', '9' → '9'."""
    m = ROUTE_KEY_RE.match(group_name or "")
    return m.group(1) if m else (group_name or "")


def _split(total: int, sizes: list[int]) -> list[int]:
    """운행 대수를 출발지그룹 크기 비율로 나눈다 (최대잉여법).

    남는 1대는 **앞 그룹**이 가져간다. 성민 7월 실측이 그렇다 —
    16번 토요일 11대 = 가좌 6 + 동춘 5 (즉 감차는 뒤 그룹이 더 진다).
    """
    n = sum(sizes)
    if n <= 0:
        return [0] * len(sizes)
    total = max(0, min(total, n))
    base = [total * s // n for s in sizes]
    rem = total - sum(base)
    # 소수부가 큰 순, 같으면 앞 그룹 우선
    order = sorted(range(len(sizes)), key=lambda i: (-((total * sizes[i]) % n), i))
    for i in order[:rem]:
        base[i] += 1
    return base


def _counts_for_group(
    operating_counts: Optional[dict[str, dict[str, int]]],
    groups: list[DepotGroup],
    g: DepotGroup,
) -> tuple[Optional[dict[str, int]], dict[str, int]]:
    """등록된 운행 대수를 이 출발지그룹 몫으로 환산한다.

    기초 데이터의 운행 대수는 **노선 단위**(16번 평일 12대)인데 로테이션과
    감차는 **출발지그룹 단위**(가좌출발 7대 / 동춘출발 7대)로 돈다. 예전에는
    노선 키('16')를 그룹 이름('16번 가좌출발')에서 그대로 찾아서 한 번도
    맞지 않았고, 그래서 감차가 통째로 무시돼 슬롯이 14% 부풀었다.
    (성민 8월 생성본: 그룹당 평일 7대 전부 운행 → 2416칸, 7월 실측은 2112칸.)

    반환: (원본 항목, 이 그룹의 요일별 운행 대수)
    """
    if not operating_counts:
        return None, {}
    oc = operating_counts.get(g.name)
    peers = [g]
    if oc is None:
        key = _route_key(g.name)
        oc = operating_counts.get(key)
        if oc is None:
            return None, {}
        peers = [x for x in groups if _route_key(x.name) == key] or [g]
    idx = next((i for i, x in enumerate(peers) if x.name == g.name), 0)
    sizes = [x.size for x in peers]
    run: dict[str, int] = {}
    for key in ("weekday", "sat", "sunhol"):
        v = oc.get(key)
        if v is None:
            continue
        run[key] = _split(int(v), sizes)[idx]
    return oc, run



def _rest_cycle(prev_work: dict[str, set[dt.date]], days: list[dt.date]) -> tuple[int, int]:
    """전월 실적에서 '몇 일 일하고 몇 일 쉬는지' 주기를 읽는다.

    성민 7월(메인 85명): 휴무 시작 간격은 6일이 47%로 최빈, 휴무 블록 길이는
    2일이 51%. 즉 4일 근무 + 2일 휴무 = 6일 주기다. 회사마다 다를 수 있으니
    고정하지 않고 실적에서 중앙값을 뽑는다.
    """
    gaps: Counter = Counter()
    lens: Counter = Counter()
    for k, w in prev_work.items():
        if len(w) < 10:
            continue
        seq = [1 if d in w else 0 for d in days]
        run = 0
        starts = []
        for i, x in enumerate(seq):
            if x == 0 and (i == 0 or seq[i - 1] == 1):
                starts.append(i)
            if x == 0:
                run += 1
            elif run:
                lens[run] += 1
                run = 0
        if run:
            lens[run] += 1
        for a, b in zip(starts, starts[1:]):
            gaps[b - a] += 1
    cycle = gaps.most_common(1)[0][0] if gaps else 6
    rest_len = lens.most_common(1)[0][0] if lens else 2
    return max(3, min(10, cycle)), max(1, min(3, rest_len))


def _fit_phase(w: set[dt.date], epoch: dt.date, days: list[dt.date],
               cycle: int, rest_len: int) -> tuple[int, int]:
    """이 사람의 전월 휴무가 어느 위상(phase)에 가장 잘 맞는지 — (위상, 일치수)."""
    best, best_score = 0, -1
    for ph in range(cycle):
        score = 0
        for d in days:
            resting = ((d - epoch).days - ph) % cycle < rest_len
            if resting == (d not in w):
                score += 1
        if score > best_score:
            best, best_score = ph, score
    return best, best_score


def _staircase_rest(
    prev_t: MonthlyRoster,
    home_vehicle: dict[str, str],
    dates: list[dt.date],
    leaves: dict[str, set[dt.date]] | None = None,
) -> tuple[dict[str, set[dt.date]], int, int]:
    """계단식 메인 배치 — 이번 달 '쉬어야 할 날'을 사람마다 미리 깔아둔다.

    담당자가 실제로 하는 순서가 이렇다: 먼저 메인(정·부)을 4일근무+2일휴무
    주기로, 차량마다 하루씩 밀어서(계단식) 쫙 깔아 놓는다. 그 다음 연차를
    빼고, 남는 자리를 스페어가 비슷한 패턴으로 메운다.

    CP-SAT 에게 이 모양을 '찾아내라'고 시키면 못 찾는다. 근무일수 밴드(H5)와
    연속근무 한도(H3)는 총량만 묶을 뿐이라, 하루 일하고 하루 쉬는 톱니도
    똑같이 정답이기 때문이다. 실제로 8월 생성본은 휴무블록 1일이 58%까지
    올라갔다 (7월 실측 28%). 그래서 찾게 하지 않고 **깔아준다** —
    여기서 만든 휴무일을 솔버가 소프트 제약(S8)으로 따라간다.

    위상은 전월 실적에 맞춰 고른다. 그래야 월이 바뀌어도 계단이 끊기지 않는다.
    """
    days = sorted({d for (d, _v) in prev_t.entries})
    if not days:
        return {}, 6, 2
    prev_work: dict[str, set[dt.date]] = defaultdict(set)
    for (d, _v), e in prev_t.entries.items():
        for cs in (e.am, e.pm):
            if cs.driver:
                prev_work[cs.driver].add(d)
    cycle, rest_len = _rest_cycle(prev_work, days)
    epoch = days[0]
    dates_set = set(dates)

    mains_of: dict[str, list[str]] = defaultdict(list)
    for k, v in home_vehicle.items():
        mains_of[v].append(k)

    phase_of: dict[str, int] = {}
    for g in prev_t.groups:
        # 그룹의 기준 위상 b: 차량 i 의 위상을 (b+i)%cycle 로 놓았을 때
        # 전월 실적과 가장 잘 맞는 b 를 고른다 (계단을 이어받는다)
        best_b, best_score = 0, -1
        for b in range(cycle):
            score = 0
            for i, v in enumerate(g.vehicles):
                ph = (b + i) % cycle
                for k in mains_of.get(v, ()):
                    w = prev_work.get(k) or set()
                    for d in days:
                        resting = ((d - epoch).days - ph) % cycle < rest_len
                        if resting == (d not in w):
                            score += 1
            if score > best_score:
                best_b, best_score = b, score
        for i, v in enumerate(g.vehicles):
            for k in mains_of.get(v, ()):
                phase_of[k] = (best_b + i) % cycle

    # 스페어는 메인 자리를 메우는 사람이라 차량 계단에 속하지 않는다.
    # 각자 전월 패턴에 가장 잘 맞는 위상을 준다 — 실측상 스페어도 같은
    # 4일근무+2일휴무 모양이다(7월: 근무 4일 61%, 휴무 2일 51%).
    for k, w in prev_work.items():
        if k in phase_of or len(w) < 10:
            continue
        phase_of[k], _ = _fit_phase(w, epoch, days, cycle, rest_len)

    rest: dict[str, set[dt.date]] = {}
    for k, ph in phase_of.items():
        rest[k] = {d for d in dates if ((d - epoch).days - ph) % cycle < rest_len}
        # 승인된 연차는 계단보다 먼저다 — 미리 휴무로 박아두고 아래 레벨링이
        # 그 사람의 나머지 휴무를 옮겨 총량과 날짜별 인원을 다시 맞춘다
        for d in (leaves or {}).get(k, ()):
            if d in dates_set:
                rest[k].add(d)
    return rest, cycle, rest_len




def _split_by(total: int, weights: list[int], cap: list[int]) -> list[int]:
    """total 을 weights 비율로 나누되 각 몫이 cap 을 넘지 않게 (최대잉여법)."""
    n = len(weights)
    w = sum(weights)
    if w <= 0 or total <= 0:
        return [0] * n
    out = [min(cap[i], total * weights[i] // w) for i in range(n)]
    rem = total - sum(out)
    order = sorted(range(n), key=lambda i: (-((total * weights[i]) % w), i))
    while rem > 0:
        progressed = False
        for i in order:
            if rem <= 0:
                break
            if out[i] < cap[i]:
                out[i] += 1; rem -= 1; progressed = True
        if not progressed:
            break
    return out


def _level_rest(
    rest: dict[str, set[dt.date]],
    dates: list[dt.date],
    need_rest: dict[dt.date, int],
    partner: dict[str, str],
    band: tuple[int, int],
    locked: dict[str, set[dt.date]] | None = None,
    max_consecutive: int = 10 ** 6,
) -> dict[str, set[dt.date]]:
    """계단식 휴무를 그날 실제로 필요한 휴무 인원에 **정확히** 맞춘다.

    4일근무+2일휴무를 그대로 깔면 매일 쉬는 인원이 거의 일정하다. 그런데
    감차 때문에 필요한 휴무 인원은 요일마다 다르다 — 성민 8월이면 평일 35명,
    토 41명, 일 47명이다. 일요일마다 12명이 모자란다.

    날짜별 인원이 정확히 맞아야 하는 이유는 이 계획이 아래에서 **하드 제약**
    으로 박히기 때문이다.
      · 필요보다 많이 쉬는 날 → 그만큼 슬롯이 빈다(결행 후보)
      · 필요보다 적게 쉬는 날 → 일감 없는 사람이 생기고, 그 사람의 휴무는
        솔버가 아무 데나 놓아서 블록이 쪼개진다
    그래서 아래 3단계를 거쳐 날짜별 합을 정확히 맞춘다.

    손질 원칙은 담당자가 실제로 하는 것과 같다 — 붙일 때는 이미 있는 휴무
    블록 옆에 붙여 2일을 3일로 늘리고, 뗄 때는 3일 이상 블록의 끝에서 뗀다.
    혼자 뚝 떨어진 하루 휴무는 마지막 수단이다(7월 실측 28%).

    짝궁은 같은 날 쉬어야 하므로(S6 하드) 항상 둘을 함께 움직인다.
    승인된 연차(locked)는 어떤 경우에도 건드리지 않는다.
    """
    lo, _hi = band
    locked = locked or {}
    units: list[tuple[str, ...]] = []
    seen: set[str] = set()
    for k in sorted(rest):
        if k in seen:
            continue
        pk = partner.get(k)
        if pk and pk in rest and pk not in seen:
            units.append((k, pk)); seen.update((k, pk))
        else:
            units.append((k,)); seen.add(k)

    idx = {d: i for i, d in enumerate(dates)}
    count: Counter = Counter()
    for u in units:
        for d in rest[u[0]]:
            count[d] += len(u)

    def resting(u, d):
        return d in rest[u[0]]

    def is_locked(u, d):
        return any(d in locked.get(k, ()) for k in u)

    def block_len(u, d):
        i = idx[d]; n = 1
        j = i - 1
        while j >= 0 and resting(u, dates[j]):
            n += 1; j -= 1
        j = i + 1
        while j < len(dates) and resting(u, dates[j]):
            n += 1; j += 1
        return n

    def adjacent(u, d):
        i = idx[d]
        return ((i > 0 and resting(u, dates[i - 1]))
                or (i + 1 < len(dates) and resting(u, dates[i + 1])))

    def cost_add(u, d):
        return 0 if adjacent(u, d) else 3

    def cost_remove(u, d):
        n = block_len(u, d)
        if n == 1:
            return -2                     # 외톨이 하루 휴무를 없애는 건 이득
        i = idx[d]
        edge = (i == 0 or not resting(u, dates[i - 1])
                or i + 1 >= len(dates) or not resting(u, dates[i + 1]))
        if not edge:
            return 20                     # 블록 한가운데를 파면 두 조각이 난다
        return 0 if n >= 3 else 3

    def add(u, d):
        for k in u:
            rest[k].add(d)
        count[d] += len(u)

    def drop(u, d):
        for k in u:
            rest[k].discard(d)
        count[d] -= len(u)

    def want(d):
        return need_rest.get(d, count[d])

    # 1단계: 총량 맞추기. 계단이 주는 휴무 일수와 이 달에 실제로 필요한 일수는
    # 딱 떨어지지 않는다 (성민 8월: 계단 1106일 vs 필요 1175일).
    target_total = sum(want(d) for d in dates)
    for _ in range(4000):
        gap = target_total - sum(count.values())
        if gap == 0:
            break
        if gap > 0:
            pool = sorted(units, key=lambda u: len(rest[u[0]]))
            best = None
            for u in pool[: max(6, len(pool) // 2)]:
                for d in dates:
                    if resting(u, d) or len(u) > gap and best:
                        continue
                    c = (cost_add(u, d), count[d] - want(d))
                    if best is None or c < best[0]:
                        best = (c, u, d)
            if best is None:
                break
            add(best[1], best[2])
        else:
            pool = sorted(units, key=lambda u: -len(rest[u[0]]))
            best = None
            for u in pool[: max(6, len(pool) // 2)]:
                for d in dates:
                    if not resting(u, d) or is_locked(u, d):
                        continue
                    c = (cost_remove(u, d), want(d) - count[d])
                    if best is None or c < best[0]:
                        best = (c, u, d)
            if best is None:
                break
            drop(best[1], best[2])

    # 2단계: 날짜별로 옮기기. 총량이 맞았으니 늘리고 줄이는 게 아니라 **옮긴다**
    # — 남는 날의 휴무를 떼어 모자란 날에 붙인다.
    for _ in range(12):
        moved = False
        deficit = sorted((d for d in dates if count[d] < want(d)),
                         key=lambda d: count[d] - want(d))
        for d in deficit:
            while count[d] < want(d):
                surplus = [d2 for d2 in dates if count[d2] > want(d2) and d2 != d]
                if not surplus:
                    break
                best = None
                for u in units:
                    if resting(u, d) or count[d] + len(u) - want(d) > 1:
                        continue
                    ca = cost_add(u, d)
                    for d2 in surplus:
                        if not resting(u, d2) or is_locked(u, d2):
                            continue
                        if count[d2] - len(u) < want(d2) - 1:
                            continue
                        c = ca + cost_remove(u, d2)
                        if best is None or c < best[0]:
                            best = (c, u, d2)
                if best is None or best[0] >= 20:
                    break
                _c, u, d2 = best
                add(u, d); drop(u, d2); moved = True
        if not moved:
            break

    # 3단계: 남은 오차를 무조건 없앤다. 여기서 정확히 맞추지 못하면 위에서
    # 적은 두 가지 부작용(빈 슬롯 / 떠도는 휴무)이 그대로 나온다. 모양이
    # 나빠지더라도 개수는 맞춘다 — 그래서 여기서 생기는 하루짜리 휴무가
    # 7월 실측의 28% 같은 자연스러운 불규칙이 된다.
    for d in sorted(dates, key=lambda d: -abs(count[d] - need_rest.get(d, count[d]))):
        while count[d] > want(d):
            cands = [u for u in units if resting(u, d) and not is_locked(u, d)]
            if not cands:
                break
            cands.sort(key=lambda u: (cost_remove(u, d), -len(rest[u[0]])))
            drop(cands[0], d)
        while count[d] < want(d):
            # 넘치게는 절대 넣지 않는다. 1명이 모자란데 짝궁(2명)밖에 없으면
            # 그냥 덜 쉬는 쪽으로 둔다 — 그 날은 일감 없는 사람이 한 명 생길
            # 뿐이지만, 넘치면 슬롯이 빈 채로 나간다(결행 후보).
            cands = [u for u in units
                     if not resting(u, d) and count[d] + len(u) <= want(d)]
            if not cands:
                break
            cands.sort(key=lambda u: (cost_add(u, d), len(rest[u[0]])))
            add(cands[0], d)
    # 4단계: 연속 근무 한도(H3) 지키기 — 마지막에 한다. 총량을 맞추다 보면 8~10일짜리 근무
    # 블록이 생기는데, 이 계획은 하드로 박히므로 H3(기본 6일)와 정면충돌해
    # 모델이 통째로 INFEASIBLE 이 된다. 긴 블록 한가운데에 휴무를 하나 넣고,
    # 대신 남는 날에서 하나를 뺀다.
    for u in units:
        for _ in range(len(dates)):
            run, start_i, worst = 0, 0, None
            for i, dd in enumerate(dates):
                if resting(u, dd):
                    run = 0; start_i = i + 1
                else:
                    run += 1
                    if run > max_consecutive:
                        worst = (start_i, i); break
            if worst is None:
                break
            a, b = worst
            mid = sorted(range(a, b + 1), key=lambda i: (count[dates[i]] - want(dates[i]),
                                                         abs(i - (a + b) // 2)))
            spot = next((dates[i] for i in mid if count[dates[i]] + len(u) <= want(dates[i])),
                        dates[mid[0]])
            add(u, spot)
            # 넣었으면 반드시 어디선가 뺀다. 안 빼면 그 날이 '필요보다 많이
            # 쉬는 날'이 되고, 계획이 하드라서 그만큼 슬롯이 빈 채로 나간다.
            give = [dd for dd in dates
                    if resting(u, dd) and dd != spot and not is_locked(u, dd)]
            if give:
                drop(u, max(give, key=lambda dd: (count[dd] - want(dd),
                                                  -cost_remove(u, dd))))

    # 5단계: '필요보다 많이 쉬는 날'을 최종적으로 없앤다. 4단계에서 휴무를
    # 옮기다 보면 다시 생길 수 있는데, 계획이 하드라 하나 남을 때마다 슬롯이
    # 하나씩 빈 채로 나간다(실제로 17칸이 비었다). 뺄 때는 연속 근무가 한도를
    # 넘지 않는 사람 중에서 고른다.
    def run_ok(u, d):
        i = idx[d]; n = 1
        j = i - 1
        while j >= 0 and not resting(u, dates[j]):
            n += 1; j -= 1
        j = i + 1
        while j < len(dates) and not resting(u, dates[j]):
            n += 1; j += 1
        return n <= max_consecutive

    for d in dates:
        while count[d] > want(d):
            cands = [u for u in units
                     if resting(u, d) and not is_locked(u, d) and run_ok(u, d)]
            if not cands:
                cands = [u for u in units if resting(u, d) and not is_locked(u, d)]
                if not cands:
                    break
            cands.sort(key=lambda u: (cost_remove(u, d), -len(rest[u[0]])))
            drop(cands[0], d)

    del lo
    return rest



def generate_month(
    history: list[MonthlyRoster],
    policy: CompanyPolicy,
    year: int,
    month: int,
    leaves: dict[str, set[dt.date]] | None = None,
    weekday_off_pref: dict[str, dict[int, float]] | None = None,
    home_vehicle_config: Optional[dict[str, str]] = None,
    # 실측(성민 42대·108명·3노선): 45초면 미충원 0, 60초면 짝궁 100%·스왑 98%.
    # 180초는 이미 충분한 해를 더 깎느라 담당자를 3분 더 기다리게 할 뿐이었다.
    time_limit_s: float = 90.0,
    operating_counts: Optional[dict[str, dict[str, int]]] = None,
) -> GenerationResult:
    """home_vehicle_config: 담당자가 확정한 이번 달 차량-고정기사 구성
    (기사 -> 차량). 없으면 전월 실적에서 추론한다."""
    if not history:
        raise ValueError("과거 로스터가 최소 1개월 필요합니다 (규칙·프로필 추론)")
    leaves = leaves or {}
    prev = history[-1]
    first = dt.date(year, month, 1)
    last = dt.date(year, month, _calendar.monthrange(year, month)[1])
    last_prev_day = first - dt.timedelta(days=1)

    # 로테이션은 전월 말일 상태에서 이어받는 것이 원칙이다 (월 경계 리셋 금지 — 스펙 7).
    # 다만 첫 도입처럼 직전 월 배차표가 없을 수 있다. 그때는 이어받기를 포기하고
    # 차량 순서대로 순번을 새로 시작한다(rotation_carry_over=false 와 동일 동작).
    # 규칙(순열·감차·짝궁) 자체는 어느 달 이력에서든 추론되므로 생성은 가능하다.
    carry_over = bool(policy.get("rotation_carry_over"))
    prev_is_immediate = (prev.year, prev.month) == (last_prev_day.year, last_prev_day.month)
    if carry_over and not prev_is_immediate:
        raise ValueError(
            f"직전 월({last_prev_day.year}-{last_prev_day.month:02d}) 배차표가 없습니다 "
            f"(가장 최근 이력: {prev.year}-{prev.month:02d}). 순번 로테이션을 이어받으려면 "
            f"직전 월이 포함된 엑셀이 필요합니다.\n"
            f"직전 월 자료가 없다면 [AI 엔진 설정] → '월 경계 이어가기'를 끄고 다시 "
            f"생성하세요. 순번이 차량 순서대로 새로 시작됩니다."
        )
    prev_t = MonthlyRoster(
        year=prev.year, month=prev.month,
        division=prev.division, groups=prev.groups,
        # 순번이 시트에서 온 것인지 파서가 부여한 것인지는 잘라낸 사본에도
        # 그대로 따라가야 한다 — 아래 로테이션 추론이 이 값으로 갈린다
        slots_are_synthetic=prev.slots_are_synthetic,
    )
    prev_t.entries = {
        (d, v): e for (d, v), e in prev.entries.items() if d <= last_prev_day
    }
    warnings: list[str] = []

    # ── 감차 캘린더 (정책의 공휴일 + 특별 감차 시나리오) ──
    cal = ReductionCalendar(holidays=set(policy.holidays))
    for s, e, _label in policy.special_reductions:
        cal.special_periods.append((s, e, DayClass.SUNHOL))

    # ── 1단계: 패턴 전개 ──
    patterns: dict[str, PatternMatrix] = {}
    display_of: dict[str, DisplayMode] = {}
    rotation_on = bool(policy.get("rotation_enabled"))
    reduction_on = bool(policy.get("weekend_reduction_enabled"))
    # 순번을 이어받지 않고 새로 시작하는 그룹 (파일에 순번 열이 없는 경우)
    fresh_start: set[str] = set()
    for g in prev_t.groups:
        rule = infer_rotation(prev_t, g)
        if rule is None and prev_t.slots_are_synthetic:
            # 순번 열이 없는 양식(Busync 내보내기)이다. 이어받을 순번이 애초에
            # 존재하지 않으므로 전월 말일에서 '이어받는 척'하면 그게 곧 틀린
            # 순번이 된다. 대신 이어받기를 끈 것과 똑같이 **차량 순서대로 새로
            # 시작**하고, 이어지지 않는다는 사실을 경고로 분명히 남긴다.
            # 회전 자체는 설정된 칸수를 쓴다.
            n = g.size
            step = int(policy.get("rotation_step") or 1)
            rule = RotationRule(
                group=g.name, size=n,
                perm={s: ((s - 1 + step) % n) + 1 for s in range(1, n + 1)},
                support=0.0,
            )
            fresh_start.add(g.name)
            warnings.append(
                f"{g.name}: 파일에 순번 정보가 없어 순번을 차량 순서대로 새로 "
                f"시작합니다(회전 {step:+d}칸). 지난달 순번과는 이어지지 않으니 "
                f"게시 전에 순번을 확인해 주세요."
            )
        if rule is None:
            raise ValueError(f"{g.name}: 로테이션 규칙 추론 실패 — 온보딩 위저드에서 확인 필요")
        if not rotation_on:
            # 로테이션 끔: 전월 말일 순번 고정 (항등 순열)
            rule.perm = {s: s for s in rule.perm}
            warnings.append(f"{g.name}: 로테이션 꺼짐 — 순번 고정")
        elif all(rule.perm[s] == s for s in rule.perm):
            # 추론 결과가 항등 = 시트에서 순번 회전을 읽을 수 없었다는 뜻.
            # 월간배차처럼 순번이 고정 열인 양식이 여기 해당한다 — 이때는
            # 설정된 회전 칸수를 쓴다 (모르면 회전이 없는 것처럼 돼버리므로).
            step = int(policy.get("rotation_step"))
            n = g.size
            if step % n:
                rule.perm = {s: ((s - 1 + step) % n) + 1 for s in rule.perm}
                warnings.append(
                    f"{g.name}: 시트에서 순번 회전을 감지하지 못해 설정값"
                    f"({step:+d}칸)을 적용했습니다"
                )
        cfg, disp, _hols, ptr_end = infer_reduction_model(prev_t, g, rule)
        cfg.pointer_start = ptr_end
        # 등록된 요일별 운행 대수가 있으면 추론값을 덮어쓴다. 회사가 직접 적은
        # 값이 지난달 실적을 되짚은 것보다 정확하다 — 되짚기는 평일 상시 감차를
        # 공휴일로 오해해 대수를 뭉갠다(성민: 평일 12/토 11/휴일 10, 등록 14).
        oc, per_group_run = _counts_for_group(operating_counts, prev_t.groups, g)
        if oc:
            rest_counts: dict[DayClass, int] = {}
            for key, cls in (("weekday", DayClass.WEEKDAY), ("sat", DayClass.SAT), ("sunhol", DayClass.SUNHOL)):
                run = per_group_run.get(key)
                if run is None:
                    continue
                rest_counts[cls] = max(0, g.size - int(run))
            if rest_counts:
                cfg.mode = ReductionMode.VEHICLE_POINTER
                cfg.rest_counts = rest_counts
                cfg.rest_slots = {}
                if not cfg.pointer_order:
                    cfg.pointer_order = list(g.vehicles)
                warnings.append(
                    f"{g.name}: 등록된 운행 대수를 적용했습니다 "
                    + " · ".join(
                        f"{ko}{per_group_run[k]}대"
                        for k, ko in (("weekday", "평일 "), ("sat", "토 "), ("sunhol", "일·공휴일 "))
                        if per_group_run.get(k) is not None
                    )
                )
        if not reduction_on:
            cfg.rest_slots = {}
            cfg.rest_counts = {}
        # 이어받기를 끈 경우엔 전월 상태를 조회하지 않는다 — 직전 월 자료가
        # 아예 없어도(첫 도입) 생성이 가능해야 하기 때문.
        if g.name in fresh_start:
            # 위에서 이미 사유를 경고로 남겼다 — 여기서 또 알리지 않는다
            last_map = {v: i + 1 for i, v in enumerate(g.vehicles)}
        elif not carry_over or not prev_is_immediate:
            last_map = {v: i + 1 for i, v in enumerate(g.vehicles)}
            warnings.append(
                f"{g.name}: 순번을 차량 순서대로 새로 시작합니다 "
                f"(직전 월 이어받기 없음)"
            )
        else:
            last_map = slot_map(prev_t, g, last_prev_day)
            if len(last_map) < g.size:
                # 감차일이라 표시 순번이 비었으면 언더라잉을 복원해 이어받는다
                replayed = replay_underlying(prev_t, g, rule)
                if last_prev_day not in replayed:
                    raise ValueError(
                        f"{g.name}: 전월 말일({last_prev_day}) 로테이션 상태를 복원할 수 "
                        f"없습니다 — 직전 월 배차표가 말일까지 채워져 있는지 확인해 주세요."
                    )
                last_map = replayed[last_prev_day]
        patterns[g.name] = expand_pattern(
            rule, last_map, first, last, cal, cfg, disp
        )
        display_of[g.name] = disp

    # ── 프로필 (전월 구성 = 월초 초기 조건) ──
    counts: dict[str, Counter] = defaultdict(Counter)
    shift_hist: dict[str, list[str]] = defaultdict(list)
    affinity: dict[tuple[str, str], int] = defaultdict(int)
    for i, r in enumerate(history):
        recency = i + 1
        for (d, v), e in r.entries.items():
            if d.month != r.month:
                continue
            for s, cs in (("A", e.am), ("P", e.pm)):
                if cs.driver:
                    affinity[(cs.driver, v)] += recency
                    shift_hist[cs.driver].append(s)
                    if r is prev:
                        counts[cs.driver][v] += 1
    if home_vehicle_config is not None:
        home_vehicle = dict(home_vehicle_config)
    else:
        home_vehicle = {}
        for k, c in counts.items():
            v, n = c.most_common(1)[0]
            if n / sum(c.values()) >= 0.5 and n >= 10:
                home_vehicle[k] = v
    partner: dict[str, str] = {}
    by_home: dict[str, list[str]] = defaultdict(list)
    for k, v in home_vehicle.items():
        by_home[v].append(k)
    for v, ks in sorted(by_home.items()):
        if len(ks) == 2:
            partner[ks[0]], partner[ks[1]] = ks[1], ks[0]
    pm_ratio = {
        k: h.count("P") / len(h) for k, h in shift_hist.items() if len(h) >= 10
    }
    vehicle_group: dict[str, str] = {}
    for g in prev_t.groups:
        for v in g.vehicles:
            vehicle_group[v] = g.name
    driver_group = {
        k: vehicle_group[v] for k, v in home_vehicle.items() if v in vehicle_group
    }

    # ── 월 경계 상태 ──
    prev_pm: dict[str, bool] = {}
    prev_last_work: dict[str, dt.date] = {}
    for (d, v), e in prev_t.entries.items():
        for s, cs in (("A", e.am), ("P", e.pm)):
            if cs.driver and (
                cs.driver not in prev_last_work or d > prev_last_work[cs.driver]
            ):
                prev_last_work[cs.driver] = d
                prev_pm[cs.driver] = s == "P"

    # ── 운행 슬롯 ──
    dates = [first + dt.timedelta(days=i) for i in range((last - first).days + 1)]
    operating: set[tuple[dt.date, str, str]] = set()
    for gname, pat in patterns.items():
        for (d, v), cell in pat.items():
            if cell.operating:
                operating.add((d, v, "A"))
                operating.add((d, v, "P"))

    # ── H5 밴드 (기사별 가용일 반영 일할) ──
    drivers = sorted(set(counts.keys()) | set(home_vehicle.keys()))  # 전월 근무자 + 확정 구성
    if policy.get("monthly_band_enabled"):
        lo, hi = policy.get("monthly_work_days")
    else:
        lo, hi = 0, len(dates)
    # 전역 수급 검증: 총 슬롯 vs 밴드
    total_slots = len(operating)
    if drivers and not (lo * len(drivers) <= total_slots <= hi * len(drivers)):
        warnings.append(
            f"수급 경고: 슬롯 {total_slots}개 vs 기사 {len(drivers)}명 × "
            f"밴드 {lo}~{hi}일 — 밴드를 자동 완화합니다"
        )
        lo = min(lo, total_slots // len(drivers))
        hi = max(hi, -(-total_slots // len(drivers)))

    max_consec = (int(policy.get("max_consecutive_days"))
                  if policy.get("max_consecutive_enabled") else len(dates))
    preferred_rest, cycle_len, rest_len = _staircase_rest(prev_t, home_vehicle, dates, leaves)
    if preferred_rest:
        # 그날 몇 명이 쉬어야 하는지는 운행 슬롯 수가 정한다 (감차 반영)
        # 몇 명이 쉬어야 하는지는 **출발지그룹별로** 따진다. 기사가 몰 수 있는
        # 차량은 본인차량·과거 탑승차량·같은 그룹으로 제한돼 있어서, 전체
        # 인원수만 맞추고 그룹이 어긋나면 솔버는 계획을 버릴 수밖에 없다.
        #
        # 그리고 날짜별 합이 슬롯 수와 **정확히** 맞아야 한다. 하루라도 계획
        # 근무 인원이 슬롯보다 적으면 솔버는 그 날 누군가를 계획에서 끌어내야
        # 하고, 그러면 그 사람의 휴무 블록이 쪼개진다.
        slots_g: dict[str, Counter] = defaultdict(Counter)
        for (d, v, _s) in operating:
            slots_g[vehicle_group.get(v, "")][d] += 1
        mains_g: dict[str, list[str]] = defaultdict(list)
        for k, v in home_vehicle.items():
            if k in preferred_rest:
                mains_g[vehicle_group.get(v, "")].append(k)
        spares = [k for k in preferred_rest if k not in home_vehicle]
        gnames = sorted(mains_g)
        cohorts: dict[str, dict[dt.date, int]] = {g: {} for g in gnames}
        spare_need: dict[dt.date, int] = {}
        # 여유 인원. 계획대로만 깔면 그날 '일할 수 있는 사람 = 슬롯 수'가 되어
        # 여유가 0이다. 그런데 정·부는 짝으로 함께 쉬고(S6) 고정기사는 본인
        # 차량에만 타므로(S1 하드), 남는 한 명이 마침 필요한 그 자리에 못 앉는
        # 경우가 생긴다 — 실제로 13칸이 빈 채로 나왔다. 하루 두 명씩 여유를
        # 두면 그런 어긋남을 흡수한다. 남는 사람은 그날 일감이 없을 뿐이고,
        # 그 하루는 S7(톱니 페널티)이 이미 있는 휴무 블록 옆에 붙여 준다.
        SUPPLY_SLACK = 4
        for d in dates:
            total = sum(slots_g[g].get(d, 0) for g in gnames) + SUPPLY_SLACK
            cap = [len(mains_g[g]) for g in gnames]
            # 메인이 그룹 슬롯 비율대로 나눠 맡고, 남는 자리는 스페어가 맡는다
            n_main = sum(cap)
            want = min(total, n_main, round(total * n_main / max(1, len(preferred_rest))))
            share = _split_by(want, [slots_g[g].get(d, 0) for g in gnames], cap)
            # 메인은 정·부 짝으로 묶여 함께 쉬므로(S6 하드) 그룹의 휴무 인원은
            # 짝수여야 한다. 홀수면 한 명을 근무 쪽으로 밀고, 그 자리는
            # 스페어가 맡는다 — 남는 몫은 어차피 스페어 코호트로 넘어간다.
            flip = d.toordinal()
            for i, g in enumerate(gnames):
                if (len(mains_g[g]) - share[i]) % 2 == 0:
                    continue
                # 항상 근무 쪽으로만 밀면 그 몫이 전부 스페어에게 쏠려
                # 스페어 근무일수가 15일까지 떨어진다. 그룹·날짜마다 번갈아
                # 올리고 내려서 양쪽 부담을 맞춘다.
                up = (flip + i) % 2 == 0
                if up and share[i] < cap[i]:
                    share[i] += 1
                elif share[i] > 0:
                    share[i] -= 1
                elif share[i] < cap[i]:
                    share[i] += 1
            for g, on in zip(gnames, share):
                cohorts[g][d] = len(mains_g[g]) - on
            spare_need[d] = max(0, len(spares) - max(0, total - sum(share)))
        for g in gnames:
            sub = {k: preferred_rest[k] for k in mains_g[g]}
            preferred_rest.update(_level_rest(sub, dates, cohorts[g], partner, (lo, hi), leaves, max_consec))
        if spares:
            sub = {k: preferred_rest[k] for k in spares}
            preferred_rest.update(_level_rest(sub, dates, spare_need, partner, (lo, hi), leaves, max_consec))
        warnings.append(
            f"메인을 {cycle_len - rest_len}일 근무 + {rest_len}일 휴무 주기로 "
            f"차량마다 하루씩 밀어(계단식) 깔았습니다 — 전월 실적에서 읽은 주기입니다"
        )
    problem = AssignmentProblem(
        dates=dates,
        operating=operating,
        drivers=drivers,
        leaves={k: set(v) for k, v in leaves.items()},
        forced_work_days=None,          # 생성 모드
        home_vehicle=home_vehicle,
        partner=partner,
        driver_group=driver_group,
        vehicle_group=vehicle_group,
        affinity=dict(affinity),
        weekday_off_pref=weekday_off_pref or {},
        pm_ratio=pm_ratio,
        prev_pm=prev_pm,
        prev_last_work=prev_last_work,
        work_days_band=(lo, hi),
        max_consecutive=(
            int(policy.get("max_consecutive_days"))
            if policy.get("max_consecutive_enabled") else len(dates)
        ),
        forbid_pm_to_am=bool(policy.get("forbid_pm_to_am")),
        hard_own_vehicle=bool(policy.get("fixed_driver_own_vehicle")),
        pair_swap_rule=str(policy.get("pair_swap_rule")),
        spare_balance_enabled=bool(policy.get("spare_balance_enabled")),
        fairness_lambda=int(policy.get("fairness_lambda")),
        preferred_rest=preferred_rest,
        allow_unfilled=True,   # 수급 부족은 '결행 후보'로 리포트 (현실 대응)
    )
    assignment = solve(problem, policy_to_weights(policy), time_limit_s=time_limit_s)

    roster = _to_roster(
        assignment, patterns, prev_t.groups, display_of, year, month,
        prev_t.division,
    )
    audit_report = audit(problem, assignment)
    # 미충원 슬롯은 위반이 아니라 결행 후보 — 감사에서 분리해 경고로
    if assignment.unfilled:
        unfilled_set = set(assignment.unfilled)
        audit_report.violations = [
            v for v in audit_report.violations
            if not (v.rule == "H1" and any(str(u) in v.message for u in unfilled_set))
        ]
        warnings.append(
            f"기사를 못 채운 칸 {len(assignment.unfilled)}개 — 직접 채우거나 "
            f"결행 여부를 정해 주세요: "
            + ", ".join(
                f"{d.month}/{d.day} {v} {'오전' if s == 'A' else '오후'}"
                for d, v, s in assignment.unfilled[:5]
            )
            + (" 외" if len(assignment.unfilled) > 5 else "")
        )
    fairness_report = build_report(roster)
    return GenerationResult(
        roster=roster,
        assignment=assignment,
        problem=problem,
        audit=audit_report,
        fairness=fairness_report,
        patterns=patterns,
        warnings=warnings,
    )


def _to_roster(
    assignment: Assignment,
    patterns: dict[str, PatternMatrix],
    groups: list[DepotGroup],
    display_of: dict[str, DisplayMode],
    year: int,
    month: int,
    division: str,
) -> MonthlyRoster:
    """솔버 산출물 → MonthlyRoster (렌더러·공정성 리포트 공용 입력)."""
    roster = MonthlyRoster(
        year=year, month=month, division=division, groups=groups,
    )
    from .importer.weekly import classify_cell  # 휴 표기 재사용

    for g in groups:
        pat = patterns[g.name]
        prefix = g.slot_prefix
        for (d, v), cell in pat.items():
            am = assignment.cells.get((d, v, "A"))
            pm = assignment.cells.get((d, v, "P"))
            disp = cell.display_slot
            label = f"{prefix}{disp}" if (prefix and disp) else (
                str(disp) if disp else None
            )
            roster.entries[(d, v)] = DayEntry(
                date=d, vehicle=v,
                slot_label=label,
                slot_index=disp,
                am=CellState(driver=am, raw=am or ("휴" if not cell.operating else "")),
                pm=CellState(driver=pm, raw=pm or ("휴" if not cell.operating else "")),
            )
    return roster
