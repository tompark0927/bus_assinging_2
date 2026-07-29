import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';

/**
 * 게시 양식 배차표 그리드 — 현장에서 수년간 봐온 그 표.
 *
 *   행 = 차량, 열 = 날짜, 각 날짜는 (순번 | 오전 | 오후) 3칸
 *   출발지그룹별로 행 블록을 나누고, 주 단위(일~토)로 패널을 끊는다.
 *
 * 기존 "기사별 조/석" 뷰와 달리 **순번**이 있다 — 그날의 출발시각을 정하고
 * 매일 로테이션으로 돌면서 이른/늦은 근무를 공평하게 나누는 핵심 장치.
 * 데이터는 SchedulePattern(엔진 1단계)에서 온다.
 */

export interface PostingDriver {
  id: number;
  name: string;
  slotId: number;
  overridden: boolean;
}

export interface PostingCell {
  slot: number | null;
  operating: boolean;
  am: PostingDriver | null;
  pm: PostingDriver | null;
}

export interface PostingView {
  groups: { name: string; vehicles: string[] }[];
  cells: Record<string, Record<string, PostingCell>>;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_KO[d.getDay()]})`;
}

function isWeekend(iso: string) {
  const dow = new Date(`${iso}T00:00:00`).getDay();
  return dow === 0 || dow === 6;
}

export default function PostingScheduleGrid({
  view,
  onCellClick,
}: {
  view: PostingView;
  /** 셀 클릭 — 담당자가 배정을 바꾸거나 근거를 보려 할 때 */
  onCellClick?: (p: {
    date: string; vehicle: string; shift: 'MORNING' | 'AFTERNOON';
    driver: PostingDriver | null;
  }) => void;
}) {
  const [weekIdx, setWeekIdx] = useState(0);

  // 일요일 시작 주간으로 분할 (실물 게시표와 동일)
  const weeks = useMemo(() => {
    const dates = Object.keys(view.cells).sort();
    const out: string[][] = [];
    let cur: string[] = [];
    for (const iso of dates) {
      if (new Date(`${iso}T00:00:00`).getDay() === 0 && cur.length) {
        out.push(cur);
        cur = [];
      }
      cur.push(iso);
    }
    if (cur.length) out.push(cur);
    return out;
  }, [view.cells]);

  const week = weeks[Math.min(weekIdx, weeks.length - 1)] ?? [];

  if (weeks.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        게시 양식으로 볼 수 있는 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 주 선택 */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange size={16} className="text-gray-400" />
        {weeks.map((w, i) => (
          <button
            key={i}
            onClick={() => setWeekIdx(i)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              i === weekIdx
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {i + 1}주차 ({fmtDay(w[0])}~)
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/40">
              <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                차량
              </th>
              {week.map((iso) => (
                <th
                  key={iso}
                  colSpan={3}
                  className={`border-b border-r border-gray-200 px-1 py-2 text-center font-semibold dark:border-gray-700 ${
                    isWeekend(iso)
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {fmtDay(iso)}
                </th>
              ))}
            </tr>
            <tr className="bg-gray-50/60 dark:bg-gray-900/20">
              <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-3 py-1 dark:border-gray-700 dark:bg-gray-900/40" />
              {week.map((iso) =>
                ['순번', '오전', '오후'].map((h) => (
                  <th
                    key={`${iso}-${h}`}
                    className="border-b border-r border-gray-100 px-1 py-1 text-center font-medium text-gray-400 dark:border-gray-700 dark:text-gray-500"
                  >
                    {h}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {view.groups.map((group) => (
              <>
                <tr key={`g-${group.name}`}>
                  <td
                    colSpan={1 + week.length * 3}
                    className="border-b border-gray-100 bg-blue-50/40 px-3 py-1 text-[11px] font-semibold text-blue-700 dark:border-gray-700 dark:bg-blue-900/20 dark:text-blue-300"
                  >
                    {group.name} · {group.vehicles.length}대
                  </td>
                </tr>
                {group.vehicles.map((vehicle) => (
                  <tr key={vehicle} className="hover:bg-gray-50/60 dark:hover:bg-gray-700/30">
                    <td className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-1 font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                      {vehicle}
                    </td>
                    {week.map((iso) => {
                      const cell = view.cells[iso]?.[vehicle];
                      return (
                        <DayCells
                          key={`${iso}-${vehicle}`}
                          cell={cell}
                          onAm={() =>
                            onCellClick?.({
                              date: iso, vehicle, shift: 'MORNING',
                              driver: cell?.am ?? null,
                            })
                          }
                          onPm={() =>
                            onCellClick?.({
                              date: iso, vehicle, shift: 'AFTERNOON',
                              driver: cell?.pm ?? null,
                            })
                          }
                        />
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        빨간 이름 = 수동 변경된 배정 · 순번은 매일 로테이션으로 돌아 이른/늦은 근무가 고르게 배분됩니다.
      </p>
    </div>
  );
}

/** 하루치 3칸 (순번 | 오전 | 오후) */
function DayCells({
  cell, onAm, onPm,
}: {
  cell?: PostingCell;
  onAm: () => void;
  onPm: () => void;
}) {
  const td = 'border-b border-r border-gray-100 px-1 py-1 text-center whitespace-nowrap dark:border-gray-700';

  if (!cell) {
    return (
      <>
        <td className={td} />
        <td className={td} />
        <td className={td} />
      </>
    );
  }

  // 감차 휴차: 순번은 그대로 두고 기사 자리에 "휴" (지선 게시 양식과 동일)
  if (!cell.operating) {
    return (
      <>
        <td className={`${td} text-gray-400`}>{cell.slot ?? '○'}</td>
        <td className={`${td} text-gray-400`}>휴</td>
        <td className={`${td} text-gray-400`}>휴</td>
      </>
    );
  }

  const nameCls = (d: PostingDriver | null) =>
    d?.overridden
      ? 'font-bold text-red-600 dark:text-red-400'
      : 'text-gray-800 dark:text-gray-100';

  return (
    <>
      <td className={`${td} text-gray-500 dark:text-gray-400`}>{cell.slot ?? ''}</td>
      <td className={td}>
        <button onClick={onAm} className={`w-full rounded px-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 ${nameCls(cell.am)}`}>
          {cell.am?.name ?? '—'}
        </button>
      </td>
      <td className={td}>
        <button onClick={onPm} className={`w-full rounded px-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 ${nameCls(cell.pm)}`}>
          {cell.pm?.name ?? '—'}
        </button>
      </td>
    </>
  );
}
