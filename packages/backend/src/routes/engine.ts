import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

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
      init.body = req.body;
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
