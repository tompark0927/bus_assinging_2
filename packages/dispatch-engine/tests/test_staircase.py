"""계단식 메인 배치 — 회귀 테스트.

담당자가 실제로 배차를 짜는 순서:
  1. 메인(정·부)을 4일근무 + 2일휴무 주기로, 차량마다 하루씩 밀어(계단식) 깔고
  2. 연차를 빼고
  3. 남는 자리를 스페어가 비슷한 패턴으로 메운다

이 1단계가 없으면 CP-SAT 는 근무일수 밴드(H5)와 연속근무 한도(H3)만 보고
'하루 일하고 하루 쉬는' 톱니도 똑같이 정답으로 친다. 실제로 성민 8월
생성본에서 메인 휴무블록 1일이 58%까지 올라갔다 — 7월 실측은 28%다.
그래서 계획을 먼저 깔고(_staircase_rest) 솔버에 하드로 넘긴다.

실측 근거(성민 7월, 메인 85명):
  · 휴무 시작 간격 6일이 최빈(47%), 휴무 블록 2일이 최빈(51%)
  · 근무 블록 4일이 56%
"""
import datetime as dt

from busync_engine.generate import _level_rest, _rest_cycle, _split_by


def _days(n=31, y=2026, mth=8):
    return [dt.date(y, mth, 1) + dt.timedelta(days=i) for i in range(n)]


def test_전월_실적에서_4일근무_2일휴무_주기를_읽는다():
    days = _days(30, 2026, 6)
    # 4일 일하고 2일 쉬는 사람 10명
    work = {
        f"K{i}": {d for j, d in enumerate(days) if (j + i) % 6 >= 2}
        for i in range(10)
    }
    cycle, rest_len = _rest_cycle(work, days)
    assert (cycle, rest_len) == (6, 2)


def test_노선_운행대수를_출발지그룹_크기대로_나눈다():
    # 성민 16번: 등록 14대(가좌 7 + 동춘 7), 평일 12 · 토 11 · 일공휴일 10.
    # 7월 실측이 평일 6+6, 토 6+5, 휴일 5+5 이다.
    assert _split_by(12, [7, 7], [7, 7]) == [6, 6]
    assert _split_by(11, [7, 7], [7, 7]) == [6, 5]
    assert _split_by(10, [7, 7], [7, 7]) == [5, 5]


def test_필요보다_많이_쉬는_날은_남기지_않는다():
    """계획은 하드로 박히므로, 넘치게 쉬는 날이 남으면 그만큼 슬롯이 빈다."""
    days = _days(30, 2026, 6)
    drivers = [f"K{i}" for i in range(12)]
    rest = {k: {d for j, d in enumerate(days) if (j + i) % 6 < 2}
            for i, k in enumerate(drivers)}
    # 일요일마다 더 많이 쉬어야 하는 달
    need = {d: (6 if d.weekday() == 6 else 3) for d in days}
    out = _level_rest(rest, days, need, {}, (0, 30), None, 6)
    for d in days:
        got = sum(1 for k in drivers if d in out[k])
        assert got <= need[d], f"{d}: {got}명 쉼 > 필요 {need[d]}명"


def test_짝궁은_계획에서도_같은_날_쉰다():
    days = _days(30, 2026, 6)
    drivers = [f"K{i}" for i in range(12)]
    partner = {}
    for i in range(0, 12, 2):
        partner[f"K{i}"], partner[f"K{i+1}"] = f"K{i+1}", f"K{i}"
    rest = {k: {d for j, d in enumerate(days) if (j + i // 2) % 6 < 2}
            for i, k in enumerate(drivers)}
    need = {d: (6 if d.weekday() == 6 else 4) for d in days}
    out = _level_rest(rest, days, need, partner, (0, 30), None, 6)
    for i in range(0, 12, 2):
        assert out[f"K{i}"] == out[f"K{i+1}"], f"K{i} 짝궁 휴무가 어긋남"


def test_연차는_계획이_건드리지_않는다():
    days = _days(30, 2026, 6)
    drivers = [f"K{i}" for i in range(12)]
    rest = {k: {d for j, d in enumerate(days) if (j + i) % 6 < 2}
            for i, k in enumerate(drivers)}
    leave = {"K0": {days[10], days[11], days[12]}}
    for d in leave["K0"]:
        rest["K0"].add(d)
    need = {d: (6 if d.weekday() == 6 else 3) for d in days}
    out = _level_rest(rest, days, need, {}, (0, 30), leave, 6)
    assert leave["K0"] <= out["K0"]


def test_연속근무_한도를_넘는_계획은_만들지_않는다():
    """계획이 하드라서, 8일짜리 근무 블록이 남으면 H3와 부딪혀 모델이 깨진다."""
    days = _days(31, 2026, 8)
    drivers = [f"K{i}" for i in range(14)]
    rest = {k: {d for j, d in enumerate(days) if (j + i) % 6 < 2}
            for i, k in enumerate(drivers)}
    need = {d: (7 if d.weekday() >= 5 else 4) for d in days}
    out = _level_rest(rest, days, need, {}, (0, 31), None, 6)
    for k in drivers:
        run = 0
        for d in days:
            run = 0 if d in out[k] else run + 1
            assert run <= 6, f"{k}: 연속 근무 {run}일"
