import { Fragment, useMemo } from 'react';

/**
 * 차량 기준 배차표 — 엑셀 원본 양식(행=차번, 날짜당 오전/오후 두 칸)을 재현.
 *
 * 기사별 뷰가 "이 기사가 무슨 차를 타나"라면, 이 뷰는 "이 차에 누가 타나"다.
 * 게시 양식(PostingScheduleGrid)과 달리 순번(SchedulePattern)이 필요 없다 —
 * 배차표 slots만으로 만들어지므로 수동/업로드 배차표에서도 항상 동작한다.
 *
 * 노선별로 행 블록을 나누고, 기초 데이터에서 차량에 출발 그룹(가좌출발/동춘출발
 * 같은)을 지정하면 노선 안에서 그룹별로 다시 블록이 나뉜다 — 엑셀 원본의
 * 상/하단 블록 구분과 같은 구조. 차량이 없는 근무(차량미배정)는 노선 맨 아래
 * "미배정" 행으로 모은다. 조/석 파트너는 같은 행의 오전/오후 칸에 나란히 보인다.
 */

export interface VehicleSlot {
  id: number;
  date: string;
  isRestDay: boolean;
  shift: string;
  status: string;
  notes?: string;
  isManualOverride?: boolean;
  driver: { id: number; name: string; driverType: string; employeeId: string };
  route: { id: number; routeNumber: string; name: string };
  bus?: { id: number; busNumber: string };
}

/** 기초 데이터의 차량 구분 — busNumber → 출발 그룹 라벨/그룹 내 순번 */
export type BusGroupMap = Record<string, { group: string | null; order: number | null }>;

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

const SHIFT_LABELS: Record<string, string> = {
  MORNING: '조',
  AFTERNOON: '석',
  FULL_DAY: '종',
};

// 기사별 뷰와 같은 4색 체계: 근무(파랑) · 대타 충원(초록) · 공석(빨강)
const STATUS_TINT: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
  FILLED: 'bg-emerald-100 text-emerald-700',
  DROPPED: 'bg-red-100 text-red-700',
  ABSENT: 'bg-red-100 text-red-700',
};

const UNASSIGNED = '미배정';

/** "3-2" 같은 노선번호를 자연 정렬 (문자열 비교면 3-2가 16보다 앞에 온다) */
function routeKey(r: string) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(r ?? '');
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
}

interface DayPair {
  am?: VehicleSlot;
  pm?: VehicleSlot;
}

interface BusRow {
  bus: string;
  days: Map<string, DayPair>;
}

/** 노선 안의 출발 그룹 블록 — 라벨이 없으면(그룹 미지정) 헤더 없이 나온다 */
interface SubBlock {
  label: string | null;
  buses: BusRow[];
}

interface RouteGroup {
  route: string;
  blocks: SubBlock[];
  /** 미배정 제외 실차량 수 */
  vehicleCount: number;
}

export default function VehicleScheduleGrid({
  slots,
  busGroups,
  year,
  month,
  daysInMonth,
  editable,
  onSlotClick,
  vehicleOff,
  onToggleVehicleOff,
  duplicateSlotIds,
  unregisteredAt,
}: {
  slots: VehicleSlot[];
  /** 기초 데이터의 출발 그룹 지정 — 없으면 노선당 한 블록 */
  busGroups?: BusGroupMap;
  year: number;
  month: number;
  daysInMonth: number;
  /** 초안 상태 — 이름을 눌러 배정을 바꿀 수 있는지 */
  editable: boolean;
  onSlotClick?: (slot: VehicleSlot) => void;
  /** 감차(휴차) 표기 — "YYYY-MM-DD|차번" 집합. 엑셀의 0=초록 감차에 대응 */
  vehicleOff?: Set<string>;
  /** 빈 칸 클릭으로 감차 토글 (초안에서만) */
  onToggleVehicleOff?: (busNumber: string, date: string, off: boolean) => void;
  /** 같은 날 같은 기사 중복 배정 slot id — 빨간 링 경고 */
  duplicateSlotIds?: Set<number>;
  /**
   * 기초 데이터에 계정이 없어 슬롯으로 저장되지 못한 기사 이름.
   * 키 `YYYY-MM-DD|차번|MORNING`. 인쇄물은 이 이름을 찍으므로 화면에서
   * 빈칸으로 두면 종이와 어긋난다 — 주황 점선으로 표시한다.
   */
  unregisteredAt?: Record<string, string>;
}) {
  const groups = useMemo<RouteGroup[]>(() => {
    const byRoute = new Map<string, Map<string, Map<string, DayPair>>>();
    for (const slot of slots) {
      if (slot.isRestDay) continue;
      const route = slot.route?.routeNumber ?? '기타';
      const bus = slot.bus?.busNumber ?? UNASSIGNED;
      const dateKey = slot.date.split('T')[0];

      let byBus = byRoute.get(route);
      if (!byBus) byRoute.set(route, (byBus = new Map()));
      let days = byBus.get(bus);
      if (!days) byBus.set(bus, (days = new Map()));
      let pair = days.get(dateKey);
      if (!pair) days.set(dateKey, (pair = {}));

      // 같은 차·같은 날에 중복 배정이 있으면 먼저 온 것을 유지한다
      if (slot.shift === 'MORNING') pair.am ??= slot;
      else if (slot.shift === 'AFTERNOON') pair.pm ??= slot;
      else {
        // 종일 근무 — 오전/오후 두 칸에 같은 이름이 보인다
        pair.am ??= slot;
        pair.pm ??= slot;
      }
    }

    const infoOf = (bus: string) => busGroups?.[bus] ?? { group: null, order: null };
    const byOrderThenNumber = (a: BusRow, b: BusRow) => {
      const oa = infoOf(a.bus).order ?? Number.MAX_SAFE_INTEGER;
      const ob = infoOf(b.bus).order ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.bus.localeCompare(b.bus, undefined, { numeric: true });
    };

    return Array.from(byRoute.entries())
      .sort((a, b) => routeKey(a[0]) - routeKey(b[0]))
      .map(([route, byBus]) => {
        const rows: BusRow[] = Array.from(byBus.entries()).map(([bus, days]) => ({ bus, days }));
        const unassigned = rows.filter((r) => r.bus === UNASSIGNED);
        const real = rows.filter((r) => r.bus !== UNASSIGNED);

        // 출발 그룹별 블록 분할 — 그룹 없는 차량은 맨 앞 무제 블록
        const byLabel = new Map<string, BusRow[]>();
        const ungrouped: BusRow[] = [];
        for (const row of real) {
          const g = infoOf(row.bus).group;
          if (!g) ungrouped.push(row);
          else {
            if (!byLabel.has(g)) byLabel.set(g, []);
            byLabel.get(g)!.push(row);
          }
        }
        const blocks: SubBlock[] = [];
        if (ungrouped.length) blocks.push({ label: null, buses: ungrouped.sort(byOrderThenNumber) });
        for (const [label, buses] of [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
          blocks.push({ label, buses: buses.sort(byOrderThenNumber) });
        }
        // 미배정 행은 노선 맨 아래 자체 블록
        if (unassigned.length) blocks.push({ label: null, buses: unassigned });

        return { route, blocks, vehicleCount: real.length };
      });
  }, [slots, busGroups]);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        차량별로 볼 수 있는 배차 데이터가 없습니다.
      </div>
    );
  }

  const dates = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(year, month - 1, i + 1);
    return {
      key: `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
      day: i + 1,
      dow: d.getDay(),
    };
  });

  const countCls =
    'border-b border-r border-gray-100 px-0.5 py-0.5 text-center text-[10px] font-semibold text-gray-500 dark:border-gray-700 dark:text-gray-400';

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800">
        <table
          className="border-collapse text-[11px] leading-tight tabular-nums"
          style={{ minWidth: `${daysInMonth * 104 + 92}px` }}
        >
          <colgroup>
            <col style={{ width: 28 }} />
            <col style={{ width: 64 }} />
            {dates.map((d) => (
              <Fragment key={d.key}>
                <col style={{ width: 52 }} />
                <col style={{ width: 52 }} />
              </Fragment>
            ))}
          </colgroup>
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-900/50">
              <th className="sticky left-0 z-10 border-b border-gray-300 bg-gray-100 px-1 py-1.5 text-center font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-200">
                순번
              </th>
              <th className="sticky left-[28px] z-10 border-b border-r-2 border-gray-300 bg-gray-100 px-1 py-1.5 text-center font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-200">
                차번
              </th>
              {dates.map((d) => (
                <th
                  key={d.key}
                  colSpan={2}
                  className={`border-b border-r-2 border-gray-300 px-0.5 py-1 text-center font-semibold dark:border-gray-600 ${
                    d.dow === 0
                      ? 'text-red-600 dark:text-red-400'
                      : d.dow === 6
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {d.day}({WEEKDAY_KO[d.dow]})
                </th>
              ))}
            </tr>
            <tr className="bg-gray-50 dark:bg-gray-900/20">
              <th className="sticky left-0 z-10 border-b border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/50" />
              <th className="sticky left-[28px] z-10 border-b border-r-2 border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/50" />
              {dates.map((d) =>
                (['오전', '오후'] as const).map((h, hi) => (
                  <th
                    key={`${d.key}-${h}`}
                    className={`border-b border-gray-200 px-0.5 py-0.5 text-center text-[10px] font-medium text-gray-400 dark:border-gray-700 dark:text-gray-500 ${
                      hi === 1 ? 'border-r-2 border-r-gray-300 dark:border-r-gray-600' : 'border-r border-r-gray-100'
                    }`}
                  >
                    {h}
                  </th>
                )),
              )}
            </tr>
          </thead>
          {/* 노선마다 <tbody> — 인쇄에서 노선 블록이 페이지 중간에 잘리지 않게 */}
          {groups.map((group) => (
            <tbody key={group.route} className="posting-group">
              <tr>
                <td
                  colSpan={2 + daysInMonth * 2}
                  className="border-y border-gray-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-800 dark:border-gray-700 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  {/* 표가 화면보다 넓어 셀 자체는 고정할 수 없다 — 라벨만 sticky로 붙인다 */}
                  <span className="sticky left-2 inline-block">
                    {group.route === '기타' ? '기타' : `${group.route}번 노선`} · {group.vehicleCount}대
                  </span>
                </td>
              </tr>
              {group.blocks.map((block, blockIdx) => {
                const isUnassignedBlock = block.buses.every((b) => b.bus === UNASSIGNED);
                return (
                  <Fragment key={`${group.route}-b${blockIdx}`}>
                    {block.label && (
                      <tr>
                        <td
                          colSpan={2 + daysInMonth * 2}
                          className="border-b border-gray-200 bg-gray-100/80 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300"
                        >
                          <span className="sticky left-2 inline-block">
                            {block.label} · {block.buses.length}대
                          </span>
                        </td>
                      </tr>
                    )}
                    {block.buses.map(({ bus, days }, bi) => (
                      <tr key={bus} className="hover:bg-gray-50/60 dark:hover:bg-gray-700/30">
                        <td className="sticky left-0 z-10 border-b border-gray-300 bg-white px-1 py-0.5 text-center text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500">
                          {bus === UNASSIGNED ? '-' : bi + 1}
                        </td>
                        <td
                          className={`sticky left-[28px] z-10 border-b border-r-2 border-gray-300 bg-white px-1 py-0.5 text-center font-semibold dark:border-gray-600 dark:bg-gray-800 ${
                            bus === UNASSIGNED
                              ? 'text-amber-600 dark:text-amber-500'
                              : 'text-gray-800 dark:text-gray-100'
                          }`}
                        >
                          {bus}
                        </td>
                        {dates.map((d) => (
                          <DayCells
                            key={`${bus}-${d.key}`}
                            pair={days.get(d.key)}
                            editable={editable}
                            onSlotClick={onSlotClick}
                            off={vehicleOff?.has(`${d.key}|${bus}`) ?? false}
                            onToggleOff={
                              bus !== UNASSIGNED && onToggleVehicleOff
                                ? (next: boolean) => onToggleVehicleOff(bus, d.key, next)
                                : undefined
                            }
                            duplicateSlotIds={duplicateSlotIds}
                            unregisteredAm={unregisteredAt?.[`${d.key}|${bus}|MORNING`]}
                            unregisteredPm={unregisteredAt?.[`${d.key}|${bus}|AFTERNOON`]}
                          />
                        ))}
                      </tr>
                    ))}
                    {/* 엑셀 원본의 "가좌출발차량 10 10 12…" 줄 — 그날 실제로 나가는 대수 */}
                    {!isUnassignedBlock && (
                      <tr className="bg-gray-50/80 dark:bg-gray-900/30">
                        <td
                          colSpan={2}
                          className="sticky left-0 z-10 border-b border-r-2 border-gray-300 bg-gray-50 px-1 py-0.5 text-center text-[10px] font-semibold text-gray-500 dark:border-gray-600 dark:bg-gray-900/60 dark:text-gray-400"
                        >
                          {block.label ? `${block.label} 대수` : '운행 대수'}
                        </td>
                        {dates.map((d) => {
                          const count = (k: 'am' | 'pm') =>
                            block.buses.filter(
                              ({ bus, days }) => bus !== UNASSIGNED && days.get(d.key)?.[k],
                            ).length;
                          return (
                            <Fragment key={`cnt-${d.key}`}>
                              <td className={countCls}>{count('am') || ''}</td>
                              <td className={`${countCls} border-r-2 border-r-gray-300 dark:border-r-gray-600`}>
                                {count('pm') || ''}
                              </td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      <p className="text-xs text-gray-400 print:hidden dark:text-gray-500">
        오전/오후 두 칸에 같은 이름 = 종일 근무 ·{' '}
        <span className="font-bold text-red-600 dark:text-red-400">빨간 이름</span> = 수동 변경 ·{' '}
        <span className="rounded bg-gray-100 px-1 text-gray-500 dark:bg-gray-900/40">휴</span> = 감차(휴차)
        {editable ? ' — 빈 칸을 누르면 감차로 표기' : ''} ·{' '}
        <span className="font-semibold text-red-500">빨간 테두리</span> = 같은 날 중복 배정 · 차량 없는
        근무는 노선 아래 <span className="font-semibold text-amber-600 dark:text-amber-500">미배정</span>{' '}
        행에 모입니다 · 출발 그룹 구분은 기초 데이터 → 버스에서 지정합니다
        {editable ? ' · 이름을 누르면 배정을 바꿀 수 있습니다.' : '.'}
      </p>
    </div>
  );
}

/** 하루치 2칸 (오전 | 오후) */
function DayCells({
  pair,
  editable,
  onSlotClick,
  off,
  onToggleOff,
  duplicateSlotIds,
  unregisteredAm,
  unregisteredPm,
}: {
  pair?: DayPair;
  editable: boolean;
  onSlotClick?: (slot: VehicleSlot) => void;
  /** 감차(휴차) — 그 차가 그날 안 나감 */
  off?: boolean;
  onToggleOff?: (next: boolean) => void;
  duplicateSlotIds?: Set<number>;
  unregisteredAm?: string;
  unregisteredPm?: string;
}) {
  const td = 'border-b border-r border-gray-100 px-0.5 py-0.5 text-center whitespace-nowrap dark:border-gray-700';
  const tdLast = `${td} border-r-2 border-r-gray-300 dark:border-r-gray-600`; // 날짜 경계
  const hasSlots = !!(pair?.am || pair?.pm);
  const canToggleOff = editable && !!onToggleOff;

  // 감차 + 배정 없음: 엑셀의 초록 0칸 — 회색 '휴' 두 칸 (클릭 시 해제)
  if (off && !hasSlots) {
    const cls = 'bg-gray-100 text-gray-400 dark:bg-gray-900/40 dark:text-gray-500';
    const inner = canToggleOff ? (
      <button
        onClick={() => onToggleOff!(false)}
        title="감차 — 클릭하여 해제"
        className="w-full rounded hover:ring-2 hover:ring-inset hover:ring-blue-400"
      >
        휴
      </button>
    ) : (
      '휴'
    );
    return (
      <>
        <td className={`${td} ${cls}`}>{inner}</td>
        <td className={`${tdLast} ${cls}`}>{inner}</td>
      </>
    );
  }

  const renderSlot = (slot: VehicleSlot | undefined, pendingName?: string) => {
    if (!slot) {
      // 엑셀엔 이름이 있는데 계정이 없어 저장 못 한 칸 — 인쇄물은 이 이름을
      // 찍으므로 화면도 같은 이름을 보여준다 (등록 필요는 점선으로 구분)
      if (pendingName) {
        return (
          <span
            title={`${pendingName} — 기초 데이터에 없는 기사입니다. 등록하면 정상 배정됩니다.`}
            className="block truncate rounded px-0.5 text-amber-600/90 underline decoration-dotted underline-offset-2 dark:text-amber-500/90"
          >
            {pendingName}
          </span>
        );
      }
      // 빈 칸 — 초안에서는 클릭해 감차로 표기할 수 있다
      if (canToggleOff && !hasSlots) {
        return (
          <button
            onClick={() => onToggleOff!(true)}
            title="클릭하여 감차(휴차) 처리"
            className="w-full rounded text-gray-200 hover:bg-gray-100 hover:text-gray-400 dark:text-gray-600 dark:hover:bg-gray-900/40"
          >
            ·
          </button>
        );
      }
      return <span className="text-gray-200 dark:text-gray-600">·</span>;
    }

    const tint = STATUS_TINT[slot.status] ?? 'text-gray-800 dark:text-gray-100';
    const isDup = duplicateSlotIds?.has(slot.id) ?? false;
    const name = slot.isManualOverride ? (
      <span className="font-bold text-red-600 dark:text-red-400">{slot.driver.name}</span>
    ) : (
      slot.driver.name
    );
    const title = [
      slot.driver.name,
      `${slot.route?.routeNumber ?? '-'}번`,
      SHIFT_LABELS[slot.shift] ?? slot.shift,
      isDup ? '⚠ 같은 날 다른 칸에도 배정됨' : undefined,
      off ? '⚠ 감차로 표기된 차량에 배정이 남아 있음' : undefined,
      slot.notes,
      slot.isManualOverride ? '[수동변경]' : undefined,
    ]
      .filter(Boolean)
      .join(' | ');
    const warnRing = isDup
      ? 'ring-2 ring-inset ring-red-500'
      : off
        ? 'ring-2 ring-inset ring-amber-400'
        : '';

    if (!editable || !onSlotClick) {
      return (
        <span title={title} className={`block rounded px-0.5 ${tint} ${warnRing}`}>
          {name}
        </span>
      );
    }
    return (
      <button
        onClick={() => onSlotClick(slot)}
        title={title}
        className={`w-full rounded px-0.5 hover:ring-2 hover:ring-inset hover:ring-blue-400 ${tint} ${warnRing}`}
      >
        {name}
      </button>
    );
  };

  return (
    <>
      <td className={td}>{renderSlot(pair?.am, unregisteredAm)}</td>
      <td className={tdLast}>{renderSlot(pair?.pm, unregisteredPm)}</td>
    </>
  );
}
