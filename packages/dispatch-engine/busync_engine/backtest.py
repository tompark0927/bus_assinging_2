"""검증 프로토콜 (스펙 5): 백테스트 — 생성표 vs 실제표 셀 단위 일치율.

입력(초기 조건): 과거 월들의 실배차표.
- 규칙(로테이션·감차 모델)과 프로필(고정/짝궁/숙련도)은 이전 달들에서 추론.
- 대상 월의 승인 휴무(= 실제 OFF일)와 감차 캘린더는 운영 입력으로 간주.

출력: 순번 패턴 일치율(목표 95%+), 기사 배정 일치율(목표 80%+),
      불일치 목록(대부분 당일 대타 — 담당자 검토용 예외 케이스).
"""
from __future__ import annotations

import calendar as _calendar
import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field

from .config import DisplayMode, ReductionCalendar
from .importer.inference import (
    infer_reduction_model,
    infer_rotation,
    replay_underlying,
    slot_map,
)
from .models import MonthlyRoster
from .rotation import expand_pattern
from .solver import AssignmentProblem, SolverWeights, solve


@dataclass
class BacktestResult:
    slot_total: int = 0
    slot_match: int = 0
    cell_total: int = 0
    cell_match: int = 0
    slot_mismatches: list = field(default_factory=list)
    cell_mismatches: list = field(default_factory=list)
    problem: object = None      # 감사(audit) 재사용을 위한 원본 문제
    assignment: object = None   # 솔버 산출물

    @property
    def slot_rate(self) -> float:
        return self.slot_match / self.slot_total if self.slot_total else 0.0

    @property
    def cell_rate(self) -> float:
        return self.cell_match / self.cell_total if self.cell_total else 0.0


def _trim(roster: MonthlyRoster, until: dt.date) -> MonthlyRoster:
    r = MonthlyRoster(
        year=roster.year, month=roster.month,
        division=roster.division, groups=roster.groups,
    )
    r.entries = {(d, v): e for (d, v), e in roster.entries.items() if d <= until}
    return r


def backtest_stage1(
    prev: MonthlyRoster,
    actual: MonthlyRoster,
    holidays: set[dt.date],
    result: BacktestResult | None = None,
):
    """1단계 백테스트 + 이후 2단계가 쓸 패턴 반환."""
    result = result or BacktestResult()
    first = dt.date(actual.year, actual.month, 1)
    last = dt.date(
        actual.year, actual.month,
        _calendar.monthrange(actual.year, actual.month)[1],
    )
    last_prev_day = first - dt.timedelta(days=1)
    prev_t = _trim(prev, last_prev_day)
    cal = ReductionCalendar(holidays=holidays)
    patterns = {}
    for gp, gc in zip(prev_t.groups, actual.groups):
        rule = infer_rotation(prev_t, gp)
        if rule is None:
            raise ValueError(f"{gp.name}: 로테이션 추론 실패")
        cfg, disp, _, ptr_end = infer_reduction_model(prev_t, gp, rule)
        cfg.pointer_start = ptr_end
        last_map = slot_map(prev_t, gp, last_prev_day)
        if len(last_map) < gp.size:
            last_map = replay_underlying(prev_t, gp, rule)[last_prev_day]
        pat = expand_pattern(rule, last_map, first, last, cal, cfg, disp)
        patterns[gc.name] = (pat, disp)
        for d in actual.month_dates():
            for v in gc.vehicles:
                e = actual.entry(d, v)
                if e is None:
                    continue
                cell = pat[(d, v)]
                predicted = (
                    cell.display_slot
                    if cell.operating or disp == DisplayMode.KEEP
                    else None
                )
                result.slot_total += 1
                if e.slot_index == predicted:
                    result.slot_match += 1
                else:
                    result.slot_mismatches.append(
                        (d, v, predicted, e.slot_index)
                    )
    return result, patterns


def backtest_stage2(
    history: list[MonthlyRoster],
    actual: MonthlyRoster,
    result: BacktestResult | None = None,
    weights: SolverWeights | None = None,
    time_limit_s: float = 120.0,
    hard_own_vehicle: bool = True,
    anchor_first_shift: bool = False,
):
    """2단계 백테스트: 승인 휴무(실측 OFF)를 입력으로 기사 배정 재현.

    실측 근무일을 가용성으로 고정하고, 솔버가 '누가 어느 차량·시프트인가'를
    결정한다. 셀 단위 일치율을 리포트한다.
    """
    result = result or BacktestResult()

    # 초기 조건 (스펙 5.1): 대상 월의 명단·짝궁·차량 구성은 입력이다.
    # 실환경에서는 담당자가 확정한 월초 구성이 들어온다. 백테스트에서는
    # 대상 월의 차량별 최다 탑승 2인(월 단위 집계 = 구성 수준 정보)으로 재구성한다.
    veh_top: dict[str, list[tuple[str, int]]] = {}
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for (d, v), e in actual.entries.items():
        if d.month != actual.month:
            continue
        for cs in (e.am, e.pm):
            if cs.driver:
                counts[v][cs.driver] += 1
    home_vehicle: dict[str, str] = {}
    for v, c in counts.items():
        top2 = sorted(c.items(), key=lambda kv: -kv[1])[:2]
        veh_top[v] = top2
        for name, n in top2:
            # 절반 이상 그 차량에 탄 기사만 고정으로 (월중 교체·순수 스페어 배제)
            if n >= 12 and name not in home_vehicle:
                home_vehicle[name] = v

    # 월 경계 상태: 전월 마지막 근무일·시프트
    # (전월 시트에는 대상 월 스필오버 패널이 있으므로 반드시 전월 말일까지 자른다)
    prev_pm: dict[str, bool] = {}
    prev_last_work: dict[str, dt.date] = {}
    if history:
        month_first = dt.date(actual.year, actual.month, 1)
        prev_roster = _trim(history[-1], month_first - dt.timedelta(days=1))
        for (d, v), e in prev_roster.entries.items():
            for s, cs in (("A", e.am), ("P", e.pm)):
                if cs.driver and (
                    cs.driver not in prev_last_work
                    or d > prev_last_work[cs.driver]
                ):
                    prev_last_work[cs.driver] = d
                    prev_pm[cs.driver] = s == "P"

    # 실제 운행 슬롯과 정답 셀
    operating: set[tuple[dt.date, str, str]] = set()
    truth: dict[tuple[dt.date, str, str], str] = {}
    forced: dict[str, set[dt.date]] = defaultdict(set)
    dates = actual.month_dates()
    for d in dates:
        for (dd, v), e in actual.entries.items():
            if dd != d:
                continue
            for s, cs in (("A", e.am), ("P", e.pm)):
                if cs.driver:  # 결행/휴차 슬롯은 제외 — 실제 배정 존재 셀만
                    operating.add((d, v, s))
                    truth[(d, v, s)] = cs.driver
                    forced[cs.driver].add(d)

    drivers = sorted(forced.keys())
    affinity: dict[tuple[str, str], int] = defaultdict(int)
    shift_hist: dict[str, list[str]] = defaultdict(list)
    for i, roster in enumerate(history):
        recency = i + 1  # 최근 달 가중
        for (d, v), e in roster.entries.items():
            for s, cs in (("A", e.am), ("P", e.pm)):
                if cs.driver:
                    affinity[(cs.driver, v)] += recency
                    shift_hist[cs.driver].append(s)
    pm_ratio = {
        k: hist.count("P") / len(hist)
        for k, hist in shift_hist.items()
        if len(hist) >= 10
    }

    vehicle_group = {}
    for g in actual.groups:
        for v in g.vehicles:
            vehicle_group[v] = g.name

    driver_group = {
        n: vehicle_group[v]
        for n, v in home_vehicle.items()
        if v in vehicle_group
    }

    # 짝궁: 같은 차량을 홈으로 갖는 두 기사
    partner: dict[str, str] = {}
    by_home: dict[str, list[str]] = defaultdict(list)
    for n, v in home_vehicle.items():
        by_home[v].append(n)
    for v, ns in by_home.items():
        if len(ns) == 2:
            partner[ns[0]], partner[ns[1]] = ns[1], ns[0]

    # 월초 페이즈 앵커: 기사별 첫 근무일의 실제 A/P (초기 조건 — 월초 게시표)
    first_anchor: dict[str, tuple[dt.date, bool]] = {}
    if anchor_first_shift:
        first_cell: dict[str, tuple[dt.date, str]] = {}
        for (d, v, s), k in truth.items():
            if k not in first_cell or d < first_cell[k][0]:
                first_cell[k] = (d, s)
        first_anchor = {
            k: (d, s == "P") for k, (d, s) in first_cell.items()
        }
    problem = AssignmentProblem(
        dates=dates,
        operating=operating,
        drivers=drivers,
        forced_work_days=dict(forced),
        home_vehicle={n: v for n, v in home_vehicle.items() if n in forced},
        driver_group={n: g for n, g in driver_group.items() if n in forced},
        vehicle_group=vehicle_group,
        affinity=dict(affinity),
        prev_pm=prev_pm,
        prev_last_work=prev_last_work,
        pm_ratio=pm_ratio,
        partner=partner,
        hard_own_vehicle=hard_own_vehicle,
        first_shift_anchor=first_anchor,
    )
    assignment = solve(problem, weights, time_limit_s=time_limit_s)
    result.problem = problem
    result.assignment = assignment

    for key, truth_driver in truth.items():
        result.cell_total += 1
        got = assignment.cells.get(key)
        if got == truth_driver:
            result.cell_match += 1
        else:
            result.cell_mismatches.append((*key, got, truth_driver))
    return result, assignment
