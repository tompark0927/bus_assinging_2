"""검산 모드 테스트.

이 기능은 **오탐이 없는 것**이 전부라, 테스트도 '위반을 찾는가'보다
'멀쩡한 표를 틀렸다고 하지 않는가'에 무게를 둔다. 실데이터에서 확인한
두 가지 함정(고정 순번 양식, 달마다 움직이는 근무일수)을 회귀로 박아 둔다.
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from busync_engine.inspector import inspect_roster
from busync_engine.models import CellState, DayEntry, DepotGroup, MonthlyRoster
from busync_engine.policy import CompanyPolicy

POLICY = CompanyPolicy().effective()


def _roster(days: int = 30, vehicles: int = 6, rotate: bool = True) -> MonthlyRoster:
    """실제 규칙을 따르는 정상 배차표.

    차량마다 짝궁 2인(A/P)이 붙고, 나흘에 하루 함께 쉬며, 쉬고 나면
    오전↔오후를 맞바꾼다(실측 표준). 근무일수는 22~23일로 실물과 같다.
    """
    r = MonthlyRoster(year=2026, month=9, division="테스트")
    vs = [f"V{i}" for i in range(1, vehicles + 1)]
    r.groups.append(DepotGroup(name="본선", vehicles=vs))
    for k in range(days):
        d = dt.date(2026, 9, 1) + dt.timedelta(days=k)
        for i, v in enumerate(vs):
            # 로테이션: 매일 한 칸씩 당긴다
            slot = ((i - k) % vehicles) + 1 if rotate else i + 1
            resting = (k + i) % 4 == 3      # 차량마다 다른 날 쉰다
            # 휴무를 한 번 거칠 때마다 짝궁끼리 오전/오후 교대
            swapped = ((k + i) // 4) % 2 == 1
            a, p = (f"P{i}", f"A{i}") if swapped else (f"A{i}", f"P{i}")
            r.entries[(d, v)] = DayEntry(
                date=d, vehicle=v, slot_index=slot, slot_label=str(slot),
                am=CellState(driver=None if resting else a,
                             leave="휴" if resting else None, raw=""),
                pm=CellState(driver=None if resting else p,
                             leave="휴" if resting else None, raw=""),
            )
    return r


def _by_rule(rep) -> dict[str, int]:
    return {c.rule: c.violations for c in rep.checks}


def test_clean_roster_has_no_findings():
    """정상 배차표에서는 아무것도 나오면 안 된다 — 오탐 0이 이 기능의 전부."""
    rep = inspect_roster(_roster(), POLICY)
    assert rep.findings == [], [f.title for f in rep.findings]


def test_detects_double_booking():
    r = _roster()
    d = dt.date(2026, 9, 10)
    # V2 오전을 V1 오전과 같은 사람으로 → 같은 날 두 자리
    e = r.entries[(d, "V2")]
    r.entries[(d, "V2")] = DayEntry(
        date=d, vehicle="V2", slot_index=e.slot_index, slot_label=e.slot_label,
        am=CellState(driver=r.entries[(d, "V1")].am.driver), pm=e.pm,
    )
    assert _by_rule(inspect_roster(r, POLICY))["E1"] == 1


def test_detects_empty_seat_on_operating_vehicle():
    """운행하는 차량(순번 있음)인데 기사도 휴무표기도 없는 칸."""
    r = _roster()
    d = dt.date(2026, 9, 12)
    e = r.entries[(d, "V3")]
    r.entries[(d, "V3")] = DayEntry(
        date=d, vehicle="V3", slot_index=e.slot_index, slot_label=e.slot_label,
        am=CellState(), pm=e.pm,
    )
    assert _by_rule(inspect_roster(r, POLICY))["E2"] == 1


def test_resting_vehicle_empty_is_not_a_finding():
    """휴차(순번 없음)는 비어 있는 게 정상 — 여기서 오탐이 나면 못 쓴다."""
    r = _roster()
    d = dt.date(2026, 9, 12)
    r.entries[(d, "V3")] = DayEntry(
        date=d, vehicle="V3", slot_index=None, am=CellState(), pm=CellState(),
    )
    assert _by_rule(inspect_roster(r, POLICY))["E2"] == 0


def test_detects_consecutive_overrun():
    """쉬는 날을 없애면 연속근무 초과가 잡힌다."""
    r = _roster()
    for (d, v), e in list(r.entries.items()):
        i = int(v[1:]) - 1
        r.entries[(d, v)] = DayEntry(
            date=d, vehicle=v, slot_index=e.slot_index, slot_label=e.slot_label,
            am=CellState(driver=f"A{i}"), pm=CellState(driver=f"P{i}"),
        )
    assert _by_rule(inspect_roster(r, POLICY))["E3"] > 0


def test_static_slot_sheet_skips_rotation_checks():
    """순번이 한 달 고정인 양식(월간배차)에서는 순번 검사를 건너뛴다.

    실데이터에서 이걸 안 걸렀을 때 기사 111명 중 14명이 '이른 순번 쏠림'으로
    잡혔다. 고정 라벨이라 정의상 매일 같은 값이었을 뿐, 실제 출발 순서는
    일일배차의 조율로 매일 돌고 있었다.
    """
    r = _roster(rotate=False)
    rep = inspect_roster(r, POLICY)
    checks = {c.rule: c for c in rep.checks}
    assert checks["W3"].checked == 0 and checks["W3"].note
    assert checks["I2"].checked == 0 and checks["I2"].note
    assert not [f for f in rep.findings if f.rule in ("W3", "I2")]


def test_work_days_compared_to_cohort_not_fixed_band():
    """근무일수는 설정 밴드가 아니라 그 달 동료들의 중앙값과 비교한다.

    실데이터에서 2월(28일)은 대부분 19~20일 근무라 고정 밴드(20~23)로 재면
    110명 중 53명이 '미달'로 떴다. 배차가 틀린 게 아니라 자가 틀린 것이다.
    """
    r = _roster(days=28)
    rep = inspect_roster(r, POLICY)
    assert not [f for f in rep.findings if f.rule == "W2" and f.severity == "warn"]

    # 한 차량이 달 중반부터 통째로 빠지면 그 짝궁 둘은 잡아야 한다
    for (d, v), e in list(r.entries.items()):
        if v == "V1" and d.day > 10:
            r.entries[(d, v)] = DayEntry(
                date=d, vehicle=v, slot_index=e.slot_index, slot_label=e.slot_label,
                am=CellState(leave="휴"), pm=CellState(leave="휴"),
            )
    hits = {f.driver for f in inspect_roster(r, POLICY).findings if f.rule == "W2"}
    assert {"A0", "P0"} <= hits, hits
