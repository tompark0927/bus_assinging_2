"""이미 저장된 배차표(cells JSON) → MonthlyRoster.

"지난달 배차표로 이번 달 짜기"는 원래 파일을 올릴 일이 아니다. 지난달
배차표는 이미 Busync 안에 있고, 순번(SchedulePattern)까지 저장돼 있다.
그런데 엔진 입력이 엑셀 파일뿐이라 담당자는 내보내기 → 다시 업로드라는
왕복을 해야 했고, 그 왕복에서 순번이 떨어져 나가 "로테이션 추론 실패"로
막혔다.

이 모듈은 백엔드가 DB 에서 만든 cells 를 파서 결과와 같은 자료구조로
되돌린다. `/import`·`/generate` 응답의 cells 와 **같은 형식**을 받는다:

    {"2026-07-01": {"2506": {"display_slot": 3, "underlying": 3,
                             "am": "김명천", "pm": "김상윤",
                             "operating": true, "group": "가좌"}}}
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Optional

from ..models import CellState, DayEntry, DepotGroup, MonthlyRoster

#: 기사 자리에 사람 이름이 아닌 것이 오는 경우 (휴무·결행 표기)
_NON_DRIVER = {"", "-", "휴", "휴무", "O휴", "0휴", "○", "O", "결행", "미운행", "운휴", "연차", "병가"}


def _driver(v: Any) -> Optional[str]:
    s = ("" if v is None else str(v)).strip()
    return s if s and s not in _NON_DRIVER else None


def roster_from_cells(
    cells: dict[str, dict[str, dict]],
    year: int,
    month: int,
    division: str = "",
    groups: Optional[list[dict]] = None,
) -> MonthlyRoster:
    """cells → MonthlyRoster.

    `underlying`(언더라잉 순번)이 하나라도 있으면 그것을 순번으로 삼는다 —
    감차일에 표시 순번이 비어도 로테이션은 계속 돌기 때문에, 다음 달을
    이어받으려면 언더라잉이 정확한 근거다. 하나도 없으면 표시 순번을 쓰고,
    그것마저 없으면 `slots_are_synthetic` 을 세워 "이어받을 순번이 없다"고
    알린다(그 경우 generate 가 차량 순서대로 새로 시작한다).
    """
    entries: dict[tuple[dt.date, str], DayEntry] = {}
    group_vehicles: dict[str, list[str]] = {}
    has_real_slot = False

    for date_str, by_vehicle in cells.items():
        try:
            date = dt.date.fromisoformat(date_str[:10])
        except ValueError:
            continue
        for vehicle, cell in (by_vehicle or {}).items():
            if not vehicle:
                continue
            slot = cell.get("underlying") or cell.get("display_slot")
            # 0 은 "저장은 됐지만 순번이 없다"는 뜻으로 들어온다 (감차 기록 등)
            slot = int(slot) if slot else None
            if slot:
                has_real_slot = True
            e = DayEntry(
                date=date,
                vehicle=str(vehicle),
                slot_label=cell.get("slot") or (str(slot) if slot else None),
                slot_index=slot,
            )
            e.am = CellState(driver=_driver(cell.get("am")), raw=str(cell.get("am") or ""))
            e.pm = CellState(driver=_driver(cell.get("pm")), raw=str(cell.get("pm") or ""))
            entries[(date, str(vehicle))] = e

            gname = cell.get("group") or division or "전체"
            vs = group_vehicles.setdefault(str(gname), [])
            if str(vehicle) not in vs:
                vs.append(str(vehicle))

    # 그룹은 호출측이 준 것을 우선한다 (DB 가 아는 출발지그룹이 더 정확하다)
    if groups:
        built = [
            DepotGroup(name=str(g.get("name")), vehicles=[str(v) for v in g.get("vehicles", [])])
            for g in groups
            if g.get("vehicles")
        ]
    else:
        built = [
            DepotGroup(name=n, vehicles=sorted(vs, key=lambda v: (len(v), v)))
            for n, vs in sorted(group_vehicles.items())
        ]

    # 순번이 하나도 없으면 차량 순서대로 임시 부여 — 없으면 그룹 판정 자체가 안 된다
    if not has_real_slot:
        for g in built:
            index_of = {v: i + 1 for i, v in enumerate(g.vehicles)}
            for (d, v), e in entries.items():
                if v in index_of:
                    e.slot_index = index_of[v]
                    e.slot_label = str(index_of[v])

    return MonthlyRoster(
        year=year,
        month=month,
        division=division,
        groups=built,
        entries=entries,
        slots_are_synthetic=not has_real_slot,
    )
