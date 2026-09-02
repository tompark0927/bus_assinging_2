"""임포트 데이터에서 배차 규칙 자동 추론 (온보딩 위저드의 코어).

추론 대상:
- 그룹별 로테이션 순열 π: 오늘 slot s의 차량 → 내일 π(s)
- 감차 규칙: 요일/공휴일별 휴차 슬롯 집합
- 기사 프로필: 고정/예비, 본인차량, 짝궁
- 휴무 직후 A/P 스왑률, 만근일수
"""
from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Optional

from ..config import (
    DayClass,
    DisplayMode,
    GroupReductionConfig,
    ReductionMode,
)
from ..models import DepotGroup, DriverProfile, DriverTier, MonthlyRoster, Shift


@dataclass
class RotationRule:
    """그룹 로테이션 = 슬롯 순열. π[s] = 다음날 슬롯 (1-based dict)."""

    group: str
    size: int
    perm: dict[int, int]
    support: float  # 관측 전이 중 순열과 일치한 비율

    @property
    def as_step(self) -> Optional[int]:
        """순열이 단일 스텝(+k mod N)이면 k, 아니면 None."""
        steps = {(self.perm[s] - s) % self.size for s in self.perm}
        return steps.pop() if len(steps) == 1 else None


@dataclass
class ReductionRule:
    """감차: 조건(주말/공휴일)에 해당하는 날 휴차되는 슬롯."""

    group: str
    rest_slots: list[int] = field(default_factory=list)


@dataclass
class InferenceReport:
    rotations: dict[str, RotationRule] = field(default_factory=dict)
    reductions: dict[str, ReductionRule] = field(default_factory=dict)
    reduced_dates: list[dt.date] = field(default_factory=list)  # 감차 시행일(관측)
    profiles: dict[str, DriverProfile] = field(default_factory=dict)
    swap_rate_after_leave: Optional[float] = None
    avg_work_days: Optional[float] = None


def slot_map(roster: MonthlyRoster, group: DepotGroup, date: dt.date) -> dict[str, int]:
    """해당 날짜의 {차량: 순번}. 순번 없는 차량은 제외."""
    out = {}
    for v in group.vehicles:
        e = roster.entry(date, v)
        if e and e.slot_index:
            out[v] = e.slot_index
    return out


def infer_rotation(roster: MonthlyRoster, group: DepotGroup) -> Optional[RotationRule]:
    """연속 이틀 슬롯 전이에서 다수결 순열 추출.

    간선처럼 감차일에 순번이 1..M로 압축 재부여되는 표가 있으므로,
    양일 모두 전 차량이 순번을 가진 날(=전면 운행일)의 전이만 사용한다.
    """
    dates = roster.dates()
    trans: dict[int, Counter] = defaultdict(Counter)
    total = matched = 0
    full = group.size
    for i in range(len(dates) - 1):
        m1 = slot_map(roster, group, dates[i])
        m2 = slot_map(roster, group, dates[i + 1])
        if (dates[i + 1] - dates[i]).days != 1:
            continue
        if len(m1) < full or len(m2) < full:
            continue
        for v, s1 in m1.items():
            if v in m2:
                trans[s1][m2[v]] += 1
    if not trans:
        return None
    perm = {s: c.most_common(1)[0][0] for s, c in trans.items()}
    # 검증: 순열(전단사)인지 + 지지율
    for s, c in trans.items():
        total += sum(c.values())
        matched += c[perm[s]]
    if len(set(perm.values())) != len(perm):
        return None  # 전단사 아님 — 로테이션 규칙 불명
    return RotationRule(
        group=group.name, size=group.size, perm=perm,
        support=matched / total if total else 0.0,
    )


def infer_reduction(
    roster: MonthlyRoster, group: DepotGroup
) -> tuple[ReductionRule, list[dt.date]]:
    """양 시프트 모두 휴무인 차량의 슬롯 → 휴차 슬롯 후보.

    같은 슬롯 집합이 반복되는 날들 = 감차 시행일(주말·공휴일).
    """
    by_date: dict[dt.date, set[int]] = {}
    for d in roster.dates():
        slots = set()
        for v in group.vehicles:
            e = roster.entry(d, v)
            if e and e.slot_index and e.am.leave and e.pm.leave:
                slots.add(e.slot_index)
        if slots:
            by_date[d] = slots
    if not by_date:
        return ReductionRule(group=group.name), []
    counts = Counter(frozenset(s) for s in by_date.values())
    rest = counts.most_common(1)[0][0]
    reduced = [d for d, s in by_date.items() if s == set(rest)]
    return ReductionRule(group=group.name, rest_slots=sorted(rest)), sorted(reduced)


def replay_underlying(
    roster: MonthlyRoster, group: DepotGroup, rule: RotationRule
) -> dict[dt.date, dict[str, int]]:
    """관측 첫 전면운행일부터 순열을 매일 적용해 언더라잉 슬롯 복원.

    감차일의 압축 재부여(간선)와 무관하게 로테이션은 매일 진행된다는
    실측 모델을 그대로 재생한다.
    """
    dates = [d for d in roster.dates() if slot_map(roster, group, d)]
    if not dates:
        return {}
    start = None
    for d in dates:
        if len(slot_map(roster, group, d)) == group.size:
            start = d
            break
    if start is not None:
        base = slot_map(roster, group, start)
    else:
        # 전 차량이 순번을 가진 날이 **하루도 없는** 회사가 있다. 성민 실측이
        # 그렇다: 노선당 등록 14대인데 평일 12·토 11·휴일 10대만 나가므로
        # 전면운행일이 0일이다. 예전에는 여기서 {} 를 돌려줬고, 그러면
        # 감차 모델 추론이 통째로 비어 다음 달이 '전 차량 매일 운행'으로
        # 짜였다(슬롯 20%↑ → 인력 부족 → 짝궁 상보까지 포기).
        #
        # 관측이 가장 많은 날에서 출발하고, 그날 빠진 차량에는 쓰이지 않은
        # 순번을 차번순으로 채워 완전한 매핑을 만든다. 로테이션은 감차와
        # 무관하게 매일 돌기 때문에 언더라잉은 전 차량이 갖는 게 맞다.
        start = max(dates, key=lambda d: len(slot_map(roster, group, d)))
        base = dict(slot_map(roster, group, start))
        used = set(base.values())
        free = [s for s in range(1, group.size + 1) if s not in used]
        for v in group.vehicles:
            if v not in base and free:
                base[v] = free.pop(0)
    out: dict[dt.date, dict[str, int]] = {start: dict(base)}
    cur = dict(out[start])
    d = start
    while d < dates[-1]:
        d += dt.timedelta(days=1)
        cur = {v: rule.perm[s] for v, s in cur.items()}
        out[d] = dict(cur)
    return out


def observed_resting(
    roster: MonthlyRoster, group: DepotGroup, date: dt.date
) -> tuple[set[str], DisplayMode] | None:
    """해당 날짜의 휴차 차량 관측. (휴차 집합, 표시 모드) 또는 데이터 없음 None.

    - COMPACT(간선): 일부 차량만 순번 없음 → 그 차량들이 휴차
    - KEEP(지선): 전 차량 순번 보유, 오전·오후 모두 휴무 표기인 차량이 휴차
    """
    m = slot_map(roster, group, date)
    if not m:
        return None
    if len(m) < group.size:
        return {v for v in group.vehicles if v not in m}, DisplayMode.COMPACT
    rest = set()
    for v in group.vehicles:
        e = roster.entry(date, v)
        if e and e.am.leave and e.pm.leave:
            rest.add(v)
    return rest, DisplayMode.KEEP


def infer_reduction_model(
    roster: MonthlyRoster,
    group: DepotGroup,
    rule: RotationRule,
    holidays: set[dt.date] | None = None,
) -> tuple[GroupReductionConfig, DisplayMode, set[dt.date], int]:
    """감차 모델 추론.

    반환: (설정, 표시모드, 관측된 감차일 중 평일=공휴일 후보, 월말 포인터 상태)
    - 요일클래스별 언더라잉 휴차 슬롯이 매번 동일 → FIXED_SLOTS
    - 아니면 차량 리스트 연속 포인터 적합 시도 → VEHICLE_POINTER
    """
    holidays = holidays or set()
    underlying = replay_underlying(roster, group, rule)
    display = DisplayMode.KEEP
    reduced: dict[dt.date, set[str]] = {}
    for d in sorted(underlying):
        obs = observed_resting(roster, group, d)
        if obs is None:
            continue
        rest, mode = obs
        if mode == DisplayMode.COMPACT:
            display = DisplayMode.COMPACT
        if rest:
            reduced[d] = rest

    def day_class(d: dt.date) -> DayClass:
        if d in holidays or d.weekday() == 6:
            return DayClass.SUNHOL
        if d.weekday() == 5:
            return DayClass.SAT
        return DayClass.SUNHOL  # 평일 감차 = 공휴일로 간주

    inferred_holidays = {
        d for d in reduced if d.weekday() < 5 and d not in holidays
    }

    # 1) FIXED_SLOTS 적합
    by_class: dict[DayClass, set[frozenset[int]]] = defaultdict(set)
    for d, rest in reduced.items():
        slots = frozenset(underlying[d][v] for v in rest)
        by_class[day_class(d)].add(slots)
    if all(len(s) == 1 for s in by_class.values()) and by_class:
        cfg = GroupReductionConfig(
            mode=ReductionMode.FIXED_SLOTS,
            rest_slots={cls: next(iter(s)) for cls, s in by_class.items()},
        )
        return cfg, display, inferred_holidays, 0

    # 감차일이 하나도 관측되지 않았으면 감차 없는 운영 (또는 시트가 휴차를
    # 표기하지 않는 양식) — 빈 설정으로 돌려보낸다.
    if not reduced:
        return GroupReductionConfig(), display, inferred_holidays, 0

    # 2) VEHICLE_POINTER 적합: 감차일 순서대로 연속 소비
    order = list(group.vehicles)
    n = len(order)
    days = sorted(reduced)
    first = reduced[days[0]]
    starts = [i for i in range(n) if {order[(i + j) % n] for j in range(len(first))} == first]
    for s0 in starts:
        p = s0
        fits = True
        for d in days:
            k = len(reduced[d])
            if {order[(p + j) % n] for j in range(k)} != reduced[d]:
                fits = False
                break
            p = (p + k) % n
        if fits:
            counts: dict[DayClass, Counter] = defaultdict(Counter)
            for d in days:
                counts[day_class(d)][len(reduced[d])] += 1
            cfg = GroupReductionConfig(
                mode=ReductionMode.VEHICLE_POINTER,
                rest_counts={
                    cls: c.most_common(1)[0][0] for cls, c in counts.items()
                },
                pointer_order=order,
                pointer_start=s0,
            )
            return cfg, display, inferred_holidays, p
    # 적합 실패 — 어느 차를 세우는지는 못 읽었지만 **몇 대를 세우는지**는
    # 확실히 안다. 그것마저 버리면 다음 달이 '전 차량 매일 운행'으로 짜여
    # 슬롯이 20% 넘게 부풀고, 인력이 모자란 것처럼 되어 솔버가 밴드를
    # 완화하면서 짝궁 상보(같은 날 휴무·A/P 스왑)까지 포기한다.
    # 실제로 2026-08 생성에서 슬롯 2160 → 2604 로 늘고 짝궁이 어긋났다.
    #
    # 어느 차를 세울지는 포인터가 고르게 돌린다. 차량 조합을 못박지 않는
    # 편이 오히려 낫다 — 못박으면 감차일이 짝궁 휴무와 어긋나 그 짝궁의
    # 휴무가 2일에서 3~4일로 늘어난다(실측).
    fallback_counts: dict[DayClass, Counter] = defaultdict(Counter)
    for d in days:
        fallback_counts[day_class(d)][len(reduced[d])] += 1
    cfg = GroupReductionConfig(
        mode=ReductionMode.VEHICLE_POINTER,
        rest_counts={cls: c.most_common(1)[0][0] for cls, c in fallback_counts.items()},
        pointer_order=order,
        pointer_start=0,
    )
    return cfg, display, inferred_holidays, 0


def infer_profiles(rosters: list[MonthlyRoster]) -> dict[str, DriverProfile]:
    """여러 달 데이터에서 기사 프로필 추론.

    - 본인차량: 근무일 중 최다 탑승 차량. 점유율 50%+ → 고정, 미만 → 예비(스펙 2.1).
    - 짝궁: 본인차량에서 반대 시프트로 가장 자주 만난 기사.
    """
    veh_count: dict[str, Counter] = defaultdict(Counter)
    work_days: Counter = Counter()
    pair_count: dict[str, Counter] = defaultdict(Counter)

    for roster in rosters:
        for (d, v), e in roster.entries.items():
            am, pm = e.am.driver, e.pm.driver
            if am:
                veh_count[am][v] += 1
                work_days[am] += 1
            if pm:
                veh_count[pm][v] += 1
                work_days[pm] += 1
            if am and pm:
                pair_count[am][pm] += 1
                pair_count[pm][am] += 1

    profiles: dict[str, DriverProfile] = {}
    for name, vc in veh_count.items():
        home, cnt = vc.most_common(1)[0]
        share = cnt / work_days[name]
        tier = DriverTier.FIXED if share >= 0.5 else DriverTier.SPARE
        partner = None
        if pair_count[name]:
            partner = pair_count[name].most_common(1)[0][0]
        group = None
        for roster in rosters:
            g = roster.group_of(home)
            if g:
                group = g.name
                break
        profiles[name] = DriverProfile(
            name=name, tier=tier,
            home_vehicle=home if tier == DriverTier.FIXED else None,
            partner=partner, group=group,
        )
    return profiles


def infer_swap_rate(roster: MonthlyRoster) -> Optional[float]:
    """휴무 직후 오전↔오후 스왑 비율 (스펙 2.2: 지선 74%, 간선 69%)."""
    # 기사별 (날짜 → 시프트) 시계열
    shift_of: dict[str, dict[dt.date, Shift]] = defaultdict(dict)
    off_days: dict[str, set[dt.date]] = defaultdict(set)
    for (d, v), e in roster.entries.items():
        if e.am.driver:
            shift_of[e.am.driver][d] = Shift.AM
        if e.pm.driver:
            shift_of[e.pm.driver][d] = Shift.PM
    # 휴무 표기는 셀 위치로 기사 특정이 안 되므로, "근무 공백"을 휴무로 간주
    swaps = keeps = 0
    for name, days in shift_of.items():
        ds = sorted(days)
        for i in range(1, len(ds)):
            gap = (ds[i] - ds[i - 1]).days
            if gap == 1:
                continue
            if gap > 4:  # 장기 공백(연차 등)은 제외
                continue
            if days[ds[i]] != days[ds[i - 1]]:
                swaps += 1
            else:
                keeps += 1
    total = swaps + keeps
    return swaps / total if total else None


def infer_all(rosters: list[MonthlyRoster]) -> InferenceReport:
    report = InferenceReport()
    base = rosters[-1]  # 최신 달 기준
    for g in base.groups:
        rot = infer_rotation(base, g)
        if rot:
            report.rotations[g.name] = rot
        red, dates = infer_reduction(base, g)
        report.reductions[g.name] = red
        for d in dates:
            if d not in report.reduced_dates:
                report.reduced_dates.append(d)
    report.reduced_dates.sort()
    report.profiles = infer_profiles(rosters)
    report.swap_rate_after_leave = infer_swap_rate(base)
    # 만근: 최신 달 기사별 근무일수 평균(월중 입퇴사 제외 근사: 상위 50% 중앙값)
    wd = Counter()
    for (d, v), e in base.entries.items():
        if d.month != base.month:
            continue
        for cs in (e.am, e.pm):
            if cs.driver:
                wd[cs.driver] += 1
    if wd:
        vals = sorted(wd.values())
        report.avg_work_days = vals[len(vals) // 2]
    return report
