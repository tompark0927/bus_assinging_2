"""감차·표시 모델 설정 (rotation과 importer가 공유)."""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum


class DayClass(str, Enum):
    WEEKDAY = "weekday"
    SAT = "sat"
    SUNHOL = "sunhol"   # 일요일 + 공휴일


class ReductionMode(str, Enum):
    FIXED_SLOTS = "fixed_slots"        # 고정 언더라잉 휴차 슬롯 (지선, 간선 동춘/삼산동)
    VEHICLE_POINTER = "vehicle_pointer"  # 차량 순환 포인터 (간선 37번 원창동)


class DisplayMode(str, Enum):
    KEEP = "keep"        # 지선: 휴차도 순번 표시
    COMPACT = "compact"  # 간선: 운행차만 1..M 재부여


@dataclass
class GroupReductionConfig:
    mode: ReductionMode = ReductionMode.FIXED_SLOTS
    rest_slots: dict[DayClass, frozenset[int]] = field(default_factory=dict)
    rest_counts: dict[DayClass, int] = field(default_factory=dict)
    pointer_order: list[str] = field(default_factory=list)
    pointer_start: int = 0


@dataclass
class ReductionCalendar:
    """감차 시행 캘린더. 공휴일 목록 + 특별 감차 시나리오(코로나/아시아드)."""

    holidays: set[dt.date] = field(default_factory=set)
    special_periods: list[tuple[dt.date, dt.date, DayClass]] = field(
        default_factory=list
    )

    def day_class(self, d: dt.date) -> DayClass:
        for start, end, cls in self.special_periods:
            if start <= d <= end:
                return cls
        if d in self.holidays or d.weekday() == 6:
            return DayClass.SUNHOL
        if d.weekday() == 5:
            return DayClass.SAT
        return DayClass.WEEKDAY
