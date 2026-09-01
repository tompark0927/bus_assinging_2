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
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Optional

from .audit import AuditReport, audit
from .config import DayClass, ReductionCalendar, ReductionMode
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
from .frame import BaseFrame, Cycle, build_month_frame, estimate_anchor
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


ROUTE_KEY_RE = re.compile(r"^\s*([0-9A-Za-z가-힣\-]+?)번?(?:\s|$)")


def _route_key(group_name: str) -> str:
    """그룹 이름에서 노선 번호를 뽑는다 — '16번 가좌출발' → '16', '9' → '9'."""
    m = ROUTE_KEY_RE.match(group_name or "")
    return m.group(1) if m else (group_name or "")


def _split(total: int, sizes: list[int]) -> list[int]:
    """운행 대수를 출발지그룹 크기 비율로 나눈다 (최대잉여법).

    남는 1대는 **앞 그룹**이 가져간다. 성민 7월 실측이 그렇다 —
    16번 토요일 11대 = 가좌 6 + 동춘 5 (즉 감차는 뒤 그룹이 더 진다).
    """
    n = sum(sizes)
    if n <= 0:
        return [0] * len(sizes)
    total = max(0, min(total, n))
    base = [total * s // n for s in sizes]
    rem = total - sum(base)
    # 소수부가 큰 순, 같으면 앞 그룹 우선
    order = sorted(range(len(sizes)), key=lambda i: (-((total * sizes[i]) % n), i))
    for i in order[:rem]:
        base[i] += 1
    return base


def _counts_for_group(
    operating_counts: Optional[dict[str, dict[str, int]]],
    groups: list[DepotGroup],
    g: DepotGroup,
) -> tuple[Optional[dict[str, int]], dict[str, int]]:
    """등록된 운행 대수를 이 출발지그룹 몫으로 환산한다.

    기초 데이터의 운행 대수는 **노선 단위**(16번 평일 12대)인데 로테이션과
    감차는 **출발지그룹 단위**(가좌출발 7대 / 동춘출발 7대)로 돈다. 예전에는
    노선 키('16')를 그룹 이름('16번 가좌출발')에서 그대로 찾아서 한 번도
    맞지 않았고, 그래서 감차가 통째로 무시돼 슬롯이 14% 부풀었다.
    (성민 8월 생성본: 그룹당 평일 7대 전부 운행 → 2416칸, 7월 실측은 2112칸.)

    반환: (원본 항목, 이 그룹의 요일별 운행 대수)
    """
    if not operating_counts:
        return None, {}
    oc = operating_counts.get(g.name)
    peers = [g]
    if oc is None:
        key = _route_key(g.name)
        oc = operating_counts.get(key)
        if oc is None:
            return None, {}
        peers = [x for x in groups if _route_key(x.name) == key] or [g]
    idx = next((i for i, x in enumerate(peers) if x.name == g.name), 0)
    sizes = [x.size for x in peers]
    run: dict[str, int] = {}
    for key in ("weekday", "sat", "sunhol"):
        v = oc.get(key)
        if v is None:
            continue
        run[key] = _split(int(v), sizes)[idx]
    return oc, run



def generate_month(
    history: list[MonthlyRoster],
    policy: CompanyPolicy,
    year: int,
    month: int,
    leaves: dict[str, set[dt.date]] | None = None,
    weekday_off_pref: dict[str, dict[int, float]] | None = None,
    home_vehicle_config: Optional[dict[str, str]] = None,
    # 실측(성민 42대·108명·3노선): 45초면 미충원 0, 60초면 짝궁 100%·스왑 98%.
    # 180초는 이미 충분한 해를 더 깎느라 담당자를 3분 더 기다리게 할 뿐이었다.
    time_limit_s: float = 90.0,
    operating_counts: Optional[dict[str, dict[str, int]]] = None,
    base_frame: Optional[BaseFrame] = None,
    mains_only: bool = False,
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

    # ── 기본 틀 — 메인의 근무·휴무·시프트를 여기서 못박는다 ──
    # 패턴 전개보다 먼저다. 감차가 "짝꿍이 쉬는 차"를 골라 세워야 하기 때문에
    # 어느 차가 쉬는지를 알고 들어가야 한다.
    all_vehicles = [v for g in prev_t.groups for v in g.vehicles]
    anchor_warnings: list[str] = []
    # 근무 주기는 회사가 [배차 설정 → 운영 정책]에서 정한다. 여기에 박아 넣으면
    # 다른 회사에서 그대로 틀린다 — 시내는 보통 5근2휴, 마을은 6근1휴다.
    cycle = Cycle(
        work_days=int(policy.get("cycle_work_days")),
        rest_days=int(policy.get("cycle_rest_days")),
    )
    if base_frame is None:
        est = estimate_anchor(prev_t, home_vehicle, epoch=min(prev_t.dates(), default=first), cycle=cycle)
        base_frame = est.frame
        anchor_warnings = list(est.warnings)
        anchor_warnings.append(
            f"기본 틀 위상을 {prev.year}년 {prev.month}월 배차표에서 추정했습니다 "
            f"(일치도 {est.overall_fit:.0%}). [배차 설정 → 기본 틀] 에서 확정해 두면 "
            f"다음 달부터 추정 없이 그대로 씁니다."
        )
    mframe = build_month_frame(base_frame, all_vehicles, year, month, leaves)

    # ── 1단계: 패턴 전개 ──
    patterns: dict[str, PatternMatrix] = {}
    display_of: dict[str, DisplayMode] = {}
    rotation_on = bool(policy.get("rotation_enabled"))
    reduction_on = bool(policy.get("weekend_reduction_enabled"))
    # 순번을 이어받지 않고 새로 시작하는 그룹 (파일에 순번 열이 없는 경우)
    fresh_start: set[str] = set()
    for g in prev_t.groups:
        rule = infer_rotation(prev_t, g)
        if rule is None and prev_t.slots_are_synthetic:
            # 순번 열이 없는 양식(Busync 내보내기)이다. 이어받을 순번이 애초에
            # 존재하지 않으므로 전월 말일에서 '이어받는 척'하면 그게 곧 틀린
            # 순번이 된다. 대신 이어받기를 끈 것과 똑같이 **차량 순서대로 새로
            # 시작**하고, 이어지지 않는다는 사실을 경고로 분명히 남긴다.
            # 회전 자체는 설정된 칸수를 쓴다.
            n = g.size
            step = int(policy.get("rotation_step") or 1)
            rule = RotationRule(
                group=g.name, size=n,
                perm={s: ((s - 1 + step) % n) + 1 for s in range(1, n + 1)},
                support=0.0,
            )
            fresh_start.add(g.name)
            warnings.append(
                f"{g.name}: 파일에 순번 정보가 없어 순번을 차량 순서대로 새로 "
                f"시작합니다(회전 {step:+d}칸). 지난달 순번과는 이어지지 않으니 "
                f"게시 전에 순번을 확인해 주세요."
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
        # 등록된 요일별 운행 대수가 있으면 추론값을 덮어쓴다. 회사가 직접 적은
        # 값이 지난달 실적을 되짚은 것보다 정확하다 — 되짚기는 평일 상시 감차를
        # 공휴일로 오해해 대수를 뭉갠다(성민: 평일 12/토 11/휴일 10, 등록 14).
        oc, per_group_run = _counts_for_group(operating_counts, prev_t.groups, g)
        if oc:
            rest_counts: dict[DayClass, int] = {}
            for key, cls in (("weekday", DayClass.WEEKDAY), ("sat", DayClass.SAT), ("sunhol", DayClass.SUNHOL)):
                run = per_group_run.get(key)
                if run is None:
                    continue
                rest_counts[cls] = max(0, g.size - int(run))
            if rest_counts:
                cfg.mode = ReductionMode.VEHICLE_POINTER
                cfg.rest_counts = rest_counts
                cfg.rest_slots = {}
                if not cfg.pointer_order:
                    cfg.pointer_order = list(g.vehicles)
                warnings.append(
                    f"{g.name}: 등록된 운행 대수를 적용했습니다 "
                    + " · ".join(
                        f"{ko}{per_group_run[k]}대"
                        for k, ko in (("weekday", "평일 "), ("sat", "토 "), ("sunhol", "일·공휴일 "))
                        if per_group_run.get(k) is not None
                    )
                )
        if not reduction_on:
            cfg.rest_slots = {}
            cfg.rest_counts = {}
        # 이어받기를 끈 경우엔 전월 상태를 조회하지 않는다 — 직전 월 자료가
        # 아예 없어도(첫 도입) 생성이 가능해야 하기 때문.
        if g.name in fresh_start:
            # 위에서 이미 사유를 경고로 남겼다 — 여기서 또 알리지 않는다
            last_map = {v: i + 1 for i, v in enumerate(g.vehicles)}
        elif not carry_over or not prev_is_immediate:
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
            rule, last_map, first, last, cal, cfg, disp,
            rest_preference=mframe.resting_vehicles,
        )
        display_of[g.name] = disp

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

    max_consec = (int(policy.get("max_consecutive_days"))
                  if policy.get("max_consecutive_enabled") else len(dates))
    # ── 기본 틀을 붙박이로 ──
    # 메인의 근무일·시프트·차량은 이미 정해져 있다. 솔버는 스페어 자리만 푼다.
    # 예전에는 이 계획을 소프트 제약(S8)으로 넘기고 날짜별 휴무 인원을 다시
    # 맞추는 레벨링을 돌렸는데, 그 과정에서 계단이 흐트러져 8월 배차표의
    # 휴무 블록이 1일짜리로 쪼개졌다.
    fixed_cells: dict[tuple[dt.date, str, str], str] = {}
    for driver, days in mframe.work.items():
        v = home_vehicle.get(driver)
        if v is None:
            continue
        for d, sh in days.items():
            fixed_cells[(d, v, sh.value)] = driver
    fixed_off = {k: set(v) for k, v in mframe.rest.items() if k in home_vehicle}

    # 스페어도 같은 계단에 올린다.
    #
    # 예전에는 스페어에게 리듬이 없어서 "메인이 쓰고 남은 자리"만 받았다.
    # 성민에서 메인 21일 / 스페어 11일로 갈렸다 — 같은 회사 기사인데 근무일수가
    # 두 배 차이 났다. 2020년 수기 배차표는 107명 전원이 19~21일로 고르다.
    #
    # 스페어는 고정 차량이 없으니 '어느 칸'은 정할 수 없다. 대신 **쉬는 날**을
    # 같은 주기로 깔아 준다. 그러면 그날 나올 수 있는 사람이 정해지고, 아래
    # 근무일수 밴드가 2,058칸을 108명에게 고르게 나눈다.
    spares = [k for k in drivers if k not in home_vehicle]
    for i, k in enumerate(spares):
        ph = cycle.staircase_phase(0, i)
        off = {
            d for d in dates
            if not cycle.state(ph + (d - dates[0]).days)[0]
        }
        fixed_off[k] = off | set(leaves.get(k, ()))

    # 스페어 근무일수 하한은 **남은 슬롯**으로 다시 잰다. 메인이 틀대로 자리를
    # 차지하고 나면 스페어가 앉을 칸은 얼마 안 남는데, 원래 밴드(20~23일)를
    # 그대로 걸면 "이만큼은 일해야 한다"와 "앉을 자리가 없다"가 부딪혀 모델이
    # 통째로 INFEASIBLE 이 된다.
    # 근무일수 밴드 = **공평한 몫**. 총 슬롯을 전원으로 나눈 값 언저리로 묶는다.
    # 이게 메인과 스페어의 근무일수를 붙여 놓는 유일한 장치다 — 밴드가 없으면
    # 솔버는 메인을 틀대로 꽉 채우고 스페어를 놀린다(둘 다 제약 위반이 아니다).
    fair = len(operating) / max(len(drivers), 1)
    lo, hi = max(0, int(fair) - 1), int(fair) + 2
    warnings.append(
        f"운행 {len(operating)}칸을 기사 {len(drivers)}명이 나눠 "
        f"1인당 {fair:.1f}일이 공평한 몫입니다 — 근무일수를 {lo}~{hi}일로 맞춥니다."
    )

    # 주기가 일감을 감당하는가. 4근2휴면 한 사람이 한 달에 나올 수 있는 날이
    # 정해진다(30일 중 20일). 공평한 몫이 그보다 크면 아무리 잘 짜도 칸이 빈다 —
    # 인력이 모자란 게 아니라 **주기가 헐거운** 것이다. 담당자가 배차표의 빈 칸을
    # 보고 "사람이 없다"고 오해하지 않도록 먼저 알려준다.
    can_work = len(dates) * (2 * cycle.work_days) / cycle.length
    if fair > can_work + 0.5:
        short = int((fair - can_work) * len(drivers))
        warnings.append(
            f"근무 주기({cycle.work_days}근 {cycle.rest_days}휴)로는 한 사람이 한 달에 "
            f"최대 {can_work:.0f}일까지만 나올 수 있는데, 공평한 몫은 {fair:.1f}일입니다 — "
            f"약 {short}칸이 빌 수밖에 없습니다. [배차 설정 → 운영 정책]에서 연속 "
            f"근무일을 늘리거나 기사를 더 등록해 주세요."
        )

    stranded = sum(
        1 for (d, v, s) in fixed_cells if (d, v, s) not in operating
    )
    if stranded:
        warnings.append(
            f"기본 틀상 근무일이지만 그날 차가 안 나가는 칸이 {stranded}개입니다 — "
            f"그 기사들은 쉬는 것으로 처리됩니다(감차 대수가 틀보다 큰 날)."
        )
    warnings.extend(anchor_warnings)
    warnings.append(
        f"메인은 기본 틀(근무 {cycle.work_days}일→휴무 {cycle.rest_days}일, "
        f"오후/오전 번갈아 {cycle.length}일 주기, 차량마다 하루씩 계단)로 "
        f"확정했습니다. 남은 자리만 스페어로 채웁니다."
    )

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
        fixed_cells=fixed_cells,
        fixed_off=fixed_off,
        allow_unfilled=True,   # 수급 부족은 '결행 후보'로 리포트 (현실 대응)
    )
    if mains_only:
        # 기본 틀만 — 스페어 자리는 비워 둔다. 담당자가 직접 채우거나,
        # [스페어 자동 배치] 로 엔진에 맡기거나 고를 수 있게 하기 위함이다.
        # CP-SAT 를 아예 돌리지 않으므로 즉시 끝난다 — 12개월치를 미리
        # 깔아 두는 일이 가능해지는 이유다.
        filled = {c: k for c, k in fixed_cells.items() if c in operating}
        assignment = Assignment(
            cells=filled,
            objective=0.0,
            status="FRAME_ONLY",
            unfilled=sorted(set(operating) - set(filled)),
        )
        warnings.append(
            f"메인 {len(filled)}칸만 채웠습니다. 남은 "
            f"{len(assignment.unfilled)}칸은 스페어 자리입니다."
        )
    else:
        assignment = solve(problem, policy_to_weights(policy), time_limit_s=time_limit_s)

    roster = _to_roster(
        assignment, patterns, prev_t.groups, display_of, year, month,
        prev_t.division,
    )
    audit_report = audit(problem, assignment)
    # 미충원 슬롯은 위반이 아니라 결행 후보 — 감사에서 분리해 경고로
    if assignment.unfilled and not mains_only:
        unfilled_set = set(assignment.unfilled)
        audit_report.violations = [
            v for v in audit_report.violations
            if not (v.rule == "H1" and any(str(u) in v.message for u in unfilled_set))
        ]
        warnings.append(
            f"기사를 못 채운 칸 {len(assignment.unfilled)}개 — 직접 채우거나 "
            f"결행 여부를 정해 주세요: "
            + ", ".join(
                f"{d.month}/{d.day} {v} {'오전' if s == 'A' else '오후'}"
                for d, v, s in assignment.unfilled[:5]
            )
            + (" 외" if len(assignment.unfilled) > 5 else "")
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
