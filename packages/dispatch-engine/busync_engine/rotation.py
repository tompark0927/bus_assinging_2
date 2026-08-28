"""1단계: 차량-순번 패턴 전개 (결정론적).

실측으로 확정된 모델 (2026 성민 간선/지선 역공학):

언더라잉 로테이션
    그룹별 순열 π가 매일 적용된다 (감차일 포함, 중단 없음).
    - 지선 가좌/일신(5대): +2, 삼산(8대): 1→4→7→3→6→2→5→8 순열
    - 간선 동춘/삼산동: -1, 원창동(37번): -3
    월 경계에서 오프셋 리셋 금지 — 전월 말일 상태를 이어받는다 (스펙 7).

감차(휴차) 모델 — "휴차도 순환" (스펙 2.5)
    - FIXED_SLOTS: 요일클래스별 고정 언더라잉 휴차 슬롯 집합.
      차량이 로테이션으로 그 슬롯을 통과하며 쉰다. (지선 전체, 간선 동춘/삼산동)
    - VEHICLE_POINTER: 차량 리스트 위의 연속 포인터가 감차일마다
      휴차 대수만큼 이어서 소비된다. (간선 37번 원창동)

표시 모드
    - KEEP: 휴차 차량도 순번 유지, 기사 자리만 휴 표기 (지선)
    - COMPACT: 운행 차량만 언더라잉 슬롯 순위로 1..M 재부여, 휴차는 공란/○ (간선)
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Optional

from .config import (
    DayClass,
    DisplayMode,
    GroupReductionConfig,
    ReductionCalendar,
    ReductionMode,
)
from .importer.inference import RotationRule

__all__ = [
    "DayClass",
    "DisplayMode",
    "GroupReductionConfig",
    "ReductionCalendar",
    "ReductionMode",
    "SlotCell",
    "PatternMatrix",
    "expand_pattern",
]


@dataclass
class SlotCell:
    underlying_slot: int            # 로테이션상 슬롯 (연속성의 기준)
    operating: bool
    display_slot: Optional[int]     # 표에 인쇄되는 순번 (COMPACT면 재부여)


PatternMatrix = dict[tuple[dt.date, str], SlotCell]


def expand_pattern(
    rule: RotationRule,
    last_slot_map: dict[str, int],
    start: dt.date,
    end: dt.date,
    calendar: ReductionCalendar,
    reduction: GroupReductionConfig | None = None,
    display: DisplayMode = DisplayMode.KEEP,
) -> PatternMatrix:
    """전월 말일 슬롯 상태(start 전날)에서 [start, end] 패턴 전개."""
    if set(last_slot_map.values()) != set(rule.perm.keys()):
        missing = set(rule.perm.keys()) - set(last_slot_map.values())
        raise ValueError(
            f"{rule.group}: 초기 슬롯 상태가 순열 정의역과 불일치 (누락 {missing})"
        )
    reduction = reduction or GroupReductionConfig()
    out: PatternMatrix = {}
    cur = dict(last_slot_map)
    ptr = reduction.pointer_start
    d = start
    while d <= end:
        cur = {v: rule.perm[s] for v, s in cur.items()}
        cls = calendar.day_class(d)
        resting: set[str] = set()
        # 평일을 건너뛰지 않는다. 예전에는 `cls != WEEKDAY` 조건이 있어 "감차는
        # 주말·공휴일에만" 이라고 전제했는데, 평일에도 상시 감차하는 회사가 있다
        # (성민: 노선당 등록 14대, 평일 12·토 11·일공휴일 10). 그 회사는 평일
        # 감차가 통째로 무시돼 다음 달이 '전 차량 매일 운행'으로 짜였다.
        # WEEKDAY 키가 없으면 아래에서 자연히 감차 0 이므로, 주말만 감차하는
        # 회사의 동작은 그대로다.
        if reduction.mode == ReductionMode.FIXED_SLOTS:
            slots = reduction.rest_slots.get(cls, frozenset())
            resting = {v for v, s in cur.items() if s in slots}
        else:
            k = reduction.rest_counts.get(cls, 0)
            order = reduction.pointer_order
            if order and k:
                resting = {order[(ptr + j) % len(order)] for j in range(k)}
                ptr = (ptr + k) % len(order)
        running_sorted = sorted(
            (v for v in cur if v not in resting), key=lambda v: cur[v]
        )
        compact = {v: i + 1 for i, v in enumerate(running_sorted)}
        for v, s in cur.items():
            op = v not in resting
            if display == DisplayMode.KEEP:
                disp: Optional[int] = s
            else:
                disp = compact.get(v)
            out[(d, v)] = SlotCell(underlying_slot=s, operating=op, display_slot=disp)
        d += dt.timedelta(days=1)
    return out
