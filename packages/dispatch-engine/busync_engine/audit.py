"""제약 감사 (스펙 5.2): 생성 결과에서 H1~H6 위반 0건 자동 검증.

위반이 하나라도 있으면 배포를 차단해야 한다 — audit()가 위반 리스트를
반환하며, 비어 있지 않으면 상위 레이어가 게시를 거부한다.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from .solver import Assignment, AssignmentProblem


@dataclass
class Violation:
    rule: str
    message: str


@dataclass
class AuditReport:
    violations: list[Violation] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations


def audit(problem: AssignmentProblem, assignment: Assignment) -> AuditReport:
    report = AuditReport()
    cells = assignment.cells

    # H1: 운행 슬롯마다 정확히 1명
    for slot in problem.operating:
        if slot not in cells:
            report.violations.append(
                Violation("H1", f"슬롯 미충원: {slot}")
            )

    # H2: 기사 1인 1일 최대 1시프트
    per_day: dict[tuple[str, dt.date], list] = {}
    for (d, v, s), k in cells.items():
        per_day.setdefault((k, d), []).append((v, s))
    for (k, d), lst in per_day.items():
        if len(lst) > 1:
            report.violations.append(
                Violation("H2", f"{k} {d} 중복 배정: {lst}")
            )

    # H3: 연속 근무 ≤ max_consecutive
    work_dates: dict[str, set[dt.date]] = {}
    for (k, d), _ in per_day.items():
        work_dates.setdefault(k, set()).add(d)
    for k, ds in work_dates.items():
        run = 0
        d = min(ds)
        while d <= max(ds):
            if d in ds:
                run += 1
                if run > problem.max_consecutive:
                    report.violations.append(
                        Violation("H3", f"{k} 연속 {run}일 근무 ({d}까지)")
                    )
            else:
                run = 0
            d += dt.timedelta(days=1)

    # H4: 승인 휴무일 근무 금지
    for k, offs in problem.leaves.items():
        bad = work_dates.get(k, set()) & set(offs)
        if bad:
            report.violations.append(
                Violation("H4", f"{k} 승인 휴무일 근무: {sorted(bad)}")
            )

    # H5: 월 근무일수 밴드 (생성 모드에서만)
    if problem.forced_work_days is None:
        lo, hi = problem.work_days_band
        all_dates = set(problem.dates)
        for k in problem.drivers:
            n = len(work_dates.get(k, ()))
            avail = len(all_dates - set(problem.leaves.get(k, ())))
            lo_k = min(lo, avail)  # 가용일 부족(연차·입퇴사)은 일할 — 솔버와 동일 기준
            if n and not (lo_k <= n <= hi):
                report.violations.append(
                    Violation("H5", f"{k} 월 근무 {n}일 (허용 {lo_k}~{hi})")
                )

    # H6: 오후 → 익일 오전 금지 (스위치 켜진 경우)
    if problem.forbid_pm_to_am:
        by_driver_day: dict[tuple[str, dt.date], str] = {}
        for (d, v, s), k in cells.items():
            by_driver_day[(k, d)] = s
        for (k, d), s in by_driver_day.items():
            nxt = by_driver_day.get((k, d + dt.timedelta(days=1)))
            if s == "P" and nxt == "A":
                report.violations.append(
                    Violation("H6", f"{k} {d} 오후 → 익일 오전")
                )

    return report
