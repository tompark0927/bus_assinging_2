"""평일 상시 감차 회귀 테스트.

실제 사고: 성민버스는 노선당 등록 14대 중 평일 12·토 11·일공휴일 10대만
운행하는데, 8월 배차표가 '전 차량 매일 운행'으로 짜여 슬롯이 2160 → 2604 로
20% 부풀었다. 인력이 모자란 것처럼 되자 솔버가 근무일 밴드를 완화하면서
짝궁 상보(같은 날 휴무 · 오전/오후 스왑)까지 무너졌다.

원인은 `expand_pattern` 의 `if cls != DayClass.WEEKDAY` — "감차는 주말·공휴일
에만" 이라는 전제였다.
"""
import datetime as dt

from busync_engine.config import (
    DayClass, GroupReductionConfig, ReductionCalendar, ReductionMode,
)
from busync_engine.importer.inference import RotationRule
from busync_engine.rotation import expand_pattern


def _fleet(n: int) -> list[str]:
    return [f"V{i:02d}" for i in range(1, n + 1)]


def _pattern(rest_counts, fleet_size=14, days=("2026-08-03", "2026-08-08", "2026-08-09")):
    """월(평일) · 토 · 일 하루씩 전개해 운행 대수를 센다."""
    vehicles = _fleet(fleet_size)
    rule = RotationRule(
        group="16", size=fleet_size,
        perm={s: ((s - 1 - 1) % fleet_size) + 1 for s in range(1, fleet_size + 1)},
        support=1.0,
    )
    last = {v: i + 1 for i, v in enumerate(vehicles)}
    cfg = GroupReductionConfig(
        mode=ReductionMode.VEHICLE_POINTER,
        rest_counts=rest_counts,
        pointer_order=vehicles,
    )
    out = {}
    for ds in days:
        d = dt.date.fromisoformat(ds)
        pat = expand_pattern(rule, last, d, d, ReductionCalendar(), cfg, None)
        out[ds] = sum(1 for cell in pat.values() if cell.operating)
    return out


def test_평일에도_감차가_적용된다():
    # 등록 14대 · 평일 2대 · 토 3대 · 일 4대 감차 → 12 / 11 / 10
    got = _pattern({DayClass.WEEKDAY: 2, DayClass.SAT: 3, DayClass.SUNHOL: 4})
    assert got["2026-08-03"] == 12, f"평일 12대여야 하는데 {got['2026-08-03']}대"
    assert got["2026-08-08"] == 11, f"토요일 11대여야 하는데 {got['2026-08-08']}대"
    assert got["2026-08-09"] == 10, f"일요일 10대여야 하는데 {got['2026-08-09']}대"


def test_주말만_감차하는_회사는_평일이_그대로다():
    """WEEKDAY 키가 없으면 평일 감차 0 — 기존 회사 동작이 바뀌면 안 된다."""
    got = _pattern({DayClass.SAT: 3, DayClass.SUNHOL: 4})
    assert got["2026-08-03"] == 14, "평일은 전 차량 운행이어야 한다"
    assert got["2026-08-08"] == 11
    assert got["2026-08-09"] == 10
