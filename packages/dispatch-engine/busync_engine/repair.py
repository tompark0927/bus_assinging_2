"""국소 수리 재배차 (스펙 4 — 3단계).

당일 결원(병가·사고·무단결근)이 났을 때 **전체 재생성은 금지**다. 한 달치를
다시 풀면 이미 게시된 배차표가 통째로 흔들려 현장이 신뢰를 잃는다.

대신:
  1. 비어버린 슬롯 하나만 놓고 후보 기사를 스코어링해 상위 3명을 추천
  2. 담당자가 원탭 확정 → 그 셀만 교체, 나머지는 불변
  3. 변경분만 마킹해 푸시 알림 (스펙 3.1의 빨간색 표시 규칙과 동일한 의미)
  4. 모든 수동 오버라이드는 이력으로 남아 다음 달 공정성 계산에 반영

추천 스코어 (낮을수록 우선) — 스펙 2.1 "예비 투입 순서에 하드 규칙 없음,
담당자 재량" → 부담 균등화 점수로 대체:

    score = w_load × 최근30일_투입횟수
          + w_aff  × (1 - 해당차량_숙련도)
          + w_group× 그룹경계_초과
          + w_shift× 시프트_전환_부담
          + w_run  × 연속근무_누적
"""
from __future__ import annotations

import datetime as dt
from collections import Counter
from dataclasses import dataclass, field

from .solver import Assignment, AssignmentProblem


@dataclass
class RepairCandidate:
    driver: str
    score: float
    reasons: list[str] = field(default_factory=list)
    blocking: list[str] = field(default_factory=list)   # 비어있어야 추천 가능

    @property
    def eligible(self) -> bool:
        return not self.blocking


@dataclass
class RepairSuggestion:
    date: dt.date
    vehicle: str
    shift: str
    absent_driver: str | None
    candidates: list[RepairCandidate] = field(default_factory=list)

    @property
    def top(self) -> list[RepairCandidate]:
        return [c for c in self.candidates if c.eligible][:3]


@dataclass
class RepairWeights:
    load: float = 10.0        # 최근 투입 부담
    affinity: float = 6.0     # 차량 숙련도
    group: float = 8.0        # 그룹 경계
    shift_switch: float = 4.0  # 시프트 전환 부담
    consecutive: float = 12.0  # 연속 근무 누적
    off_day: float = 25.0     # 원래 쉬는 날 호출 (가장 미안한 선택)


SHIFT_KO = {"A": "오전", "P": "오후"}


def _work_map(assignment: Assignment) -> dict[str, dict[dt.date, tuple[str, str]]]:
    out: dict[str, dict[dt.date, tuple[str, str]]] = {}
    for (d, v, s), k in assignment.cells.items():
        out.setdefault(k, {})[d] = (v, s)
    return out


def suggest_repair(
    problem: AssignmentProblem,
    assignment: Assignment,
    date: dt.date,
    vehicle: str,
    shift: str,
    weights: RepairWeights | None = None,
    lookback_days: int = 30,
    absent_driver: str | None = None,
) -> RepairSuggestion:
    """비어버린 슬롯 하나에 대한 대체 기사 추천.

    absent_driver를 주지 않으면 슬롯의 현재 배정자 → assignment.absences 순으로
    결원자를 찾는다. 결원자 본인은 절대 후보에 오르지 않는다.
    """
    w = weights or RepairWeights()
    work = _work_map(assignment)
    key = (date, vehicle, shift)
    absent = (
        absent_driver
        or assignment.cells.get(key)
        or assignment.absences.get(key)
    )
    sug = RepairSuggestion(
        date=date, vehicle=vehicle, shift=shift, absent_driver=absent
    )

    # 최근 투입 부담 (해당 차량이 본인차량이 아닌 근무 = 대타성 투입)
    since = date - dt.timedelta(days=lookback_days)
    sub_load: Counter = Counter()
    for k, days in work.items():
        home = problem.home_vehicle.get(k)
        for d, (v, _s) in days.items():
            if since <= d < date and v != home:
                sub_load[k] += 1
    max_aff = max(problem.affinity.values(), default=1)

    for k in problem.drivers:
        if k == absent:
            continue  # 결원 당사자는 후보에서 제외
        cand = RepairCandidate(driver=k, score=0.0)

        # ── 하드 차단 사유 ──
        if date in problem.leaves.get(k, ()):
            cand.blocking.append("승인 휴무일")
        today = work.get(k, {}).get(date)
        if today is not None:
            cand.blocking.append(
                f"이미 {today[0]} {SHIFT_KO[today[1]]} 근무 중"
            )
        # 연속 근무 상한
        run = 1
        d = date - dt.timedelta(days=1)
        while d in work.get(k, {}):
            run += 1
            d -= dt.timedelta(days=1)
        d = date + dt.timedelta(days=1)
        while d in work.get(k, {}):
            run += 1
            d += dt.timedelta(days=1)
        if run > problem.max_consecutive:
            cand.blocking.append(
                f"투입 시 연속 {run}일 — 상한 {problem.max_consecutive}일 초과"
            )
        if problem.forbid_pm_to_am:
            prev = work.get(k, {}).get(date - dt.timedelta(days=1))
            if shift == "A" and prev and prev[1] == "P":
                cand.blocking.append("전날 오후 근무 — 익일 오전 금지 규칙")
        if cand.blocking:
            sug.candidates.append(cand)
            continue

        # ── 소프트 스코어 ──
        load = sub_load.get(k, 0)
        cand.score += w.load * load
        if load == 0:
            cand.reasons.append(f"최근 {lookback_days}일 대타 투입 없음")
        else:
            cand.reasons.append(f"최근 {lookback_days}일 대타 {load}회")

        aff = problem.affinity.get((k, vehicle), 0)
        cand.score += w.affinity * (max_aff - aff) / max(max_aff, 1)
        if aff:
            cand.reasons.append(f"{vehicle} 차량 탑승 이력 {aff}회")
        else:
            cand.reasons.append(f"{vehicle} 차량 경험 없음")

        kg, vg = problem.driver_group.get(k), problem.vehicle_group.get(vehicle)
        if kg and vg and kg != vg:
            cand.score += w.group
            cand.reasons.append(f"소속 {kg} → {vg} 그룹 이동")

        # 원래 그날 쉬는 사람인가
        if date not in work.get(k, {}):
            cand.score += w.off_day
            cand.reasons.append("원래 휴무일 — 호출 필요")
        else:
            cand.reasons.append("이미 출근일")

        # 시프트 전환 부담: 최근 시프트와 다르면
        recent = [
            s for d, (_v, s) in sorted(work.get(k, {}).items())
            if since <= d < date
        ]
        if recent and recent[-1] != shift:
            cand.score += w.shift_switch
            cand.reasons.append(
                f"최근 {SHIFT_KO[recent[-1]]} 근무 → {SHIFT_KO[shift]} 전환"
            )

        cand.score += w.consecutive * max(0, run - 3)

        # 본인차량이면 크게 우대 (짝궁이 비었을 때 자연스러운 해)
        if problem.home_vehicle.get(k) == vehicle:
            cand.score -= 50
            cand.reasons.insert(0, f"{vehicle}의 고정기사")
        sug.candidates.append(cand)

    sug.candidates.sort(key=lambda c: (not c.eligible, c.score))
    return sug


@dataclass
class RepairRecord:
    """수동 오버라이드 이력 — 다음 달 공정성 계산 입력 (스펙 4-3)."""

    date: dt.date
    vehicle: str
    shift: str
    removed: str | None
    added: str
    reason: str = ""
    decided_at: dt.datetime | None = None


def apply_repair(
    assignment: Assignment,
    date: dt.date,
    vehicle: str,
    shift: str,
    new_driver: str,
    reason: str = "",
    now: dt.datetime | None = None,
) -> RepairRecord:
    """확정된 대체를 해에 반영. 해당 셀만 바뀐다 — 나머지는 절대 불변."""
    key = (date, vehicle, shift)
    # 이미 mark_absent로 비워졌다면 결원자를 absences에서 복원 (대타 카운터 정확도)
    removed = assignment.cells.get(key) or assignment.absences.get(key)
    assignment.cells[key] = new_driver
    if key in assignment.unfilled:
        assignment.unfilled.remove(key)
    note = f"{removed or '(미충원)'} → {new_driver}"
    if reason:
        note += f" ({reason})"
    assignment.notes[key] = note
    return RepairRecord(
        date=date, vehicle=vehicle, shift=shift,
        removed=removed, added=new_driver, reason=reason, decided_at=now,
    )


def mark_absent(
    assignment: Assignment, date: dt.date, vehicle: str, shift: str
) -> str | None:
    """결원 발생 — 슬롯을 비우고 미충원 목록에 올린다."""
    key = (date, vehicle, shift)
    removed = assignment.cells.pop(key, None)
    if key not in assignment.unfilled:
        assignment.unfilled.append(key)
    if removed:
        assignment.absences[key] = removed
    return removed


def changed_cells(
    before: dict[tuple[dt.date, str, str], str],
    after: dict[tuple[dt.date, str, str], str],
) -> list[tuple[dt.date, str, str, str | None, str | None]]:
    """게시판 빨간색 마킹·푸시 알림 대상 — 변경된 셀만."""
    out = []
    for key in sorted(set(before) | set(after)):
        b, a = before.get(key), after.get(key)
        if b != a:
            out.append((*key, b, a))
    return out
