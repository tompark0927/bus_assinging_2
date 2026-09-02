import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { loadCompanyPolicy } from '../services/solverDispatchService';
import { mergeEnginePolicy } from '../services/enginePolicyMapper';
import { loadEnginePolicy } from '../services/enginePolicyStore';
import { prisma } from '../utils/prisma';
import {
  multipartBoundary,
  readFormField,
  hasFormField,
  formPart,
} from '../utils/multipartForm';

/**
 * Python 배차 엔진(dispatch-engine, FastAPI) 프록시.
 *
 * OR-Tools CP-SAT 솔버가 Python 전용이라 엔진은 별도 프로세스
 * (`packages/dispatch-engine`, uvicorn 포트 8100)로 뜨고, 이 라우트가
 * 인증·권한 검사 후 그대로 전달한다.
 *
 * ENGINE_URL 미설정 시 503 — 엔진 없이도 백엔드는 정상 기동한다 (기존
 * TS 솔버 monthly-grid-solver 경로는 이 라우트와 무관하게 계속 동작).
 *
 * 엔진 엔드포인트 (전부 POST/GET 패스스루):
 *   GET  /catalog                 설정 카탈로그
 *   POST /analyze                 엑셀 업로드 → 규칙 감지 + 설정 추천
 *   POST /backtest                과거 월 재현 검증
 *   POST /generate                월 배차 초안 생성
 *   GET  /draft/:id/explain       셀 배정 근거
 *   GET  /draft/:id/explain-driver 기사 월간 설명
 *   POST /draft/:id/absence       당일 결원 → 대체 후보 추천
 *   POST /draft/:id/repair        대체 확정
 *   POST /leave/triage            휴무신청 자동 분류
 *   GET  /leave/annual            연차 자동계산
 */
const router = Router();
const ENGINE_URL = process.env.ENGINE_URL; // 예: http://localhost:8100

router.use(authenticate);
// 배차 생성·수리·백테스트는 배차 담당 이상만
router.use(requireRole('DISPATCH'));

/**
 * 회사 컨텍스트(정책 + 승인 휴무)를 엔진 요청에 실어 보낸다.
 *
 * 정책의 단일 소스는 DB 다 — 운영 정책(Company.policy) + 엔진 튜닝
 * (Company.enginePolicy)을 합쳐 요청마다 실어 보낸다. 엔진은 저장소를 갖지
 * 않는 stateless 계산기이고, policy_json 이 비어 있을 때만 자기 파일을 본다
 * (구버전 호환 경로).
 *
 * express.raw 로 받은 multipart 바디를 다시 파싱하지 않고, 맨 앞에 파트를
 * 하나 덧붙인다 (파트 순서는 의미가 없다). 파일 파트는 손대지 않는다.
 */
const POLICY_INJECT_PATHS = ['/generate', '/inspect'];

/**
 * 승인된 휴무를 엔진에 넘긴다 (`leaves_json` = {기사명: [날짜...]}).
 *
 * 이걸 안 보내면 엔진은 휴무를 모르는 채로 짜고, 담당자는 발행 직전에야
 * E5(승인 휴무일 배정)로 알게 된다 — 그때 고치는 건 사람 손이다.
 * 생성 단계에서 막는 게 맞다.
 *
 * 동명이인은 제외한다. 엔진은 이름을 키로 쓰기 때문에, 같은 이름 두 사람의
 * 휴무를 합치면 **일하기로 된 사람까지 빠져** 공석이 생긴다. 이름을 구분한
 * 뒤에야 반영된다 (배차 저장 경로의 동명이인 정책과 같은 판단).
 */
export async function approvedLeavesByName(
  companyId: number,
  year: number,
  month: number,
): Promise<Record<string, string[]>> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const offs = await prisma.dayOffRequest.findMany({
    where: { companyId, status: 'APPROVED', date: { gte: from, lt: to } },
    select: { date: true, driver: { select: { name: true } } },
  });
  if (offs.length === 0) return {};

  const names = [...new Set(offs.map((o) => o.driver.name))];
  const dupes = await prisma.user.groupBy({
    by: ['name'],
    where: { companyId, role: 'DRIVER', name: { in: names } },
    having: { name: { _count: { gt: 1 } } },
  });
  const ambiguous = new Set(dupes.map((d) => d.name));

  const out: Record<string, string[]> = {};
  for (const o of offs) {
    const name = o.driver.name;
    if (ambiguous.has(name)) continue;
    (out[name] ??= []).push(o.date.toISOString().slice(0, 10));
  }
  if (ambiguous.size) {
    logger.warn(
      `[engine-proxy] 동명이인 ${[...ambiguous].join(', ')} 의 승인 휴무는 엔진에 전달하지 않음 ` +
        '(이름 키라 다른 사람까지 빠질 수 있음)',
    );
  }
  return out;
}

async function injectCompanyContext(
  body: Buffer,
  contentType: string | undefined,
  companyId: number,
  path: string,
): Promise<Buffer> {
  const boundary = multipartBoundary(contentType);
  if (!boundary) return body;

  const parts: Buffer[] = [];

  // ── 정책 (운영 정책 + 엔진 튜닝) ──
  // 이미 담당자가 policy_json 을 직접 실어 보냈으면 존중한다
  if (!hasFormField(body, 'policy_json')) {
    const [saved, companyPolicy] = await Promise.all([
      loadEnginePolicy(companyId),   // 엔진 튜닝 (DB)
      loadCompanyPolicy(companyId),  // 운영 정책 (DB)
    ]);
    parts.push(formPart(boundary, 'policy_json', JSON.stringify(mergeEnginePolicy(saved, companyPolicy))));
  }

  // ── 승인 휴무 (생성에만 해당 — /inspect 는 받지 않는다) ──
  if (path.startsWith('/generate') && !hasFormField(body, 'leaves_json')) {
    const year = Number(readFormField(body, 'year'));
    const month = Number(readFormField(body, 'month'));
    if (Number.isInteger(year) && month >= 1 && month <= 12) {
      const leaves = await approvedLeavesByName(companyId, year, month);
      if (Object.keys(leaves).length > 0) {
        parts.push(formPart(boundary, 'leaves_json', JSON.stringify(leaves)));
      }
    } else {
      logger.warn('[engine-proxy] year/month 를 읽지 못해 승인 휴무를 전달하지 못했습니다');
    }
  }

  return parts.length ? Buffer.concat([...parts, body]) : body;
}

async function proxy(req: AuthRequest, res: Response) {
  if (!ENGINE_URL) {
    return res.status(503).json({
      error: '배차 엔진이 설정되지 않았습니다 (ENGINE_URL 미설정)',
    });
  }
  // /api/engine/... -> ENGINE_URL/...
  const path = req.originalUrl.replace(/^.*\/engine/, '');
  const url = `${ENGINE_URL}${path}`;
  try {
    const headers: Record<string, string> = {};
    const contentType = req.headers['content-type'];
    if (contentType) headers['content-type'] = contentType;
    // 회사별 정책·초안 격리: 인증된 companyId를 엔진에 전달
    if (req.user?.companyId) headers['x-company-id'] = String(req.user.companyId);

    const init: RequestInit = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // 파일 업로드(multipart) 포함 원본 바디 그대로 전달
      let body = req.body as Buffer | undefined;
      // 생성·검산은 회사 배차 설정(+승인 휴무)을 함께 실어 보낸다
      if (
        Buffer.isBuffer(body) &&
        req.user?.companyId &&
        POLICY_INJECT_PATHS.some((p) => path.startsWith(p))
      ) {
        try {
          body = await injectCompanyContext(body, contentType, req.user.companyId, path);
        } catch (err) {
          // 정책 주입 실패로 생성 자체를 막지는 않는다 — 엔진 저장 정책으로 진행
          logger.warn(
            `[engine-proxy] 회사 컨텍스트 주입 실패, 엔진 저장 정책으로 진행: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      init.body = body;
      // Node fetch가 스트림/버퍼 바디에 요구
      (init as { duplex?: string }).duplex = 'half';
    }
    const upstream = await fetch(url, init);
    const body = Buffer.from(await upstream.arrayBuffer());
    res
      .status(upstream.status)
      .set('content-type', upstream.headers.get('content-type') ?? 'application/json')
      .send(body);
  } catch (err) {
    // 502는 "주소는 있는데 닿지 않는다" — 원인 대부분이 배포 설정이라
    // 화면에서 바로 짚을 수 있게 실제 사유를 함께 내려준다.
    const cause = err instanceof Error ? err.message : String(err);
    logger.error(`[engine-proxy] ${req.method} ${url} 실패: ${cause}`);
    res.status(502).json({
      error: '배차 엔진에 연결하지 못했습니다',
      message:
        `엔진(${ENGINE_URL}) 연결 실패: ${cause}. ` +
        '엔진 서비스가 실행 중인지, ENGINE_URL의 서비스 이름·포트가 맞는지 확인해 주세요.',
      hint: cause,
    });
  }
}

/**
 * 엔진 연결 진단 — 배포 문제를 화면에서 바로 확인하기 위한 경로.
 * 프록시와 같은 인증을 거치며, 엔진 /health 응답을 그대로 전달한다.
 */
router.get('/_diagnose', async (_req: AuthRequest, res: Response) => {
  if (!ENGINE_URL) {
    return res.status(503).json({
      ok: false, engineUrl: null,
      message: 'ENGINE_URL 이 설정되지 않았습니다 (백엔드 환경변수).',
    });
  }
  const started = Date.now();
  try {
    const r = await fetch(`${ENGINE_URL}/health`);
    return res.json({
      ok: r.ok, engineUrl: ENGINE_URL, status: r.status,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return res.status(502).json({
      ok: false, engineUrl: ENGINE_URL, error: cause,
      elapsedMs: Date.now() - started,
      message:
        'Railway 사설망은 IPv6 전용입니다 — 엔진이 `--host ::` 로 떠 있는지, ' +
        '서비스 이름과 포트(8100)가 ENGINE_URL과 일치하는지 확인해 주세요.',
    });
  }
});

// 모든 하위 경로 패스스루 (엔진 쪽에서 라우팅)
router.all(/.*/, proxy);

export default router;
