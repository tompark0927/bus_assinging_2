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
  /** 엔진은 배정했지만 기초 데이터에 없어 저장되지 못한 기사 */
  unregistered?: boolean;
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

/** 토=파랑, 일=빨강 — 종이 배차표의 관례 */
function dayTone(iso: string) {
  const dow = new Date(`${iso}T00:00:00`).getDay();
  if (dow === 0) return 'text-red-600 dark:text-red-400';
  if (dow === 6) return 'text-blue-600 dark:text-blue-400';
  return 'text-gray-700 dark:text-gray-200';
}

export default function PostingScheduleGrid({
  view,
  onCellClick,
  onDownloadDay,
}: {
  view: PostingView;
  /** 그날짜 게시용(일일배차표) 엑셀 받기 — 현장은 하루치를 붙인다 */
  onDownloadDay?: (date: string) => void;
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

      <div className="overflow-x-auto rounded-lg border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800">
        {/* 실물 게시표처럼 촘촘하게 — 한 화면에 한 주(7일)가 들어와야 한다 */}
        <table className="border-collapse text-[11px] leading-tight tabular-nums">
          <colgroup>
            <col style={{ width: 58 }} />
            {week.map((iso) => (
              <>
                <col key={`${iso}-s`} style={{ width: 26 }} />
                <col key={`${iso}-a`} style={{ width: 58 }} />
                <col key={`${iso}-p`} style={{ width: 58 }} />
              </>
            ))}
          </colgroup>
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-900/50">
              <th className="sticky left-0 z-10 border-b border-r-2 border-gray-300 bg-gray-100 px-1 py-1 text-center font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-200">
                차량
              </th>
              {week.map((iso) => (
                <th
                  key={iso}
                  colSpan={3}
                  className={`border-b border-r-2 border-gray-300 px-0.5 py-1 text-center font-semibold dark:border-gray-600 ${
                    dayTone(iso)
                  }`}
                >
                  {onDownloadDay ? (
                    <button
                      onClick={() => onDownloadDay(iso)}
                      title={`${fmtDay(iso)} 게시용 엑셀 받기`}
                      className="rounded px-1 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                    >
                      {fmtDay(iso)}
                    </button>
                  ) : fmtDay(iso)}
                </th>
              ))}
            </tr>
            <tr className="bg-gray-50 dark:bg-gray-900/20">
              <th className="sticky left-0 z-10 border-b border-r-2 border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/50" />
              {week.map((iso) =>
                ['순번', '오전', '오후'].map((h, hi) => (
                  <th
                    key={`${iso}-${h}`}
                    className={`border-b border-gray-200 px-0.5 py-0.5 text-center text-[10px] font-medium text-gray-400 dark:border-gray-700 dark:text-gray-500 ${
                      hi === 2 ? 'border-r-2 border-r-gray-300 dark:border-r-gray-600' : 'border-r border-r-gray-100'
                    }`}
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
                    className="sticky left-0 border-y border-gray-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-800 dark:border-gray-700 dark:bg-blue-900/30 dark:text-blue-300"
                  >
                    {group.name} · {group.vehicles.length}대
                  </td>
                </tr>
                {group.vehicles.map((vehicle) => (
                  <tr key={vehicle} className="hover:bg-gray-50/60 dark:hover:bg-gray-700/30">
                    <td className="sticky left-0 z-10 border-b border-r-2 border-gray-300 bg-white px-1 py-0.5 text-center font-semibold text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
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
        <span className="font-bold text-red-600 dark:text-red-400">빨간 이름</span> = 수동 변경 ·{' '}
        <span className="text-amber-600/70 underline decoration-dotted">주황 점선</span> = 기초 데이터에 없는 기사
        (등록하면 정상 표시) · 순번은 매일 로테이션으로 돌아 이른/늦은 근무가 고르게 배분됩니다
        {onDownloadDay ? ' · 날짜를 누르면 그날 게시용 엑셀을 받습니다.' : '.'}
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
  const td = 'border-b border-r border-gray-100 px-0.5 py-0.5 text-center whitespace-nowrap dark:border-gray-700';
  const tdLast = `${td} border-r-2 border-r-gray-300 dark:border-r-gray-600`;  // 날짜 경계

  if (!cell) {
    return (
      <>
        <td className={td} />
        <td className={td} />
        <td className={tdLast} />
      </>
    );
  }

  // 감차 휴차: 순번은 그대로 두고 기사 자리에 "휴" (지선 게시 양식과 동일)
  if (!cell.operating) {
    return (
      <>
        <td className={`${td} bg-gray-50 text-gray-400 dark:bg-gray-900/30`}>{cell.slot ?? '○'}</td>
        <td className={`${td} bg-gray-50 text-gray-400 dark:bg-gray-900/30`}>휴</td>
        <td className={`${tdLast} bg-gray-50 text-gray-400 dark:bg-gray-900/30`}>휴</td>
      </>
    );
  }

  const nameCls = (d: PostingDriver | null) => {
    if (d?.unregistered) {
      // 배정은 됐는데 앱에 계정이 없는 기사 — 빈칸으로 두면 '운행 안 함'으로
      // 오해하므로 이름을 흐리게 보여주고 점선 밑줄로 구분한다
      return 'text-amber-600/70 dark:text-amber-500/70 underline decoration-dotted underline-offset-2';
    }
    return d?.overridden
      ? 'font-bold text-red-600 dark:text-red-400'
      : 'text-gray-800 dark:text-gray-100';
  };

  return (
    <>
      <td className={`${td} text-gray-400 dark:text-gray-500`}>{cell.slot ?? ''}</td>
      <td className={td}>
        <button
          onClick={onAm}
          title={cell.am?.unregistered ? `${cell.am.name} — 기초 데이터에 없는 기사입니다` : undefined}
          className={`w-full rounded px-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 ${nameCls(cell.am)}`}
        >
          {cell.am?.name ?? <span className="text-gray-200 dark:text-gray-600">·</span>}
        </button>
      </td>
      <td className={tdLast}>
        <button
          onClick={onPm}
          title={cell.pm?.unregistered ? `${cell.pm.name} — 기초 데이터에 없는 기사입니다` : undefined}
          className={`w-full rounded px-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 ${nameCls(cell.pm)}`}
        >
          {cell.pm?.name ?? <span className="text-gray-200 dark:text-gray-600">·</span>}
        </button>
      </td>
    </>
  );
}
