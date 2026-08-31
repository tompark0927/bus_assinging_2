"""회사별 배차 정책 (CompanyPolicy).

설계 원칙
- 엔진이 픽스하는 것은 "기본값"뿐이다. 모든 규칙은 회사가 켜고/끄고/조절한다.
- 각 설정은 SETTINGS_CATALOG에 UI 메타데이터(라벨·설명·타입·기본값·카테고리)로
  선언된다 → 프론트는 카탈로그만 읽어 설정 화면을 자동 렌더링한다.
- 온보딩 시 recommend.analyze()가 업로드된 과거 배차표에서 추천값 + 근거 문장을
  만들어 카탈로그 위에 얹는다. 담당자는 "추천 수락" 원탭으로 확정한다.

기본값의 출처: 인천 3개 사업부 2020.01~2026.06 실배차 78개월 역공학 실측.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class SettingType(str, Enum):
    TOGGLE = "toggle"      # 켜기/끄기
    NUMBER = "number"      # 숫자 입력 (min/max)
    SLIDER = "slider"      # 강도 0~10 (소프트 가중치·공정성 λ)
    CHOICE = "choice"      # enum 선택
    RANGE = "range"        # (min, max) 밴드


@dataclass(frozen=True)
class SettingSpec:
    key: str
    label: str                      # UI 표시명 (한국어)
    description: str                # 도움말 문장
    type: SettingType
    default: Any
    category: str                   # 설정 화면 섹션
    choices: Optional[list[tuple[str, str]]] = None   # (값, 라벨)
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    advanced: bool = False          # 고급 접기 영역


# ────────────────────────────────────────────────────────────────────
# 설정 카탈로그 — 프론트 설정 화면의 단일 소스
# ────────────────────────────────────────────────────────────────────
SETTINGS_CATALOG: list[SettingSpec] = [
    # ── 근무 규칙 (하드 제약) ──
    SettingSpec(
        "max_consecutive_enabled", "연속 근무일수 제한",
        "기사 한 명이 쉬는 날 없이 연속으로 근무할 수 있는 일수를 제한합니다.",
        SettingType.TOGGLE, True, "근무 규칙",
    ),
    SettingSpec(
        "max_consecutive_days", "최대 연속 근무일",
        "이 일수를 초과하는 연속 근무는 배차표 생성 시 원천 차단됩니다.",
        SettingType.NUMBER, 6, "근무 규칙", min_value=3, max_value=10,
    ),
    SettingSpec(
        "forbid_pm_to_am", "오후 근무 다음날 오전 금지",
        "퇴근이 늦은 오후 시프트 다음날 새벽 오전 시프트 배정을 금지합니다 (휴게시간 보호).",
        SettingType.TOGGLE, False, "근무 규칙",
    ),
    SettingSpec(
        "monthly_band_enabled", "월 근무일수(만근) 관리",
        "기사별 월 근무일수를 정해진 범위 안으로 맞춥니다. 입·퇴사자는 자동 일할 계산.",
        SettingType.TOGGLE, True, "근무 규칙",
    ),
    SettingSpec(
        "monthly_work_days", "월 근무일수 범위",
        "만근 기준 일수의 허용 범위입니다. 사업부마다 다르면 사업부별로 설정하세요.",
        SettingType.RANGE, (20, 23), "근무 규칙", min_value=15, max_value=27,
    ),

    SettingSpec(
        "cycle_work_days", "근무 주기 — 연속 근무일",
        "기본 틀에서 며칠 일하고 쉬는지입니다. [운영 정책] 탭이 주인입니다.",
        SettingType.NUMBER, 5, "근무 규칙", min_value=1, max_value=10,
    ),
    SettingSpec(
        "cycle_rest_days", "근무 주기 — 휴무일",
        "근무 블록 뒤에 며칠 쉬는지입니다. [운영 정책] 탭이 주인입니다.",
        SettingType.NUMBER, 2, "근무 규칙", min_value=1, max_value=5,
    ),

    # ── 차량·짝궁 ──
    SettingSpec(
        "fixed_driver_own_vehicle", "고정기사 본인차량 원칙",
        "고정기사는 본인 차량에만 배정합니다. 끄면 소프트 선호로 완화되어 "
        "필요할 때 타 차량 투입을 허용합니다.",
        SettingType.TOGGLE, True, "차량·짝궁",
    ),
    SettingSpec(
        "pair_swap_rule", "짝궁 오전/오후 교대 규칙",
        "휴무 복귀 시 짝궁과 오전↔오후를 바꾸는 방식입니다.",
        SettingType.CHOICE, "joint_solo", "차량·짝궁",
        choices=[
            ("joint_solo", "함께 쉰 뒤엔 교대, 혼자 쉰 뒤엔 유지 (실측 표준)"),
            ("always_swap", "휴무 복귀 시 항상 교대"),
            ("weekly", "주 단위 교대"),
            ("manual", "자동 교대 없음 (담당자 수동)"),
        ],
    ),
    SettingSpec(
        "shift_continuity_strength", "같은 시프트 유지 강도",
        "연속 근무 중 오전/오후를 바꾸지 않으려는 정도입니다 (실측 유지율 98%).",
        SettingType.SLIDER, 8, "차량·짝궁", min_value=0, max_value=10,
        advanced=True,
    ),

    # ── 순번 로테이션 ──
    SettingSpec(
        "rotation_enabled", "순번 자동 로테이션",
        "이른 출근/늦은 퇴근 순번이 모든 차량에 골고루 돌아가도록 매일 순번을 회전합니다. "
        "그룹별 회전 규칙은 엑셀 업로드 시 자동 추론됩니다.",
        SettingType.TOGGLE, True, "순번 로테이션",
    ),
    SettingSpec(
        "rotation_step", "순번 회전 칸수",
        "매일 순번을 몇 칸씩 옮길지입니다. 기존 배차표에서 자동 감지되면 그 값이 "
        "우선하고, 감지가 안 되는 양식(월간배차처럼 순번이 고정 열인 경우)에만 "
        "이 값을 씁니다. 간선은 보통 -1(하루에 한 칸씩 당김)입니다.",
        SettingType.NUMBER, -1, "순번 로테이션", min_value=-10, max_value=10,
        advanced=True,
    ),
    SettingSpec(
        "rotation_carry_over", "월 경계 이어가기",
        "매월 1일에 로테이션을 처음부터 다시 시작하지 않고 전월 말일에서 이어갑니다. "
        "(끄면 특정 기사에게 이른/늦은 슬롯이 몰릴 수 있어 권장하지 않습니다)",
        SettingType.TOGGLE, True, "순번 로테이션", advanced=True,
    ),

    # ── 감차(주말·공휴일) ──
    SettingSpec(
        "weekend_reduction_enabled", "주말·공휴일 감차",
        "토·일·공휴일에 운행 대수를 줄입니다. 휴차 순서도 자동 순환되어 "
        "특정 기사만 주말에 쉬는 일이 없습니다.",
        SettingType.TOGGLE, True, "감차",
    ),
    SettingSpec(
        "reduction_style", "휴차 선정 방식",
        "어느 차량을 쉬게 할지 정하는 방식입니다. 엑셀 업로드 시 기존 방식을 자동 감지합니다.",
        SettingType.CHOICE, "fixed_slots", "감차",
        choices=[
            ("fixed_slots", "고정 순번이 쉼 (차량이 로테이션으로 통과)"),
            ("vehicle_pointer", "차량 순서대로 돌아가며 쉼"),
        ], advanced=True,
    ),
    SettingSpec(
        "weekend_display", "휴차 표기 방식",
        "게시용 배차표에서 휴차 차량을 어떻게 표시할지 정합니다.",
        SettingType.CHOICE, "keep", "감차",
        choices=[
            ("keep", "순번 유지, 기사 자리에 '휴' 표기 (지선식)"),
            ("compact", "운행 차량만 1번부터 다시 매김, 휴차는 '○' (간선식)"),
        ], advanced=True,
    ),

    # ── 휴무·선호 ──
    SettingSpec(
        "weekday_preference_enabled", "요일 선호 반영",
        "기사별 선호 요일(예: 일요일 휴무 선호)을 소프트하게 반영합니다. "
        "고정 지정휴무가 아니라 가중치라서 필요하면 다른 날 배정될 수 있습니다.",
        SettingType.TOGGLE, True, "휴무·선호",
    ),
    SettingSpec(
        "leave_auto_approve", "휴무신청 자동 승낙",
        "정원 여유가 있으면 휴무신청을 자동 승낙합니다. 정원 초과일만 우선순위 "
        "점수로 정렬해 담당자 확인을 받습니다.",
        SettingType.TOGGLE, True, "휴무·선호",
    ),
    SettingSpec(
        "leave_daily_cap", "일일 휴무신청 정원",
        "하루에 승낙 가능한 휴무 인원 상한입니다. 초과분만 담당자가 판단합니다.",
        SettingType.NUMBER, 6, "휴무·선호", min_value=1, max_value=20,
    ),
    SettingSpec(
        "reciprocity_weight", "대타 호혜성 반영",
        "과거에 남의 대타를 받아준 기사의 휴무신청을 우선 승낙합니다 (대타 카운터 기반).",
        SettingType.SLIDER, 5, "휴무·선호", min_value=0, max_value=10,
        advanced=True,
    ),

    # ── 예비(스페어) 운영 ──
    SettingSpec(
        "spare_balance_enabled", "예비기사 부담 균등화",
        "최근 30일 투입 횟수가 적은 예비기사부터 추천해 부담을 고르게 나눕니다.",
        SettingType.TOGGLE, True, "예비 운영",
    ),
    SettingSpec(
        "spare_affinity_enabled", "노선 숙련도 우선",
        "예비 투입 시 해당 차량·노선을 몰아본 경험이 많은 기사를 우선합니다.",
        SettingType.TOGGLE, True, "예비 운영",
    ),
    SettingSpec(
        "spare_cross_group", "그룹 간 예비 투입 허용",
        "예비기사가 소속 출발지그룹 밖 차량에도 투입될 수 있게 합니다.",
        SettingType.TOGGLE, True, "예비 운영",
    ),

    # ── 공정성 ──
    SettingSpec(
        "fairness_lambda", "공정성 강도 (λ)",
        "이른/늦은 순번, 주말 휴무, 대타 횟수가 기사 간에 고르게 퍼지도록 "
        "최적화에 반영하는 강도입니다. 높일수록 공정성이 우선됩니다.",
        SettingType.SLIDER, 3, "공정성", min_value=0, max_value=10,
    ),
    SettingSpec(
        "fairness_report_visible_to_drivers", "기사 앱에 공정성 리포트 공개",
        "기사별 슬롯 분포·주말휴무·대타 카운트를 기사 앱에도 보여줍니다. "
        "('왜 나만 늦은 배차냐' 민원을 줄이는 기능입니다)",
        SettingType.TOGGLE, True, "공정성",
    ),
]

CATALOG_BY_KEY = {s.key: s for s in SETTINGS_CATALOG}


@dataclass
class CompanyPolicy:
    """회사(사업부)별 정책 값. 없는 키는 카탈로그 기본값을 쓴다."""

    values: dict[str, Any] = field(default_factory=dict)
    # 운영 캘린더 (설정 화면이 아니라 캘린더 UI에서 관리)
    holidays: set[dt.date] = field(default_factory=set)
    # 특별 감차 시나리오: (시작일, 종료일, 라벨)
    special_reductions: list[tuple[dt.date, dt.date, str]] = field(
        default_factory=list
    )

    def get(self, key: str) -> Any:
        if key in self.values:
            return self.values[key]
        spec = CATALOG_BY_KEY.get(key)
        if spec is None:
            raise KeyError(f"알 수 없는 설정 키: {key}")
        return spec.default

    def set(self, key: str, value: Any) -> None:
        if key not in CATALOG_BY_KEY:
            raise KeyError(f"알 수 없는 설정 키: {key}")
        self.values[key] = value

    def effective(self) -> dict[str, Any]:
        """설정된 값 + 카탈로그 기본값을 합친 전체 딕셔너리.

        검산·감사처럼 '이 회사 규칙이 뭔데?'를 통째로 봐야 하는 쪽에서
        키마다 get()을 부르지 않도록.
        """
        out = {k: s.default for k, s in CATALOG_BY_KEY.items()}
        out.update(self.values)
        return out

    # ── 직렬화 (백엔드 저장/전송용) ──
    def to_dict(self) -> dict:
        return {
            "values": self.values,
            "holidays": sorted(d.isoformat() for d in self.holidays),
            "special_reductions": [
                (s.isoformat(), e.isoformat(), label)
                for s, e, label in self.special_reductions
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CompanyPolicy":
        return cls(
            values=dict(data.get("values", {})),
            holidays={
                dt.date.fromisoformat(x) for x in data.get("holidays", [])
            },
            special_reductions=[
                (dt.date.fromisoformat(s), dt.date.fromisoformat(e), label)
                for s, e, label in data.get("special_reductions", [])
            ],
        )


def catalog_as_json() -> list[dict]:
    """프론트 설정 화면 렌더링용 카탈로그 직렬화."""
    out = []
    for s in SETTINGS_CATALOG:
        out.append({
            "key": s.key,
            "label": s.label,
            "description": s.description,
            "type": s.type.value,
            "default": s.default,
            "category": s.category,
            "choices": s.choices,
            "min": s.min_value,
            "max": s.max_value,
            "advanced": s.advanced,
        })
    return out
