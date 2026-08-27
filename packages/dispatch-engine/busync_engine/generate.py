"""배차 생성 오케스트레이터 (생성 모드 E2E).

입력: 과거 로스터(규칙·프로필 추론용) + 회사 정책 + 승인 휴무 + 공휴일.
출력: 월간 배차 초안 + 제약 감사 + 공정성 리포트.

흐름 (스펙 4):
  1단계  그룹별 로테이션 규칙·감차 모델 추론 → 차량-순번 패턴 전개
  2단계  CP-SAT 기사 배정 (정책의 하드/소프트 스위치 반영)
  3단계  감사(H1~H6) → 위반 시 게시 차단, 공정성 리포트 첨부
"""
from __future__ import annotations

import calendar as _calendar
import datetime as dt
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Optional

from .audit import AuditReport, audit
from .config import DayClass, ReductionCalendar
from .fairness import FairnessReport, build_report
from .importer.inference import (
    RotationRule,
    infer_reduction_model,
    infer_rotation,
    replay_underlying,
    slot_map,
)
from .models import CellState, DayEntry, DepotGroup, MonthlyRoster
from .policy import CompanyPolicy
from .rotation import DisplayMode, PatternMatrix, expand_pattern
from .solver import AssignmentProblem, Assignment, SolverWeights, solve


@dataclass
class GenerationResult:
    roster: MonthlyRoster                  # 생성된 배차표 (렌더러 입력)
    assignment: Assignment
    problem: AssignmentProblem             # 설명(explain)·국소수리(repair) 입력
    audit: AuditReport
    fairness: FairnessReport
    patterns: dict[str, PatternMatrix] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def policy_to_weights(policy: CompanyPolicy) -> SolverWeights:
    strength = int(policy.get("shift_continuity_strength"))
    w = SolverWeights()
    w.keep_shift = max(strength * 8, 1)
    w.swap_after_leave = max(strength * 4, 1)
    w.weekday_pref = 20 if policy.get("weekday_preference_enabled") else 0
    w.vehicle_affinity = 8 if policy.get("spare_affinity_enabled") else 0
    w.group_affinity = 0 if policy.get("spare_cross_group") else 200
    w.fairness_lambda = int(policy.get("fairness_lambda"))
    return w


def generate_month(
    history: list[MonthlyRoster],
    policy: CompanyPolicy,
    year: int,
    month: int,
    leaves: dict[str, set[dt.date]] | None = None,
    weekday_off_pref: dict[str, dict[int, float]] | None = None,
    home_vehicle_config: Optional[dict[str, str]] = None,
    time_limit_s: float = 180.0,
) -> GenerationResult:
    """home_vehicle_config: 담당자가 확정한 이번 달 차량-고정기사 구성
    (기사 -> 차량). 없으면 전월 실적에서 추론한다."""
    if not history:
        raise ValueError("과거 로스터가 최소 1개월 필요합니다 (규칙·프로필 추론)")
    leaves = leaves or {}
    prev = history[-1]
    first = dt.date(year, month, 1)
    last = dt.date(year, month, _calendar.monthrange(year, month)[1])
    last_prev_day = first - dt.timedelta(days=1)

    # 로테이션은 전월 말일 상태에서 이어받는 것이 원칙이다 (월 경계 리셋 금지 — 스펙 7).
    # 다만 첫 도입처럼 직전 월 배차표가 없을 수 있다. 그때는 이어받기를 포기하고
    # 차량 순서대로 순번을 새로 시작한다(rotation_carry_over=false 와 동일 동작).
    # 규칙(순열·감차·짝궁) 자체는 어느 달 이력에서든 추론되므로 생성은 가능하다.
    carry_over = bool(policy.get("rotation_carry_over"))
    prev_is_immediate = (prev.year, prev.month) == (last_prev_day.year, last_prev_day.month)
    if carry_over and not prev_is_immediate:
        raise ValueError(
            f"직전 월({last_prev_day.year}-{last_prev_day.month:02d}) 배차표가 없습니다 "
            f"(가장 최근 이력: {prev.year}-{prev.month:02d}). 순번 로테이션을 이어받으려면 "
            f"직전 월이 포함된 엑셀이 필요합니다.\n"
            f"직전 월 자료가 없다면 [AI 엔진 설정] → '월 경계 이어가기'를 끄고 다시 "
            f"생성하세요. 순번이 차량 순서대로 새로 시작됩니다."
        )
    prev_t = MonthlyRoster(
        year=prev.year, month=prev.month,
        division=prev.division, groups=prev.groups,
        # 순번이 시트에서 온 것인지 파서가 부여한 것인지는 잘라낸 사본에도
        # 그대로 따라가야 한다 — 아래 로테이션 추론이 이 값으로 갈린다
        slots_are_synthetic=prev.slots_are_synthetic,
    )
    prev_t.entries = {
        (d, v): e for (d, v), e in prev.entries.items() if d <= last_prev_day
    }
    warnings: list[str] = []

    # ── 감차 캘린더 (정책의 공휴일 + 특별 감차 시나리오) ──
    cal = ReductionCalendar(holidays=set(policy.holidays))
    for s, e, _label in policy.special_reductions:
        cal.special_periods.append((s, e, DayClass.SUNHOL))

    # ── 1단계: 패턴 전개 ──
    patterns: dict[str, PatternMatrix] = {}
    display_of: dict[str, DisplayMode] = {}
    rotation_on = bool(policy.get("rotation_enabled"))
    reduction_on = bool(policy.get("weekend_reduction_enabled"))
    for g in prev_t.groups:
        rule = infer_rotation(prev_t, g)
        if rule is None and prev_t.slots_are_synthetic:
            # 순번 열이 없는 양식(Busync 내보내기)이다. 여기서 설정값으로
            # 적당히 회전시켜 넘어가면 **틀린 순번의 배차표**가 나오고, 현장은
            # 그 순번대로 차를 낸다. 짐작으로 채우느니 무엇을 해야 하는지
            # 알려주고 멈춘다 — '그대로 가져오기'는 이 파일로도 잘 된다.
            raise ValueError(
                "이 파일에는 순번(로테이션) 정보가 없어 새 배차표를 짤 수 없습니다. "
                "Busync 에서 [Excel 내보내기]로 받은 파일에는 순번 열이 없습니다.\n"
                "· 이 파일 내용을 그대로 쓰시려면 '이미 짠 표 그대로 가져오기'를 선택하세요.\n"
                "· 엔진으로 새로 짜시려면 순번(순번·차번 열)이 있는 월간배차 원본 파일이 필요합니다."
            )
        if rule is None:
            raise ValueError(f"{g.name}: 로테이션 규칙 추론 실패 — 온보딩 위저드에서 확인 필요")
        if not rotation_on:
            # 로테이션 끔: 전월 말일 순번 고정 (항등 순열)
            rule.perm = {s: s for s in rule.perm}
            warnings.append(f"{g.name}: 로테이션 꺼짐 — 순번 고정")
        elif all(rule.perm[s] == s for s in rule.perm):
            # 추론 결과가 항등 = 시트에서 순번 회전을 읽을 수 없었다는 뜻.
            # 월간배차처럼 순번이 고정 열인 양식이 여기 해당한다 — 이때는
            # 설정된 회전 칸수를 쓴다 (모르면 회전이 없는 것처럼 돼버리므로).
            step = int(policy.get("rotation_step"))
            n = g.size
            if step % n:
                rule.perm = {s: ((s - 1 + step) % n) + 1 for s in rule.perm}
                warnings.append(
                    f"{g.name}: 시트에서 순번 회전을 감지하지 못해 설정값"
                    f"({step:+d}칸)을 적용했습니다"
                )
        cfg, disp, _hols, ptr_end = infer_reduction_model(prev_t, g, rule)
        cfg.pointer_start = ptr_end
        if not reduction_on:
            cfg.rest_slots = {}
            cfg.rest_counts = {}
        # 이어받기를 끈 경우엔 전월 상태를 조회하지 않는다 — 직전 월 자료가
        # 아예 없어도(첫 도입) 생성이 가능해야 하기 때문.
        if not carry_over or not prev_is_immediate:
            last_map = {v: i + 1 for i, v in enumerate(g.vehicles)}
            warnings.append(
                f"{g.name}: 순번을 차량 순서대로 새로 시작합니다 "
                f"(직전 월 이어받기 없음)"
            )
        else:
            last_map = slot_map(prev_t, g, last_prev_day)
            if len(last_map) < g.size:
                # 감차일이라 표시 순번이 비었으면 언더라잉을 복원해 이어받는다
                replayed = replay_underlying(prev_t, g, rule)
                if last_prev_day not in replayed:
                    raise ValueError(
                        f"{g.name}: 전월 말일({last_prev_day}) 로테이션 상태를 복원할 수 "
                        f"없습니다 — 직전 월 배차표가 말일까지 채워져 있는지 확인해 주세요."
                    )
                last_map = replayed[last_prev_day]
        patterns[g.name] = expand_pattern(
            rule, last_map, first, last, cal, cfg, disp
        )
        display_of[g.name] = disp

    # ── 프로필 (전월 구성 = 월초 초기 조건) ──
    counts: dict[str, Counter] = defaultdict(Counter)
    shift_hist: dict[str, list[str]] = defaultdict(list)
    affinity: dict[tuple[str, str], int] = defaultdict(int)
    for i, r in enumerate(history):
        recency = i + 1
        for (d, v), e in r.entries.items():
            if d.month != r.month:
                continue
            for s, cs in (("A", e.am), ("P", e.pm)):
                if cs.driver:
                    affinity[(cs.driver, v)] += recency
                    shift_hist[cs.driver].append(s)
                    if r is prev:
                        counts[cs.driver][v] += 1
    if home_vehicle_config is not None:
        home_vehicle = dict(home_vehicle_config)
    else:
        home_vehicle = {}
        for k, c in counts.items():
            v, n = c.most_common(1)[0]
            if n / sum(c.values()) >= 0.5 and n >= 10:
                home_vehicle[k] = v
    partner: dict[str, str] = {}
    by_home: dict[str, list[str]] = defaultdict(list)
    for k, v in home_vehicle.items():
        by_home[v].append(k)
    for v, ks in sorted(by_home.items()):
        if len(ks) == 2:
            partner[ks[0]], partner[ks[1]] = ks[1], ks[0]
    pm_ratio = {
        k: h.count("P") / len(h) for k, h in shift_hist.items() if len(h) >= 10
    }
    vehicle_group: dict[str, str] = {}
    for g in prev_t.groups:
        for v in g.vehicles:
            vehicle_group[v] = g.name
    driver_group = {
        k: vehicle_group[v] for k, v in home_vehicle.items() if v in vehicle_group
    }

    # ── 월 경계 상태 ──
    prev_pm: dict[str, bool] = {}
    prev_last_work: dict[str, dt.date] = {}
    for (d, v), e in prev_t.entries.items():
        for s, cs in (("A", e.am), ("P", e.pm)):
            if cs.driver and (
                cs.driver not in prev_last_work or d > prev_last_work[cs.driver]
            ):
                prev_last_work[cs.driver] = d
                prev_pm[cs.driver] = s == "P"

    # ── 운행 슬롯 ──
    dates = [first + dt.timedelta(days=i) for i in range((last - first).days + 1)]
    operating: set[tuple[dt.date, str, str]] = set()
    for gname, pat in patterns.items():
        for (d, v), cell in pat.items():
            if cell.operating:
                operating.add((d, v, "A"))
                operating.add((d, v, "P"))

    # ── H5 밴드 (기사별 가용일 반영 일할) ──
    drivers = sorted(set(counts.keys()) | set(home_vehicle.keys()))  # 전월 근무자 + 확정 구성
    if policy.get("monthly_band_enabled"):
        lo, hi = policy.get("monthly_work_days")
    else:
        lo, hi = 0, len(dates)
    # 전역 수급 검증: 총 슬롯 vs 밴드
    total_slots = len(operating)
    if drivers and not (lo * len(drivers) <= total_slots <= hi * len(drivers)):
        warnings.append(
            f"수급 경고: 슬롯 {total_slots}개 vs 기사 {len(drivers)}명 × "
            f"밴드 {lo}~{hi}일 — 밴드를 자동 완화합니다"
        )
        lo = min(lo, total_slots // len(drivers))
        hi = max(hi, -(-total_slots // len(drivers)))

    problem = AssignmentProblem(
        dates=dates,
        operating=operating,
        drivers=drivers,
        leaves={k: set(v) for k, v in leaves.items()},
        forced_work_days=None,          # 생성 모드
        home_vehicle=home_vehicle,
        partner=partner,
        driver_group=driver_group,
        vehicle_group=vehicle_group,
        affinity=dict(affinity),
        weekday_off_pref=weekday_off_pref or {},
        pm_ratio=pm_ratio,
        prev_pm=prev_pm,
        prev_last_work=prev_last_work,
        work_days_band=(lo, hi),
        max_consecutive=(
            int(policy.get("max_consecutive_days"))
            if policy.get("max_consecutive_enabled") else len(dates)
        ),
        forbid_pm_to_am=bool(policy.get("forbid_pm_to_am")),
        hard_own_vehicle=bool(policy.get("fixed_driver_own_vehicle")),
        pair_swap_rule=str(policy.get("pair_swap_rule")),
        spare_balance_enabled=bool(policy.get("spare_balance_enabled")),
        fairness_lambda=int(policy.get("fairness_lambda")),
        allow_unfilled=True,   # 수급 부족은 '결행 후보'로 리포트 (현실 대응)
    )
    assignment = solve(problem, policy_to_weights(policy), time_limit_s=time_limit_s)

    roster = _to_roster(
        assignment, patterns, prev_t.groups, display_of, year, month,
        prev_t.division,
    )
    audit_report = audit(problem, assignment)
    # 미충원 슬롯은 위반이 아니라 결행 후보 — 감사에서 분리해 경고로
    if assignment.unfilled:
        unfilled_set = set(assignment.unfilled)
        audit_report.violations = [
            v for v in audit_report.violations
            if not (v.rule == "H1" and any(str(u) in v.message for u in unfilled_set))
        ]
        warnings.append(
            f"수급 부족 미충원(결행 후보) {len(assignment.unfilled)}건: "
            + ", ".join(f"{d} {v} {s}" for d, v, s in assignment.unfilled[:5])
        )
    fairness_report = build_report(roster)
    return GenerationResult(
        roster=roster,
        assignment=assignment,
        problem=problem,
        audit=audit_report,
        fairness=fairness_report,
        patterns=patterns,
        warnings=warnings,
    )


def _to_roster(
    assignment: Assignment,
    patterns: dict[str, PatternMatrix],
    groups: list[DepotGroup],
    display_of: dict[str, DisplayMode],
    year: int,
    month: int,
    division: str,
) -> MonthlyRoster:
    """솔버 산출물 → MonthlyRoster (렌더러·공정성 리포트 공용 입력)."""
    roster = MonthlyRoster(
        year=year, month=month, division=division, groups=groups,
    )
    from .importer.weekly import classify_cell  # 휴 표기 재사용

    for g in groups:
        pat = patterns[g.name]
        prefix = g.slot_prefix
        for (d, v), cell in pat.items():
            am = assignment.cells.get((d, v, "A"))
            pm = assignment.cells.get((d, v, "P"))
            disp = cell.display_slot
            label = f"{prefix}{disp}" if (prefix and disp) else (
                str(disp) if disp else None
            )
            roster.entries[(d, v)] = DayEntry(
                date=d, vehicle=v,
                slot_label=label,
                slot_index=disp,
                am=CellState(driver=am, raw=am or ("휴" if not cell.operating else "")),
                pm=CellState(driver=pm, raw=pm or ("휴" if not cell.operating else "")),
            )
    return roster
