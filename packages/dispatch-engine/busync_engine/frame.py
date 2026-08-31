"""기본 틀 — 메인(정·부) 근무·휴무·시프트를 규정한다.

담당자가 실제로 하는 순서가 이렇다.

    ① 메인 짝꿍을 계단식으로 쫙 깔아 놓는다   ← 이 파일
    ② 승인된 휴무를 빼 준다
    ③ 감차를 맞춘다
    ④ 남는 자리를 스페어로 메운다

그동안 엔진은 ①을 **추론**했다. 지난달 실적에서 주기를 읽고(`_rest_cycle`),
그 결과를 CP-SAT 에 소프트 제약으로 넘겼다. 그래서 달마다 틀이 달라졌다 —
근무일수 밴드와 연속근무 한도는 총량만 묶을 뿐이라, 하루 일하고 하루 쉬는
톱니도 솔버에게는 똑같이 정답이기 때문이다.

이 파일은 ①을 **규정**한다. 순수 계산이라 지난달 배차표도, 정책 값도 보지
않는다. 위상 앵커 하나만 정하면 몇 년 치든 즉시 나온다 — 그래서 모든 달에
기본 틀을 미리 깔아 둘 수 있다.

사이클 (성민, 2026-08-31 확정)
    근무 4일(오후) → 휴무 2일 → 근무 4일(오전) → 휴무 2일   = 12일

    1일부터 시작한 짝꿍의 휴무일: 5·6 · 11·12 · 17·18 · 23·24 …

    주기 길이는 인원 산술이 정한다. 성민 한 달 총 운행 슬롯은 2,142칸이고
    인원은 107명이라 **전원 평균은 무조건 20.0일**이다. 주기가 정하는 것은
    그 20일을 메인과 스페어가 어떻게 나눠 갖느냐뿐이다.
        12일(4근2휴)  메인 20.6일 / 스페어 17.7일   ← 실측과 일치
        13일(5근1휴+5근2휴) 메인 23.9일 / 스페어 7.0일  ← 스페어가 놀아버린다
    2020년 수기 배차표 107명 전수 분석도 근무블록 4일 57% · 휴무블록 2일 54%로
    앞쪽을 가리킨다. 실제로 13일로 8월을 짰더니 스페어가 9일밖에 못 나갔다.

    · 정·부는 **같은 날 함께 근무하고 함께 쉰다**. 시프트만 서로 반대다.
    · 차량마다 하루씩 밀린다 — 1번 차가 6일에 쉬면 2번 차는 7일에 쉰다.
      이 계단 덕분에 하루에 쉬는 차가 14대 중 4~5대로 고르게 퍼진다.
      평일 12대를 채우려면 2~3대는 스페어가 메운다 — 그게 스페어의 일이다.
"""
from __future__ import annotations

import calendar as _calendar
import datetime as dt
from dataclasses import dataclass, field
from typing import Iterable, Optional

from .models import DepotGroup, MonthlyRoster, Shift

# ────────────────────────────────────────────────────────────────────
# 사이클 정의
# ────────────────────────────────────────────────────────────────────

#: (근무여부, 블록 길이) — 정기사 기준. 부기사는 시프트만 반대다.
#: 첫 근무 블록이 오후인 것은 사장님 확인 사항이다("오후 쭉 일하고").
#:
#: 근무 블록이 **두 개**인 이유: 시프트가 블록마다 오후↔오전으로 뒤집히므로
#: (2020년 실측 전이 A→P 253 / P→A 251, 유지는 30건뿐) 한 바퀴를 다 돌려면
#: 근무 블록 두 개가 필요하다. 4근2휴만 적으면 매 블록이 오후로 고정된다.
CYCLE: tuple[tuple[bool, int], ...] = (
    (True, 4),    # 근무 — 정기사 오후 / 부기사 오전
    (False, 2),   # 휴무 2일
    (True, 4),    # 근무 — 정기사 오전 / 부기사 오후
    (False, 2),   # 휴무 2일
)

CYCLE_LEN = sum(n for _w, n in CYCLE)  # 12

def other(shift: Shift) -> Shift:
    """오전 ↔ 오후."""
    return Shift.AM if shift is Shift.PM else Shift.PM


def _build_phase_table() -> tuple[tuple[bool, Optional[Shift]], ...]:
    """위상 → (근무여부, 정기사 시프트). 휴무면 시프트는 None.

    근무 블록은 나올 때마다 오후 → 오전 → 오후 … 로 번갈아 간다
    ("이걸 번갈아가면서 오후 오전을 타고").
    """
    rows: list[tuple[bool, Optional[Shift]]] = []
    shift = Shift.PM
    for working, length in CYCLE:
        for _ in range(length):
            rows.append((working, shift if working else None))
        if working:
            shift = other(shift)
    return tuple(rows)


_PHASE_TABLE: tuple[tuple[bool, Optional[Shift]], ...] = _build_phase_table()

assert len(_PHASE_TABLE) == CYCLE_LEN


def phase_state(phase: int) -> tuple[bool, Optional[Shift]]:
    """사이클 위상 → (근무여부, 정기사 시프트).

    phase 0 이 첫 근무 블록의 첫날이다.
    """
    return _PHASE_TABLE[phase % CYCLE_LEN]


def rest_days_of_cycle() -> list[int]:
    """한 사이클에서 쉬는 위상들 — 테스트·화면 설명용."""
    return [p for p in range(CYCLE_LEN) if not _PHASE_TABLE[p][0]]


# ────────────────────────────────────────────────────────────────────
# 앵커
# ────────────────────────────────────────────────────────────────────


@dataclass
class BaseFrame:
    """위상 앵커. 이것만 있으면 어느 달이든 계산된다.

    epoch 날짜에 차량 v 의 짝꿍이 사이클 위상 ``phases[v]`` 에 있다.
    """

    epoch: dt.date
    phases: dict[str, int] = field(default_factory=dict)
    #: 차량 -> (정기사, 부기사). 정기사가 첫 근무 블록에 오후를 탄다.
    roles: dict[str, tuple[str, str]] = field(default_factory=dict)

    def phase_on(self, vehicle: str, day: dt.date) -> Optional[int]:
        base = self.phases.get(vehicle)
        if base is None:
            return None
        return (base + (day - self.epoch).days) % CYCLE_LEN

    def to_dict(self) -> dict:
        return {
            "epoch": self.epoch.isoformat(),
            "phases": dict(self.phases),
            "roles": {v: list(pair) for v, pair in self.roles.items()},
            "cycle_len": CYCLE_LEN,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "BaseFrame":
        return cls(
            epoch=dt.date.fromisoformat(data["epoch"]),
            phases={str(k): int(v) for k, v in (data.get("phases") or {}).items()},
            roles={
                str(k): (str(v[0]), str(v[1]))
                for k, v in (data.get("roles") or {}).items()
                if v and len(v) >= 2
            },
        )


def staircase_phase(base_phase: int, index: int) -> int:
    """계단에서 index 번째 차량의 위상.

    "1번 차가 6일에 쉬면 바로 밑 2번 차는 7일에 쉰다" — 쉬는 날이 **하루씩
    뒤로** 밀리므로 위상은 반대로 하루씩 **뒤처진다**(빼기). 부호를 뒤집으면
    계단이 위로 올라가 같은 날 쉬는 차가 몰린다.
    """
    return (base_phase - index) % CYCLE_LEN


def staircase_phases(vehicles: Iterable[str], base_phase: int = 0) -> dict[str, int]:
    """차량 순서대로 하루씩 밀린 계단 위상."""
    return {v: staircase_phase(base_phase, i) for i, v in enumerate(vehicles)}


# ────────────────────────────────────────────────────────────────────
# 전개
# ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class FrameDay:
    """(차량 × 날짜) 한 칸의 기본 틀 상태."""

    date: dt.date
    vehicle: str
    working: bool
    #: 정기사의 시프트. 부기사는 반대. 휴무일이면 None.
    lead_shift: Optional[Shift]

    def shift_of(self, role: str) -> Optional[Shift]:
        """role: 'lead'(정) | 'second'(부)"""
        if self.lead_shift is None:
            return None
        return self.lead_shift if role == "lead" else other(self.lead_shift)


def month_dates(year: int, month: int) -> list[dt.date]:
    last = _calendar.monthrange(year, month)[1]
    return [dt.date(year, month, d) for d in range(1, last + 1)]


def frame_days(
    frame: BaseFrame, vehicle: str, dates: Iterable[dt.date]
) -> list[FrameDay]:
    out: list[FrameDay] = []
    for d in dates:
        ph = frame.phase_on(vehicle, d)
        if ph is None:
            continue
        working, lead = phase_state(ph)
        out.append(FrameDay(date=d, vehicle=vehicle, working=working, lead_shift=lead))
    return out


@dataclass
class MonthFrame:
    """한 달치 기본 틀 — 메인만. 스페어 자리는 여기 없다."""

    dates: list[dt.date]
    #: (날짜, 차량) -> FrameDay
    cells: dict[tuple[dt.date, str], FrameDay] = field(default_factory=dict)
    #: 기사 -> {날짜: 시프트} (근무일만)
    work: dict[str, dict[dt.date, Shift]] = field(default_factory=dict)
    #: 기사 -> {휴무 날짜}
    rest: dict[str, set[dt.date]] = field(default_factory=dict)

    def resting_vehicles(self, day: dt.date) -> list[str]:
        """그날 짝꿍이 통째로 쉬는 차량 — 감차 1순위."""
        return sorted(
            v
            for (d, v), fd in self.cells.items()
            if d == day and not fd.working
        )


def build_month_frame(
    frame: BaseFrame,
    vehicles: Iterable[str],
    year: int,
    month: int,
    leaves: Optional[dict[str, set[dt.date]]] = None,
) -> MonthFrame:
    """기본 틀을 한 달로 전개하고 승인 휴무를 덧씌운다.

    승인 휴무는 틀보다 우선이다 — 계단상 근무일이어도 그 사람은 쉰다.
    짝꿍 한쪽만 휴무를 낸 날은 **그 사람만** 빠진다(차량은 나머지 한 명 +
    스페어로 굴린다). 묶어서 둘 다 빼면 승인 휴무 하나가 슬롯 두 개를
    날려 결행을 만든다.
    """
    dates = month_dates(year, month)
    leaves = leaves or {}
    mf = MonthFrame(dates=dates)

    for v in vehicles:
        pair = frame.roles.get(v)
        for fd in frame_days(frame, v, dates):
            mf.cells[(fd.date, v)] = fd
            if not pair:
                continue
            lead, second = pair
            for driver, role in ((lead, "lead"), (second, "second")):
                sh = fd.shift_of(role)
                on_leave = fd.date in leaves.get(driver, ())
                if sh is not None and not on_leave:
                    mf.work.setdefault(driver, {})[fd.date] = sh
                else:
                    mf.rest.setdefault(driver, set()).add(fd.date)

    return mf


# ────────────────────────────────────────────────────────────────────
# 위상 추정 — 이미 쓰고 있는 배차표에서 앵커를 뽑는다
# ────────────────────────────────────────────────────────────────────


def _observed(roster: MonthlyRoster) -> tuple[dict[str, dict[dt.date, Shift]], list[dt.date]]:
    """실적: 기사 -> {날짜: 시프트}."""
    work: dict[str, dict[dt.date, Shift]] = {}
    for (d, _v), e in roster.entries.items():
        if e.am.driver:
            work.setdefault(e.am.driver, {})[d] = Shift.AM
        if e.pm.driver:
            work.setdefault(e.pm.driver, {})[d] = Shift.PM
    return work, sorted({d for d, _v in roster.entries})


def _score_phase(
    phase: int,
    epoch: dt.date,
    dates: list[dt.date],
    lead_work: dict[dt.date, Shift],
    second_work: dict[dt.date, Shift],
) -> int:
    """이 위상이 두 사람의 실적과 몇 칸이나 맞는가 (근무여부 + 시프트)."""
    score = 0
    for d in dates:
        working, lead_shift = phase_state(phase + (d - epoch).days)
        for w, role_shift in (
            (lead_work, lead_shift),
            (second_work, other(lead_shift) if lead_shift else None),
        ):
            actual = w.get(d)
            if working:
                if actual is None:
                    continue
                score += 2 if actual is role_shift else 1
            else:
                if actual is None:
                    score += 2
    return score


@dataclass
class AnchorEstimate:
    """추정 결과 — 확정 화면이 그대로 보여준다."""

    frame: BaseFrame
    #: 차량 -> 실적과 일치한 비율 0..1
    fit: dict[str, float] = field(default_factory=dict)
    #: 그룹 -> 계단 기준 위상
    group_base: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def overall_fit(self) -> float:
        return sum(self.fit.values()) / len(self.fit) if self.fit else 0.0


def estimate_anchor(
    roster: MonthlyRoster,
    home_vehicle: dict[str, str],
    epoch: Optional[dt.date] = None,
    staircase: bool = True,
) -> AnchorEstimate:
    """쓰고 있는 배차표에서 차량별 위상과 정·부 역할을 뽑는다.

    담당자가 눈으로 확인하고 확정하기 위한 **제안**이다. 확정된 앵커는
    그 뒤로 고정이라 다시 추정하지 않는다.

    staircase=True 면 그룹마다 기준 위상 하나를 골라 차량 순서대로 하루씩
    민다. 실적이 조금 흐트러져 있어도 계단이 복원된다 — 사장님이 설명한
    "바로 밑 짝궁은 7일에 쉬고" 가 원본이고 흐트러짐은 그달의 사정이다.
    """
    work, dates = _observed(roster)
    if not dates:
        raise ValueError("실적이 비어 있어 위상을 추정할 수 없습니다.")
    epoch = epoch or dates[0]

    mains_of: dict[str, list[str]] = {}
    for driver, v in home_vehicle.items():
        mains_of.setdefault(v, []).append(driver)

    warnings: list[str] = []
    phases: dict[str, int] = {}
    roles: dict[str, tuple[str, str]] = {}
    fit: dict[str, float] = {}

    max_score = len(dates) * 2 * 2  # 두 사람 × 날짜 × 만점 2

    for g in roster.groups:
        for v in g.vehicles:
            pair = sorted(mains_of.get(v, []))
            if len(pair) < 2:
                if pair:
                    warnings.append(f"{v}: 고정기사가 {len(pair)}명이라 짝꿍 틀을 만들 수 없습니다.")
                continue
            a, b = pair[0], pair[1]
            best: tuple[int, int, tuple[str, str]] = (-1, 0, (a, b))
            for ph in range(CYCLE_LEN):
                # 누가 정(첫 블록 오후)인지도 함께 고른다
                for lead, second in ((a, b), (b, a)):
                    s = _score_phase(
                        ph, epoch, dates, work.get(lead, {}), work.get(second, {})
                    )
                    if s > best[0]:
                        best = (s, ph, (lead, second))
            phases[v] = best[1]
            roles[v] = best[2]
            fit[v] = best[0] / max_score if max_score else 0.0

    group_base: dict[str, int] = {}
    if staircase:
        for g in roster.groups:
            have = [v for v in g.vehicles if v in phases]
            if not have:
                continue
            # 차량 i 의 위상을 staircase_phase(base, i) 로 놓았을 때 가장 잘 맞는 base
            best_b, best_hit = 0, -1
            for b in range(CYCLE_LEN):
                hit = sum(
                    1
                    for i, v in enumerate(g.vehicles)
                    if v in phases and phases[v] == staircase_phase(b, i)
                )
                if hit > best_hit:
                    best_b, best_hit = b, hit
            group_base[g.name] = best_b
            moved = 0
            for i, v in enumerate(g.vehicles):
                want = staircase_phase(best_b, i)
                if v in phases and phases[v] != want:
                    moved += 1
                phases[v] = want
            if moved:
                warnings.append(
                    f"{g.name}: {len(g.vehicles)}대 중 {moved}대의 위상을 계단에 맞춰 "
                    f"정렬했습니다(기준 위상 {best_b})."
                )

    return AnchorEstimate(
        frame=BaseFrame(epoch=epoch, phases=phases, roles=roles),
        fit=fit,
        group_base=group_base,
        warnings=warnings,
    )


def new_anchor(
    groups: Iterable[DepotGroup], epoch: dt.date, base_phase: int = 0
) -> BaseFrame:
    """실적이 없을 때 — 차량 순서대로 계단을 새로 시작한다."""
    phases: dict[str, int] = {}
    for g in groups:
        phases.update(staircase_phases(g.vehicles, base_phase))
    return BaseFrame(epoch=epoch, phases=phases)
