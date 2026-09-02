"""틀에 안 박힌 기사가 0일로 떨어지지 않는가 — 회귀 테스트.

기본 틀을 하드로 박으면서 근무일수 **하한**을 뺐다. 하드 하한은 남은 칸이
인원보다 적을 때 모델을 통째로 죽이기 때문이다. 그런데 하한이 아예 없으면
솔버 입장에서는 한 사람을 0일로 두는 해와 고르게 나눈 해의 목적함수 값이
같다 — 실제로 기초 데이터상 메인인 기사(안정선·이금자·임미정)가 10월
배차표에서 한 칸도 못 받았다.

그래서 하한을 **소프트**로 되살렸다. 어길 수는 있지만 비싸다.
"""
import datetime as dt

from busync_engine.solver import AssignmentProblem, solve


def _problem(floor: int, spares: int = 4, days: int = 14):
    """차량 2대(정·부 4명 붙박이) + 스페어. 매일 두 대 모두 운행."""
    dates = [dt.date(2026, 10, 1) + dt.timedelta(days=i) for i in range(days)]
    vehicles = ["V1", "V2"]
    home = {"A1": "V1", "A2": "V1", "B1": "V2", "B2": "V2"}
    pool = [f"S{i}" for i in range(1, spares + 1)]
    drivers = sorted(list(home) + pool)
    operating = {(d, v, s) for d in dates for v in vehicles for s in ("A", "P")}
    return AssignmentProblem(
        dates=dates,
        operating=operating,
        drivers=drivers,
        leaves={},
        home_vehicle=home,
        partner={"A1": "A2", "A2": "A1", "B1": "B2", "B2": "B1"},
        driver_group={k: "G" for k in drivers},
        vehicle_group={v: "G" for v in vehicles},
        affinity={},
        max_consecutive=6,
        work_days_band=(0, days),
        work_days_floor=floor,
    )


def _loads(asg, drivers, dates):
    """기사 -> 근무일수"""
    worked = {(k, d) for (d, _v, _s), k in asg.cells.items()}
    return {k: sum(1 for d in dates if (k, d) in worked) for k in drivers}


def test_하한이_없으면_아무도_안_챙긴다():
    """지금 상태를 기록해 둔다 — 하한 0이면 편차가 벌어질 수 있다."""
    p = _problem(floor=0)
    asg = solve(p, time_limit_s=20)
    loads = _loads(asg, p.drivers, p.dates)
    pool = [loads[k] for k in p.drivers if k not in p.home_vehicle]

    # 총량은 슬롯 수를 넘지 않는다 (모델이 성립하는지 확인)
    assert sum(loads.values()) <= len(p.operating)
    assert min(pool) >= 0


def test_소프트_하한이_있으면_0일이_안_나온다():
    p = _problem(floor=6)
    asg = solve(p, time_limit_s=20)
    loads = _loads(asg, p.drivers, p.dates)
    pool = {k: n for k, n in loads.items() if k not in p.home_vehicle}

    assert min(pool.values()) > 0, f"한 칸도 못 받은 기사가 있다: {pool}"
    # 하한 근처로 붙는다 — 정확히 지킬 수 없는 달도 있으므로 여유를 둔다
    assert min(pool.values()) >= 4, pool


def test_하한이_앉을_자리보다_커도_죽지_않는다():
    """소프트인 이유. 하드였다면 여기서 INFEASIBLE 이 난다."""
    # 슬롯 56칸(14일 × 2대 × 2교대)에 기사 8명인데 1인당 14일을 요구한다
    p = _problem(floor=14, spares=4)
    asg = solve(p, time_limit_s=20)

    assert asg.status in ("OPTIMAL", "FEASIBLE")
    assert len(asg.cells) > 0


def test_붙박이_메인은_하한의_영향을_안_받는다():
    """틀이 이미 근무일을 확정했다 — 하한을 겹쳐 걸면 틀이 흔들린다."""
    p = _problem(floor=6)
    p.fixed_cells = {
        (d, "V1", "A"): "A1" for d in p.dates[:5]
    }
    p.frame_hard = True
    asg = solve(p, time_limit_s=20)

    for d in p.dates[:5]:
        assert asg.cells.get((d, "V1", "A")) == "A1"
