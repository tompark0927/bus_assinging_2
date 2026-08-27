"""Busync 가 내보낸 배차표의 '일별 상세' 시트 파서.

담당자가 우리 화면에서 [Excel 내보내기]로 받은 파일을 다시 올리는 흐름이
실제로 가장 흔하다("지난달 걸로 이번 달 짜 주세요"). 그런데 그 파일의 첫
시트는 **행=기사 / 셀=노선번호** 라 차량 중심(행=차량 / 셀=기사명)인
주간·월간 파서로는 한 글자도 읽히지 않는다. 그러면 엔진이 조용히 빈 결과를
돌려주고, 백엔드는 "차량번호가 하나도 일치하지 않습니다"라며 애먼 기초
데이터를 의심하게 만든다.

다행히 같은 파일의 '일별 상세' 시트가 (날짜 × 차량 × 오전/오후 × 기사)를
한 행씩 그대로 갖고 있다. 오히려 원본 양식보다 정확하다 — 사번까지 있어
동명이인도 갈린다. 그래서 이 시트가 있으면 그걸 우선해서 읽는다.

레이아웃:
    날짜 | 요일 | 노선 | 기사 이름 | 사원번호 | 구분 | 버스번호 | 근무형태 | 상태
    2026.07.01 | 수 | 16 | 김명천 | DRV037 | 메인 | 2506 | 오전 | 정상
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Optional

from ..models import CellState, DayEntry, DepotGroup, MonthlyRoster

SHEET_NAME = "일별 상세"

#: 근무형태 → (오전에 넣을지, 오후에 넣을지). '종일'은 두 칸 모두 같은 사람.
_SHIFT_SLOTS = {
    "오전": (True, False),
    "오후": (False, True),
    "종일": (True, True),
}

#: 기사 자리에 사람 이름이 아닌 것이 오는 경우 (휴무·결행 표기)
_NON_DRIVER = {"", "-", "휴", "휴무", "O휴", "0휴", "○", "O", "결행", "미운행", "운휴"}


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def _as_date(v: Any) -> Optional[dt.date]:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = _text(v)
    # 내보내기는 '2026.07.01', 사람이 손댄 파일은 '2026-07-01' 또는 '2026/7/1'
    m = re.match(r"^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$", s)
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def has_daily_detail(wb) -> bool:
    return SHEET_NAME in wb.sheetnames


def parse_daily_detail(wb, division: str = "") -> Optional[MonthlyRoster]:
    """'일별 상세' 시트를 MonthlyRoster 로 읽는다. 읽을 게 없으면 None."""
    if SHEET_NAME not in wb.sheetnames:
        return None
    ws = wb[SHEET_NAME]

    rows = ws.iter_rows(min_row=2, values_only=True)
    entries: dict[tuple[dt.date, str], DayEntry] = {}
    # 노선을 출발지그룹 대신 쓴다 — 이 양식에는 그룹 정보가 없고, 로테이션은
    # 어차피 노선 안에서 돈다
    route_vehicles: dict[str, list[str]] = {}
    month_count: dict[tuple[int, int], int] = {}

    for r in rows:
        if not r or len(r) < 8:
            continue
        date = _as_date(r[0])
        if date is None:
            continue
        route = _text(r[2])
        driver = _text(r[3])
        vehicle = _text(r[6])
        shift = _text(r[7])
        state = _text(r[8]) if len(r) > 8 else ""
        if not vehicle:
            continue

        slots = _SHIFT_SLOTS.get(shift)
        if slots is None:
            # 모르는 근무형태는 종일로 본다 — 칸을 통째로 잃는 것보다 낫다
            slots = (True, True)

        key = (date, vehicle)
        entry = entries.get(key)
        if entry is None:
            entry = DayEntry(date=date, vehicle=vehicle)
            entries[key] = entry

        # 결행·드랍 등 근무가 아닌 상태는 기사를 비워 둔다(그 칸은 공석으로 보인다)
        is_working = driver not in _NON_DRIVER and state not in {"결행", "미운행"}
        cell = CellState(driver=driver if is_working else None, raw=driver)
        to_am, to_pm = slots
        if to_am:
            entry.am = cell
        if to_pm:
            entry.pm = cell

        if route:
            vs = route_vehicles.setdefault(route, [])
            if vehicle not in vs:
                vs.append(vehicle)
        month_count[(date.year, date.month)] = month_count.get((date.year, date.month), 0) + 1

    if not entries:
        return None

    # 파일이 달을 걸쳐 있을 수 있다 — 행이 가장 많은 달을 그 파일의 달로 본다
    (year, month), _ = max(month_count.items(), key=lambda kv: kv[1])

    # 순번(slot_index)은 이 양식에 없다. 노선 안 차번순으로 부여해 두면
    # 게시 양식·로테이션 전개가 기존 경로를 그대로 탄다.
    groups: list[DepotGroup] = []
    for route, vehicles in sorted(route_vehicles.items()):
        ordered = sorted(vehicles, key=lambda v: (len(v), v))
        groups.append(DepotGroup(name=route, vehicles=ordered))
        index_of = {v: i + 1 for i, v in enumerate(ordered)}
        for (d, v), e in entries.items():
            if v in index_of:
                e.slot_index = index_of[v]
                e.slot_label = str(index_of[v])

    return MonthlyRoster(
        year=year,
        month=month,
        division=division,
        groups=groups,
        entries=entries,
    )
