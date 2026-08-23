"""온보딩 추천 엔진.

업로드된 과거 배차표(1~N개월)를 분석해서, 설정 카탈로그의 각 항목에 대해
"추천값 + 신뢰도 + 근거 문장"을 만든다. UI는 이를 설정 화면에 얹어
[추천 수락] 원탭 온보딩을 제공한다.

원칙: 여기서 계산하는 것은 어디까지나 '추천'이다. 확정은 항상 담당자가 한다.
"""
from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from .config import DisplayMode, ReductionMode
from .importer.inference import (
    infer_reduction_model,
    infer_rotation,
)
from .models import MonthlyRoster


@dataclass
class Recommendation:
    key: str                 # SETTINGS_CATALOG 키
    value: Any               # 추천값
    confidence: float        # 0..1
    evidence: str            # 근거 문장 (한국어, UI 노출용)


@dataclass
class GroupRuleSummary:
    """그룹별 자동 추론 규칙 (설정이 아니라 '감지된 운영 방식' 카드로 노출)."""

    group: str
    size: int
    rotation_step: Optional[int]     # 단일 스텝이면 값, 아니면 None(커스텀 순열)
    rotation_perm: dict[int, int]
    rotation_support: float
    reduction_mode: str
    rest_slots: dict[str, list[int]]
    display_mode: str


@dataclass
class AnalysisReport:
    months_analyzed: int
    drivers: int
    fixed_drivers: int
    spare_drivers: int
    group_rules: list[GroupRuleSummary] = field(default_factory=list)
    recommendations: list[Recommendation] = field(default_factory=list)
    inferred_holidays: list[dt.date] = field(default_factory=list)


def _driver_sequences(
    rosters: list[MonthlyRoster],
) -> dict[str, dict[dt.date, tuple[str, str]]]:
    seq: dict[str, dict[dt.date, tuple[str, str]]] = defaultdict(dict)
    for r in rosters:
        for (d, v), e in r.entries.items():
            if d.month != r.month:
                continue
            if e.am.driver:
                seq[e.am.driver][d] = (v, "A")
            if e.pm.driver:
                seq[e.pm.driver][d] = (v, "P")
    return seq


def analyze(rosters: list[MonthlyRoster]) -> AnalysisReport:
    """과거 배차표 → 규칙 감지 + 설정 추천."""
    seq = _driver_sequences(rosters)
    latest = rosters[-1]
    recs: list[Recommendation] = []

    # ── 기사 계층 ──
    home: dict[str, str] = {}
    for k, days in seq.items():
        c = Counter(v for v, s in days.values())
        v, n = c.most_common(1)[0]
        if n / len(days) >= 0.5:
            home[k] = v
    n_fixed = len(home)
    n_spare = len(seq) - n_fixed

    # ── 연속 근무 분포 → 최대 연속일 추천 ──
    run_hist: Counter = Counter()
    for k, days in seq.items():
        ds = sorted(days)
        run = 1
        for i in range(1, len(ds)):
            if (ds[i] - ds[i - 1]).days == 1:
                run += 1
            else:
                run_hist[run] += 1
                run = 1
        run_hist[run] += 1
    max_run = max(run_hist) if run_hist else 6
    over6 = sum(c for r, c in run_hist.items() if r > 6)
    total_runs = sum(run_hist.values())
    rec_max = max(6, max_run) if over6 else 6
    recs.append(Recommendation(
        "max_consecutive_enabled", True,
        0.95 if over6 == 0 else 0.7,
        f"근무 블록 {total_runs:,}건 중 6일 초과 {over6}건, 최장 {max_run}일 관측.",
    ))
    recs.append(Recommendation(
        "max_consecutive_days", rec_max,
        0.95 if over6 == 0 else 0.6,
        f"현행 운영상 연속 {rec_max}일이 상한으로 보입니다.",
    ))

    # ── 오후→익일 오전 전환율 → H6 추천 ──
    pm_to_am = trans_total = 0
    for k, days in seq.items():
        ds = sorted(days)
        for i in range(1, len(ds)):
            if (ds[i] - ds[i - 1]).days != 1:
                continue
            trans_total += 1
            if days[ds[i - 1]][1] == "P" and days[ds[i]][1] == "A":
                pm_to_am += 1
    rate = pm_to_am / trans_total if trans_total else 0
    recs.append(Recommendation(
        "forbid_pm_to_am", rate < 0.005,
        0.9 if rate < 0.005 or rate > 0.05 else 0.5,
        f"연속 근무 {trans_total:,}건 중 오후→익일 오전 전환 {pm_to_am}건({rate*100:.1f}%). "
        + ("현행도 사실상 금지 중 → 켜기 추천." if rate < 0.005
           else "현행에서 실제로 발생 중 → 끄기 추천."),
    ))

    # ── 월 근무일수 밴드 ──
    per_month_wd: list[int] = []
    for r in rosters:
        wd = Counter()
        for (d, v), e in r.entries.items():
            if d.month != r.month:
                continue
            for cs in (e.am, e.pm):
                if cs.driver:
                    wd[cs.driver] += 1
        # 월중 입퇴사 근사 배제: 상위 70% 만
        vals = sorted(wd.values(), reverse=True)
        per_month_wd += vals[: int(len(vals) * 0.7) or 1]
    if per_month_wd:
        per_month_wd.sort()
        lo = per_month_wd[int(len(per_month_wd) * 0.1)]
        hi = per_month_wd[int(len(per_month_wd) * 0.9) - 1]
        recs.append(Recommendation(
            "monthly_work_days", (lo, hi), 0.8,
            f"기사 월 근무일수 실측 10~90분위 {lo}~{hi}일.",
        ))

    # ── 고정기사 본인차량 원칙 ──
    viol = tot_other = 0
    for k, hv in home.items():
        for d, (v, s) in seq[k].items():
            if v == hv:
                continue
            tot_other += 1
            for r in rosters:
                e = r.entry(d, hv)
                if e is not None:
                    if not (e.am.leave and e.pm.leave):
                        viol += 1
                    break
    total_cells = sum(len(d) for d in seq.values())
    recs.append(Recommendation(
        "fixed_driver_own_vehicle", viol / max(total_cells, 1) < 0.01,
        0.9,
        f"고정기사가 본인차량 운행일에 타 차량 근무한 사례 {viol}건"
        f"/전체 {total_cells:,}셀. "
        + ("사실상 하드 규칙 → 켜기 추천." if viol / max(total_cells, 1) < 0.01
           else "예외가 잦아 소프트 완화 추천."),
    ))

    # ── 짝궁 스왑 규칙: 동시휴 vs 단독휴 ──
    partner: dict[str, str] = {}
    by_v: dict[str, list[str]] = defaultdict(list)
    for k, v in home.items():
        by_v[v].append(k)
    for v, ks in by_v.items():
        if len(ks) == 2:
            partner[ks[0]], partner[ks[1]] = ks[1], ks[0]
    joint_swap = joint_tot = solo_swap = solo_tot = 0
    for k, hv in home.items():
        pk = partner.get(k)
        if not pk:
            continue
        days = seq[k]
        pdays = seq.get(pk, {})
        ds = sorted(days)
        for i in range(1, len(ds)):
            gap = (ds[i] - ds[i - 1]).days
            if gap < 2 or gap > 5:
                continue
            gd = [ds[i - 1] + dt.timedelta(days=g) for g in range(1, gap)]
            joint = any(x not in pdays for x in gd)
            swapped = days[ds[i - 1]][1] != days[ds[i]][1]
            if joint:
                joint_tot += 1
                joint_swap += swapped
            else:
                solo_tot += 1
                solo_swap += swapped
    jr = joint_swap / joint_tot if joint_tot else 0
    sr = solo_swap / solo_tot if solo_tot else 0
    if joint_tot >= 20:
        if jr >= 0.75 and sr <= 0.5:
            val, why = "joint_solo", "실측과 일치 (함께 쉰 뒤 교대, 혼자 쉰 뒤 유지)"
        elif jr >= 0.6:
            val, why = "always_swap", "휴무 복귀 시 대체로 교대"
        else:
            val, why = "manual", "일관된 교대 패턴 미감지"
        recs.append(Recommendation(
            "pair_swap_rule", val, min(0.9, max(jr, 1 - jr)),
            f"짝 동시휴 복귀 후 교대율 {jr*100:.0f}%({joint_tot}건), "
            f"단독휴 복귀 후 교대율 {sr*100:.0f}%({solo_tot}건). {why}.",
        ))

    # ── 그룹 규칙 (로테이션·감차) ──
    group_rules: list[GroupRuleSummary] = []
    any_rotation = False
    any_reduction = False
    display_votes: Counter = Counter()
    style_votes: Counter = Counter()
    inferred_holidays: set[dt.date] = set()
    for g in latest.groups:
        rule = infer_rotation(latest, g)
        if rule is None:
            continue
        any_rotation = any_rotation or rule.support > 0.9
        cfg, disp, hols, _ptr = infer_reduction_model(latest, g, rule)
        inferred_holidays |= hols
        has_reduction = bool(cfg.rest_slots) or bool(cfg.rest_counts)
        any_reduction = any_reduction or has_reduction
        display_votes[disp.value] += 1
        style_votes[cfg.mode.value] += 1
        group_rules.append(GroupRuleSummary(
            group=g.name, size=g.size,
            rotation_step=rule.as_step, rotation_perm=rule.perm,
            rotation_support=rule.support,
            reduction_mode=cfg.mode.value,
            rest_slots={
                cls.value: sorted(slots)
                for cls, slots in cfg.rest_slots.items()
            },
            display_mode=disp.value,
        ))
    if group_rules:
        avg_support = sum(r.rotation_support for r in group_rules) / len(group_rules)
        recs.append(Recommendation(
            "rotation_enabled", any_rotation, avg_support,
            f"그룹 {len(group_rules)}개 전부에서 일일 로테이션 감지 "
            f"(평균 규칙 일치율 {avg_support*100:.0f}%).",
        ))
        recs.append(Recommendation(
            "weekend_reduction_enabled", any_reduction,
            0.9 if any_reduction else 0.7,
            "주말·공휴일 감차 패턴 감지." if any_reduction
            else "감차 패턴 미감지 (주말에도 전 차량 운행).",
        ))
        if style_votes:
            top_style, cnt = style_votes.most_common(1)[0]
            recs.append(Recommendation(
                "reduction_style", top_style, cnt / len(group_rules),
                f"그룹 {len(group_rules)}개 중 {cnt}개가 "
                + ("'고정 순번 휴차' 방식" if top_style == ReductionMode.FIXED_SLOTS.value
                   else "'차량 순환 포인터' 방식") + ".",
            ))
        if display_votes:
            top_disp, cnt = display_votes.most_common(1)[0]
            recs.append(Recommendation(
                "weekend_display", top_disp, cnt / len(group_rules),
                "기존 배차표의 휴차 표기 방식을 따랐습니다.",
            ))

    # ── 요일 선호 ──
    pref_drivers = []
    for k, days in seq.items():
        if len(days) < 30:
            continue
        # 재직 구간 내 특정 요일 휴무 집중도
        ds = sorted(days)
        start, end = ds[0], ds[-1]
        off_by_wd: Counter = Counter()
        tot_by_wd: Counter = Counter()
        d = start
        while d <= end:
            tot_by_wd[d.weekday()] += 1
            if d not in days:
                off_by_wd[d.weekday()] += 1
            d += dt.timedelta(days=1)
        for wd_i in range(7):
            if tot_by_wd[wd_i] >= 8 and off_by_wd[wd_i] / tot_by_wd[wd_i] >= 0.6:
                pref_drivers.append((k, wd_i))
                break
    recs.append(Recommendation(
        "weekday_preference_enabled", bool(pref_drivers),
        0.8,
        f"특정 요일 휴무 집중(60%+) 기사 {len(pref_drivers)}명 감지."
        + (" 소프트 선호 반영 추천." if pref_drivers else " 당장은 꺼도 무방."),
    ))

    # ── 그룹 간 예비 투입 ──
    cross = 0
    fill_total = 0
    vg = {}
    for g in latest.groups:
        for v in g.vehicles:
            vg[v] = g.name
    for k, days in seq.items():
        hv = home.get(k)
        hg = vg.get(hv) if hv else None
        for d, (v, s) in days.items():
            if hv and v != hv:
                fill_total += 1
                if hg and vg.get(v) and vg[v] != hg:
                    cross += 1
    recs.append(Recommendation(
        "spare_cross_group", cross > 5,
        0.85,
        f"타 차량 투입 {fill_total}건 중 그룹 경계를 넘은 사례 {cross}건. "
        + ("그룹 간 투입이 현행 관행 → 허용 추천." if cross > 5
           else "그룹 내 충원이 원칙 → 차단 추천."),
    ))

    # ── 일일 휴무 정원 ──
    # 배차표만으로는 '신청 휴무'와 로테이션 휴차·비번이 구분되지 않는다.
    # 정확한 값은 휴무신청 시트 임포트 시 재계산 — 여기서는 실무 관측 기본값 유지.
    recs.append(Recommendation(
        "leave_daily_cap", 6, 0.4,
        "배차표만으로는 신청 휴무를 구분할 수 없어 실무 관측 기본값(하루 최대 6명)을 "
        "유지합니다. 휴무신청 데이터 업로드 시 자동 재추천됩니다.",
    ))

    return AnalysisReport(
        months_analyzed=len(rosters),
        drivers=len(seq),
        fixed_drivers=n_fixed,
        spare_drivers=n_spare,
        group_rules=group_rules,
        recommendations=recs,
        inferred_holidays=sorted(inferred_holidays),
    )
