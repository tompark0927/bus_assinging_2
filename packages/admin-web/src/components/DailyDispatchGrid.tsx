import { useMemo } from 'react';
import { Printer } from 'lucide-react';
import type { VehicleSlot, BusGroupMap } from './VehicleScheduleGrid';

/**
 * 일일배차표 — 엑셀 "일일배차/프린터용" 시트의 화면판.
 *
 * 하루치를 노선별 카드로 보여준다. 각 카드는 출발 그룹(가좌/동춘 등) 블록으로
 * 나뉘고, 행은 순번|차번|오전|오후. 감차는 회색 '휴', 빈 칸은 공석으로 표시해
 * "의도된 감차"와 "실수로 빈 칸"이 한눈에 구분된다. 하단에 그날 대기(배정 없는)
 * 스페어 기사 명단 — 엑셀의 sp칸에 해당.
 *
 * 차량 목록은 그날 slots만이 아니라 그 달 전체에서 만든다 — 그날 배정이 없는
 * 차(감차·공석)도 행으로 보여야 엑셀 게시물과 같은 완전한 표가 된다.
 */

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;
const UNASSIGNED = '미배정';

const STATUS_TINT: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
  FILLED: 'bg-emerald-100 text-emerald-700',
  DROPPED: 'bg-red-100 text-red-700',
  ABSENT: 'bg-red-100 text-red-700',
};

function routeKey(r: string) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(r ?? '');
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
}

interface DayPair {
  am?: VehicleSlot;
  pm?: VehicleSlot;
}

interface Row {
  bus: string;
  slotNo: number | string; // 게시 순번 (패턴 있으면 그 값, 없으면 블록 내 순서)
  pair: DayPair;
  off: boolean;
}

interface Block {
  label: string | null;
  rows: Row[];
}

interface RouteCard {
  route: string;
  blocks: Block[];
  operating: number;
}

export default function DailyDispatchGrid({
  slots,
  date,
  busGroups,
  vehicleOff,
  postingSlotNo,
  unregisteredAt,
  spareStandby,
  editable,
  onSlotClick,
  duplicateSlotIds,
}: {
  /** 그 달 전체 slots — 차량 목록을 만들기 위해 하루치가 아니라 전체를 받는다 */
  slots: VehicleSlot[];
  /** YYYY-MM-DD */
  date: string;
  busGroups?: BusGroupMap;
  vehicleOff?: Set<string>;
  /** 게시 순번 (차번 → 그날 순번). 게시 양식(패턴) 데이터가 있을 때만 */
  postingSlotNo?: Record<string, number | null>;
  /**
   * 기초 데이터에 계정이 없어 슬롯으로 저장되지 못한 기사 이름.
   * 키 `차번|MORNING`. 인쇄물(dailyPostingExport)은 이 이름을 찍으므로
   * 화면이 '공석'으로 비워두면 종이와 화면이 어긋난다 — 주황으로 표시한다.
   */
  unregisteredAt?: Record<string, string>;
  /** 그날 배정 없는 스페어 기사 — 엑셀 sp칸 */
  spareStandby?: string[];
  editable: boolean;
  onSlotClick?: (slot: VehicleSlot) => void;
  duplicateSlotIds?: Set<number>;
}) {
  const cards = useMemo<RouteCard[]>(() => {
    // 그 달 전체에서 노선→차량 우주를 만들고, 그날 배정만 채운다
    const byRoute = new Map<string, Map<string, DayPair>>();
    for (const slot of slots) {
      if (slot.isRestDay) continue;
      const route = slot.route?.routeNumber ?? '기타';
      const bus = slot.bus?.busNumber ?? UNASSIGNED;
      let byBus = byRoute.get(route);
      if (!byBus) byRoute.set(route, (byBus = new Map()));
      let pair = byBus.get(bus);
      if (!pair) byBus.set(bus, (pair = {}));

      if (slot.date.split('T')[0] !== date) continue; // 우주 구축용 — 그날 것만 배정으로
      if (slot.shift === 'MORNING') pair.am ??= slot;
      else if (slot.shift === 'AFTERNOON') pair.pm ??= slot;
      else {
        pair.am ??= slot;
        pair.pm ??= slot;
      }
    }

    const infoOf = (bus: string) => busGroups?.[bus] ?? { group: null, order: null };

    return Array.from(byRoute.entries())
      .sort((a, b) => routeKey(a[0]) - routeKey(b[0]))
      .map(([route, byBus]) => {
        const all = Array.from(byBus.entries()).map(([bus, pair]) => ({ bus, pair }));
        const unassigned = all.filter((r) => r.bus === UNASSIGNED && (r.pair.am || r.pair.pm));
        const real = all.filter((r) => r.bus !== UNASSIGNED);

        const byLabel = new Map<string, typeof real>();
        const ungrouped: typeof real = [];
        for (const r of real) {
          const g = infoOf(r.bus).group;
          if (!g) ungrouped.push(r);
          else {
            if (!byLabel.has(g)) byLabel.set(g, []);
            byLabel.get(g)!.push(r);
          }
        }
        const sortRows = (arr: typeof real) =>
          arr.sort((a, b) => {
            const oa = infoOf(a.bus).order ?? Number.MAX_SAFE_INTEGER;
            const ob = infoOf(b.bus).order ?? Number.MAX_SAFE_INTEGER;
            if (oa !== ob) return oa - ob;
            return a.bus.localeCompare(b.bus, undefined, { numeric: true });
          });

        const toRows = (arr: typeof real): Row[] =>
          sortRows(arr).map((r, i) => ({
            bus: r.bus,
            slotNo: postingSlotNo?.[r.bus] ?? i + 1,
            pair: r.pair,
            off: vehicleOff?.has(`${date}|${r.bus}`) ?? false,
          }));

        const blocks: Block[] = [];
        if (ungrouped.length) blocks.push({ label: null, rows: toRows(ungrouped) });
        for (const [label, arr] of [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
          blocks.push({ label, rows: toRows(arr) });
        }
        if (unassigned.length) {
          blocks.push({
            label: null,
            rows: unassigned.map((r) => ({ bus: r.bus, slotNo: '-', pair: r.pair, off: false })),
          });
        }

        const operating = blocks
          .flatMap((b) => b.rows)
          .filter((r) => r.bus !== UNASSIGNED && (r.pair.am || r.pair.pm)).length;
        return { route, blocks, operating };
      });
  }, [slots, date, busGroups, vehicleOff, postingSlotNo]);

  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay();
  const title = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[dow]})`;

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        이 날짜에 표시할 배차 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 게시물 제목 — 인쇄에도 나간다 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          className={`text-lg font-bold ${
            dow === 0
              ? 'text-red-600 dark:text-red-400'
              : dow === 6
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-800 dark:text-gray-100'
          }`}
        >
          일일배차표 · {title}
        </h3>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 print:hidden dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          <Printer size={14} /> 인쇄
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-3 print:gap-2">
        {cards.map((card) => (
          <div
            key={card.route}
            className="break-inside-avoid overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
          >
            <div className="border-b border-gray-200 bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-800 dark:border-gray-700 dark:bg-blue-900/30 dark:text-blue-300">
              {card.route === '기타' ? '기타' : `${card.route}번`} · {card.operating}대 운행
            </div>
            <table className="w-full border-collapse text-[13px] leading-tight tabular-nums">
              <thead>
                <tr className="bg-gray-50 text-[11px] text-gray-500 dark:bg-gray-900/30 dark:text-gray-400">
                  <th className="w-12 whitespace-nowrap border-b border-gray-200 px-1 py-1 font-medium dark:border-gray-700">순번</th>
                  <th className="w-16 whitespace-nowrap border-b border-gray-200 px-1 py-1 font-medium dark:border-gray-700">차번</th>
                  <th className="whitespace-nowrap border-b border-gray-200 px-1 py-1 font-medium dark:border-gray-700">오전</th>
                  <th className="whitespace-nowrap border-b border-gray-200 px-1 py-1 font-medium dark:border-gray-700">오후</th>
                </tr>
              </thead>
              {card.blocks.map((block, bi) => (
                <tbody key={bi}>
                  {block.label && (
                    <tr>
                      <td
                        colSpan={4}
                        className="border-b border-gray-200 bg-gray-100/80 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300"
                      >
                        {block.label} · {block.rows.length}대
                      </td>
                    </tr>
                  )}
                  {block.rows.map((row) => (
                    <DailyRow
                      key={row.bus}
                      row={row}
                      editable={editable}
                      onSlotClick={onSlotClick}
                      duplicateSlotIds={duplicateSlotIds}
                      unregisteredAm={unregisteredAt?.[`${row.bus}|MORNING`]}
                      unregisteredPm={unregisteredAt?.[`${row.bus}|AFTERNOON`]}
                    />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        ))}
      </div>

      {/* sp(스페어) 대기 명단 — 엑셀 일일배차의 sp칸 */}
      {spareStandby && spareStandby.length > 0 && (
        <div className="rounded-lg border border-gray-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-800">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
            스페어 대기 ({spareStandby.length}명)
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{spareStandby.join(' · ')}</p>
        </div>
      )}

      <p className="text-xs text-gray-400 print:hidden dark:text-gray-500">
        <span className="rounded bg-gray-100 px-1 text-gray-500 dark:bg-gray-900/40">휴</span> = 감차 ·{' '}
        <span className="font-semibold text-red-500">공석</span> = 배정 없음 (버스가 나갈 수 없음) ·{' '}
        <span className="text-amber-600 underline decoration-dotted">주황 이름</span> = 기초 데이터
        미등록 (등록하면 정상 배정) · 순번은 게시
        양식(순번 로테이션) 데이터가 있으면 그 값, 없으면 블록 내 순서입니다 · 배차는 사정에 따라 변경될 수
        있으니 매일 확인 바랍니다.
      </p>
    </div>
  );
}

function DailyRow({
  row,
  editable,
  onSlotClick,
  duplicateSlotIds,
  unregisteredAm,
  unregisteredPm,
}: {
  row: Row;
  editable: boolean;
  onSlotClick?: (slot: VehicleSlot) => void;
  duplicateSlotIds?: Set<number>;
  unregisteredAm?: string;
  unregisteredPm?: string;
}) {
  const td = 'border-b border-gray-100 px-1 py-1 text-center dark:border-gray-700';

  const renderName = (slot: VehicleSlot | undefined, pendingName?: string) => {
    if (row.off) {
      // 감차 행에는 기사 이름을 인쇄하지 않는다 — 벽에 붙는 종이와 화면이
      // 다르면 현장은 종이를 믿는다. 배정이 남은 모순 상태면 경고로 드러낸다.
      if (!slot) return <span className="text-gray-400">휴</span>;
      return (
        <span
          title={`감차로 표기된 차량에 ${slot.driver.name} 배정이 남아 있습니다 — 배정을 지우거나 감차를 해제하세요`}
          className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700"
        >
          휴 ⚠{slot.driver.name}
        </span>
      );
    }
    if (!slot) {
      // 엑셀엔 이름이 있는데 계정이 없어 저장 못 한 칸 — 인쇄물은 이 이름을
      // 찍는다. '공석'으로 비우면 종이와 화면이 어긋나므로 주황으로 보여주고,
      // 등록이 필요하다는 사실만 점선으로 구분한다.
      if (pendingName) {
        return (
          <span
            title={`${pendingName} — 기초 데이터에 없는 기사입니다. 등록하면 정상 배정됩니다.`}
            className="inline-block rounded px-1.5 py-0.5 text-amber-600 underline decoration-dotted underline-offset-2 dark:text-amber-500"
          >
            {pendingName}
          </span>
        );
      }
      return <span className="text-[11px] font-semibold text-red-500">공석</span>;
    }
    const tint = STATUS_TINT[slot.status] ?? '';
    const isDup = duplicateSlotIds?.has(slot.id) ?? false;
    const cls = `${tint} ${isDup ? 'ring-2 ring-inset ring-red-500' : ''} ${
      slot.isManualOverride ? 'font-bold text-red-600 dark:text-red-400' : ''
    }`;
    if (!editable || !onSlotClick) {
      return <span className={`inline-block rounded px-1.5 py-0.5 ${cls}`}>{slot.driver.name}</span>;
    }
    return (
      <button
        onClick={() => onSlotClick(slot)}
        className={`rounded px-1.5 py-0.5 hover:ring-2 hover:ring-inset hover:ring-blue-400 ${cls}`}
      >
        {slot.driver.name}
      </button>
    );
  };

  return (
    <tr className={row.off ? 'bg-gray-50 dark:bg-gray-900/30' : ''}>
      <td className={`${td} text-gray-400 dark:text-gray-500`}>{row.slotNo}</td>
      <td
        className={`${td} font-semibold ${
          row.bus === UNASSIGNED ? 'text-amber-600 dark:text-amber-500' : 'text-gray-800 dark:text-gray-100'
        }`}
      >
        {row.bus}
      </td>
      <td className={td}>{renderName(row.pair.am, unregisteredAm)}</td>
      <td className={td}>{renderName(row.pair.pm, unregisteredPm)}</td>
    </tr>
  );
}
