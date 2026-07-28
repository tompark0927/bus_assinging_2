"""설명가능성 (스펙 0): "왜 이 기사가 이 슬롯인가"에 답한다.

솔버는 목적함수를 최소화할 뿐 이유를 말해주지 않는다. 이 모듈은 확정된 해
위에서 각 셀의 배정 근거를 **사후 재구성**한다:

  1. 하드 근거 — 그 셀에 올 수 있었던 후보가 애초에 누구였나 (제약이 걸러낸 이유)
  2. 소프트 근거 — 선택된 기사가 각 소프트 제약에서 받은 점수 기여
  3. 반사실(counterfactual) — 차선 후보로 바꿨다면 페널티가 얼마나 늘었나

담당자·기사에게 그대로 보여줄 수 있는 한국어 문장으로 출력한다.
민원 응대("왜 나만 늦은 배차냐")의 1차 방어선이자, 규칙이 의도대로 도는지
개발자가 검증하는 수단이다.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from .solver import Assignment, AssignmentProblem


@dataclass
class Reason:
    """배정 근거 한 줄. weight가 클수록 결정적."""

    code: str          # OWN_VEHICLE / PARTNER_SWAP / SHIFT_KEEP / AFFINITY / ...
    text: str          # 한국어 설명 문장
    weight: int = 0    # 페널티 관점 기여도 (음수 = 이 배정을 선호하게 만든 힘)


@dataclass
class CellExplanation:
    date: dt.date
    vehicle: str
    shift: str
    driver: str
    reasons: list[Reason] = field(default_factory=list)
    alternatives: list[tuple[str, int]] = field(default_factory=list)
    # (차선 후보, 그 후보로 바꿀 때 늘어나는 페널티)

    @property
    def summary(self) -> str:
        if not self.reasons:
            return f"{self.driver} — 특별한 제약 없이 배정 (가용 인원 중 선택)"
        head = max(self.reasons, key=lambda r: abs(r.weight))
        return f"{self.driver} — {head.text}"


SHIFT_KO = {"A": "오전", "P": "오후"}


def _topic(word: str) -> str:
    """한국어 주격 조사: 받침 있으면 '은', 없으면 '는'."""
    last = word[-1]
    if not ("가" <= last <= "힣"):
        return f"{word}는"
    has_final = (ord(last) - 0xAC00) % 28 != 0
    return f"{word}{'은' if has_final else '는'}"


def _prev_next_work(
    work_dates: list[dt.date], d: dt.date
) -> tuple[dt.date | None, dt.date | None]:
    prev = next_ = None
    for x in work_dates:
        if x < d:
            prev = x
        elif x > d:
            next_ = x
            break
    return prev, next_


def explain_cell(
    problem: AssignmentProblem,
    assignment: Assignment,
    date: dt.date,
    vehicle: str,
    shift: str,
    weights=None,
) -> CellExplanation:
    """단일 셀의 배정 근거 재구성."""
    from .solver import SolverWeights

    w = weights or SolverWeights()
    driver = assignment.cells.get((date, vehicle, shift))
    exp = CellExplanation(date=date, vehicle=vehicle, shift=shift, driver=driver or "")
    if driver is None:
        exp.reasons.append(Reason(
            "UNFILLED",
            "배정 가능한 기사가 없어 미충원(결행 후보)으로 남았습니다.", 0,
        ))
        return exp

    # 기사별 근무일 시퀀스 (해 위에서 재구성)
    by_driver: dict[str, list[tuple[dt.date, str, str]]] = {}
    for (d, v, s), k in assignment.cells.items():
        by_driver.setdefault(k, []).append((d, v, s))
    for k in by_driver:
        by_driver[k].sort()
    my_days = [d for d, _v, _s in by_driver.get(driver, [])]
    shift_on = {d: s for d, _v, s in by_driver.get(driver, [])}

    # ── 1. 본인차량 (S1) ──
    home = problem.home_vehicle.get(driver)
    if home == vehicle:
        exp.reasons.append(Reason(
            "OWN_VEHICLE",
            f"{driver} 기사의 고정(본인) 차량 {vehicle}입니다.",
            -w.own_vehicle,
        ))
    elif home:
        exp.reasons.append(Reason(
            "OFF_OWN_VEHICLE",
            f"본인차량 {home}이(가) 이날 운행하지 않아 {vehicle}에 투입되었습니다.",
            w.own_vehicle,
        ))
    else:
        aff = problem.affinity.get((driver, vehicle), 0)
        exp.reasons.append(Reason(
            "SPARE",
            f"예비(S/P) 기사이며 {vehicle} 차량 탑승 이력 {aff}회로 숙련도가 높은 편입니다."
            if aff else f"예비(S/P) 기사로 결원을 메우기 위해 투입되었습니다.",
            -w.vehicle_affinity * (1 if aff else 0),
        ))

    # ── 2. 시프트 결정 근거 (S2/S3) ──
    prev_d, _next_d = _prev_next_work(my_days, date)
    if prev_d is None:
        if driver in problem.prev_last_work:
            gap = (date - problem.prev_last_work[driver]).days
            was_pm = problem.prev_pm.get(driver)
            if was_pm is not None:
                prev_ko = SHIFT_KO["P" if was_pm else "A"]
                cur_ko = SHIFT_KO[shift]
                if gap == 1:
                    exp.reasons.append(Reason(
                        "SHIFT_KEEP",
                        f"전월 마지막 근무({prev_ko})에서 이어져 {cur_ko}을 유지했습니다.",
                        -w.keep_shift,
                    ))
                else:
                    exp.reasons.append(Reason(
                        "SHIFT_SWAP",
                        f"전월 말 {prev_ko} 근무 후 {gap - 1}일 휴무 → {cur_ko}으로 교대했습니다.",
                        -w.swap_after_leave,
                    ))
    else:
        gap = (date - prev_d).days
        prev_ko = SHIFT_KO[shift_on[prev_d]]
        cur_ko = SHIFT_KO[shift]
        same = shift_on[prev_d] == shift
        if gap == 1:
            exp.reasons.append(Reason(
                "SHIFT_KEEP" if same else "SHIFT_CHANGE",
                f"전날에 이어 연속 근무 — {cur_ko} 유지." if same
                else f"전날 {prev_ko}에서 {cur_ko}으로 변경되었습니다 (이례적).",
                -w.keep_shift if same else w.keep_shift,
            ))
        elif 2 <= gap <= 5:
            pk = problem.partner.get(driver)
            partner_off = False
            if pk:
                pk_days = {d for d, _v, _s in by_driver.get(pk, [])}
                partner_off = any(
                    (prev_d + dt.timedelta(days=g)) not in pk_days
                    for g in range(1, gap)
                )
            if partner_off:
                exp.reasons.append(Reason(
                    "PARTNER_SWAP",
                    f"짝궁 {pk} 기사와 함께 쉰 뒤 복귀 → 규칙에 따라 "
                    f"{prev_ko}에서 {cur_ko}으로 교대했습니다."
                    if not same else
                    f"짝궁 {pk} 기사와 함께 쉰 뒤 복귀했으나 {cur_ko}을 유지했습니다 "
                    f"(교대 규칙 예외).",
                    -w.swap_after_leave if not same else w.swap_after_leave,
                ))
            else:
                exp.reasons.append(Reason(
                    "SOLO_LEAVE_KEEP",
                    f"{gap - 1}일 단독 휴무 — 짝궁이 계속 근무 중이라 "
                    f"{cur_ko}을 유지했습니다." if same else
                    f"{gap - 1}일 단독 휴무 후 {cur_ko}으로 교대했습니다.",
                    -w.keep_shift if same else w.keep_shift,
                ))

    # ── 3. 짝 관계 ──
    other = "P" if shift == "A" else "A"
    counterpart = assignment.cells.get((date, vehicle, other))
    if counterpart:
        is_partner = problem.partner.get(driver) == counterpart
        exp.reasons.append(Reason(
            "PAIR",
            f"같은 차량 {_topic(SHIFT_KO[other])} "
            f"{'짝궁 ' if is_partner else ''}{counterpart} 기사입니다.",
            0,
        ))

    # ── 4. 그룹 ──
    kg = problem.driver_group.get(driver)
    vg = problem.vehicle_group.get(vehicle)
    if kg and vg and kg != vg:
        exp.reasons.append(Reason(
            "CROSS_GROUP",
            f"소속 그룹({kg}) 밖인 {vg} 차량에 투입되었습니다 — 결원 충원 목적.",
            w.group_affinity,
        ))

    # ── 5. 연속 근무 상황 ──
    run = 1
    d = date - dt.timedelta(days=1)
    while d in shift_on:
        run += 1
        d -= dt.timedelta(days=1)
    if run >= problem.max_consecutive:
        exp.reasons.append(Reason(
            "MAX_RUN",
            f"연속 근무 {run}일차 — 상한({problem.max_consecutive}일)에 도달해 "
            f"다음날은 휴무로 강제됩니다.",
            0,
        ))

    # ── 6. 반사실: 차선 후보 ──
    exp.alternatives = _alternatives(problem, assignment, date, vehicle, shift, w)
    return exp


def _alternatives(
    problem: AssignmentProblem,
    assignment: Assignment,
    date: dt.date,
    vehicle: str,
    shift: str,
    w,
    top_n: int = 3,
) -> list[tuple[str, int]]:
    """이 슬롯에 대신 올 수 있었던 기사와, 그때 늘어날 페널티 근사치.

    정확한 재최적화가 아니라 '그 셀만 바꿨을 때'의 국소 비용이다 — 빠르고
    담당자에게 충분히 설명적이다.
    """
    busy = {k for (d, _v, _s), k in assignment.cells.items() if d == date}
    cands: list[tuple[int, str]] = []
    for k in problem.drivers:
        if k in busy:
            continue
        if date in problem.leaves.get(k, ()):  # H4
            continue
        cost = 0
        home = problem.home_vehicle.get(k)
        if home and home != vehicle:
            cost += w.own_vehicle
        aff = problem.affinity.get((k, vehicle), 0)
        max_aff = max(problem.affinity.values(), default=1)
        cost += w.vehicle_affinity * (max_aff - aff) // max(max_aff, 1)
        kg, vg = problem.driver_group.get(k), problem.vehicle_group.get(vehicle)
        if kg and vg and kg != vg:
            cost += w.group_affinity
        cands.append((cost, k))
    cands.sort()
    return [(k, c) for c, k in cands[:top_n]]


def explain_driver_month(
    problem: AssignmentProblem,
    assignment: Assignment,
    driver: str,
) -> list[str]:
    """기사 한 명의 월 배정을 서술형으로 — 기사 앱 '내 배차 설명' 화면용."""
    days = sorted(
        (d, v, s) for (d, v, s), k in assignment.cells.items() if k == driver
    )
    if not days:
        return [f"{driver} 기사는 이 기간 배정이 없습니다."]
    lines = [
        f"{driver} 기사 — 총 {len(days)}일 근무 "
        f"(오전 {sum(1 for _d, _v, s in days if s == 'A')}일 / "
        f"오후 {sum(1 for _d, _v, s in days if s == 'P')}일)"
    ]
    home = problem.home_vehicle.get(driver)
    if home:
        own = sum(1 for _d, v, _s in days if v == home)
        lines.append(
            f"본인차량 {home} 탑승 {own}일 "
            f"({own / len(days) * 100:.0f}%), 타 차량 {len(days) - own}일."
        )
    else:
        from collections import Counter

        vc = Counter(v for _d, v, _s in days)
        lines.append(
            "예비(S/P) 기사 — 투입 차량: "
            + ", ".join(f"{v}({n}일)" for v, n in vc.most_common(5))
        )
    # 시프트 블록 요약
    blocks: list[tuple[str, int]] = []
    for d, _v, s in days:
        if blocks and blocks[-1][0] == s:
            blocks[-1] = (s, blocks[-1][1] + 1)
        else:
            blocks.append((s, 1))
    lines.append(
        "근무 블록: "
        + " → ".join(f"{SHIFT_KO[s]}{n}일" for s, n in blocks)
    )
    return lines
