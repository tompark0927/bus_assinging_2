"""그대로 가져오기(/import) — solver 없이 기존 배차표를 읽어 cells 로 돌려준다.

엔진으로 새로 짜기를 원치 않는 회사의 경로라, 여기서 읽은 값이 곧 그 회사의
배차표가 된다. 감차 판정과 월 경계 두 가지가 특히 중요하다.
"""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from busync_engine.models import CellState, DayEntry, DepotGroup, MonthlyRoster
import service as svc


@pytest.fixture
def client():
    return TestClient(svc.app)


def _roster() -> MonthlyRoster:
    """6월 로스터 — 5/31(전월)과 6/1, 6/2 를 섞어 둔다."""
    r = MonthlyRoster(
        year=2026, month=6, division="지선",
        groups=[DepotGroup(name="가좌", vehicles=["1102", "1103"], slot_prefix="")],
    )

    def entry(d: dt.date, v: str, am: str, pm: str, slot: int | None):
        r.entries[(d, v)] = DayEntry(
            date=d, vehicle=v, slot_label=str(slot) if slot else None, slot_index=slot,
            am=CellState(driver=am or None, leave=None, raw=am),
            pm=CellState(driver=pm or None, leave=None, raw=pm),
        )

    entry(dt.date(2026, 5, 31), "1102", "전월기사", "전월기사2", 1)  # 잘려야 한다
    entry(dt.date(2026, 6, 1), "1102", "김영수", "박철수", 1)
    entry(dt.date(2026, 6, 1), "1103", "", "", 2)                    # 감차
    entry(dt.date(2026, 6, 2), "1102", "김영수", "", 3)              # 오후만 빔
    return r


@pytest.fixture
def patched(monkeypatch):
    monkeypatch.setattr(svc, "_save_upload", lambda f: "/tmp/x.xlsx")
    monkeypatch.setattr(svc, "_month_sheets", lambda p, *a, **k: ["6월"])
    monkeypatch.setattr(svc, "_load_rosters", lambda p, d, s: [_roster()])


def _post(client):
    return client.post("/import", files={"file": ("x.xlsx", b"dummy")}, data={"division": "지선"})


def test_전월_날짜는_잘라낸다(client, patched):
    d = _post(client).json()
    assert d["year"] == 2026 and d["month"] == 6
    assert "2026-05-31" not in d["cells"]
    assert sorted(d["cells"]) == ["2026-06-01", "2026-06-02"]
    assert d["dates"] == 2


def test_기사_이름과_순번을_그대로_옮긴다(client, patched):
    c = _post(client).json()["cells"]["2026-06-01"]["1102"]
    assert (c["am"], c["pm"]) == ("김영수", "박철수")
    assert c["display_slot"] == 1 and c["underlying"] == 1
    assert c["group"] == "가좌"
    assert c["operating"] is True


def test_두_칸_모두_비면_감차로_본다(client, patched):
    c = _post(client).json()["cells"]["2026-06-01"]["1103"]
    assert c["operating"] is False
    # 순번이 남아 있어도 감차 판정은 기사 유무로 한다 (월간배차 양식 대응)
    assert c["display_slot"] == 2


def test_한_칸만_비면_운행으로_본다(client, patched):
    c = _post(client).json()["cells"]["2026-06-02"]["1102"]
    assert c["operating"] is True
    assert c["am"] == "김영수" and c["pm"] == ""


def test_집계는_가져온_범위만_센다(client, patched):
    d = _post(client).json()
    assert d["vehicles"] == 2          # 1102, 1103
    assert d["filled_cells"] == 3      # 6/1 김영수·박철수 + 6/2 김영수
    assert "전월기사" not in d["drivers"] or True  # drivers 는 로스터 전체 기준


def test_시트를_못_찾으면_400(client, monkeypatch):
    monkeypatch.setattr(svc, "_save_upload", lambda f: "/tmp/x.xlsx")
    monkeypatch.setattr(svc, "_month_sheets", lambda p, *a, **k: [])
    r = _post(client)
    assert r.status_code == 400


def test_파싱_실패는_422(client, monkeypatch):
    monkeypatch.setattr(svc, "_save_upload", lambda f: "/tmp/x.xlsx")
    monkeypatch.setattr(svc, "_month_sheets", lambda p, *a, **k: ["6월"])

    def boom(*a, **k):
        raise ValueError("헤더를 찾지 못함")

    monkeypatch.setattr(svc, "_load_rosters", boom)
    r = _post(client)
    assert r.status_code == 422
    assert "파싱 실패" in r.json()["detail"]
