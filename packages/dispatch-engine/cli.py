"""BuSync 배차 엔진 CLI — 백테스트 실행기.

사용:
    python cli.py backtest --workbook <xlsx> --division 지선 \
        --prev "지선배차표(2026년 4월)" --target "지선배차표(2026년 5월)" \
        --history "지선배차표(2026년 3월)" \
        --holidays 2026-05-01,2026-05-05,2026-05-25
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from collections import Counter

from busync_engine.audit import audit
from busync_engine.backtest import backtest_stage1, backtest_stage2
from busync_engine.fairness import build_report
from busync_engine.importer.weekly import parse_workbook_month


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    bp = sub.add_parser("backtest")
    bp.add_argument("--workbook", required=True)
    bp.add_argument("--division", default="")
    bp.add_argument("--prev", required=True, help="전월 시트명 (규칙 추론용)")
    bp.add_argument("--target", required=True, help="대상 월 시트명")
    bp.add_argument("--history", default="", help="추가 과거 시트명들 (쉼표 구분)")
    bp.add_argument("--holidays", default="", help="공휴일 YYYY-MM-DD 쉼표 구분")
    bp.add_argument("--time-limit", type=float, default=120.0)
    bp.add_argument("--skip-stage2", action="store_true")
    args = ap.parse_args()

    holidays = {
        dt.date.fromisoformat(x) for x in args.holidays.split(",") if x.strip()
    }
    prev = parse_workbook_month(args.workbook, args.prev, args.division)
    target = parse_workbook_month(args.workbook, args.target, args.division)
    history = [
        parse_workbook_month(args.workbook, name.strip(), args.division)
        for name in args.history.split(",") if name.strip()
    ] + [prev]

    res, _patterns = backtest_stage1(prev, target, holidays)
    print(f"[1단계] 순번 패턴 일치율: {res.slot_match}/{res.slot_total} "
          f"= {res.slot_rate*100:.2f}% (목표 95%+)")
    if res.slot_mismatches:
        print(f"  불일치 {len(res.slot_mismatches)}건 (앞 10건):")
        for row in res.slot_mismatches[:10]:
            print("   ", row)

    if args.skip_stage2:
        return 0

    res2, asg = backtest_stage2(
        history, target, time_limit_s=args.time_limit
    )
    print(f"[2단계] 기사 배정 일치율: {res2.cell_match}/{res2.cell_total} "
          f"= {res2.cell_rate*100:.2f}% (목표 80%+, status={asg.status})")

    # 불일치 분해: A/P 반전 vs 오배정 (반전은 짝 순서 재량 영역)
    actual_cells = {}
    for (d, v), e in target.entries.items():
        if d.month != target.month:
            continue
        if e.am.driver:
            actual_cells[(d, v, "A")] = e.am.driver
        if e.pm.driver:
            actual_cells[(d, v, "P")] = e.pm.driver
    flip = wrong = 0
    for (d, v, s, got, want) in res2.cell_mismatches:
        other = "P" if s == "A" else "A"
        if actual_cells.get((d, v, other)) == got:
            flip += 1
        else:
            wrong += 1
    veh = res2.cell_match + flip
    print(f"  차량 단위 일치(A/P 무시): {veh}/{res2.cell_total} "
          f"= {veh/res2.cell_total*100:.2f}%")
    print(f"  불일치 분해: 시프트 반전 {flip}, 오배정 {wrong}")
    by_driver = Counter(want for *_ignore, want in res2.cell_mismatches)
    print("  예외 케이스 상위(실제 기사 기준):", by_driver.most_common(8))

    # 제약 감사
    rep = audit(res2.problem, res2.assignment)
    print(f"[감사] H1~H6 위반: {len(rep.violations)}건"
          + ("" if rep.ok else " — 배포 차단 대상"))
    for viol in rep.violations[:10]:
        print("   ", viol.rule, viol.message)

    # 공정성 리포트 (실제 로스터 기준 요약)
    fr = build_report(target)
    print(f"[공정성] 슬롯균형 σ={fr.slot_balance_stdev:.2f}, "
          f"주말휴무 σ={fr.weekend_off_stdev:.2f}, "
          f"대타 σ={fr.substitute_stdev:.2f}")
    worst = sorted(
        (f for f in fr.drivers.values() if f.work_days >= 10),
        key=lambda f: f.slot_balance,
    )
    print("  늦은 슬롯 최다:", [(f.name, f.slot_balance) for f in worst[:5]])
    print("  이른 슬롯 최다:", [(f.name, f.slot_balance) for f in worst[-5:]])
    return 0


if __name__ == "__main__":
    sys.exit(main())
