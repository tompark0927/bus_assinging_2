"""BuSync 배차 엔진 도메인 모델.

역공학 스펙 기준 엔티티:
- Division(사업부) > Route(노선) > DepotGroup(출발지그룹) > Vehicle(차량)
- Driver(기사): 고정(FIXED, 짝궁·본인차량 보유) / 예비(SPARE)
- Slot(순번): 그룹 내 1..N. 그날의 출발시각 시간표를 결정 → 공정성 핵심 변수
- Shift: 오전(A) / 오후(P)
- 근무상태: 근무 / 휴무유형 enum (급여 연동 대비 타입 분리)
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Shift(str, Enum):
    AM = "A"  # 오전
    PM = "P"  # 오후


class LeaveType(str, Enum):
    """휴무 유형. 셀 표기와 급여 정산이 다르므로 반드시 분리 관리."""

    REGULAR = "휴"      # 일반휴무 (로테이션상 휴)
    PAID = "O휴"        # 유급휴일
    ANNUAL = "연차"
    SICK = "병가"
    POST = "사후"       # 사후처리
    EDUCATION = "교육"
    UNKNOWN = "?"


class DriverTier(str, Enum):
    FIXED = "고정"   # 차량 고정 + 짝궁
    SPARE = "예비"   # 스페어/SP — 결원 충원


@dataclass(frozen=True)
class CellState:
    """배차표 한 셀(기사 자리)의 상태."""

    driver: Optional[str] = None          # 기사명 (근무 시)
    leave: Optional[LeaveType] = None     # 휴무 시 유형
    raw: str = ""                         # 원본 셀 텍스트

    @property
    def is_working(self) -> bool:
        return self.driver is not None


@dataclass
class DayEntry:
    """(차량 × 날짜) 한 칸: 순번 + 오전/오후 기사."""

    date: dt.date
    vehicle: str
    slot_label: Optional[str] = None      # "3", "가좌2", "일신5" 등 원본 표기
    slot_index: Optional[int] = None      # 그룹 내 숫자 순번 (1..N), 휴차면 None
    am: CellState = field(default_factory=CellState)
    pm: CellState = field(default_factory=CellState)

    @property
    def is_resting_vehicle(self) -> bool:
        """휴차(감차) 여부: 순번이 비어 있으면 그날 미운행."""
        return self.slot_index is None


@dataclass
class DepotGroup:
    """출발지그룹 — 로테이션과 순번은 이 안에서만 돈다."""

    name: str                              # 삼산/가좌/일신/원창/동춘 …
    vehicles: list[str] = field(default_factory=list)
    slot_prefix: str = ""                  # 순번 라벨 접두("가좌", "일신"; 숫자 전용이면 "")

    @property
    def size(self) -> int:
        return len(self.vehicles)


@dataclass
class MonthlyRoster:
    """한 달치 파싱 결과: 그룹 구조 + (날짜×차량) 엔트리 전체."""

    year: int
    month: int
    division: str                          # 간선/지선 …
    groups: list[DepotGroup] = field(default_factory=list)
    entries: dict[tuple[dt.date, str], DayEntry] = field(default_factory=dict)

    def dates(self) -> list[dt.date]:
        return sorted({d for d, _ in self.entries})

    def month_dates(self) -> list[dt.date]:
        """해당 월에 속한 날짜만 (패널에는 전월/익월 날짜도 섞여 있음)."""
        return [d for d in self.dates() if d.year == self.year and d.month == self.month]

    def group_of(self, vehicle: str) -> Optional[DepotGroup]:
        for g in self.groups:
            if vehicle in g.vehicles:
                return g
        return None

    def entry(self, date: dt.date, vehicle: str) -> Optional[DayEntry]:
        return self.entries.get((date, vehicle))

    def drivers(self) -> set[str]:
        out: set[str] = set()
        for e in self.entries.values():
            for cs in (e.am, e.pm):
                if cs.driver:
                    out.add(cs.driver)
        return out


@dataclass
class DriverProfile:
    """임포트 데이터에서 추론되는 기사 프로필."""

    name: str
    tier: DriverTier = DriverTier.SPARE
    home_vehicle: Optional[str] = None     # 본인차량 (고정기사)
    partner: Optional[str] = None          # 짝궁
    group: Optional[str] = None
    # 요일 선호(0=월..6=일): 해당 요일 휴무 선호 가중치 0..1 — 하드 필드 금지(스펙 7)
    weekday_off_preference: dict[int, float] = field(default_factory=dict)
