"""배차총괄·일일배차 시트 파서 (스펙 3.2, 3.3 — 담당자 작업용 뷰).

배차총괄: 행=기사(형태 코드: 가=가좌, 동=동춘 …), 열=날짜, 셀=A/P/공란(휴무).
          우측에 월 근무일수·메모 열. 날짜 헤더가 데이터 열보다 한 칸
          왼쪽으로 밀린 실물 변형이 있어 요일 행으로 오프셋을 자동 보정한다.

일일배차: 노선별 3단 가로 배치, 각 단은 출발지별(가좌출발/동춘출발) 상하 블록.
          열: 순번|조율|차번|오전|오후|…  "0" = 결원 슬롯. 우측 #N/A 수식
          찌꺼기 열은 무시한다.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any, Optional

WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]
VEHICLE_RE = re.compile(r"^\d{3,4}$")
ROUTE_RE = re.compile(r"^\s*([0-9]+(?:-[0-9]+)?)\s*번?\s*$")


# ────────────────────────────────────────────────────────────────────
# 배차총괄 (월간 A/P 그리드)
# ────────────────────────────────────────────────────────────────────

@dataclass
class OverviewDriverRow:
    name: str
    type_code: str                      # 가/동 등 소속 형태
    cells: dict[dt.date, Optional[str]] = field(default_factory=dict)
    # 'A' | 'P' | None(휴무)
    work_days_reported: Optional[int] = None   # 시트에 적힌 근무일수

    @property
    def work_days_counted(self) -> int:
        return sum(1 for v in self.cells.values() if v in ("A", "P"))

    def off_dates(self) -> set[dt.date]:
        return {d for d, v in self.cells.items() if v is None}


@dataclass
class MonthlyOverview:
    year: int
    month: int
    drivers: list[OverviewDriverRow] = field(default_factory=list)

    def by_name(self, name: str) -> Optional[OverviewDriverRow]:
        for r in self.drivers:
            if r.name == name:
                return r
        return None


def _cell_str(v: Any) -> str:
    return "" if v is None else str(v).strip()


def parse_overview(ws) -> MonthlyOverview:
    """배차총괄 시트 → MonthlyOverview."""
    grid: dict[tuple[int, int], Any] = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is not None:
                grid[(c.row, c.column)] = c.value

    # 1) 날짜 헤더 행: datetime 셀이 15개 이상 있는 첫 행
    date_row = None
    dates_by_col: dict[int, dt.date] = {}
    for r in range(1, 6):
        found = {
            col: val.date() if isinstance(val, dt.datetime) else val
            for (rr, col), val in grid.items()
            if rr == r and isinstance(val, (dt.datetime, dt.date))
        }
        if len(found) >= 15:
            date_row = r
            dates_by_col = found
            break
    if date_row is None:
        raise ValueError("배차총괄: 날짜 헤더 행을 찾지 못함")

    # 2) 요일 행으로 열 오프셋 보정 (실물: 날짜가 한 칸 왼쪽으로 밀림)
    weekday_row = date_row + 1
    offset = 0
    for cand in (0, 1, -1):
        hits = total = 0
        for col, d in dates_by_col.items():
            w = _cell_str(grid.get((weekday_row, col + cand)))
            if w in WEEKDAY_KO:
                total += 1
                if w == WEEKDAY_KO[d.weekday()]:
                    hits += 1
        if total >= 10 and hits / total > 0.9:
            offset = cand
            break
    col_to_date = {col + offset: d for col, d in dates_by_col.items()}

    # 3) 근무일수 열: 요일 행에서 "근무" 라벨
    work_col = None
    for (rr, col), val in grid.items():
        if rr == weekday_row and _cell_str(val).startswith("근무"):
            work_col = col
            break

    year = month = None
    for d in col_to_date.values():
        year, month = d.year, d.month
        break
    out = MonthlyOverview(year=year, month=month)

    # 4) 데이터 행: 기사명 열(요일 행의 "기사명" 라벨 열)
    name_col = None
    for (rr, col), val in grid.items():
        if rr == weekday_row and _cell_str(val) == "기사명":
            name_col = col
            break
    if name_col is None:
        name_col = 2
    type_col = name_col - 1

    r = weekday_row + 1
    blanks = 0
    while r <= ws.max_row and blanks < 5:
        name = _cell_str(grid.get((r, name_col)))
        if not name:
            blanks += 1
            r += 1
            continue
        blanks = 0
        row_out = OverviewDriverRow(
            name=name, type_code=_cell_str(grid.get((r, type_col)))
        )
        for col, d in col_to_date.items():
            v = _cell_str(grid.get((r, col))).upper()
            row_out.cells[d] = v if v in ("A", "P") else None
        if work_col is not None:
            wv = grid.get((r, work_col))
            if isinstance(wv, (int, float)):
                row_out.work_days_reported = int(wv)
        out.drivers.append(row_out)
        r += 1
    return out


# ────────────────────────────────────────────────────────────────────
# 일일배차 (당일 운영용)
# ────────────────────────────────────────────────────────────────────

@dataclass
class DailySlot:
    route: str            # "16", "9", "3-2"
    depot: str            # "가좌출발" / "동춘출발" …
    slot: int             # 순번
    adjust: Optional[int]  # 조율(로테이션 오프셋 가시화)
    vehicle: str
    am: Optional[str]     # 기사명, "0"/결원은 None
    pm: Optional[str]


@dataclass
class DailySheet:
    date: Optional[dt.date]
    slots: list[DailySlot] = field(default_factory=list)

    def routes(self) -> list[str]:
        seen: list[str] = []
        for s in self.slots:
            if s.route not in seen:
                seen.append(s.route)
        return seen


def _driver_or_none(v: Any) -> Optional[str]:
    s = _cell_str(v)
    if not s or s in ("0", "0.0", "#N/A", "결행", "○", "O"):
        return None
    return s


def parse_daily(ws) -> DailySheet:
    """일일배차 시트 → DailySheet."""
    grid: dict[tuple[int, int], Any] = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is not None:
                grid[(c.row, c.column)] = c.value

    # 날짜: 첫 행의 datetime 셀
    date_val = None
    for (r, c), v in sorted(grid.items()):
        if r <= 2 and isinstance(v, (dt.datetime, dt.date)):
            date_val = v.date() if isinstance(v, dt.datetime) else v
            break

    # 패널 헤더: "순번" 라벨 행/열 → 각 패널의 기준 열
    panel_cols: list[int] = []
    header_row = None
    for (r, c), v in sorted(grid.items()):
        if _cell_str(v) == "순번":
            if header_row is None:
                header_row = r
            if r == header_row:
                panel_cols.append(c)
    if header_row is None:
        raise ValueError("일일배차: '순번' 헤더를 찾지 못함")

    # 각 패널의 노선명: 헤더 위쪽 행에서 "N번" 형태 탐색
    routes: dict[int, str] = {}
    for pc in panel_cols:
        route = ""
        for up in range(1, 4):
            for dc in range(0, 8):
                m = ROUTE_RE.match(_cell_str(grid.get((header_row - up, pc + dc))))
                if m:
                    route = m.group(1)
                    break
            if route:
                break
        routes[pc] = route or f"패널{pc}"

    out = DailySheet(date=date_val)
    for pc in panel_cols:
        # 열 매핑: 순번(pc), 조율(pc+1), 차번/오전/오후는 헤더 라벨로 탐색
        labels = {}
        for dc in range(0, 10):
            lab = _cell_str(grid.get((header_row, pc + dc)))
            if lab and lab not in labels:
                labels[lab] = pc + dc
        veh_col = labels.get("차번")
        am_col = labels.get("오전")
        pm_col = labels.get("오후")
        adj_col = labels.get("조율")
        if veh_col is None or am_col is None:
            continue

        # 첫 블록의 출발지 라벨은 헤더 행 안에 있음 (예: 3행 "가좌출발")
        depot = ""
        for hr in (header_row, header_row + 1):
            for dc in range(0, 10):
                t = _cell_str(grid.get((hr, pc + dc)))
                if t.endswith("출발"):
                    depot = t
        r = header_row + 1
        blanks = 0
        while r <= ws.max_row and blanks < 8:
            # 출발지 블록 라벨 갱신 ("가좌출발"/"동춘출발" — 아무 열에나 등장)
            for dc in range(0, 10):
                t = _cell_str(grid.get((r, pc + dc)))
                if t.endswith("출발"):
                    depot = t
            slot_v = grid.get((r, pc))
            veh = _cell_str(grid.get((r, veh_col)))
            if isinstance(slot_v, (int, float)) and VEHICLE_RE.match(veh):
                adj = grid.get((r, adj_col)) if adj_col else None
                out.slots.append(DailySlot(
                    route=routes[pc], depot=depot or "본선",
                    slot=int(slot_v),
                    adjust=int(adj) if isinstance(adj, (int, float)) else None,
                    vehicle=veh,
                    am=_driver_or_none(grid.get((r, am_col))),
                    pm=_driver_or_none(grid.get((r, pm_col))),
                ))
                blanks = 0
            else:
                blanks += 1
            r += 1
    return out
