/**
 * 배차 슬롯 색상·범례 통일 표준 (배차표 그리드 + 기사 상세 모달 공용).
 *
 * 규칙:
 *  - 채움색 4개: 근무(파랑) · 대타 충원(초록) · 공석/드랍(빨강) · 휴무(회색)
 *  - 교대(오전/오후/전일)는 색으로 구분하지 않고 조/석/종 텍스트로만 표시
 *  - 휴가(승인)  = 휴무 회색 셀 + 초록 점
 *  - 휴가 요청(대기중) = 빨강 점 (셀 상태색 위 오버레이)
 */

/** 교대 축약 표기 (오전=조 · 오후=석 · 전일=종) */
export const SHIFT_LABEL: Record<string, string> = {
  MORNING: '조',
  AFTERNOON: '석',
  FULL_DAY: '종',
};

export type SlotFillKey = 'WORK' | 'FILLED' | 'DROPPED' | 'REST';

/** 통일 채움색 — 라이트/다크. bg/border 는 박스형 셀(모달), bg/text 는 칩형 셀(그리드)에서 사용. */
export const SLOT_FILL: Record<SlotFillKey, { bg: string; border: string; text: string }> = {
  WORK: {
    bg: 'bg-blue-100 dark:bg-blue-500/15',
    border: 'border-blue-200 dark:border-blue-500/30',
    text: 'text-blue-800 dark:text-blue-300',
  },
  FILLED: {
    bg: 'bg-emerald-100 dark:bg-emerald-500/15',
    border: 'border-emerald-200 dark:border-emerald-500/30',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  DROPPED: {
    bg: 'bg-red-100 dark:bg-red-500/15',
    border: 'border-red-200 dark:border-red-500/30',
    text: 'text-red-700 dark:text-red-300',
  },
  REST: {
    bg: 'bg-gray-100 dark:bg-white/5',
    border: 'border-gray-200 dark:border-white/10',
    text: 'text-gray-400 dark:text-gray-500',
  },
};

/** 범례 스와치 색(테두리 포함, 라이트 기준) */
const SWATCH: Record<SlotFillKey, string> = {
  WORK: 'bg-blue-100 border-blue-300',
  FILLED: 'bg-emerald-100 border-emerald-300',
  DROPPED: 'bg-red-100 border-red-300',
  REST: 'bg-gray-100 border-gray-300',
};

export type SlotLike = {
  isRestDay?: boolean;
  status?: string;
  shift?: string;
  route?: { routeNumber?: string | null } | null;
  bus?: { busNumber?: string | null } | null;
};

export interface SlotView {
  isEmpty: boolean;
  fillKey: SlotFillKey | null;
  /** 셀 라벨: 노선번호 / '드랍' / '결근' / '휴' */
  label: string;
  /** 보조 라벨: 교대(조/석/종) (+옵션 차량번호) */
  sub: string;
  /** 우상단 점: 승인 휴가(초록) / 대기중 휴가 요청(빨강) */
  dot: 'approved' | 'pending' | null;
}

/**
 * 슬롯 1칸의 표시 정보 계산 — 그리드/모달 공용.
 * 승인/대기 휴가 요청은 opts 로 주입(둘 다 아니면 점 없음).
 */
export function getSlotView(
  slot: SlotLike | undefined,
  opts?: { approved?: boolean; pending?: boolean; withBus?: boolean },
): SlotView {
  const dot: SlotView['dot'] = opts?.approved ? 'approved' : opts?.pending ? 'pending' : null;
  if (!slot) return { isEmpty: true, fillKey: null, label: '', sub: '', dot };

  // 휴무(정기 휴무 또는 승인 휴가 반영) — 회색. 승인 휴가면 초록 점이 위에 붙는다.
  if (slot.isRestDay) return { isEmpty: false, fillKey: 'REST', label: '휴', sub: '', dot };

  const shift = SHIFT_LABEL[slot.shift ?? ''] ?? '';
  const routeNum = slot.route?.routeNumber || '';
  const busNum = slot.bus?.busNumber || '';

  // 공석(드랍·결근) — 빨강
  if (slot.status === 'DROPPED') return { isEmpty: false, fillKey: 'DROPPED', label: '드랍', sub: '', dot };
  if (slot.status === 'ABSENT') return { isEmpty: false, fillKey: 'DROPPED', label: '결근', sub: '', dot };

  // 근무(파랑) / 대타 충원(초록)
  const fillKey: SlotFillKey = slot.status === 'FILLED' ? 'FILLED' : 'WORK';
  let sub = routeNum && shift ? shift : routeNum ? '' : shift;
  if (opts?.withBus && busNum) sub = sub ? `${sub}/${busNum}` : busNum;
  return { isEmpty: false, fillKey, label: routeNum || shift, sub, dot };
}

/** 라벨이 순수 노선번호일 때만 "번" 접미사를 붙일지 판단 */
export function isRouteLabel(view: SlotView): boolean {
  return (view.fillKey === 'WORK' || view.fillKey === 'FILLED') && /^\d+$/.test(view.label);
}

/** 우상단 상태 점 (position 은 className 으로 조정) */
export function SlotDot({ kind, className }: { kind: 'approved' | 'pending'; className?: string }) {
  const cls = kind === 'approved' ? 'bg-emerald-500' : 'bg-rose-500';
  const title = kind === 'approved' ? '휴가 (승인)' : '휴가 요청 (대기중)';
  return (
    <span
      className={`absolute w-1.5 h-1.5 rounded-full ${cls} ${className ?? 'top-1 right-1'}`}
      title={title}
    />
  );
}

function LegendSwatch({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-4 h-4 rounded border ${swatch}`} />
      {label}
    </span>
  );
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${cls}`} />
      {label}
    </span>
  );
}

/**
 * 통일 범례 (내부 항목 행만 렌더 — 카드/헤더 래핑은 호출부가 담당).
 *  - variant="full": 배차표 하단 범례(큰 글씨)
 *  - variant="compact": 기사 상세 모달(작은 글씨)
 */
export function SlotLegend({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  const wrap =
    variant === 'compact'
      ? 'flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-[11px] text-gray-500 dark:text-gray-400'
      : 'flex flex-wrap items-center gap-x-5 gap-y-2 text-base text-gray-600 dark:text-gray-400';
  return (
    <div className={wrap}>
      <LegendSwatch swatch={SWATCH.WORK} label="근무" />
      <LegendSwatch swatch={SWATCH.FILLED} label="대타 충원" />
      <LegendSwatch swatch={SWATCH.DROPPED} label="공석 (드랍·결근)" />
      <LegendDot cls="bg-emerald-500" label="휴가 (승인)" />
      <LegendDot cls="bg-rose-500" label="휴가 요청 (대기)" />
      <span className="border-l border-gray-200 dark:border-gray-600 pl-3 flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <b className="text-gray-700 dark:text-gray-300">조</b>오전
        <b className="text-gray-700 dark:text-gray-300">석</b>오후
        <b className="text-gray-700 dark:text-gray-300">종</b>전일
      </span>
    </div>
  );
}
