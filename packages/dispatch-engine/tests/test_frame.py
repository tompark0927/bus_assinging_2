"""기본 틀 — 13일 계단 사이클.

여기 적힌 숫자는 사장님이 직접 지시한 규칙이다(2026-08-31).
바꾸려면 회사에 먼저 물어야 한다.
"""
from __future__ import annotations

import datetime as dt

import pytest

from busync_engine.frame import (
    CYCLE_LEN,
    BaseFrame,
    build_month_frame,
    estimate_anchor,
    frame_days,
    month_dates,
    new_anchor,
    phase_state,
    rest_days_of_cycle,
    staircase_phases,
)
from busync_engine.models import (  # noqa: E402
    CellState,
    DayEntry,
    DepotGroup,
    MonthlyRoster,
    Shift,
)

EPOCH = dt.date(2026, 9, 1)


def _frame_one_vehicle(phase: int = 0) -> BaseFrame:
    return BaseFrame(
        epoch=EPOCH,
        phases={"1001": phase},
        roles={"1001": ("김정기", "박부기")},
    )


# ── 사이클 그 자체 ──────────────────────────────────────────────────


def test_사이클은_13일이다():
    assert CYCLE_LEN == 13


def test_한_사이클에서_쉬는_날은_사흘이고_1일_2일로_끊긴다():
    # 근무 5(0~4) · 휴무 1(5) · 근무 5(6~10) · 휴무 2(11~12)
    assert rest_days_of_cycle() == [5, 11, 12]


def test_근무_블록은_오후_오전_순으로_번갈아_간다():
    first = [phase_state(p)[1] for p in range(0, 5)]
    second = [phase_state(p)[1] for p in range(6, 11)]
    assert first == [Shift.PM] * 5
    assert second == [Shift.AM] * 5


# ── 사장님이 직접 말한 날짜 ─────────────────────────────────────────


def test_1일부터_일한_짝꿍은_6일_12일_13일에_쉰다():
    frame = _frame_one_vehicle(phase=0)  # 9/1 이 사이클 첫날
    days = frame_days(frame, "1001", month_dates(2026, 9))
    rest = [d.date.day for d in days if not d.working]
    assert rest[:6] == [6, 12, 13, 19, 25, 26]


def test_바로_밑_차량은_하루_뒤에_쉰다():
    phases = staircase_phases(["1001", "1002", "1003"], base_phase=0)
    frame = BaseFrame(epoch=EPOCH, phases=phases)
    # 계단을 넉넉히 보려면 한 달로는 짧다 — 두 달을 이어 본다
    dates = month_dates(2026, 9) + month_dates(2026, 10)

    def rest_set(v: str) -> set[dt.date]:
        return {d.date for d in frame_days(frame, v, dates) if not d.working}

    one_day = dt.timedelta(days=1)
    # 첫날은 그 앞 날짜가 없어 비교 대상에서 빠진다 (경계)
    inner = set(dates[1:])
    for above, below in (("1001", "1002"), ("1002", "1003")):
        shifted = {d + one_day for d in rest_set(above)}
        assert rest_set(below) & inner == shifted & inner

    # 1일부터 근무를 시작한 1001 이 6일에 쉬면, 1002 는 7일에 쉰다
    assert dt.date(2026, 9, 6) in rest_set("1001")
    assert dt.date(2026, 9, 7) in rest_set("1002")
    assert dt.date(2026, 9, 8) in rest_set("1003")


# ── 짝꿍 ────────────────────────────────────────────────────────────


def test_짝꿍은_같은_날_쉬고_시프트는_매일_반대다():
    mf = build_month_frame(_frame_one_vehicle(), ["1001"], 2026, 9)
    assert mf.rest["김정기"] == mf.rest["박부기"]

    for d, sh in mf.work["김정기"].items():
        assert mf.work["박부기"][d] is not sh
    assert set(mf.work["김정기"]) == set(mf.work["박부기"])


def test_승인_휴무는_틀보다_우선이고_낸_사람만_뺀다():
    leave_day = dt.date(2026, 9, 2)  # 계단상 근무일
    mf = build_month_frame(
        _frame_one_vehicle(), ["1001"], 2026, 9, leaves={"김정기": {leave_day}}
    )
    assert leave_day in mf.rest["김정기"]
    # 짝꿍은 그대로 근무한다 — 묶어서 빼면 슬롯 두 개가 한꺼번에 날아간다
    assert leave_day in mf.work["박부기"]


# ── 월 경계 ─────────────────────────────────────────────────────────


def test_월이_바뀌어도_사이클이_끊기지_않는다():
    frame = _frame_one_vehicle(phase=0)
    sep = frame_days(frame, "1001", month_dates(2026, 9))
    oct_ = frame_days(frame, "1001", month_dates(2026, 10))
    joined = sep + oct_

    # 9/30 → 10/1 이 이어지는지: 근무·휴무 순열이 13일 주기를 유지한다
    for i, day in enumerate(joined):
        working, _ = phase_state(i)
        assert day.working is working


def test_한_달_근무일수는_23_24일이다():
    mf = build_month_frame(_frame_one_vehicle(), ["1001"], 2026, 9)  # 30일
    worked = len(mf.work["김정기"])
    assert worked == 30 - len(mf.rest["김정기"])
    assert 22 <= worked <= 24


# ── 감차 1순위 ──────────────────────────────────────────────────────


def test_14대_계단이면_하루에_쉬는_차가_고르게_퍼진다():
    vehicles = [f"10{i:02d}" for i in range(14)]
    frame = BaseFrame(epoch=EPOCH, phases=staircase_phases(vehicles))
    mf = build_month_frame(frame, vehicles, 2026, 9)

    counts = [len(mf.resting_vehicles(d)) for d in mf.dates]
    # 14 × 3/13 = 3.23 → 하루 3~4대. 평일 12대 운행(2대 감차)과 맞물린다
    assert set(counts) <= {3, 4}


# ── 위상 추정 ───────────────────────────────────────────────────────


def _roster_from_frame(frame: BaseFrame, vehicles: list[str], year: int, month: int) -> MonthlyRoster:
    """틀 그대로 짜인 완벽한 배차표 — 추정이 원래 위상을 되찾아야 한다."""
    roster = MonthlyRoster(
        year=year, month=month, division="지선",
        groups=[DepotGroup(name="가좌", vehicles=list(vehicles))],
    )
    mf = build_month_frame(frame, vehicles, year, month)
    for (d, v), fd in mf.cells.items():
        lead, second = frame.roles[v]
        am = pm = CellState()
        if fd.working:
            lead_shift = fd.lead_shift
            if lead_shift is Shift.PM:
                pm, am = CellState(driver=lead), CellState(driver=second)
            else:
                am, pm = CellState(driver=lead), CellState(driver=second)
        roster.entries[(d, v)] = DayEntry(
            date=d, vehicle=v, slot_index=1, am=am, pm=pm
        )
    return roster


def test_실적에서_위상과_정부_역할을_되찾는다():
    vehicles = ["1001", "1002", "1003"]
    truth = BaseFrame(
        epoch=dt.date(2026, 7, 1),
        phases=staircase_phases(vehicles, base_phase=4),
        roles={v: (f"정{v}", f"부{v}") for v in vehicles},
    )
    roster = _roster_from_frame(truth, vehicles, 2026, 7)
    home = {f"정{v}": v for v in vehicles} | {f"부{v}": v for v in vehicles}

    est = estimate_anchor(roster, home, epoch=dt.date(2026, 7, 1))

    assert est.frame.phases == truth.phases
    assert est.frame.roles == truth.roles
    assert est.overall_fit > 0.99


def test_실적이_없으면_차량_순서대로_계단을_새로_시작한다():
    g = DepotGroup(name="가좌", vehicles=["1001", "1002"])
    frame = new_anchor([g], epoch=EPOCH)
    # 2번 차는 하루 늦게 쉬므로 위상은 하루 뒤처진다
    assert frame.phases == {"1001": 0, "1002": CYCLE_LEN - 1}


def test_실적이_비면_추정은_거부한다():
    empty = MonthlyRoster(year=2026, month=7, division="지선")
    with pytest.raises(ValueError):
        estimate_anchor(empty, {})
