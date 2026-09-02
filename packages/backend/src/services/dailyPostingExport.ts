import ExcelJS from 'exceljs';
import { prisma } from '../utils/prisma';
import { serviceTypeLabel } from '../utils/serviceType';

/**
 * 일일배차표(게시용) 엑셀 출력 — 현장이 실제로 붙이는 그 종이.
 *
 * 실물(작업용 워크북의 '프린터용' 시트)을 그대로 재현한다:
 *
 *   1행           날짜
 *   2행           노선 헤더가 가로로 (16번 | 9번 | 3-2번)
 *   3행           순번 | 조율 | 차번 | 오전 | 오후 | (출발지) | 교대시간
 *   4행~          출발지 블록. 순번은 7→1 **내림차순**
 *   블록 사이 공백 후 다음 출발지 블록
 *
 * "엑셀을 뺏지 않는다"가 도입 전략의 핵심이라, 이 파일이 늘 쓰던 것과
 * 같아 보이는지가 제품의 성패를 가른다. 주간 양식과는 다른 물건이므로
 * 별도로 만든다.
 */

const HEADER = ['순번', '조율', '차번', '오전', '오후'];
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
/** 노선 블록 하나가 차지하는 열 수 (헤더 5 + 여백 2) */
const BLOCK_W = 7;

interface Row {
  slot: number | null;
  vehicle: string;
  am: string;
  pm: string;
}

export async function buildDailyPostingXlsx(
  companyId: number,
  scheduleId: number,
  dateStr: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, companyId },
    select: { id: true, year: true, month: true, notes: true, serviceType: true },
  });
  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');

  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const [patterns, slots] = await Promise.all([
    prisma.schedulePattern.findMany({
      where: { scheduleId, date },
      select: {
        displaySlot: true, operating: true, depotGroup: true,
        bus: { select: { id: true, busNumber: true, route: { select: { routeNumber: true } } } },
      },
    }),
    prisma.scheduleSlot.findMany({
      where: { scheduleId, date },
      select: { shift: true, busId: true, driver: { select: { name: true } } },
    }),
  ]);
  if (patterns.length === 0) {
    throw new Error(`${dateStr} 에 해당하는 배차 데이터가 없습니다.`);
  }

  // 저장 못 한(미등록 기사) 배정도 이름은 살려서 인쇄한다 — 빈칸이면 현장이 혼란
  let unmatched: Record<string, string> = {};
  try {
    const meta = schedule.notes ? JSON.parse(schedule.notes) : null;
    unmatched = meta?.unmatchedCells ?? {};
  } catch { /* 평문 notes */ }

  const nameAt = new Map<string, string>();
  for (const s of slots) {
    if (s.busId) nameAt.set(`${s.busId}|${s.shift}`, s.driver.name);
  }

  // ── 출발지그룹으로 묶기 ──
  const groups = new Map<string, { route: string; rows: Row[] }>();
  for (const p of patterns) {
    const key = p.depotGroup ?? p.bus.route?.routeNumber ?? '전체';
    const g = groups.get(key) ?? {
      route: p.bus.route?.routeNumber ?? key.replace(/\s.*$/, ''),
      rows: [],
    };
    const am = nameAt.get(`${p.bus.id}|MORNING`)
      ?? unmatched[`${dateStr}|${p.bus.busNumber}|MORNING`] ?? '';
    const pm = nameAt.get(`${p.bus.id}|AFTERNOON`)
      ?? unmatched[`${dateStr}|${p.bus.busNumber}|AFTERNOON`] ?? '';
    g.rows.push({
      slot: p.operating ? p.displaySlot : null,
      vehicle: p.bus.busNumber,
      am: p.operating ? am : '휴',
      pm: p.operating ? pm : '휴',
    });
    groups.set(key, g);
  }

  // 노선별로 묶고, 각 노선 안에서 출발지 블록을 세로로 쌓는다
  const byRoute = new Map<string, { depot: string; rows: Row[] }[]>();
  for (const [depot, g] of [...groups.entries()].sort()) {
    // 실물과 같이 순번 내림차순 (늦은 순번이 위)
    g.rows.sort((a, b) => (b.slot ?? -1) - (a.slot ?? -1));
    const list = byRoute.get(g.route) ?? [];
    list.push({ depot, rows: g.rows });
    byRoute.set(g.route, list);
  }
  const routes = [...byRoute.keys()].sort((a, b) => {
    const key = (r: string) => {
      const m = /^(\d+)(?:-(\d+))?$/.exec(r);
      return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
    };
    return key(a) - key(b);
  });

  // ── 엑셀 그리기 ──
  const wb = new ExcelJS.Workbook();
  const typeTag = schedule.serviceType ? serviceTypeLabel(schedule.serviceType) : '';
  const ws = wb.addWorksheet(typeTag ? `${dateStr} ${typeTag}` : dateStr, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const d = new Date(`${dateStr}T00:00:00`);
  // 종류를 함께 찍는다 — 같은 날 간선·지선 두 장을 뽑으면 종이 위에서 구별할
  // 방법이 날짜밖에 없다. 잘못된 장을 차고지에 붙이면 그날이 통째로 어긋난다.
  ws.getCell(1, 1).value = typeTag
    ? `${dateStr} (${WEEKDAY_KO[d.getDay()]}) · ${typeTag}`
    : `${dateStr} (${WEEKDAY_KO[d.getDay()]})`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };

  const thin = { style: 'thin' as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: 'center' as const, vertical: 'middle' as const };

  routes.forEach((route, ri) => {
    const c0 = 1 + ri * BLOCK_W;
    ws.getCell(2, c0).value = `${route}번`;
    ws.getCell(2, c0).font = { bold: true, size: 12 };

    let r = 3;
    for (const block of byRoute.get(route)!) {
      // 출발지 이름 (엑셀 원본에는 헤더 우측에 붙어 있다)
      ws.getCell(r, c0 + 5).value = block.depot.replace(/^.*?\s/, '');
      ws.getCell(r, c0 + 5).font = { size: 10, color: { argb: 'FF666666' } };

      HEADER.forEach((h, i) => {
        const cell = ws.getCell(r, c0 + i);
        cell.value = h;
        cell.font = { bold: true, size: 10 };
        cell.alignment = center;
        cell.border = border;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
      });
      r++;

      for (const row of block.rows) {
        const vals = [
          row.slot ?? '○',
          row.slot != null ? row.slot - 1 : '',   // 조율 = 순번 기준 오프셋
          row.vehicle, row.am, row.pm,
        ];
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, c0 + i);
          cell.value = v as string | number;
          cell.alignment = center;
          cell.border = border;
          cell.font = { size: 11 };
        });
        r++;
      }
      r++; // 블록 사이 빈 행
    }

    // 열 폭 — 실물과 비슷하게 좁게
    [4, 4, 8, 10, 10, 8, 2].forEach((w, i) => {
      ws.getColumn(c0 + i).width = w;
    });
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `일일배차표_${dateStr}${typeTag ? `_${typeTag}` : ''}.xlsx` };
}
