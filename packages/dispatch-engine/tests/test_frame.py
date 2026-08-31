"""기본 틀 — 12일 계단 사이클 (4근2휴 × 오후/오전 두 블록).

여기 적힌 숫자는 회사가 확정한 규칙이다(2026-08-31).
바꾸려면 회사에 먼저 물어야 한다.

주기 길이는 취향이 아니라 인원 산술이 정한다. 성민 총 슬롯 2,142칸 ÷ 107명
= 전원 평균 20.0일이 고정값이고, 주기는 그 20일을 메인과 스페어가 어떻게
나눠 갖는지만 정한다. 13일(5근1휴+5근2휴)로 짰더니 메인이 23.9일을 가져가
스페어가 7~9일밖에 못 나갔다.
"""
from __future__ import annotations

import datetime as dt

import pytest

from busync_engine.frame import (
    DEFAULT_CYCLE,
    BaseFrame,
    Cycle,
    build_month_frame,
    estimate_anchor,
    frame_days,
    month_dates,
    new_anchor,
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

#: 성민이 [배차 설정 → 운영 정책]에 넣은 값. 회사마다 다르다.
SUNGMIN = Cycle(work_days=4, rest_days=2)


def _frame_one_vehicle(phase: int = 0, cycle: Cycle = SUNGMIN) -> BaseFrame:
    return BaseFrame(
        epoch=EPOCH,
        phases={"1001": phase},
        roles={"1001": ("김정기", "박부기")},
        cycle=cycle,
    )


# ── 사이클 그 자체 ──────────────────────────────────────────────────


def test_주기는_회사가_정한다():
    """주기를 코드에 박으면 다음 회사에서 그대로 틀린다.

    시내는 보통 5근2휴, 마을은 6근1휴, 성민은 4근2휴다.
    """
    assert DEFAULT_CYCLE.work_days == 5 and DEFAULT_CYCLE.rest_days == 2
    assert SUNGMIN.length == 12
    assert Cycle(5, 2).length == 14
    assert Cycle(6, 1).length == 14
    assert Cycle(5, 1).length == 12


def test_근무_블록_뒤마다_이틀씩_쉰다():
    # 근무 4(0~3) · 휴무 2(4~5) · 근무 4(6~9) · 휴무 2(10~11)
    assert SUNGMIN.rest_phases() == [4, 5, 10, 11]
    assert Cycle(5, 1).rest_phases() == [5, 11]


def test_근무_블록은_오후_오전_순으로_번갈아_간다():
    """블록을 하나만 두면 매 블록이 오후로 고정된다 (2020 실측 교대율 97%)."""
    first = [SUNGMIN.state(p)[1] for p in range(0, 4)]
    second = [SUNGMIN.state(p)[1] for p in range(6, 10)]
    assert first == [Shift.PM] * 4
    assert second == [Shift.AM] * 4


def test_주기가_바뀌면_쉬는_날도_바뀐다():
    """위상 숫자는 주기에 종속이다 — 프레임이 주기를 함께 들고 다녀야 한다."""
    def rest(cycle):
        f = _frame_one_vehicle(cycle=cycle)
        return [d.date.day for d in frame_days(f, "1001", month_dates(2026, 9))][:0] or [
            d.date.day for d in frame_days(f, "1001", month_dates(2026, 9)) if not d.working
        ]
    assert rest(Cycle(4, 2))[:4] == [5, 6, 11, 12]
    assert rest(Cycle(5, 1))[:4] == [6, 12, 18, 24]
    assert rest(Cycle(5, 2))[:4] == [6, 7, 13, 14]


# ── 사장님이 직접 말한 날짜 ─────────────────────────────────────────


def test_1일부터_일한_짝꿍은_6일_12일에_쉰다():
    """사장님이 직접 말한 날짜 — "1일부터 일했으면 6일에 쉬고 12일에 쉬고"."""
    frame = _frame_one_vehicle(phase=0)  # 9/1 이 사이클 첫날
    days = frame_days(frame, "1001", month_dates(2026, 9))
    rest = [d.date.day for d in days if not d.working]
    assert rest[:6] == [5, 6, 11, 12, 17, 18]
    # 휴무 블록의 끝날이 6일·12일이다
    assert 6 in rest and 12 in rest


def test_바로_밑_차량은_하루_뒤에_쉰다():
    phases = staircase_phases(["1001", "1002", "1003"], base_phase=0, cycle=SUNGMIN)
    frame = BaseFrame(epoch=EPOCH, phases=phases, cycle=SUNGMIN)
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

    # 9/30 → 10/1 이 이어지는지: 근무·휴무 순열이 주기를 그대로 유지한다
    for i, day in enumerate(joined):
        working, _ = SUNGMIN.state(i)
        assert day.working is working


def test_한_달_근무일수는_20일_안팎이다():
    """전원 평균 20.0일(2,142칸 ÷ 107명)과 맞아야 스페어가 놀지 않는다."""
    mf = build_month_frame(_frame_one_vehicle(), ["1001"], 2026, 9)  # 30일
    worked = len(mf.work["김정기"])
    assert worked == 30 - len(mf.rest["김정기"])
    assert 19 <= worked <= 21


# ── 감차 1순위 ──────────────────────────────────────────────────────


def test_14대_계단이면_하루에_쉬는_차가_고르게_퍼진다():
    vehicles = [f"10{i:02d}" for i in range(14)]
    frame = BaseFrame(epoch=EPOCH, phases=staircase_phases(vehicles, cycle=SUNGMIN), cycle=SUNGMIN)
    mf = build_month_frame(frame, vehicles, 2026, 9)

    counts = [len(mf.resting_vehicles(d)) for d in mf.dates]
    # 14 × 4/12 = 4.67 → 하루 4~6대. 등록 대수(14)가 주기(12)의 배수가 아니라
    # 두 위상에 차가 두 대씩 겹치고, 그만큼 날마다 ±1 이 흔들린다.
    # 평일 12대를 채우려면 2~3대는 스페어 몫이다.
    assert set(counts) <= {4, 5, 6}
    assert 4.3 <= sum(counts) / len(counts) <= 5.0


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
        phases=staircase_phases(vehicles, base_phase=4, cycle=SUNGMIN),
        roles={v: (f"정{v}", f"부{v}") for v in vehicles},
        cycle=SUNGMIN,
    )
    roster = _roster_from_frame(truth, vehicles, 2026, 7)
    home = {f"정{v}": v for v in vehicles} | {f"부{v}": v for v in vehicles}

    est = estimate_anchor(roster, home, epoch=dt.date(2026, 7, 1), cycle=SUNGMIN)

    assert est.frame.phases == truth.phases
    assert est.frame.roles == truth.roles
    assert est.overall_fit > 0.99


def test_실적이_없으면_차량_순서대로_계단을_새로_시작한다():
    g = DepotGroup(name="가좌", vehicles=["1001", "1002"])
    frame = new_anchor([g], epoch=EPOCH, cycle=SUNGMIN)
    # 2번 차는 하루 늦게 쉬므로 위상은 하루 뒤처진다
    assert frame.phases == {"1001": 0, "1002": SUNGMIN.length - 1}
    assert frame.cycle == SUNGMIN


def test_실적이_비면_추정은_거부한다():
    empty = MonthlyRoster(year=2026, month=7, division="지선")
    with pytest.raises(ValueError):
        estimate_anchor(empty, {})
