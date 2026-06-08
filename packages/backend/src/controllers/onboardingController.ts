import { Response } from 'express';
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

    // ── STEP 2: Claude에게 전체 분석 요청 ────────────────────────
    const result = await analyzeWithClaude(sheets);

    logger.info(`[onboarding] Claude 분석 결과: 기사 ${result.drivers.length}명, 노선 ${result.routes.length}개, 버스 ${result.buses.length}대`);

    // ── STEP 3: 결과 정리 ─────────────────────────────────────────
    const warnings: string[] = [];
    if (result.drivers.length === 0) warnings.push('기사 정보를 찾지 못했습니다. 수동으로 입력해주세요.');
    if (result.routes.length === 0) warnings.push('노선 정보를 찾지 못했습니다. 수동으로 입력해주세요.');
    if (result.buses.length === 0) warnings.push('차량 정보를 찾지 못했습니다. 수동으로 입력해주세요.');

    // 노선번호 정규화: "16번"·" 16 " → "16". 기사 routeNumber 와 노선 routeNumber 가
    // 같은 형식이어야 confirmImport 에서 매칭됨.
    const normRoute = (v: unknown): string => String(v ?? '').replace(/번/g, '').trim();

    // 추출된 차량번호 집합 (기사 vehicleNumber 검증용)
    const busNumberSet = new Set(result.buses.map(b => String(b.busNumber ?? '').trim()).filter(Boolean));

    // 기사에 사원번호 부여 + 정규화 + 차량번호 검증
    const drivers = result.drivers.map((d, i) => {
      const veh = String(d.vehicleNumber ?? '').trim();
      return {
        name: d.name,
        employeeId: `DRV${String(i + 1).padStart(3, '0')}`,
        phone: '',
        driverType: d.driverType,
        routeNumber: d.routeNumber ? normRoute(d.routeNumber) : null,
        shiftGroup: d.shiftGroup ?? null,
        // 실제 버스 목록에 있는 차번만 인정 (오매칭 차번은 버려 autoWire 가 재배정하게 함)
        vehicleNumber: veh && busNumberSet.has(veh) ? veh : null,
      };
    });

    const routes = result.routes.map(r => {
      const num = normRoute(r.routeNumber);
      return {
        routeNumber: num,
        name: r.name || `${num}번`,
        startPoint: '',
        endPoint: '',
      };
    });

    const buses = result.buses.map(b => ({
      busNumber: String(b.busNumber ?? '').trim(),
      plateNumber: '',
      model: '',
    }));

    const { drivers: dc, routes: rc, buses: bc } = { drivers, routes, buses };
    const summary = result.companyName
      ? `${result.companyName} — 기사 ${dc.length}명, 노선 ${rc.length}개, 버스 ${bc.length}대 발견`
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
    const busList = (buses as { busNumber?: string; plateNumber?: string; model?: string }[])
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
          return { companyId, busNumber: busNo, plateNumber: b.plateNumber || busNo, model: b.model || null };
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

    // 이미 등록된 같은 이름의 기사는 제외 (재업로드 시 중복 생성 방지).
    // 분석 단계에서 이미 이름 기준 중복 제거가 되므로 한 파일 내 동명이인 손실 위험은 없음.
    const existingNames = new Set(
      (await prisma.user.findMany({ where: { companyId, role: 'DRIVER' }, select: { name: true } }))
        .map(u => u.name)
    );

    // 새 사번을 동기적으로 먼저 부여 (Promise.all 안에서 카운터를 증가시키면 경쟁상태 발생).
    const driverList = (drivers as DriverInput[])
      .filter(d => d.name && !existingNames.has(d.name))
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

    for (const driver of allActiveDrivers) {
      if (assignedDriverIds.has(driver.id)) continue; // 이미 배정됨

      const routeNumber = routeNumberByEmpId.get(driver.employeeId);
      let targetRoute = routeNumber ? routeByNumber.get(routeNumber) : undefined;

      // 엑셀에 노선 정보 없으면 첫 번째 노선으로 fallback (단, 노선이 존재할 때만)
      if (!targetRoute && allRoutes.length > 0) {
        targetRoute = allRoutes[0];
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

    return res.json({
      success: true,
      data: { ...results, driversWithoutPhone },
      message: baseMsg + warnMsg,
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
    const wb = XLSX.utils.book_new();

    /* ────────────────────────────────────────
       시트 0: 안내 (Read me)
       ──────────────────────────────────────── */
    const guideData: (string | number)[][] = [
      ['Busync 등록 양식'],
      [],
      ['이 파일을 채워서 업로드하시면 AI가 자동으로 데이터를 읽어 등록합니다.'],
      ['빈 셀은 그대로 두셔도 됩니다 — 필수 항목만 채워주세요.'],
      [],
      ['시트 구성'],
      ['1) 기사 명단 — 운행할 기사 정보'],
      ['2) 노선 — 운행 노선 정보'],
      ['3) 버스 — 보유 차량 정보'],
      [],
      ['필수 항목'],
      ['• 기사: 이름, 전화번호 (전화번호 없으면 등록되지 않습니다)'],
      ['• 노선: 노선번호, 노선명'],
      ['• 버스: 버스번호'],
      [],
      ['형식 안내'],
      ['• 전화번호: 010-1234-5678 (하이픈 권장) — 기사 앱 로그인 ID로 사용'],
      ['• 기사 유형: "정규" 또는 "예비"'],
      [],
      ['기사 최초 비밀번호'],
      ['• "이름을 영문 키보드로 친 글자 + 전화번호 뒷 4자리"'],
      ['• 예) 최진호 / 010-1234-6788 → chlwlsgh6788'],
      ['• 기사 앱 최초 로그인 시 비밀번호 변경이 강제됩니다 (보안)'],
    ];
    const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
    wsGuide['!cols'] = [{ wch: 90 }];
    // 제목/섹션 셀 강조
    const titleRows = [0, 5, 10, 15, 19];
    titleRows.forEach((r) => {
      const cell = wsGuide[XLSX.utils.encode_cell({ r, c: 0 })];
      if (cell) {
        cell.s = {
          font: { bold: true, sz: r === 0 ? 14 : 12, color: { rgb: '1D4ED8' } },
        };
      }
    });
    XLSX.utils.book_append_sheet(wb, wsGuide, '안내');

    /* ────────────────────────────────────────
       시트 1: 기사 명단 (10개 예시)
       ──────────────────────────────────────── */
    const driversData = [
      ['이름', '전화번호', '유형(정규/예비)'],
      ['김민수', '010-1234-5678', '정규'],
      ['이지훈', '010-2345-6789', '정규'],
      ['박상철', '010-3456-7890', '정규'],
      ['최영호', '010-4567-8901', '정규'],
      ['정대현', '010-5678-9012', '정규'],
      ['강병철', '010-6789-0123', '정규'],
      ['윤성민', '010-7890-1234', '정규'],
      ['장재호', '010-8901-2345', '예비'],
      ['임동욱', '010-9012-3456', '예비'],
      ['오현석', '010-0123-4567', '예비'],
    ];
    const wsDrivers = XLSX.utils.aoa_to_sheet(driversData);
    wsDrivers['!cols'] = [
      { wch: 10 },
      { wch: 16 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDrivers, '기사 명단');

    /* ────────────────────────────────────────
       시트 2: 노선 (5개 예시)
       ──────────────────────────────────────── */
    const routesData = [
      ['노선번호', '노선명', '출발지', '도착지'],
      ['100', '인천 직행', '인천터미널', '부평역'],
      ['200', '시내 순환', '부평역', '구월동'],
      ['300', '서울 광역', '부평역', '서울역'],
      ['400', '공항 셔틀', '인천터미널', '인천공항'],
      ['500', '학교 지원', '구월동', '인하대학교'],
    ];
    const wsRoutes = XLSX.utils.aoa_to_sheet(routesData);
    wsRoutes['!cols'] = [
      { wch: 10 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, wsRoutes, '노선');

    /* ────────────────────────────────────────
       시트 3: 버스 (5대 예시)
       ──────────────────────────────────────── */
    const busesData = [
      ['버스번호', '차량번호(번호판)', '차종', '연식'],
      ['B001', '인천 70 가 1234', '현대 유니버스', 2022],
      ['B002', '인천 70 가 5678', '현대 유니버스', 2023],
      ['B003', '인천 70 나 1111', '기아 그랜버드', 2021],
      ['B004', '인천 70 나 2222', '기아 그랜버드', 2024],
      ['B005', '인천 70 다 3333', '대우 BX212', 2020],
    ];
    const wsBuses = XLSX.utils.aoa_to_sheet(busesData);
    wsBuses['!cols'] = [
      { wch: 10 },
      { wch: 20 },
      { wch: 18 },
      { wch: 8 },
    ];
    XLSX.utils.book_append_sheet(wb, wsBuses, '버스');

    /* ── 헤더 행 강조 (모든 데이터 시트) ── */
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
    [
      { ws: wsDrivers, cols: 3 },
      { ws: wsRoutes, cols: 4 },
      { ws: wsBuses, cols: 4 },
    ].forEach(({ ws, cols }) => {
      for (let c = 0; c < cols; c++) {
        const ref = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[ref]) ws[ref].s = headerStyle;
      }
      // 첫 행 약간 높게
      if (!ws['!rows']) ws['!rows'] = [];
      ws['!rows'][0] = { hpt: 22 };
    });

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Busync_template.xlsx');
    return res.send(buffer);
  } catch (error) {
    logger.error('[onboarding] downloadTemplate 오류', error);
    return res.status(500).json({ success: false, message: '템플릿 생성 중 오류가 발생했습니다.' });
  }
};
