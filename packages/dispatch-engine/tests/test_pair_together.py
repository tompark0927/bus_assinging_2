"""짝궁(정·부)은 같은 날 함께 근무하거나 함께 쉰다 — 회귀 테스트.

실측 근거(성민 7월 16번 노선, 정·부 14쌍 × 31일 = 434일):
  · 한쪽만 근무한 날 **0일**
  · 함께 일한 282일은 전부 본인 차량에 오전/오후로 나눠 탐
  · 함께 쉰 152일 중 78일은 그 차가 나가야 해서 스페어가 채움

이 규칙이 솔버에 없어서 8월 생성본의 짝궁 휴무 일치율이 33% 까지 떨어졌다.
담당자가 화면에서 가장 먼저 알아채는 어긋남이라 반드시 지켜야 한다.
"""
import datetime as dt

from busync_engine.solver import AssignmentProblem, SolverWeights, solve


def _problem(days=14, extra_spares=4):
    """차량 2대(정·부 4명) + 스페어. 매일 두 대 모두 운행."""
    dates = [dt.date(2026, 8, 1) + dt.timedelta(days=i) for i in range(days)]
    vehicles = ["V1", "V2"]
    fixed = {"A1": "V1", "A2": "V1", "B1": "V2", "B2": "V2"}
    spares = [f"S{i}" for i in range(1, extra_spares + 1)]
    drivers = sorted(list(fixed) + spares)
    operating = {(d, v, s) for d in dates for v in vehicles for s in ("A", "P")}
    partner = {"A1": "A2", "A2": "A1", "B1": "B2", "B2": "B1"}
    return AssignmentProblem(
        dates=dates,
        operating=operating,
        drivers=drivers,
        leaves={},
        home_vehicle=fixed,
        partner=partner,
        driver_group={k: "G" for k in drivers},
        vehicle_group={v: "G" for v in vehicles},
        affinity={},
        max_consecutive=6,
        work_days_band=(0, days),
    )


def _pair_stats(asg, pairs, dates):
    work = {}
    for (d, v, s), k in asg.cells.items():
        work.setdefault(k, {})[d] = s
    split = same_shift = 0
    for a, b in pairs:
        A, B = work.get(a, {}), work.get(b, {})
        for d in dates:
            ina, inb = d in A, d in B
            if ina != inb:
                split += 1
            elif ina and inb and A[d] == B[d]:
                same_shift += 1
    return split, same_shift


def test_짝궁은_한쪽만_쉬지_않는다():
    p = _problem()
    asg = solve(p, SolverWeights(), time_limit_s=20)
    split, same_shift = _pair_stats(asg, [("A1", "A2"), ("B1", "B2")], p.dates)
    assert split == 0, f"한쪽만 근무한 날이 {split}일 있다 (0이어야 함)"


def test_함께_일하는_날은_오전_오후를_나눈다():
    p = _problem()
    asg = solve(p, SolverWeights(), time_limit_s=20)
    _, same_shift = _pair_stats(asg, [("A1", "A2"), ("B1", "B2")], p.dates)
    assert same_shift == 0, f"짝궁이 같은 시프트인 날이 {same_shift}일 있다"


def test_짝궁_가중치는_본인차량보다_크다():
    """어길 바에는 다른 걸 포기하도록 — 우선순위가 뒤집히면 33% 로 돌아간다."""
    w = SolverWeights()
    assert w.pair_together > w.own_vehicle
