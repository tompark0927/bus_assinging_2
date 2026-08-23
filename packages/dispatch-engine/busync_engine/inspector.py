"""검산 모드 — **남이 이미 짠 배차표**를 그대로 받아 규칙 위반을 찾는다.

기존 audit.py 와 목적이 다르다. audit.py 는 우리가 생성한 결과가 제약을
지켰는지 확인하는 내부 게이트이고(입력이 AssignmentProblem), 여기는 담당자가
엑셀로 짜 온 배차표(MonthlyRoster)를 입력으로 받는다.

이게 왜 따로 필요한가:

    배차 담당자에게 "우리 걸로 바꾸세요"는 팔리지 않는다. 자기 방식이
    있고, 새 도구를 배우는 비용을 본인이 다 진다. 반대로 "당신이 짠 걸
    그대로 올려보세요, 빠진 게 있나 봐드릴게요"는 거절할 이유가 없다.
    바꾸라고 하지 않고, 손해 볼 게 없기 때문이다.

    그래서 이 모듈의 성패는 **오탐이 없는 것**에 달렸다. 틀리지 않은 걸
    틀렸다고 하면 그 자리에서 신뢰를 잃고 두 번째 기회는 없다. 확실한
    것만 ERROR, 애매한 것은 WARN, 통계적 쏠림은 INFO 로 내린다.

검사 항목:
    E1 중복배정   같은 기사가 같은 날 두 자리
    E2 빈 자리    운행하는 차량인데 기사가 없음
    E3 연속근무   최대 연속 근무일 초과
    W1 짧은 휴식  오후 근무 다음날 오전 (퇴근~출근 간격)
    W2 근무일수   월 근무일수 범위 밖
    W3 순번이탈   로테이션이 규칙대로 안 돈 날
    I1 시프트편중 오전/오후가 한쪽으로 쏠린 기사
    I2 순번편중   이른/늦은 순번이 특정 기사에게 몰림
"""
from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from .models import MonthlyRoster

SEV_ERROR = "error"
SEV_WARN = "warn"
SEV_INFO = "info"

_SEV_ORDER = {SEV_ERROR: 0, SEV_WARN: 1, SEV_INFO: 2}


@dataclass
class Finding:
    rule: str
    severity: str
    title: str            # 한 줄 요약 (목록에 뜨는 말)
    detail: str           # 왜 문제인지
    date: Optional[dt.date] = None
    vehicle: Optional[str] = None
    shift: Optional[str] = None      # "오전"/"오후"
    driver: Optional[str] = None
    group: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "severity": self.severity,
            "title": self.title,
            "detail": self.detail,
            "date": self.date.isoformat() if self.date else None,
            "vehicle": self.vehicle,
            "shift": self.shift,
            "driver": self.driver,
            "group": self.group,
        }


@dataclass
class CheckResult:
    """검사 항목 하나의 결과 — 통과한 항목도 보여준다.

    위반만 나열하면 '트집 잡는 도구'로 읽힌다. 24개 중 21개는 깨끗하다는
    걸 같이 보여줘야 '검산받았다'는 느낌이 든다.
    """

    rule: str
    label: str
    checked: int          # 검사한 대상 수 (0이면 해당 없음)
    violations: int
    note: str = ""        # 검사하지 않았다면 그 이유 — 조용히 빼면 '다 봤다'로 읽힌다


@dataclass
class InspectionReport:
    year: int
    month: int
    division: str
    drivers: int = 0
    vehicles: int = 0
    days: int = 0
    cells: int = 0
    findings: list[Finding] = field(default_factory=list)
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def errors(self) -> int:
        return sum(1 for f in self.findings if f.severity == SEV_ERROR)

    @property
    def warns(self) -> int:
        return sum(1 for f in self.findings if f.severity == SEV_WARN)

    def to_dict(self) -> dict[str, Any]:
        findings = sorted(
            self.findings,
            key=lambda f: (_SEV_ORDER[f.severity], f.date or dt.date.min, f.vehicle or ""),
        )
        return {
            "year": self.year,
            "month": self.month,
            "division": self.division,
            "summary": {
                "drivers": self.drivers,
                "vehicles": self.vehicles,
                "days": self.days,
                "cells": self.cells,
                "errors": self.errors,
                "warns": self.warns,
                "infos": sum(1 for f in self.findings if f.severity == SEV_INFO),
            },
            "checks": [
                {"rule": c.rule, "label": c.label, "checked": c.checked,
                 "violations": c.violations, "note": c.note}
                for c in self.checks
            ],
            "findings": [f.to_dict() for f in findings],
        }


def _shift_cells(roster: MonthlyRoster):
    """(날짜, 차량, '오전'/'오후', CellState) 를 순회."""
    for (d, v), e in roster.entries.items():
        yield d, v, "오전", e.am
        yield d, v, "오후", e.pm


def _slots_are_static(roster: MonthlyRoster, dates: list[dt.date], vehicles: list[str]) -> bool:
    """이 표의 순번이 '매일 도는 값'인지 '한 달 고정 라벨'인지 판별.

    월간배차 양식은 순번이 행 라벨이라 한 달 내내 안 변한다. 그 표를 두고
    순번 로테이션을 검사하면 결과가 전부 무의미해지므로 먼저 구분한다.
    (휴차로 순번이 빈 날은 변화로 세지 않는다.)
    """
    changed = 0
    checked = 0
    for v in vehicles:
        seen = {
            e.slot_index for d in dates
            if (e := roster.entry(d, v)) is not None and e.slot_index is not None
        }
        if not seen:
            continue
        checked += 1
        if len(seen) > 1:
            changed += 1
    if checked == 0:
        return True
    return changed / checked < 0.2


def inspect_roster(roster: MonthlyRoster, policy: dict[str, Any] | None = None) -> InspectionReport:
    pol = policy or {}
    dates = sorted(set(roster.month_dates() or roster.dates()))
    date_set = set(dates)
    vehicles = sorted({v for _, v in roster.entries})

    rep = InspectionReport(
        year=roster.year, month=roster.month, division=roster.division,
        drivers=len(roster.drivers()), vehicles=len(vehicles), days=len(dates),
    )

    group_of: dict[str, str] = {}
    for g in roster.groups:
        for v in g.vehicles:
            group_of[v] = g.name

    static_slots = _slots_are_static(roster, dates, vehicles)

    # ── 사전 집계 ──
    # (기사, 날짜) → [(차량, 시프트)]
    per_driver_day: dict[tuple[str, dt.date], list[tuple[str, str]]] = defaultdict(list)
    shift_count: dict[str, Counter] = defaultdict(Counter)
    slot_hits: dict[str, Counter] = defaultdict(Counter)   # 기사 → 순번 카운트
    cells = 0

    for d, v, sh, cs in _shift_cells(roster):
        if d not in date_set:
            continue
        cells += 1
        if cs.driver:
            per_driver_day[(cs.driver, d)].append((v, sh))
            shift_count[cs.driver][sh] += 1
            e = roster.entry(d, v)
            if e and e.slot_index is not None:
                slot_hits[cs.driver][e.slot_index] += 1
    rep.cells = cells

    # ── E1 중복배정 ─────────────────────────────────────────────
    dup = 0
    for (drv, d), places in sorted(per_driver_day.items()):
        if len(places) > 1:
            dup += 1
            where = ", ".join(f"{v} {sh}" for v, sh in places)
            rep.findings.append(Finding(
                "E1", SEV_ERROR,
                f"{drv} — {d:%m/%d} 에 두 자리에 들어가 있습니다",
                f"{where} 에 동시에 배정돼 있습니다. 한 사람은 하루에 한 자리만 "
                f"설 수 있으니 둘 중 하나는 다른 기사여야 합니다.",
                date=d, driver=drv, vehicle=places[0][0], group=group_of.get(places[0][0]),
            ))
    rep.checks.append(CheckResult("E1", "같은 날 중복 배정", len(per_driver_day), dup))

    # ── E2 빈 자리 ──────────────────────────────────────────────
    # 운행하는 차량(순번이 있는 날)인데 기사 칸이 비어 있는 경우.
    # 휴차(순번 없음)는 비어 있는 게 정상이므로 세지 않는다.
    empty = 0
    operating = 0
    for d in dates:
        for v in vehicles:
            e = roster.entry(d, v)
            if e is None or e.is_resting_vehicle:
                continue
            for sh, cs in (("오전", e.am), ("오후", e.pm)):
                operating += 1
                if cs.driver or cs.leave:
                    continue
                empty += 1
                if empty <= 60:      # 대량이면 목록이 무의미해진다 — 요약만
                    rep.findings.append(Finding(
                        "E2", SEV_ERROR,
                        f"{v} — {d:%m/%d} {sh} 자리가 비어 있습니다",
                        "이 차량은 그날 운행하는데(순번이 있음) 기사가 지정돼 있지 "
                        "않습니다. 배차 누락이거나 휴차 표기가 빠진 것입니다.",
                        date=d, vehicle=v, shift=sh, group=group_of.get(v),
                    ))
    rep.checks.append(CheckResult("E2", "운행 차량의 빈 자리", operating, empty))

    # ── E3 연속근무 ─────────────────────────────────────────────
    work_days: dict[str, set[dt.date]] = defaultdict(set)
    for (drv, d) in per_driver_day:
        work_days[drv].add(d)

    max_consec = int(pol.get("max_consecutive_days", 6) or 6)
    consec_on = bool(pol.get("max_consecutive_enabled", True))
    over = 0
    if consec_on:
        for drv, ds in sorted(work_days.items()):
            run: list[dt.date] = []
            d = min(ds)
            end = max(ds)
            while d <= end:
                if d in ds:
                    run.append(d)
                else:
                    run = []
                if len(run) == max_consec + 1:
                    over += 1
                    rep.findings.append(Finding(
                        "E3", SEV_ERROR,
                        f"{drv} — {run[0]:%m/%d}부터 연속 {max_consec + 1}일 근무",
                        f"설정된 최대 연속 근무일({max_consec}일)을 넘습니다. "
                        f"중간에 휴무를 하루 넣어야 합니다.",
                        date=run[0], driver=drv,
                    ))
                d += dt.timedelta(days=1)
    rep.checks.append(CheckResult(
        "E3", f"연속 근무 {max_consec}일 초과", len(work_days), over,
    ))

    # ── W1 짧은 휴식 (오후 → 다음날 오전) ────────────────────────
    # 규칙으로 금지한 회사면 ERROR, 아니면 참고용 WARN.
    pm_am_forbidden = bool(pol.get("forbid_pm_to_am", False))
    shift_on: dict[tuple[str, dt.date], set[str]] = defaultdict(set)
    for (drv, d), places in per_driver_day.items():
        for _, sh in places:
            shift_on[(drv, d)].add(sh)

    short_rest = 0
    for (drv, d), shifts in sorted(shift_on.items()):
        if "오후" not in shifts:
            continue
        nxt = d + dt.timedelta(days=1)
        if nxt in date_set and "오전" in shift_on.get((drv, nxt), set()):
            short_rest += 1
            if short_rest <= 40:
                rep.findings.append(Finding(
                    "W1", SEV_ERROR if pm_am_forbidden else SEV_WARN,
                    f"{drv} — {d:%m/%d} 오후 근무 뒤 {nxt:%m/%d} 오전 근무",
                    "늦게 퇴근하고 다음날 새벽에 출근하는 형태입니다."
                    + (" 설정에서 금지된 조합입니다." if pm_am_forbidden
                       else " 금지 설정은 꺼져 있어 참고로만 표시합니다."),
                    date=d, driver=drv,
                ))
    rep.checks.append(CheckResult("W1", "오후 근무 다음날 오전", len(shift_on), short_rest))

    # ── W2 월 근무일수 ──────────────────────────────────────────
    # 월 전체가 담긴 파일일 때만 의미가 있다. 일부 기간만 올린 파일에
    # '근무일수 부족'을 띄우면 전부 오탐이 된다.
    #
    # 설정된 밴드(예: 20~23일)와 직접 비교하면 안 된다. 실측을 보면 같은
    # 회사도 1월엔 20~21일, 3월엔 22~23일에 몰린다 — 달의 길이와 공휴일
    # 수에 따라 통째로 움직이기 때문이다. 고정 밴드로 재면 2월에 110명 중
    # 53명이 '미달'로 뜨는데, 그건 배차가 틀린 게 아니라 자가 틀린 것이다.
    #
    # 그래서 **그 달 본인들의 중앙값**을 기준으로 크게 떨어진 사람만 짚는다.
    # 실제로 걸리는 건 월중 입·퇴사자와 장기 결근자 — 담당자가 알아야 할
    # 바로 그 사람들이다. 밴드는 한 줄 요약으로만 쓴다.
    band_on = bool(pol.get("monthly_band_enabled", True))
    band = pol.get("monthly_work_days") or (20, 23)
    lo, hi = int(band[0]), int(band[1])
    full_month = len(dates) >= 28
    off_band = 0
    if band_on and full_month and len(work_days) >= 5:
        counts = sorted(len(ds) for ds in work_days.values())
        median = counts[len(counts) // 2]
        floor_, ceil_ = median - 5, median + 3
        for drv, ds in sorted(work_days.items()):
            n = len(ds)
            if floor_ <= n <= ceil_:
                continue
            off_band += 1
            rep.findings.append(Finding(
                "W2", SEV_WARN,
                f"{drv} — 근무 {n}일 (다른 기사 대부분 {median}일)",
                ("다른 기사보다 많이 적습니다. 월중 입·퇴사나 장기 휴무가 "
                 "아니라면 배차가 덜 들어간 것입니다."
                 if n < median else
                 "다른 기사보다 많습니다. 초과분이 연장근무 정산 대상인지 "
                 "확인해 보세요."),
                driver=drv,
            ))
        if not (lo <= median <= hi):
            rep.findings.append(Finding(
                "W2", SEV_INFO,
                f"이 달 평균 근무일수가 {median}일입니다 (설정 기준 {lo}~{hi}일)",
                "개인 문제가 아니라 이 달 전체가 기준 밖입니다. 달의 길이나 "
                "공휴일 때문이면 정상이고, 아니면 설정값을 손볼 때입니다.",
            ))
    rep.checks.append(CheckResult(
        "W2", "월 근무일수 쏠림",
        len(work_days) if (band_on and full_month) else 0, off_band,
        note="" if band_on and full_month else
             ("월 근무일수 관리가 꺼져 있습니다" if not band_on else
              f"올린 기간이 {len(dates)}일뿐이라 월 근무일수는 판단하지 않습니다"),
    ))

    # ── W3 순번 이탈 ────────────────────────────────────────────
    # 그룹별로 '어제 순번 → 오늘 순번'의 차이를 본다. 대부분의 날이 같은
    # 값(예: -1)이면 그게 그 회사의 회전 규칙이고, 거기서 벗어난 날만 짚는다.
    # 규칙을 우리가 정해 놓고 재는 게 아니라 **그 회사 표에서 읽어낸 규칙**과
    # 비교하는 것이라, 스타일이 달라도 오탐이 나지 않는다.
    rot_off = 0
    rot_checked = 0
    if bool(pol.get("rotation_enabled", True)) and not static_slots:
        for g in roster.groups:
            n = len(g.vehicles)
            if n < 3:
                continue
            steps: list[tuple[dt.date, Optional[int]]] = []
            for i in range(1, len(dates)):
                prev_d, cur_d = dates[i - 1], dates[i]
                step_votes = Counter()
                for v in g.vehicles:
                    pe, ce = roster.entry(prev_d, v), roster.entry(cur_d, v)
                    if not pe or not ce:
                        continue
                    if pe.slot_index is None or ce.slot_index is None:
                        continue
                    step_votes[(ce.slot_index - pe.slot_index) % n] += 1
                if not step_votes:
                    steps.append((cur_d, None))
                    continue
                step, votes = step_votes.most_common(1)[0]
                # 그룹 안에서 의견이 갈리면(같은 날 차량마다 이동칸이 다름)
                # 회전이 아니라 손으로 건드린 날이다.
                steps.append((cur_d, step if votes >= max(2, sum(step_votes.values()) - 1) else None))

            known = Counter(s for _, s in steps if s is not None)
            if not known:
                continue
            main_step, main_votes = known.most_common(1)[0]
            # 지배적인 규칙이 없으면(예: 로테이션을 안 쓰는 그룹) 검사하지 않는다
            if main_votes < len(steps) * 0.6:
                continue
            rot_checked += len(steps)
            for d, s in steps:
                if s == main_step:
                    continue
                # 감차일은 순번이 재배열되는 게 정상이라 제외
                resting = sum(
                    1 for v in g.vehicles
                    if (e := roster.entry(d, v)) is not None and e.is_resting_vehicle
                )
                prev_resting = sum(
                    1 for v in g.vehicles
                    if (e := roster.entry(d - dt.timedelta(days=1), v)) is not None
                    and e.is_resting_vehicle
                )
                if resting != prev_resting:
                    continue
                rot_off += 1
                if rot_off <= 30:
                    rep.findings.append(Finding(
                        "W3", SEV_WARN,
                        f"{g.name} — {d:%m/%d} 순번 회전이 평소와 다릅니다",
                        f"이 그룹은 보통 하루에 {main_step}칸씩 회전하는데 이 날은 "
                        f"그 규칙에서 벗어나 있습니다. 의도한 조정이면 넘어가셔도 "
                        f"되고, 아니면 순번이 한 번 꼬인 뒤 계속 밀렸을 수 있습니다.",
                        date=d, group=g.name,
                    ))
    rep.checks.append(CheckResult(
        "W3", "순번 회전 규칙", rot_checked, rot_off,
        note="이 양식은 순번이 한 달 고정이라 회전을 확인할 수 없습니다 "
             "(게시용 배차표를 올리면 검사합니다)" if static_slots else "",
    ))

    # ── I1 시프트 편중 ──────────────────────────────────────────
    # 오전만/오후만 도는 기사. 회사에 따라 의도된 운영일 수 있어 INFO.
    bias = 0
    for drv, cnt in sorted(shift_count.items()):
        total = cnt["오전"] + cnt["오후"]
        if total < 10:
            continue
        ratio = max(cnt["오전"], cnt["오후"]) / total
        if ratio < 0.85:
            continue
        bias += 1
        side = "오전" if cnt["오전"] >= cnt["오후"] else "오후"
        rep.findings.append(Finding(
            "I1", SEV_INFO,
            f"{drv} — {side}에 {round(ratio * 100)}% 쏠려 있습니다",
            f"{total}일 중 {side} {max(cnt['오전'], cnt['오후'])}일입니다. "
            f"본인 희망이면 문제없고, 아니라면 짝궁 교대가 멈춰 있을 수 있습니다.",
            driver=drv,
        ))
    rep.checks.append(CheckResult("I1", "오전/오후 편중", len(shift_count), bias))

    # ── I2 이른/늦은 순번 편중 ──────────────────────────────────
    # 로테이션이 있는 이유가 이걸 막기 위해서다. 실제로 고르게 갔는지 본다.
    #
    # 단, 순번이 **고정 라벨**인 양식(월간배차: 순번이 행 라벨이라 한 달 내내
    # 안 변한다)에서는 이 값을 잴 수 없다. 그 표에서 1번 차량 고정기사는
    # 정의상 매일 '1번 순번'이라 전원이 쏠림으로 잡히는데, 실제 이른 출발은
    # 일일배차의 조율로 매일 돌고 있다. 잴 수 없는 걸 재면 전부 오탐이므로
    # 아예 건너뛰고 '해당 없음'으로 표시한다.
    skew = 0
    measurable = static_slots is False
    early = Counter()
    if measurable:
        for drv, hits in slot_hits.items():
            if hits:
                early[drv] = hits.get(1, 0)
        if len(early) >= 5:
            vals = list(early.values())
            mean = sum(vals) / len(vals)
            if mean >= 1:
                for drv, n in sorted(early.items(), key=lambda kv: -kv[1]):
                    if n < mean * 2 or n - mean < 3:
                        continue
                    skew += 1
                    rep.findings.append(Finding(
                        "I2", SEV_INFO,
                        f"{drv} — 1번 순번(가장 이른 출발)을 {n}회 맡았습니다",
                        f"평균 {mean:.1f}회의 두 배가 넘습니다. 로테이션이 이 기사만 "
                        f"비껴가고 있는지 확인해 보세요.",
                        driver=drv,
                    ))
    rep.checks.append(CheckResult(
        "I2", "이른 순번 쏠림", len(early), skew,
        note="이 양식은 순번이 한 달 고정이라 쏠림을 확인할 수 없습니다 "
             "(게시용 배차표를 올리면 검사합니다)" if static_slots else "",
    ))

    return rep
