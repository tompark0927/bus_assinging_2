"""2단계: 기사 배정 (Google OR-Tools CP-SAT).

결정변수: x[k, d, v, s] — 기사 k가 날짜 d에 차량 v의 시프트 s(A/P) 근무.

하드 제약 (스펙 4)
    H1. 운행 (d,v)마다 오전 1명 + 오후 1명 정확히.
    H2. 기사 1인 1일 최대 1시프트.
    H3. 연속 근무 ≤ max_consecutive(기본 6).
    H4. 승인 휴무일은 OFF 고정.
    H5. 월 근무일수 밴드 (입퇴사자는 호출측에서 일할 조정).
    H6. (옵션) 오후 근무 다음날 오전 금지.

소프트 제약 (가중 페널티)
    S1. 고정기사는 본인 차량에 (w 높음. 실측: 위반은 월 3건 수준).
    S2. 휴무 직후 짝궁과 A/P 스왑 (실측 준수율 지선 74%/간선 69%).
    S3. 같은 시프트 연속 블록 유지 (연속 근무일에 시프트 변경 페널티).
    S4. 요일 선호 반영.
    S5. 예비 투입 부담 균등화 + 차량 숙련도(과거 탑승 빈도) 반영.

공정성 (F1~F3)은 fairness.py 리포트 + 목적함수 분산항으로 반영.
LLM은 이 모듈에 관여하지 않는다 — 결과는 결정론적·설명가능 (스펙 0).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

from ortools.sat.python import cp_model

from .models import Shift


@dataclass
class SolverWeights:
    own_vehicle: int = 1000        # S1
    pair_together: int = 4000      # S6: 짝궁은 같은 날 함께 근무/휴무 (실측 100%)
    swap_after_leave: int = 30     # S2: 휴무 복귀 후 시프트 유지 시 페널티
    keep_shift: int = 60           # S3: 연속 근무일 시프트 변경 시 페널티
    weekday_pref: int = 20         # S4
    vehicle_affinity: int = 8      # S5: 숙련도 — 과거 탑승 빈도 기반
    group_affinity: int = 15       # 소속 그룹 밖 투입 페널티 (하드 금지 — 실측 교차 88건/월)
    solo_rest: int = 300           # S7: 하루만 쉬고 나오는 톱니 (실측 30%)
    solo_work: int = 500           # S7: 하루만 나오고 다시 쉬는 톱니 (실측 9%)
    spare_balance: int = 5         # S5: 예비 투입 횟수 분산
    fairness_lambda: int = 3       # λ: 공정성 분산항 (담당자 슬라이더 노출용)


@dataclass
class AssignmentProblem:
    """한 사업부-월의 배정 문제."""

    dates: list[dt.date]
    # 운행 슬롯: (date, vehicle, shift) — 1단계 패턴의 operating=True에서 전개.
    # 결행 등으로 한쪽 시프트만 비는 케이스를 표현하기 위해 시프트 단위로 관리.
    operating: set[tuple[dt.date, str, str]]
    drivers: list[str]
    # 기본 틀에서 확정된 메인 배정 — (날짜, 차량, 시프트) -> 기사.
    # 솔버는 이 칸을 풀지 않는다. 붙박이로 박고 **스페어 자리만** 푼다.
    fixed_cells: dict[tuple[dt.date, str, str], str] = field(default_factory=dict)
    # 기본 틀에서 확정된 메인의 휴무일. 이 날은 다른 차에도 못 앉는다 —
    # 안 막으면 솔버가 쉬는 사람을 남는 자리에 끌어다 써서 계단이 무너진다.
    fixed_off: dict[str, set[dt.date]] = field(default_factory=dict)
    # S8: 스페어가 톱니로 쉬지 않게 미리 깔아둔 '쉬어야 할 날' (선택)
    preferred_rest: dict[str, set[dt.date]] = field(default_factory=dict)
    # H4: 기사별 휴무(OFF 고정)일
    leaves: dict[str, set[dt.date]] = field(default_factory=dict)
    # 백테스트 모드: 기사별 근무일을 실측으로 고정 (None이면 자유 — 생성 모드)
    forced_work_days: Optional[dict[str, set[dt.date]]] = None
    # 프로필
    home_vehicle: dict[str, str] = field(default_factory=dict)      # 고정기사 -> 본인차량
    partner: dict[str, str] = field(default_factory=dict)           # 짝궁 (양방향)
    driver_group: dict[str, str] = field(default_factory=dict)
    vehicle_group: dict[str, str] = field(default_factory=dict)
    # S5 숙련도: (기사, 차량) -> 과거 탑승 횟수
    affinity: dict[tuple[str, str], int] = field(default_factory=dict)
    # S4: 기사 -> {요일(0=월): 휴무선호 0..1}
    weekday_off_pref: dict[str, dict[int, float]] = field(default_factory=dict)
    # 풀(비고정) 기사 시프트 특화: 기사 -> 과거 오후 근무 비율 (0..1)
    pm_ratio: dict[str, float] = field(default_factory=dict)
    # 월초 페이즈 앵커: 기사 -> (첫 근무일, 오후여부). 실무에선 월초 게시표가
    # 항상 존재하므로 초기 조건으로 정당 (전월 오프셋의 페이즈 버전).
    first_shift_anchor: dict[str, tuple[dt.date, bool]] = field(default_factory=dict)
    # 직전월 말 상태 (시프트 연속성·스왑 판단용): 기사 -> 마지막 근무가 오후였나/언제였나
    prev_pm: dict[str, bool] = field(default_factory=dict)
    prev_last_work: dict[str, dt.date] = field(default_factory=dict)
    # H5: 근무일수 밴드 (생성 모드에서만 유효)
    work_days_band: tuple[int, int] = (0, 31)
    max_consecutive: int = 6
    forbid_pm_to_am: bool = False  # H6 스위치
    # S1을 하드로 (백테스트·기본 생성: 실측 위반 월 3건 수준이라 사실상 하드)
    hard_own_vehicle: bool = False
    # 후보 가지치기: 기사는 (본인차량 | 과거 탑승 차량 | 같은 그룹)만 몰 수 있다
    prune_candidates: bool = True
    # 짝 교대 규칙: joint_solo(동시휴→교대/단독휴→유지) | always_swap | manual
    pair_swap_rule: str = "joint_solo"
    # 수급 부족 시 미충원 슬롯 허용 (생성 모드): 해당 슬롯은 '결행 후보'로 리포트
    allow_unfilled: bool = False
    # 예비 부담 균등화 (생성 모드): 비고정 기사 근무일수 max-min 최소화
    spare_balance_enabled: bool = True
    fairness_lambda: int = 3


@dataclass
class Assignment:
    """(date, vehicle, shift) -> driver"""

    cells: dict[tuple[dt.date, str, str], str]
    objective: float
    status: str
    # 설명가능성: 셀별 기여 페널티 내역 (why this driver here)
    notes: dict[tuple[dt.date, str, str], str] = field(default_factory=dict)
    # 수급 부족으로 미충원된 슬롯 (결행 후보 — 담당자 확인 대상)
    unfilled: list[tuple[dt.date, str, str]] = field(default_factory=list)
    # 당일 결원으로 빠진 기사: 슬롯 -> 원래 배정자 (국소 수리 입력)
    absences: dict[tuple[dt.date, str, str], str] = field(default_factory=dict)


def solve(problem: AssignmentProblem, weights: SolverWeights | None = None,
          time_limit_s: float = 60.0) -> Assignment:
    w = weights or SolverWeights()
    m = cp_model.CpModel()
    dates = problem.dates
    date_idx = {d: i for i, d in enumerate(dates)}

    # 슬롯 목록
    slots: list[tuple[dt.date, str, str]] = sorted(problem.operating)

    # 가용성: 기사 k가 날짜 d에 근무 가능한가
    def available(k: str, d: dt.date) -> bool:
        if d in problem.leaves.get(k, ()):  # H4
            return False
        if d in problem.fixed_off.get(k, ()):  # H0: 기본 틀 휴무일
            return False
        if problem.forced_work_days is not None:
            return d in problem.forced_work_days.get(k, ())
        return True

    def candidate(k: str, v: str) -> bool:
        if not problem.prune_candidates:
            return True
        if problem.home_vehicle.get(k) == v:
            return True
        if problem.affinity.get((k, v), 0) > 0:
            return True
        kg, vg = problem.driver_group.get(k), problem.vehicle_group.get(v)
        return kg is None or vg is None or kg == vg

    x: dict[tuple[str, dt.date, str, str], cp_model.IntVar] = {}
    for (d, v, s) in slots:
        for k in problem.drivers:
            if available(k, d) and candidate(k, v):
                x[(k, d, v, s)] = m.NewBoolVar(f"x_{k}_{d}_{v}_{s}")

    # H0: 기본 틀 붙박이. 메인(정·부)의 근무일·시프트·차량은 이미 확정이라
    # 탐색 대상이 아니다. 여기서 1로 박으면 H1(칸당 1명)이 나머지 후보를,
    # H2(1인 1일 1시프트)가 그 사람의 다른 칸을 자동으로 0으로 만든다.
    slot_set = set(slots)
    pinned_drivers: set[str] = set()
    for (d, v, s), k in problem.fixed_cells.items():
        if (d, v, s) not in slot_set:
            continue  # 그날 감차된 차 — 틀에는 근무지만 나갈 차가 없다
        key = (k, d, v, s)
        if key not in x:
            continue  # 승인 휴무·후보 제한과 겹침 — 스페어가 메운다
        m.Add(x[key] == 1)
        pinned_drivers.add(k)

    # H1: 운행 슬롯마다 정확히 1명 (allow_unfilled면 미충원 슬랙 + 큰 페널티)
    unfilled_penalties = []
    unfilled_vars: dict[tuple[dt.date, str, str], cp_model.IntVar] = {}
    for (d, v, s) in slots:
        vars_ = [x[(k, d, v, s)] for k in problem.drivers if (k, d, v, s) in x]
        if not vars_ and not problem.allow_unfilled:
            raise ValueError(f"슬롯 {d} {v} {s}에 배정 가능한 기사가 없음")
        if problem.allow_unfilled:
            sv = m.NewBoolVar(f"un_{d}_{v}_{s}")
            m.Add(sum(vars_) + sv == 1)
            unfilled_vars[(d, v, s)] = sv
            unfilled_penalties.append(sv * 10000)
        else:
            m.AddExactlyOne(vars_)

    # 기사-일 근무 지시변수 works[k][d]
    works: dict[tuple[str, dt.date], cp_model.IntVar] = {}
    # 시프트 지시변수 shift_pm[k][d] (그날 오후 근무 여부)
    shift_pm: dict[tuple[str, dt.date], cp_model.IntVar] = {}
    for k in problem.drivers:
        for d in dates:
            day_vars = [x[(k, d, v, s)] for (dd, v, s) in slots if dd == d
                        and (k, d, v, s) in x]
            if not day_vars:
                continue
            wv = m.NewBoolVar(f"w_{k}_{d}")
            m.Add(sum(day_vars) <= 1)          # H2
            m.Add(sum(day_vars) == 1).OnlyEnforceIf(wv)
            m.Add(sum(day_vars) == 0).OnlyEnforceIf(wv.Not())
            works[(k, d)] = wv
            pm_vars = [x[(k, d, v, s)] for (dd, v, s) in slots
                       if dd == d and s == "P" and (k, d, v, s) in x]
            pv = m.NewBoolVar(f"pm_{k}_{d}")
            if pm_vars:
                m.Add(sum(pm_vars) == 1).OnlyEnforceIf(pv)
                m.Add(sum(pm_vars) == 0).OnlyEnforceIf(pv.Not())
            else:
                m.Add(pv == 0)
            shift_pm[(k, d)] = pv

    # 백테스트 모드: 근무일 강제
    if problem.forced_work_days is not None:
        for k in problem.drivers:
            for d in problem.forced_work_days.get(k, ()):
                if (k, d) in works:
                    m.Add(works[(k, d)] == 1)
    else:
        # H5: 월 근무일수 밴드 — 가용일이 밴드 하한보다 적은 기사(연차·입퇴사)는
        # 가용일 기준으로 자동 일할 (스펙 2.8)
        lo, hi = problem.work_days_band
        for k in problem.drivers:
            if k in pinned_drivers:
                # 기본 틀이 이 사람의 근무일을 이미 확정했다. 밴드를 겹쳐 걸면
                # 12일 주기가 만드는 근무일수와 밴드(20~23)가 부딪혀 모델이
                # 통째로 INFEASIBLE 이 된다.
                continue
            kvars = [works[(k, d)] for d in dates if (k, d) in works]
            if kvars:
                # 계단식 계획(S8)이 있으면 근무일수 하한은 걸지 않는다.
                # 계획이 이미 '이 사람은 이 날들에 쉰다'를 정해 놨고, 하루에
                # 일할 수 있는 사람 수는 슬롯 수보다 딱 2명 많을 뿐이라
                # (2144 vs 2142) 근무일수는 계획이 사실상 확정한다.
                # 하한을 같이 걸면 '이 날 쉰다'와 '이만큼은 일해야 한다'가
                # 그룹 단위로 부딪혀 모델이 통째로 INFEASIBLE 이 된다 —
                # 기사는 같은 그룹 차량만 몰 수 있어서, 그룹 슬롯이 다 차면
                # 남는 사람은 일하고 싶어도 앉을 자리가 없기 때문이다.
                if not problem.preferred_rest.get(k):
                    m.Add(sum(kvars) >= min(lo, len(kvars)))
                m.Add(sum(kvars) <= hi)

    # H3: 연속 근무 ≤ max_consecutive
    win = problem.max_consecutive + 1
    for k in problem.drivers:
        for i in range(len(dates) - win + 1):
            span = [works[(k, dates[i + j])] for j in range(win)
                    if (k, dates[i + j]) in works]
            if len(span) == win:
                m.Add(sum(span) <= problem.max_consecutive)

    penalties: list[cp_model.LinearExpr] = list(unfilled_penalties)

    # ── S7: 근무·휴무를 덩어리로 (톱니 방지) ──
    # 성민 7월 실측(107명): 근무블록은 4일 57%·3일 17%, 휴무블록은 2일 51%.
    #
    # 근무일수 밴드(H5)와 연속근무 한도(H3)만으로는 이 모양이 나오지 않는다.
    # 총 근무일수만 맞으면 되니 솔버는 하루 일하고 하루 쉬는 톱니도 똑같이
    # 정답으로 친다. 실제로 8월 생성본은 휴무블록 1일이 66%까지 치솟았다.
    #
    # 큰 틀은 아래 S8(계단식 계획)이 하드로 잡는다. S7 이 맡는 건 그 계획에
    # 없는 사람과, 계획상 근무일이지만 그날 앉을 자리가 없어 쉬게 되는
    # 여유 인원의 하루다 — 그 하루를 이미 있는 휴무 블록 옆에 붙여 준다.
    # 하드로 못 거는 이유: 연차가 하루만 껴 있거나 월 경계에 걸리면 1일
    # 블록이 불가피하다 — 실측에도 30%/9% 존재한다.
    for k in problem.drivers:
        for i in range(1, len(dates) - 1):
            dp, dc, dn = dates[i - 1], dates[i], dates[i + 1]
            if (k, dp) not in works or (k, dc) not in works or (k, dn) not in works:
                continue
            wp, wc, wn = works[(k, dp)], works[(k, dc)], works[(k, dn)]
            # 일·쉼·일 → 하루짜리 휴무
            sr = m.NewBoolVar(f"solo_rest_{k}_{dc}")
            m.AddBoolAnd([wp, wc.Not(), wn]).OnlyEnforceIf(sr)
            m.AddBoolOr([wp.Not(), wc, wn.Not()]).OnlyEnforceIf(sr.Not())
            penalties.append(sr * w.solo_rest)
            # 쉼·일·쉼 → 하루짜리 근무
            sw = m.NewBoolVar(f"solo_work_{k}_{dc}")
            m.AddBoolAnd([wp.Not(), wc, wn.Not()]).OnlyEnforceIf(sw)
            m.AddBoolOr([wp, wc.Not(), wn]).OnlyEnforceIf(sw.Not())
            penalties.append(sw * w.solo_work)

    # ── S8: 미리 깔아둔 휴무일을 지킨다 (하드) ──
    # 메인(정·부)은 이제 H0(fixed_cells/fixed_off)가 통째로 확정하므로 여기
    # 오지 않는다. 남은 쓰임은 **스페어**다 — 스페어에게도 쉬는 날을 미리
    # 깔아 주면 하루 일하고 하루 쉬는 톱니가 안 생긴다.
    #
    # 소프트로는 안 된다. 가중치를 900에서 5000까지 올려도 90초 안에 준수율이
    # 67~70%에서 멈췄다 — 가중치 문제가 아니라 탐색 크기 문제다.
    for k, want_rest in problem.preferred_rest.items():
        for d in want_rest:
            if (k, d) in works:
                m.Add(works[(k, d)] == 0)
        # 힌트로도 준다 — 이 모양 근처에서 탐색을 시작하게 한다
        for d in dates:
            if (k, d) in works:
                m.AddHint(works[(k, d)], 0 if d in want_rest else 1)

    # H6: 오후 → 익일 오전 금지 (옵션)
    if problem.forbid_pm_to_am:
        for k in problem.drivers:
            for i in range(len(dates) - 1):
                d1, d2 = dates[i], dates[i + 1]
                if (k, d1) in shift_pm and (k, d2) in shift_pm and (k, d2) in works:
                    am2 = m.NewBoolVar(f"am_{k}_{d2}")
                    m.Add(am2 == 1).OnlyEnforceIf([works[(k, d2)], shift_pm[(k, d2)].Not()])
                    m.AddImplication(shift_pm[(k, d1)], am2.Not())

    # ── S6: 짝궁은 같은 날 함께 근무하거나 함께 쉰다 ──
    # 성민 7월 실측: 정·부 14쌍 × 31일 = 434일 중 '한쪽만 근무'가 **0일**이다.
    # 함께 일한 282일은 전부 본인 차량에 오전/오후로 나눠 탔고, 함께 쉰 152일
    # 중 78일은 그 차가 나가야 해서 스페어 2명이 채웠다.
    #
    # 이 규칙이 없으면 솔버가 한쪽만 쉬게 만드는 해를 자유롭게 고른다. 실제로
    # 8월 생성본의 짝궁 휴무 일치율이 33%까지 떨어졌다 — 담당자 눈에 가장 먼저
    # 띄는 어긋남이다.
    #
    # 하드로 걸지 않는 이유: 승인 휴무·입퇴사·연속근무 한도와 겹치면 해가 아예
    # 없어질 수 있다. 대신 가중치를 본인차량(1000)보다 높게 줘서, 어길 바에는
    # 다른 걸 포기하도록 만든다.
    # 'S6 하드 제약이 실제로 걸린' 짝 — 아래 S2 가 이걸 보고 동시휴로 판단한다
    pair_locked: set[str] = set()
    driver_set = set(problem.drivers)
    for k in problem.drivers:
        pk = problem.partner.get(k)
        # (k, pk) 쌍을 한 번만 — 사전순으로 앞선 쪽에서만 건다
        if not pk or pk >= k or pk not in driver_set:
            continue
        pair_locked.add(k)
        pair_locked.add(pk)
        for d in dates:
            if (k, d) not in works or (pk, d) not in works:
                continue
            # 승인 휴무·결원이 한쪽에만 걸린 날은 애초에 함께 설 수 없다 —
            # 그런 날까지 하드로 묶으면 해가 아예 없어진다.
            blocked = (
                d in problem.leaves.get(k, ())
                or d in problem.leaves.get(pk, ())
                or not available(k, d)
                or not available(pk, d)
            )
            if blocked:
                continue
            # 하드로 건다. 7월 실측이 434일 중 위반 0일이라 이게 현실이고,
            # 쌍을 한 덩어리로 묶으면 탐색 공간도 크게 줄어 해를 빨리 찾는다.
            # (소프트로 뒀더니 3개 노선에서 제한 시간 안에 62% 밖에 못 맞췄다)
            m.Add(works[(k, d)] == works[(pk, d)])

            # 함께 일하는 날에는 오전/오후를 나눠 맡아야 한다. 짝궁은 한 차의
            # 정·부이므로 둘 다 오전(또는 둘 다 오후)이면 그 차의 반대 시프트가
            # 비고 누군가 남의 차를 타고 있다는 뜻이다 (7월 실측 0건).
            if (k, d) in shift_pm and (pk, d) in shift_pm:
                # 함께 일하는 날이면 오전/오후를 나눠 맡는다 (같은 차의 정·부).
                # 둘 다 오전이면 그 차의 오후가 비고 누군가 남의 차를 탄다.
                m.Add(
                    shift_pm[(k, d)] + shift_pm[(pk, d)] == 1
                ).OnlyEnforceIf(works[(k, d)])


    # 월초 페이즈 앵커 (하드): 기사별 첫 근무일의 A/P 고정
    for k, (d, is_pm) in problem.first_shift_anchor.items():
        if (k, d) in shift_pm:
            m.Add(shift_pm[(k, d)] == (1 if is_pm else 0))

    # 월 경계 연속성: 전월 마지막 근무일과 이번 달 첫 근무일 사이에도 S2/S3 적용.
    # (백테스트 모드: 첫 근무일이 forced로 확정되어 있어 정확히 걸 수 있다)
    if problem.forced_work_days is not None:
        for k in problem.drivers:
            if k not in problem.prev_pm or k not in problem.prev_last_work:
                continue
            fdays = sorted(problem.forced_work_days.get(k, ()))
            if not fdays or (k, fdays[0]) not in shift_pm:
                continue
            first_day = fdays[0]
            gap = (first_day - problem.prev_last_work[k]).days
            pv = shift_pm[(k, first_day)]
            was_pm = problem.prev_pm[k]
            if gap == 1:
                # S3: 연속 근무 — 시프트 변경 페널티
                bad = pv.Not() if was_pm else pv
                penalties.append(bad * w.keep_shift)
            elif 2 <= gap <= 5:
                # S2: 휴무 복귀 — 유지 페널티
                bad = pv if was_pm else pv.Not()
                penalties.append(bad * w.swap_after_leave)

    # S1: 고정기사 본인차량 (본인차량이 그날 운행하면, 근무 시 그 차량에)
    for k, home in problem.home_vehicle.items():
        for d in dates:
            if (k, d) not in works:
                continue
            own_vars = [x[(k, d, home, s)] for s in ("A", "P")
                        if (d, home, s) in problem.operating and (k, d, home, s) in x]
            if not own_vars:
                continue
            if problem.hard_own_vehicle:
                # 근무하면 반드시 본인차량 (본인차량이 운행하는 날 한정)
                m.Add(sum(own_vars) == 1).OnlyEnforceIf(works[(k, d)])
                continue
            off_own = m.NewBoolVar(f"s1_{k}_{d}")
            # 근무하는데 본인차량이 아니면 페널티
            m.Add(sum(own_vars) == 0).OnlyEnforceIf(off_own)
            m.Add(sum(own_vars) == 1).OnlyEnforceIf(off_own.Not())
            viol = m.NewBoolVar(f"s1v_{k}_{d}")
            m.AddBoolAnd([works[(k, d)], off_own]).OnlyEnforceIf(viol)
            m.AddBoolOr([works[(k, d)].Not(), off_own.Not()]).OnlyEnforceIf(viol.Not())
            penalties.append(viol * w.own_vehicle)

    # S2/S3: 시프트 연속성과 휴무 후 스왑
    # 연속 근무(gap=1): 시프트 변경 페널티(S3). 휴무 복귀(gap 2~5): 유지 페널티(S2).
    if problem.forced_work_days is not None:
        # 백테스트 모드: 근무일 시퀀스가 상수 — 정적 선형 페널티로 직결
        for k in problem.drivers:
            wdays = sorted(problem.forced_work_days.get(k, ()))
            pk = problem.partner.get(k)
            partner_days = problem.forced_work_days.get(pk, set()) if pk else set()
            for i in range(len(wdays) - 1):
                d1, d2 = wdays[i], wdays[i + 1]
                if (k, d1) not in shift_pm or (k, d2) not in shift_pm:
                    continue
                gap = (d2 - d1).days
                p1, p2 = shift_pm[(k, d1)], shift_pm[(k, d2)]
                diff = m.NewBoolVar(f"df_{k}_{d1}")
                m.Add(p1 + p2 == 1).OnlyEnforceIf(diff)
                m.Add(p1 == p2).OnlyEnforceIf(diff.Not())
                if gap == 1:
                    penalties.append(diff * w.keep_shift)          # S3
                elif 2 <= gap <= 5 and problem.pair_swap_rule != "manual":
                    # 실측 정제 규칙: 짝이 갭 중 하루라도 같이 쉬었으면 스왑(90%+),
                    # 짝이 계속 일했으면 유지(70%+) — 짝의 시프트 유지가 강제하기 때문.
                    gap_days = [d1 + dt.timedelta(days=g) for g in range(1, gap)]
                    joint = (
                        problem.pair_swap_rule == "always_swap"
                        or pk is None
                        or any(gd not in partner_days for gd in gap_days)
                    )
                    if joint:
                        penalties.append(diff.Not() * w.swap_after_leave)  # S2
                    else:
                        penalties.append(diff * w.keep_shift)
    else:
        # 생성 모드: 근무일이 결정변수 — 조건부(reified) 페널티
        for k in problem.drivers:
            if k in pinned_drivers:
                # 기본 틀이 이 사람의 시프트를 이미 정했다. S2(휴무 복귀 시 스왑)를
                # 겹쳐 걸면 안 된다 — 틀에서는 근무가 끊기는 이유가 휴무만이
                # 아니라 **감차**이기도 한데, 감차로 하루 빠진 뒤에는 시프트를
                # 그대로 이어 간다. S2 는 2~5일 간격을 전부 '휴무 복귀'로 보고
                # 스왑을 하드로 요구해서, 블록 한가운데가 감차로 끊긴 날마다
                # 모델이 INFEASIBLE 이 됐다.
                continue
            for i in range(len(dates) - 1):
                d1, d2 = dates[i], dates[i + 1]
                if (k, d1) not in works or (k, d2) not in works:
                    continue
                both = m.NewBoolVar(f"b_{k}_{d1}")
                m.AddBoolAnd([works[(k, d1)], works[(k, d2)]]).OnlyEnforceIf(both)
                m.AddBoolOr(
                    [works[(k, d1)].Not(), works[(k, d2)].Not()]
                ).OnlyEnforceIf(both.Not())
                diff = m.NewBoolVar(f"df_{k}_{d1}")
                p1, p2 = shift_pm[(k, d1)], shift_pm[(k, d2)]
                m.Add(p1 + p2 == 1).OnlyEnforceIf(diff)
                m.Add(p1 == p2).OnlyEnforceIf(diff.Not())
                chg = m.NewBoolVar(f"chg_{k}_{d1}")
                m.AddBoolAnd([both, diff]).OnlyEnforceIf(chg)
                m.AddBoolOr([both.Not(), diff.Not()]).OnlyEnforceIf(chg.Not())
                penalties.append(chg * w.keep_shift)  # S3

            if problem.pair_swap_rule == "manual":
                continue
            pk = problem.partner.get(k)
            partner_leaves = problem.leaves.get(pk, set()) if pk else set()
            for i in range(len(dates)):
                for gap in (2, 3, 4, 5):
                    j = i + gap
                    if j >= len(dates):
                        break
                    d1, d2 = dates[i], dates[j]
                    if (k, d1) not in works or (k, d2) not in works:
                        continue
                    mids = [works[(k, dates[i + g])] for g in range(1, gap)
                            if (k, dates[i + g]) in works]
                    cond = m.NewBoolVar(f"ret_{k}_{d1}_{gap}")
                    lits = [works[(k, d1)], works[(k, d2)]] + [mv.Not() for mv in mids]
                    m.AddBoolAnd(lits).OnlyEnforceIf(cond)
                    m.AddBoolOr([l.Not() for l in lits]).OnlyEnforceIf(cond.Not())
                    same = m.NewBoolVar(f"same_{k}_{d1}_{gap}")
                    p1, p2 = shift_pm[(k, d1)], shift_pm[(k, d2)]
                    m.Add(p1 == p2).OnlyEnforceIf(same)
                    m.Add(p1 != p2).OnlyEnforceIf(same.Not())
                    # joint 판정 = 이 휴무를 짝과 **함께** 쉬었는가.
                    #
                    # 예전에는 짝의 **승인 휴무(연차)** 만 봤다. 그런데 정·부가
                    # 로테이션으로 함께 쉬는 회사에서는 갭이 연차가 아니라서
                    # '단독휴'로 잘못 읽히고, 그러면 규칙이 뒤집혀 **시프트 유지**를
                    # 선호하게 된다 — 한 사람이 한 달 내내 오후만 타는 그 현상이다.
                    #
                    # 짝이 있으면 위 S6 하드 제약이 '같은 날 함께 쉰다'를 보장하므로
                    # 갭에는 짝도 반드시 쉰다. 곧 언제나 동시휴다.
                    gap_days = [dates[i + g] for g in range(1, gap)]
                    joint = (
                        problem.pair_swap_rule == "always_swap"
                        or pk is None
                        or pk in pair_locked          # 짝과 함께 쉬는 것이 보장된 경우
                        or any(gd in partner_leaves for gd in gap_days)
                    )
                    # 짝이 있는 메인은 휴무 뒤 스왑이 실측 100%(7월 207회 중 207회)다.
                    # 하드로 걸면 어긋남이 없어지고 탐색 공간도 줄어 더 빨리 푼다.
                    # 다만 갭에 승인 휴무가 걸린 날은 사정이 다르므로 소프트로 남긴다.
                    if (
                        pk is not None
                        and pk in pair_locked
                        and not any(gd in problem.leaves.get(k, ()) for gd in gap_days)
                        and not any(gd in partner_leaves for gd in gap_days)
                    ):
                        m.Add(p1 + p2 == 1).OnlyEnforceIf(cond)
                        continue
                    flag = m.NewBoolVar(f"sw_{k}_{d1}_{gap}")
                    if joint:
                        # 복귀했는데 유지하면 페널티 (스왑 선호)
                        m.AddBoolAnd([cond, same]).OnlyEnforceIf(flag)
                        m.AddBoolOr([cond.Not(), same.Not()]).OnlyEnforceIf(flag.Not())
                        penalties.append(flag * w.swap_after_leave)
                    else:
                        # 단독휴 복귀: 교대하면 페널티 (유지 선호)
                        m.AddBoolAnd([cond, same.Not()]).OnlyEnforceIf(flag)
                        m.AddBoolOr([cond.Not(), same]).OnlyEnforceIf(flag.Not())
                        penalties.append(flag * w.keep_shift)

    # S5: 차량 숙련도 (과거 탑승 빈도 낮은 차량 투입 페널티) + 그룹 교차 페널티
    max_aff = max(problem.affinity.values(), default=1)
    for (k, d, v, s), var in x.items():
        if problem.home_vehicle.get(k) == v:
            continue  # 본인차량은 S1이 관리
        aff = problem.affinity.get((k, v), 0)
        # 숙련도 역비례 페널티 (0회 탑승 = 최대)
        pen = w.vehicle_affinity * (max_aff - aff) // max(max_aff, 1)
        if pen:
            penalties.append(var * pen)
        kg = problem.driver_group.get(k)
        vg = problem.vehicle_group.get(v)
        if kg and vg and kg != vg:
            penalties.append(var * w.group_affinity)

    # 풀 기사 시프트 특화 (예: 오후 전담 스페어) — 강한 특화만 반영
    for k, ratio in problem.pm_ratio.items():
        if k in problem.home_vehicle or abs(ratio - 0.5) < 0.3:
            continue
        prefers_pm = ratio > 0.5
        for d in dates:
            if (k, d) not in shift_pm or (k, d) not in works:
                continue
            pv = shift_pm[(k, d)]
            bad = pv.Not() if prefers_pm else pv
            # 근무하는 날만: works ∧ bad
            dev = m.NewBoolVar(f"sp_{k}_{d}")
            m.AddBoolAnd([works[(k, d)], bad]).OnlyEnforceIf(dev)
            m.AddBoolOr([works[(k, d)].Not(), bad.Not()]).OnlyEnforceIf(dev.Not())
            penalties.append(dev * (w.keep_shift // 2))

    # S4: 요일 선호 (생성 모드에서만 의미 — 근무일이 자유일 때)
    if problem.forced_work_days is None:
        for k, prefs in problem.weekday_off_pref.items():
            for d in dates:
                if (k, d) in works and prefs.get(d.weekday(), 0) > 0.5:
                    penalties.append(works[(k, d)] * w.weekday_pref)

    # S5/F3: 예비(비고정) 기사 근무일수 균등화 — 생성 모드에서만
    if (problem.forced_work_days is None and problem.spare_balance_enabled
            and problem.fairness_lambda > 0):
        spare_loads = []
        for k in problem.drivers:
            if k in problem.home_vehicle:
                continue
            kvars = [works[(k, d)] for d in dates if (k, d) in works]
            if kvars:
                load = m.NewIntVar(0, len(dates), f"load_{k}")
                m.Add(load == sum(kvars))
                spare_loads.append(load)
        if len(spare_loads) >= 2:
            mx = m.NewIntVar(0, len(dates), "load_max")
            mn = m.NewIntVar(0, len(dates), "load_min")
            m.AddMaxEquality(mx, spare_loads)
            m.AddMinEquality(mn, spare_loads)
            penalties.append((mx - mn) * (problem.fairness_lambda * 10))

    m.Minimize(sum(penalties))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_workers = 8
    status = solver.Solve(m)
    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"솔버 실패: {status_name}")

    cells: dict[tuple[dt.date, str, str], str] = {}
    for (k, d, v, s), var in x.items():
        if solver.Value(var):
            cells[(d, v, s)] = k
    unfilled = [
        slot for slot, sv in unfilled_vars.items() if solver.Value(sv)
    ]
    return Assignment(cells=cells, objective=solver.ObjectiveValue(),
                      status=status_name, unfilled=unfilled)
