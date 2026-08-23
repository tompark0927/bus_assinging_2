"""휴무신청 워크플로 · 대타 카운터 · 연차 자동계산 (스펙 2.7, 2.8).

현행 엑셀은 "휴무신청" 시트에 신청만 기록하고 **승낙/거절 결과는 남기지 않는다**.
BuSync가 채울 공백이 정확히 여기다.

승낙 정책 (실무 인터뷰 기반)
  - 기본은 자동 승낙. "웬만하면 승낙"이 실무 기조다.
  - 정원(하루 최대 N명)을 초과할 때만 스코어로 정렬해 담당자 최종 확인.
  - 스코어 요소: 호혜성(남의 대타를 받아준 이력) / 선착순 / 그날 여유인력 /
    최근 휴무 승낙률(낮을수록 우선).

연차 (근로기준법)
  - 1년 미만: 매월 개근 시 1일 (최대 11일)
  - 1년 이상: 15일, 3년차부터 2년마다 +1, 상한 25일
"""
from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from enum import Enum

from .models import LeaveType


class RequestStatus(str, Enum):
    PENDING = "대기"
    APPROVED = "승낙"
    REJECTED = "거절"
    CANCELED = "취소"


@dataclass
class LeaveRequest:
    driver: str
    date: dt.date
    leave_type: LeaveType = LeaveType.REGULAR
    requested_at: dt.datetime | None = None
    reason: str = ""
    status: RequestStatus = RequestStatus.PENDING
    decided_by: str = ""
    decision_note: str = ""


@dataclass
class SubstituteCounter:
    """기사별 대타 집계 — 영구 누적. 호혜성 점수의 원천 (스펙 2.7)."""

    requested: int = 0   # 내가 대타를 부탁한 횟수
    accepted: int = 0    # 남의 대타를 받아준 횟수
    rejected: int = 0    # 거절한 횟수

    @property
    def reciprocity(self) -> float:
        """받아준 만큼 돌려받는다: +면 베푼 쪽, -면 신세진 쪽."""
        return self.accepted - self.requested

    @property
    def acceptance_rate(self) -> float:
        total = self.accepted + self.rejected
        return self.accepted / total if total else 0.0


@dataclass
class ApprovalWeights:
    reciprocity: float = 3.0     # w1 — 대타 받아준 이력
    fifo: float = 1.0            # w2 — 선착순
    slack: float = 2.0           # w3 — 해당일 여유인력
    past_approval: float = 2.5   # w4 — 최근 승낙률 낮은 사람 우선


@dataclass
class ScoredRequest:
    request: LeaveRequest
    score: float
    breakdown: dict[str, float] = field(default_factory=dict)
    evidence: str = ""


@dataclass
class DayDecision:
    date: dt.date
    capacity: int
    auto_approved: list[LeaveRequest] = field(default_factory=list)
    needs_review: list[ScoredRequest] = field(default_factory=list)

    @property
    def over_capacity(self) -> bool:
        return bool(self.needs_review)


def annual_leave_days(
    hire_date: dt.date, as_of: dt.date, monthly_perfect_attendance: int | None = None
) -> int:
    """근로기준법 연차 자동계산 (스펙 2.8).

    hire_date 기준 as_of 시점의 연차 일수.
    - 1년 미만: 개근한 달 수만큼 1일씩 (최대 11일)
    - 1년 이상: 15일 + (근속연수-1)//2, 상한 25일
    """
    if as_of < hire_date:
        return 0
    years = as_of.year - hire_date.year
    if (as_of.month, as_of.day) < (hire_date.month, hire_date.day):
        years -= 1
    if years < 1:
        months = (as_of.year - hire_date.year) * 12 + (as_of.month - hire_date.month)
        if as_of.day < hire_date.day:
            months -= 1
        earned = monthly_perfect_attendance if monthly_perfect_attendance is not None \
            else max(0, months)
        return min(11, max(0, earned))
    return min(25, 15 + (years - 1) // 2)


def prorated_work_days(
    band_days: int,
    month_start: dt.date,
    month_end: dt.date,
    hire_date: dt.date | None = None,
    resign_date: dt.date | None = None,
) -> int:
    """월중 입·퇴사자 만근 일할 계산 (스펙 2.8: "6/14입사 11일 근무").

    재직일 비율만큼 만근 기준을 줄인다.
    """
    total = (month_end - month_start).days + 1
    start = max(month_start, hire_date) if hire_date else month_start
    end = min(month_end, resign_date) if resign_date else month_end
    if end < start:
        return 0
    served = (end - start).days + 1
    if served >= total:
        return band_days
    return max(0, round(band_days * served / total))


def score_requests(
    requests: list[LeaveRequest],
    counters: dict[str, SubstituteCounter],
    slack: int,
    recent_approval_rate: dict[str, float] | None = None,
    weights: ApprovalWeights | None = None,
) -> list[ScoredRequest]:
    """정원 초과일의 신청들을 우선순위 정렬 (높은 점수 = 먼저 승낙).

    스펙 2.7 공식:
        score = w1×대타승낙이력 + w2×신청선착순 + w3×해당일 여유인력
              + w4×최근 휴무요청 승낙률(낮을수록 우선)
    """
    w = weights or ApprovalWeights()
    rates = recent_approval_rate or {}
    ordered = sorted(
        requests,
        key=lambda r: r.requested_at or dt.datetime.max,
    )
    fifo_rank = {id(r): i for i, r in enumerate(ordered)}
    n = max(len(requests) - 1, 1)

    out: list[ScoredRequest] = []
    for r in requests:
        c = counters.get(r.driver, SubstituteCounter())
        # 호혜성: 남의 대타를 많이 받아준 사람일수록 우선
        recip = w.reciprocity * c.reciprocity
        # 선착순: 먼저 낸 사람이 높은 점수 (0..1 정규화)
        fifo = w.fifo * (1 - fifo_rank[id(r)] / n)
        # 여유인력: 그날 인력이 넉넉할수록 전체적으로 관대해짐 (공통 가산)
        slack_term = w.slack * min(slack, 5) / 5
        # 최근 승낙률이 낮은 사람 우선 (0.0이면 만점)
        rate = rates.get(r.driver, 0.5)
        fairness = w.past_approval * (1 - rate)
        # 연차·병가는 권리이므로 우선순위 상단 고정
        priority = 100 if r.leave_type in (LeaveType.ANNUAL, LeaveType.SICK) else 0

        score = recip + fifo + slack_term + fairness + priority
        bits = []
        if c.accepted or c.requested:
            bits.append(f"대타 받아줌 {c.accepted}회/부탁 {c.requested}회")
        bits.append(f"신청 순번 {fifo_rank[id(r)] + 1}번째")
        if r.driver in rates:
            bits.append(f"최근 승낙률 {rate * 100:.0f}%")
        if priority:
            bits.append(f"{r.leave_type.value}는 법정 권리로 우선")
        out.append(ScoredRequest(
            request=r, score=score,
            breakdown={
                "호혜성": round(recip, 2), "선착순": round(fifo, 2),
                "여유인력": round(slack_term, 2), "형평": round(fairness, 2),
                "우선권": priority,
            },
            evidence=" · ".join(bits),
        ))
    out.sort(key=lambda s: -s.score)
    return out


def triage(
    requests: list[LeaveRequest],
    counters: dict[str, SubstituteCounter],
    daily_cap: int,
    available_by_date: dict[dt.date, int] | None = None,
    auto_approve: bool = True,
    recent_approval_rate: dict[str, float] | None = None,
    weights: ApprovalWeights | None = None,
) -> list[DayDecision]:
    """날짜별 분류: 정원 내는 자동 승낙, 초과분만 담당자 확인 대기.

    available_by_date: 그날 가용 예비 인원 (없으면 여유 0으로 보수 평가)
    """
    by_date: dict[dt.date, list[LeaveRequest]] = defaultdict(list)
    for r in requests:
        if r.status in (RequestStatus.CANCELED, RequestStatus.REJECTED):
            continue
        by_date[r.date].append(r)

    decisions: list[DayDecision] = []
    for d in sorted(by_date):
        day_reqs = by_date[d]
        slack = (available_by_date or {}).get(d, 0)
        dec = DayDecision(date=d, capacity=daily_cap)
        if auto_approve and len(day_reqs) <= daily_cap:
            for r in day_reqs:
                r.status = RequestStatus.APPROVED
                r.decision_note = (
                    f"정원({daily_cap}명) 이내 — 자동 승낙"
                )
            dec.auto_approved = day_reqs
        else:
            scored = score_requests(
                day_reqs, counters, slack, recent_approval_rate, weights
            )
            # 정원까지는 자동 승낙, 나머지는 검토 대기
            for i, s in enumerate(scored):
                if auto_approve and i < daily_cap:
                    s.request.status = RequestStatus.APPROVED
                    s.request.decision_note = (
                        f"정원 초과일 — 우선순위 {i + 1}위로 승낙 ({s.evidence})"
                    )
                    dec.auto_approved.append(s.request)
                else:
                    s.request.status = RequestStatus.PENDING
                    s.request.decision_note = (
                        f"정원({daily_cap}명) 초과 — 담당자 확인 필요 "
                        f"(우선순위 {i + 1}위: {s.evidence})"
                    )
                    dec.needs_review.append(s)
        decisions.append(dec)
    return decisions


def approved_leaves(requests: list[LeaveRequest]) -> dict[str, set[dt.date]]:
    """승낙된 신청 → 솔버 H4 입력 형식."""
    out: dict[str, set[dt.date]] = defaultdict(set)
    for r in requests:
        if r.status == RequestStatus.APPROVED:
            out[r.driver].add(r.date)
    return dict(out)


def counters_from_history(
    repair_records, requests: list[LeaveRequest] | None = None
) -> dict[str, SubstituteCounter]:
    """국소 수리 이력 + 휴무신청에서 대타 카운터 재구성.

    - repair에서 빠진 사람 = 대타를 부탁한 쪽(requested)
    - 들어온 사람 = 받아준 쪽(accepted)
    """
    counters: dict[str, SubstituteCounter] = defaultdict(SubstituteCounter)
    for rec in repair_records:
        if rec.removed:
            counters[rec.removed].requested += 1
        counters[rec.added].accepted += 1
    return dict(counters)


def approval_rates(requests: list[LeaveRequest]) -> dict[str, float]:
    """기사별 최근 휴무신청 승낙률 (형평 요소 w4의 입력)."""
    tally: dict[str, Counter] = defaultdict(Counter)
    for r in requests:
        if r.status == RequestStatus.APPROVED:
            tally[r.driver]["y"] += 1
        elif r.status == RequestStatus.REJECTED:
            tally[r.driver]["n"] += 1
    return {
        k: c["y"] / (c["y"] + c["n"])
        for k, c in tally.items() if (c["y"] + c["n"])
    }
