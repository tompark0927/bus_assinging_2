"""공정성 리포트 (스펙 5.3, F1~F3).

"왜 나만 맨날 늦은 배차냐" 민원을 줄이는 제품 기능 — 담당자·기사 앱
양쪽에 노출한다.

F1. 순번 슬롯 분포: 기사별 (이른 슬롯 일수 − 늦은 슬롯 일수) 편차
F2. 주말 휴무 횟수 편차
F3. 대타 투입(타 차량 근무) 횟수 편차
"""
from __future__ import annotations

import datetime as dt
import statistics
from dataclasses import dataclass, field

from .models import MonthlyRoster


@dataclass
class DriverFairness:
    name: str
    early_days: int = 0        # 그룹 중앙값보다 이른 순번 근무일
    late_days: int = 0
    weekend_off: int = 0
    substitute_days: int = 0   # 본인 주차량이 아닌 차량 근무일
    work_days: int = 0

    @property
    def slot_balance(self) -> int:
        """양수 = 이른 슬롯 우세(편한 쪽), 음수 = 늦은 슬롯 우세."""
        return self.early_days - self.late_days


@dataclass
class FairnessReport:
    drivers: dict[str, DriverFairness] = field(default_factory=dict)
    slot_balance_stdev: float = 0.0
    weekend_off_stdev: float = 0.0
    substitute_stdev: float = 0.0


def build_report(roster: MonthlyRoster) -> FairnessReport:
    """실적(또는 생성) 로스터에서 기사별 공정성 지표 산출."""
    report = FairnessReport()
    # 기사별 주차량: 그 달 최다 탑승 차량
    from collections import Counter, defaultdict

    veh_count: dict[str, Counter] = defaultdict(Counter)
    for (d, v), e in roster.entries.items():
        if d.month != roster.month:
            continue
        for cs in (e.am, e.pm):
            if cs.driver:
                veh_count[cs.driver][v] += 1
    main_veh = {k: c.most_common(1)[0][0] for k, c in veh_count.items()}

    for (d, v), e in roster.entries.items():
        if d.month != roster.month:
            continue
        g = roster.group_of(v)
        median_slot = (g.size + 1) / 2 if g else None
        for cs in (e.am, e.pm):
            if not cs.driver:
                continue
            f = report.drivers.setdefault(
                cs.driver, DriverFairness(name=cs.driver)
            )
            f.work_days += 1
            if e.slot_index and median_slot:
                if e.slot_index < median_slot:
                    f.early_days += 1
                elif e.slot_index > median_slot:
                    f.late_days += 1
            if main_veh.get(cs.driver) != v:
                f.substitute_days += 1

    # 주말 휴무: 주말인데 근무 기록 없는 날 (재직 기간 근사: 첫~마지막 근무일)
    work_dates: dict[str, set[dt.date]] = {}
    for (d, v), e in roster.entries.items():
        if d.month != roster.month:
            continue
        for cs in (e.am, e.pm):
            if cs.driver:
                work_dates.setdefault(cs.driver, set()).add(d)
    for k, ds in work_dates.items():
        f = report.drivers[k]
        d = min(ds)
        while d <= max(ds):
            if d.weekday() >= 5 and d not in ds:
                f.weekend_off += 1
            d += dt.timedelta(days=1)

    vals = [f.slot_balance for f in report.drivers.values() if f.work_days >= 10]
    if len(vals) > 1:
        report.slot_balance_stdev = statistics.pstdev(vals)
    vals = [f.weekend_off for f in report.drivers.values() if f.work_days >= 10]
    if len(vals) > 1:
        report.weekend_off_stdev = statistics.pstdev(vals)
    vals = [f.substitute_days for f in report.drivers.values() if f.work_days >= 10]
    if len(vals) > 1:
        report.substitute_stdev = statistics.pstdev(vals)
    return report
