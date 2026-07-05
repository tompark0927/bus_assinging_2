import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { generateInitialPassword, normalizePhone } from '../utils/initialPassword';
import { autoWireBusesAndCrews } from '../utils/autoWire';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────
// 날짜 시리얼 번호 → YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────
function serialToDateStr(serial: number): string {
  const base = new Date(1899, 11, 30);
  const d = new Date(base.getTime() + serial * 86400000);
  return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────
// 셀 값 정제
// ─────────────────────────────────────────────────────────────────
function cleanCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number' && val > 40000 && val < 55000) return serialToDateStr(val);
  return String(val).trim().replace(/[\n\r\t]/g, ' ').replace(/\s{2,}/g, ' ');
}

// ─────────────────────────────────────────────────────────────────
// 병합셀 전파 + 수식 셀 [수식] 표기
// ─────────────────────────────────────────────────────────────────
function buildCellMap(ws: XLSX.WorkSheet): Map<string, unknown> {
  const cellMap = new Map<string, unknown>();

  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const cell = ws[key] as XLSX.CellObject;
    if (cell.f && (cell.v === undefined || cell.v === null)) {
      cellMap.set(key, '[수식]');
    } else {
      cellMap.set(key, cell.v ?? '');
    }
  }

  for (const merge of ws['!merges'] || []) {
    const tlRef = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
    const tlVal = cellMap.get(tlRef) ?? '';
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!cellMap.has(ref) || cellMap.get(ref) === '') {
          cellMap.set(ref, tlVal);
        }
      }
    }
  }

  return cellMap;
}

// ─────────────────────────────────────────────────────────────────
// 워크북 → 시트별 텍스트 변환
// ─────────────────────────────────────────────────────────────────
function parseWorkbook(buffer: Buffer): { name: string; text: string; rows: number }[] {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: true,
    cellNF: false,
  });

  const result: { name: string; text: string; rows: number }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws['!ref']) continue;

    const range = XLSX.utils.decode_range(ws['!ref']);
    const maxRow = range.e.r + 1;
    const maxCol = range.e.c + 1;

    const cellMap = buildCellMap(ws);
    const lines: string[] = [];

    for (let r = 0; r < maxRow; r++) {
      const cells: string[] = [];
      for (let c = 0; c < maxCol; c++) {
        cells.push(cleanCell(cellMap.get(XLSX.utils.encode_cell({ r, c })) ?? ''));
      }
      if (cells.some(c => c !== '')) {
        // 행 번호(R{n})를 붙여 2-D 좌표를 보존 — 모델이 "이 기사 행의 옆/위 열에 있는
        // 노선·차량"을 연결할 수 있게 한다. 빈 셀도 유지해 열 정렬을 보존.
        lines.push(`R${r + 1}: ${cells.join(' | ')}`);
      }
    }

    result.push({ name: sheetName, text: lines.join('\n'), rows: maxRow });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// JSON 파서 (안전, 절대 throw 안 함)
// ─────────────────────────────────────────────────────────────────
function safeParseJson<T>(text: string, fallback: T): T {
  let s = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  try { return JSON.parse(s) as T; } catch {}
  const start = s.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)) as T; } catch {} break; } }
    }
  }
  return fallback;
}

// ─────────────────────────────────────────────────────────────────
// 표준 템플릿(고정 열) 결정론적 파싱 — AI 없이 정확히 읽는다.
// 시트명에 "기사"/"노선"/"버스"가 포함되고 예상 머리글이 있으면 사용.
// 실패(비표준 파일)하면 null 반환 → AI 폴백.
// ─────────────────────────────────────────────────────────────────
type TemplateParse = {
  drivers: { name: string; phone: string; driverType: 'MAIN' | 'SPARE' }[];
  routes: { routeNumber: string; name: string; startPoint: string; endPoint: string }[];
  buses: { busNumber: string; plateNumber: string; model: string; year: number | null }[];
};

function parseTemplateSheets(buffer: Buffer): TemplateParse | null {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const findSheet = (kw: string): XLSX.WorkSheet | null => {
    const nm = wb.SheetNames.find((n) => n.replace(/\s/g, '').includes(kw));
    return nm ? wb.Sheets[nm] : null;
  };
  const driverWs = findSheet('기사');
  const routeWs = findSheet('노선');
  const busWs = findSheet('버스');
  if (!driverWs || !routeWs || !busWs) return null;

  const rowsOf = (ws: XLSX.WorkSheet): unknown[][] =>
    XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) as unknown[][];
  const colIndex = (header: unknown[], ...keywords: string[]): number => {
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i] ?? '').replace(/\s/g, '');
      if (keywords.some((k) => h.includes(k))) return i;
    }
    return -1;
  };
  const cell = (row: unknown[], idx: number): string => (idx >= 0 ? String(row[idx] ?? '').trim() : '');

  // 기사 명단: 이름 / 전화번호 / 유형(정규/예비)
  const dRows = rowsOf(driverWs);
  const dh = dRows[0] || [];
  const dNameI = colIndex(dh, '이름', '성명');
  const dPhoneI = colIndex(dh, '전화', '휴대폰', '연락처');
  const dTypeI = colIndex(dh, '유형', '구분');
  if (dNameI < 0) return null; // 이름 열이 없으면 템플릿이 아님 → AI 폴백
  const drivers = dRows.slice(1)
    .filter((r) => cell(r, dNameI))
    .map((r) => {
      const typeStr = cell(r, dTypeI);
      const driverType: 'MAIN' | 'SPARE' = /예비|스페어|SP|SPARE/i.test(typeStr) ? 'SPARE' : 'MAIN';
      return { name: cell(r, dNameI), phone: cell(r, dPhoneI), driverType };
    });

  // 노선: 노선번호 / 노선명 / 출발지 / 도착지
  const rRows = rowsOf(routeWs);
  const rh = rRows[0] || [];
  const rNumI = colIndex(rh, '노선번호', '번호');
  const rNameI = colIndex(rh, '노선명', '노선이름');
  const rStartI = colIndex(rh, '출발', '기점');
  const rEndI = colIndex(rh, '도착', '종점');
  const routes = rRows.slice(1)
    .filter((r) => cell(r, rNumI) || cell(r, rNameI))
    .map((r) => {
      const num = cell(r, rNumI).replace(/번/g, '').trim();
      return {
        routeNumber: num,
        name: cell(r, rNameI) || (num ? `${num}번` : ''),
        startPoint: cell(r, rStartI),
        endPoint: cell(r, rEndI),
      };
    });

  // 버스: 버스번호 / 차량번호(번호판) / 차종 / 연식
  const bRows = rowsOf(busWs);
  const bh = bRows[0] || [];
  const bNumI = colIndex(bh, '버스번호');
  const bPlateI = colIndex(bh, '차량번호', '번호판');
  const bModelI = colIndex(bh, '차종', '모델', '차량모델');
  const bYearI = colIndex(bh, '연식');
  const buses = bRows.slice(1)
    .filter((r) => cell(r, bNumI) || cell(r, bPlateI))
    .map((r) => {
      const yr = parseInt(cell(r, bYearI).replace(/\D/g, ''), 10);
      return {
        busNumber: cell(r, bNumI),
        plateNumber: cell(r, bPlateI),
        model: cell(r, bModelI),
        year: isNaN(yr) ? null : yr,
      };
    });

  return { drivers, routes, buses };
}

// ─────────────────────────────────────────────────────────────────
// Claude에게 전체 엑셀 내용 전달 → 기사/노선/버스 일괄 추출
// ─────────────────────────────────────────────────────────────────
type ClaudeResult = {
  companyName: string | null;
  drivers: Array<{
    name: string;
    driverType: 'MAIN' | 'SPARE';
    routeNumber?: string;   // 담당 노선 (MAIN 기사만)
    shiftGroup?: string;    // "1조" or "2조" (있으면)
    vehicleNumber?: string; // 담당 차량번호 (있으면)
  }>;
  routes: Array<{ routeNumber: string; name: string }>;
  buses: Array<{ busNumber: string }>;
};

const EMPTY_RESULT: ClaudeResult = { companyName: null, drivers: [], routes: [], buses: [] };

async function analyzeWithClaude(sheets: { name: string; text: string; rows: number }[]): Promise<ClaudeResult> {
  // 전체 텍스트 조합 (시트별 구분자 포함)
  // 강한 모델(AI_MODEL_CHAT)은 컨텍스트가 크므로 한도를 넉넉히 — 배차 그리드가
  // 300행 아래에 있어 잘려서 노선·차량을 못 읽던 문제 완화.
  const MAX_ROWS_PER_SHEET = 1200;
  const MAX_TOTAL_CHARS = 220000;
  let fullContent = '';
  for (const sheet of sheets) {
    const lines = sheet.text.split('\n');
    const preview = lines.slice(0, MAX_ROWS_PER_SHEET).join('\n');
    const truncated = lines.length > MAX_ROWS_PER_SHEET
      ? `${preview}\n...(이하 ${lines.length - MAX_ROWS_PER_SHEET}행 생략)`
      : preview;
    fullContent += `\n\n=== 시트: "${sheet.name}" (${sheet.rows}행) ===\n${truncated}`;
    if (fullContent.length > MAX_TOTAL_CHARS) {
      fullContent = fullContent.slice(0, MAX_TOTAL_CHARS) + '\n...(이하 생략)';
      break;
    }
  }

  // 전체 크기 로깅
  logger.info(`[onboarding] Claude에 전송할 내용: ${fullContent.length}자 (약 ${Math.round(fullContent.length / 4)}토큰)`);

  // 429 rate limit 시 자동 재시도 (최대 2회, 대기 후 재시도)
  const MAX_RETRIES = 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await anthropic.messages.create({
        // 배차표의 2-D 관계(기사↔노선↔차량) 추출은 공간 추론이 필요해 빠른 모델(haiku)이 약함.
        // 강한 모델(AI_MODEL_CHAT)로 추출해 노선/차량/조 매핑 정확도를 높인다.
        model: process.env.AI_MODEL_CHAT || 'claude-sonnet-4-6',
        max_tokens: 16384,
    system: `당신은 한국 버스회사 배차표/명단 엑셀을 분석하는 전문가입니다.
엑셀은 2차원 표입니다. 각 줄은 "R{행번호}: 셀1 | 셀2 | 셀3 ..." 형식이며 "|" 위치가 곧 열(column)입니다.
같은 열(파이프 위치)·같은 행을 기준으로 머리글과 값을 연결해 공간적으로 해석하세요.
[수식]은 값을 읽지 못한 수식 셀입니다.
반드시 설명·마크다운·코드블록 없이 순수 JSON만 출력합니다.`,
    messages: [{
      role: 'user',
      content: `아래는 버스회사 엑셀 파일의 모든 시트 내용입니다 (각 줄 앞 R{n}은 엑셀 행 번호, "|"는 열 구분).

배차표는 보통 "기사 한 명 = 한 행"이고, 그 행 또는 같은 열의 머리글에 담당 노선·차량번호·조(1조/2조)가 함께 적혀 있습니다.
같은 행/열의 값을 적극적으로 연결해서 기사별 노선·차량·조를 최대한 채워주세요. (이게 이 분석의 핵심입니다.)

다음을 정확하게 추출해주세요:

1. **회사명**: 파일 어딘가에 있는 회사 이름 (없으면 null)

2. **기사 전체 목록** (중복 제거):
   - name: 2~5글자 한글 이름만 (정류장명, 지역명, 업무용어, 머리글 제외)
   - driverType: "MAIN"(정규기사) 또는 "SPARE"(예비/SP기사)
     * 열 헤더/구분에 "예비", "SP", "스페어", "대기" 등이 있으면 SPARE
   - routeNumber: 이 기사가 담당하는 노선번호 — **반드시 "번" 없이 숫자/숫자-숫자만** (예: "16", "9", "3-2")
     * 기사 행과 같은 행, 또는 그 행이 속한 노선 머리글(같은 열 블록)에서 노선번호를 찾아 연결
     * 추정이라도 행/열 위치상 명확하면 채울 것. 정말 단서가 없을 때만 null
   - vehicleNumber: 이 기사가 담당하는 차량번호 — 아래 4번 차량 목록의 busNumber 와 일치해야 함
     * 기사 행/열에 차량(차번)이 보이면 반드시 연결. 없으면 null
   - shiftGroup: "1조"/"2조"/"오전"/"오후" 등 교대조 (있으면, 없으면 null)
   - 시트 여러 개에 같은 이름이 반복되면 한 번만 포함
   - [수식] 셀의 값은 이름으로 취급하지 말 것

3. **버스 노선 목록** (중복 제거):
   - routeNumber: **"번" 없이** 숫자/숫자-숫자 (예: "16", "9", "3-2")
   - name: 노선 이름 (예: "16번")

4. **차량 목록** (중복 제거):
   - busNumber: 실제 차량 관리번호 (노선번호나 단순 순번 제외, 예: 2292, 1161)

중요:
- 기사 수가 많아도 **빠짐없이 전부** 추출하세요 (107명이면 107명 모두).
- routeNumber 는 2번(기사)·3번(노선) 모두 "번"을 떼고 숫자만 — 서로 매칭되어야 합니다.

출력 형식 (순수 JSON만):
{
  "companyName": "회사명 또는 null",
  "drivers": [
    {"name": "홍길동", "driverType": "MAIN", "routeNumber": "16", "shiftGroup": "1조", "vehicleNumber": "2292"},
    {"name": "김예비", "driverType": "SPARE", "routeNumber": null, "shiftGroup": null, "vehicleNumber": null}
  ],
  "routes": [
    {"routeNumber": "16", "name": "16번"},
    {"routeNumber": "9", "name": "9번"},
    {"routeNumber": "3-2", "name": "3-2번"}
  ],
  "buses": [
    {"busNumber": "2292"}
  ]
}

엑셀 내용:
${fullContent}`,
    }],
  });

      const raw = (resp.content[0] as { type: string; text: string }).text;
      logger.info(`[onboarding] Claude 응답 길이: ${raw.length}자`);
      return safeParseJson<ClaudeResult>(raw, EMPTY_RESULT);
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number((err as { headers?: Record<string, string> }).headers?.['retry-after']) || 30;
        const waitSec = Math.min(retryAfter, 60);
        logger.warn(`[onboarding] Rate limit 초과, ${waitSec}초 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────
// 엑셀 분석 (AI)
// POST /api/v1/onboarding/analyze-excel
// ─────────────────────────────────────────────────────────────────
export const analyzeExcel = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '파일을 업로드해 주세요.' });
    }

    // ── STEP 1: 엑셀 → 텍스트 변환 ──────────────────────────────
    let sheets: { name: string; text: string; rows: number }[];
    try {
      sheets = parseWorkbook(Buffer.from(req.file.buffer));
    } catch (err) {
      logger.error('[onboarding] 엑셀 읽기 실패', err);
      return res.status(400).json({
        success: false,
        message: '파일을 읽을 수 없습니다. 엑셀(.xlsx, .xls) 파일인지 확인해 주세요.',
      });
    }

    if (sheets.length === 0) {
      return res.status(400).json({ success: false, message: '엑셀 파일에 내용이 없습니다.' });
    }

    // 노선번호 정규화: "16번"·" 16 " → "16".
    const normRoute = (v: unknown): string => String(v ?? '').replace(/번/g, '').trim();

    // ── STEP 2: 표준 템플릿이면 결정론적 파싱 (전화번호·기점/종점·번호판·차종·연식까지 정확히).
    //            아니면 AI 로 폴백.
    let drivers: {
      name: string; employeeId: string; phone: string; driverType: 'MAIN' | 'SPARE';
      routeNumber: string | null; shiftGroup: string | null; vehicleNumber: string | null;
    }[];
    let routes: { routeNumber: string; name: string; startPoint: string; endPoint: string }[];
    let buses: { busNumber: string; plateNumber: string; model: string; year: number | null }[];
    let companyName: string | null = null;

    const tmpl = parseTemplateSheets(Buffer.from(req.file.buffer));
    if (tmpl && (tmpl.drivers.length + tmpl.routes.length + tmpl.buses.length) > 0) {
      logger.info(`[onboarding] 템플릿 파싱: 기사 ${tmpl.drivers.length}명, 노선 ${tmpl.routes.length}개, 버스 ${tmpl.buses.length}대`);
      drivers = tmpl.drivers.map((d, i) => ({
        name: d.name,
        employeeId: `DRV${String(i + 1).padStart(3, '0')}`,
        phone: d.phone || '',
        driverType: d.driverType,
        routeNumber: null, // 표준 템플릿엔 기사↔노선 매핑이 없음 → autoWire 가 배정
        shiftGroup: null,
        vehicleNumber: null,
      }));
      routes = tmpl.routes;
      buses = tmpl.buses;
    } else {
      // 비표준 파일 → AI 분석 폴백
      const result = await analyzeWithClaude(sheets);
      logger.info(`[onboarding] Claude 분석 결과: 기사 ${result.drivers.length}명, 노선 ${result.routes.length}개, 버스 ${result.buses.length}대`);
      companyName = result.companyName;
      const busNumberSet = new Set(result.buses.map((b) => String(b.busNumber ?? '').trim()).filter(Boolean));
      drivers = result.drivers.map((d, i) => {
        const veh = String(d.vehicleNumber ?? '').trim();
        return {
          name: d.name,
          employeeId: `DRV${String(i + 1).padStart(3, '0')}`,
          phone: '',
          driverType: d.driverType,
          routeNumber: d.routeNumber ? normRoute(d.routeNumber) : null,
          shiftGroup: d.shiftGroup ?? null,
          vehicleNumber: veh && busNumberSet.has(veh) ? veh : null,
        };
      });
      routes = result.routes.map((r) => {
        const num = normRoute(r.routeNumber);
        return { routeNumber: num, name: r.name || `${num}번`, startPoint: '', endPoint: '' };
      });
      buses = result.buses.map((b) => ({
        busNumber: String(b.busNumber ?? '').trim(), plateNumber: '', model: '', year: null,
      }));
    }

    // ── STEP 3: 결과 정리 ─────────────────────────────────────────
    const warnings: string[] = [];
    if (drivers.length === 0) warnings.push('기사 정보를 찾지 못했습니다. 수동으로 입력해주세요.');
    if (routes.length === 0) warnings.push('노선 정보를 찾지 못했습니다. 수동으로 입력해주세요.');
    if (buses.length === 0) warnings.push('차량 정보를 찾지 못했습니다. 수동으로 입력해주세요.');

    const dc = drivers, rc = routes, bc = buses;
    const summary = companyName
      ? `${companyName} — 기사 ${dc.length}명, 노선 ${rc.length}개, 버스 ${bc.length}대 발견`
      : `기사 ${dc.length}명, 노선 ${rc.length}개, 버스 ${bc.length}대 발견`;

    return res.json({
      success: true,
      data: { summary, drivers, routes, buses, warnings },
    });
  } catch (error: unknown) {
    logger.error('[onboarding] analyzeExcel 오류', error);
    const status = (error as { status?: number }).status;
    if (status === 429) {
      return res.status(429).json({ success: false, message: 'AI 분석 요청이 너무 많습니다. 1~2분 후 다시 시도해주세요.' });
    }
    return res.status(500).json({ success: false, message: '파일 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// AI 분석 결과 확인 후 DB 저장
// POST /api/v1/onboarding/confirm-import
// ─────────────────────────────────────────────────────────────────
export const confirmImport = async (req: AuthRequest, res: Response) => {
  try {
    const { drivers = [], routes = [], buses = [] } = req.body;
    const companyId = req.user!.companyId;
    const bcrypt = await import('bcryptjs');

    // ── 노선: 기존 확인 후 신규만 일괄 삽입 ──────────────────────
    const routeList = (routes as { routeNumber: string; name: string; startPoint: string; endPoint: string }[])
      .filter(r => r.routeNumber || r.name)
      .map(r => ({ ...r, routeNumber: r.routeNumber || r.name, name: r.name || r.routeNumber }));
    const existingRouteNos = new Set(
      (await prisma.route.findMany({ where: { companyId }, select: { routeNumber: true } }))
        .map(r => r.routeNumber)
    );
    const newRoutes = routeList.filter(r => !existingRouteNos.has(r.routeNumber));
    if (newRoutes.length > 0) {
      await prisma.route.createMany({
        data: newRoutes.map(r => ({
          companyId, routeNumber: r.routeNumber, name: r.name,
          startPoint: r.startPoint || '', endPoint: r.endPoint || '',
        })),
        skipDuplicates: true,
      });
    }

    // ── 버스: 기존 확인 후 신규만 일괄 삽입 ──────────────────────
    const busList = (buses as { busNumber?: string; plateNumber?: string; model?: string; year?: number | null }[])
      .filter(b => b.busNumber || b.plateNumber)
      .map((b, i) => ({ ...b, busNumber: b.busNumber || b.plateNumber || `BUS${String(i + 1).padStart(3, '0')}` }));
    const existingBusNos = new Set(
      (await prisma.bus.findMany({ where: { companyId }, select: { busNumber: true } }))
        .map(b => b.busNumber)
    );
    const newBuses = busList.filter(b => !existingBusNos.has(b.busNumber!));
    if (newBuses.length > 0) {
      await prisma.bus.createMany({
        data: newBuses.map(b => {
          const busNo = b.busNumber!;
          return {
            companyId, busNumber: busNo,
            plateNumber: b.plateNumber || busNo,
            model: b.model || null,
            year: typeof b.year === 'number' ? b.year : null,
          };
        }),
        skipDuplicates: true,
      });
    }

    // ── 기사: 비밀번호 해시 후 일괄 삽입 ─────────────────────────
    type DriverInput = {
      name: string; employeeId?: string; phone?: string; driverType?: string;
      routeNumber?: string | null; shiftGroup?: string | null; vehicleNumber?: string | null;
    };
    // employeeId 는 회사의 기존 최대값 다음부터 새로 부여한다.
    // (엑셀 분석이 매긴 DRV001~ 는 임시 placeholder 라, 재업로드 시 이미 있는 사번과 충돌해
    //  기사가 통째로 누락되던 문제가 있었음 → 항상 새 사번을 발급해 무조건 등록되게 한다.)
    let autoIdCounter = 1;
    const existingMaxId = await prisma.user.findFirst({
      where: { companyId, role: 'DRIVER' },
      orderBy: { employeeId: 'desc' },
      select: { employeeId: true },
    });
    if (existingMaxId?.employeeId) {
      const num = parseInt(existingMaxId.employeeId.replace(/\D/g, ''), 10);
      if (!isNaN(num)) autoIdCounter = num + 1;
    }

    // 중복 제거 기준 = 전화번호(회사 내 앱 로그인 ID = 고유 식별자).
    //   → 동명이인이라도 번호가 다르면 각각 등록되고, 같은 번호(동일인/재업로드)만 제외한다.
    //   (이름으로 제거하면 동명이인이 통째로 누락되므로 사용하지 않는다)
    const existingPhones = new Set(
      (await prisma.user.findMany({ where: { companyId, phone: { not: null } }, select: { phone: true } }))
        .map(u => normalizePhone(u.phone))
        .filter(Boolean)
    );
    // 전화번호가 없는 기사만 이름으로 폴백 중복 제거(번호가 없으면 동명이인을 구분할 방법이 없어 최선).
    const existingDriverNames = new Set(
      (await prisma.user.findMany({ where: { companyId, role: 'DRIVER' }, select: { name: true } }))
        .map(u => u.name)
    );

    const seenPhones = new Set<string>();
    const seenNames = new Set<string>();
    const skippedDup: string[] = [];

    // 새 사번을 동기적으로 먼저 부여 (Promise.all 안에서 카운터를 증가시키면 경쟁상태 발생).
    const driverList = (drivers as DriverInput[])
      .filter(d => {
        if (!d.name) return false;
        const p = normalizePhone(d.phone);
        if (p) {
          // 전화번호가 있으면 전화번호로만 중복 판정 (동명이인 보존)
          if (existingPhones.has(p) || seenPhones.has(p)) { skippedDup.push(d.name); return false; }
          seenPhones.add(p);
          return true;
        }
        // 전화번호 없는 기사: 이름으로 폴백 중복 제거
        if (existingDriverNames.has(d.name) || seenNames.has(d.name)) { skippedDup.push(d.name); return false; }
        seenNames.add(d.name);
        return true;
      })
      .map((d, i) => ({ ...d, employeeId: `DRV${String(autoIdCounter + i).padStart(3, '0')}` }));

    // 전화번호 없는 기사도 "스킵하지 않고" 모두 등록한다. (앱 로그인은 나중에 번호를 채워야 가능)
    // 안내용으로 번호 없는 기사 목록만 따로 모은다.
    const driversWithoutPhone = driverList
      .filter(d => String(d.phone ?? '').replace(/\D/g, '').length < 4)
      .map(d => d.name);

    // 비밀번호 해시 병렬 처리
    // 최초 비밀번호 = 이름(영문 키 입력) + 전화번호 뒷 4자리(번호 없으면 이름만), 최초 로그인 시 변경 강제
    const hashedDrivers = await Promise.all(
      driverList.map(async d => ({
        companyId,
        name: d.name,
        phone: normalizePhone(d.phone) || null,
        employeeId: d.employeeId,
        password: await bcrypt.hash(generateInitialPassword(d.name, d.phone), 10),
        mustChangePassword: true,
        role: 'DRIVER' as const,
        driverType: d.driverType === 'SPARE' ? 'SPARE' as const : 'MAIN' as const,
        shiftGroup: d.shiftGroup || null,
        assignedBusNumber: d.vehicleNumber || null,
      }))
    );
    if (hashedDrivers.length > 0) {
      await prisma.user.createMany({ data: hashedDrivers, skipDuplicates: true });
    }

    // ── 노선 배정: 엑셀에서 추출한 기사-노선 매핑 사용 ──────────
    // MAIN 기사: 엑셀에서 읽은 routeNumber로 배정 (정보 없으면 첫 번째 노선)
    // SPARE 기사: 노선 배정 없음 (어느 노선이든 빈자리에 투입)
    const allRoutes = await prisma.route.findMany({ where: { companyId, isActive: true } });
    const routeByNumber = new Map(allRoutes.map(r => [r.routeNumber, r]));

    // 현재 배정되지 않은 MAIN 기사들만 대상
    const existingAssignments = await prisma.routeAssignment.findMany({
      where: { isActive: true, driver: { companyId } },
      select: { driverId: true },
    });
    const assignedDriverIds = new Set(existingAssignments.map(a => a.driverId));

    const allActiveDrivers = await prisma.user.findMany({
      where: { companyId, role: 'DRIVER', isActive: true, driverType: 'MAIN' },
      select: { id: true, employeeId: true },
    });

    // driverList에서 routeNumber 매핑 (employeeId 기준)
    const routeNumberByEmpId = new Map(
      driverList.map(d => [d.employeeId, d.routeNumber ?? null])
    );

    const today = new Date();
    const assignments: { driverId: number; routeId: number; startDate: Date }[] = [];

    // 노선 정보가 없는 기사는 "첫 노선에 몰아주지 않고" 모든 노선에 라운드로빈으로 골고루 배정한다.
    // (첫 노선에만 쌓이면 나머지 노선은 담당 기사=0 → 크루 없음 → 배차표에서 통째로 빠지는 문제 발생)
    let fallbackRouteIdx = 0;

    for (const driver of allActiveDrivers) {
      if (assignedDriverIds.has(driver.id)) continue; // 이미 배정됨

      const routeNumber = routeNumberByEmpId.get(driver.employeeId);
      let targetRoute = routeNumber ? routeByNumber.get(routeNumber) : undefined;

      // 엑셀에 노선 정보가 없으면 노선 순환 배정 (골고루 분산)
      if (!targetRoute && allRoutes.length > 0) {
        targetRoute = allRoutes[fallbackRouteIdx % allRoutes.length];
        fallbackRouteIdx++;
      }

      if (targetRoute) {
        assignments.push({ driverId: driver.id, routeId: targetRoute.id, startDate: today });
      }
    }

    if (assignments.length > 0) {
      await prisma.routeAssignment.createMany({ data: assignments, skipDuplicates: true });
    }
    logger.info(`[onboarding] 노선 배정 완료: MAIN ${assignments.length}명, SPARE는 배정 없음`);

    // 버스↔노선, 기사↔담당차량(차번) 자동 기본배정 → AI 자동 생성(솔버)이 바로 돌 수 있게.
    // 엑셀에 관계가 없을 때의 기본값이며 관리자가 기초 데이터에서 조정 가능.
    await autoWireBusesAndCrews(companyId);

    const results = {
      routes: newRoutes.length,
      buses: newBuses.length,
      drivers: hashedDrivers.length,
    };

    const baseMsg = `등록 완료! 노선 ${results.routes}개, 버스 ${results.buses}대, 기사 ${results.drivers}명이 등록되었습니다.`;
    const warnMsg = driversWithoutPhone.length > 0
      ? ` (참고: 전화번호가 없는 기사 ${driversWithoutPhone.length}명도 등록됐습니다. 기사 앱 로그인을 하려면 기초 데이터에서 전화번호를 채워주세요.)`
      : '';
    const dupMsg = skippedDup.length > 0
      ? ` (이미 등록된 기사와 전화번호가 중복되어 ${skippedDup.length}명은 제외했습니다: ${skippedDup.join(', ')})`
      : '';

    return res.json({
      success: true,
      data: { ...results, driversWithoutPhone, skippedDup },
      message: baseMsg + warnMsg + dupMsg,
    });
  } catch (error) {
    logger.error('[onboarding] confirmImport 오류', error);
    return res.status(500).json({ success: false, message: '저장 중 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// Excel 템플릿 다운로드
// ─────────────────────────────────────────────────────────────────
export const downloadTemplate = async (_req: AuthRequest, res: Response) => {
  try {
    // 배포된 정적 양식 파일을 그대로 전송한다.
    // assets/ 는 src/·dist/ 와 형제 디렉터리라 개발(src)·운영(dist) 양쪽에서 동일 경로로 해석된다.
    const templatePath = path.resolve(__dirname, '../../assets/Busync_template.xlsx');
    const buffer = await fs.promises.readFile(templatePath);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Busync_template.xlsx');
    return res.send(buffer);
  } catch (error) {
    logger.error('[onboarding] downloadTemplate 오류', error);
    return res.status(500).json({ success: false, message: '템플릿 생성 중 오류가 발생했습니다.' });
  }
};
