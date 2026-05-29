import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import busRoutes from './routes/buses';
import routeRoutes from './routes/routes';
import scheduleRoutes from './routes/schedules';
import dayOffRoutes from './routes/dayoff';
import emergencyRoutes from './routes/emergency';
import notificationRoutes from './routes/notifications';
import chatRoutes from './routes/chat';
import ruleRoutes from './routes/rules';
import maintenanceRoutes from './routes/maintenance';
import contactRoutes from './routes/contacts';
import companyRoutes from './routes/companies';
import attendanceRoutes from './routes/attendance';
import inspectionRoutes from './routes/inspection';
import safetyRoutes from './routes/safety';
import onboardingRoutes from './routes/onboarding';
import postRoutes from './routes/posts';
import dmRoutes from './routes/dm';
import auditRoutes from './routes/audit';
import searchRoutes from './routes/search';
import driverTagRoutes from './routes/driverTags';
import driverPreferenceRoutes from './routes/driverPreferences';
import agentDecisionRoutes from './routes/agentDecisions';
import dailyReportRoutes from './routes/dailyReports';
import errorReportRoutes from './routes/error-report';
import { errorHandler } from './middleware/errorHandler';
import { globalLimiter, apiLimiter, uploadLimiter } from './middleware/rateLimits';
import { sanitizeInput } from './middleware/security';
import logger from './utils/logger';
import { prisma } from './utils/prisma';

const app = express();

// --------------- Proxy 신뢰 ---------------
// Nginx / 로드밸런서 1단계 뒤에 배포되므로 X-Forwarded-* 헤더를 신뢰해
//   - express-rate-limit 가 실제 클라이언트 IP 로 throttle
//   - req.ip 가 nginx 내부 IP 가 아닌 진짜 클라이언트 IP 가 됨
//   - 감사 로그(audit) 의 ipAddress 가 의미있는 값이 됨
// production 외 환경(test/dev)에선 0(비신뢰) 유지해 통합 테스트가 정확한 동작을 검증.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// --------------- CORS ---------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// --------------- Security headers ---------------
//
// CSP 외부 도메인 허용목록 (Sentry, PostHog, Stripe 등 도입 시 사용).
// 코드 변경 없이 환경변수만 추가하면 활성화되도록 directive 별로 분리.
//   CSP_CONNECT_SRC_EXTRA="https://*.sentry.io https://app.posthog.com"
//   CSP_SCRIPT_SRC_EXTRA="https://js.stripe.com"
//   CSP_FRAME_SRC_EXTRA="https://js.stripe.com"
//   CSP_IMG_SRC_EXTRA="https://*.amazonaws.com"
const splitCsp = (key: string): string[] =>
  (process.env[key] || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const cspExtra = {
  connect: splitCsp('CSP_CONNECT_SRC_EXTRA'),
  script: splitCsp('CSP_SCRIPT_SRC_EXTRA'),
  frame: splitCsp('CSP_FRAME_SRC_EXTRA'),
  img: splitCsp('CSP_IMG_SRC_EXTRA'),
};

// HSTS preload 는 한 번 활성화 → hstspreload.org 등록되면 사실상 되돌리기 어렵다.
//   "모든 서브도메인 HTTPS" 가 보장되지 않은 상태에서 켜면 일부 서브도메인 접속 불가.
//   ─ 안전 절차:
//     1) 모든 서브도메인 (api.busync.kr, app.busync.kr ...) 이 valid 인증서 보유 확인
//     2) HSTS_PRELOAD=true 로 배포 후 Chrome DevTools Network → busync.kr 응답 헤더에
//        `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` 보이는지 확인
//     3) https://hstspreload.org 에 busync.kr 등록 (수일 ~ 수주 검증 후 브라우저 반영)
//   기본값(false)은 보수적 — 실수로 1단계 빼먹어도 일부 서브도메인 접속 차단 안됨.
const HSTS_PRELOAD_ENABLED = process.env.HSTS_PRELOAD === 'true';

app.use(helmet({
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: HSTS_PRELOAD_ENABLED,
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...cspExtra.script],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', ...cspExtra.img],
      connectSrc: ["'self'", ...cspExtra.connect],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", ...cspExtra.frame],
      frameAncestors: ["'none'"],
    },
  },
  frameguard: { action: 'deny' },       // X-Frame-Options: DENY
  noSniff: true,                          // X-Content-Type-Options: nosniff
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// --------------- Global rate limiting ---------------
app.use(globalLimiter);

// --------------- HTTP request logging ---------------
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === '/health',
}));

// --------------- 기본 헬스체크 (로드밸런서용) ---------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), memory: process.memoryUsage() });
});

// --------------- API v1 Routes ---------------
const v1 = express.Router();

// 상세 헬스체크 (DB 연결 포함) — 모니터링 서비스용
v1.get('/health', async (_req, res) => {
  const mem = process.memoryUsage();
  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
    logger.error('[health] DB 연결 실패');
  }
  const status = dbStatus === 'ok' ? 'ok' : 'degraded';
  res.status(dbStatus === 'ok' ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: { heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024), rssМB: Math.round(mem.rss / 1024 / 1024) },
    db: dbStatus,
  });
});

// --- Auth routes: strict body size + 일반 API rate limit ---
// 라우터 전체에 strict limiter 를 걸면 /auth/me·/auth/refresh 같은 빈번한 호출까지
// 카운트되어 정상 사용자가 막힌다. 무차별 대입 방지는 민감 엔드포인트(/login, /register,
// /phone/send-otp)에 붙은 전용 limiter(loginLimiter/registerLimiter/otpSendLimiter)가 담당.
v1.use('/auth', express.json({ limit: '16kb' }), apiLimiter, sanitizeInput, authRoutes);
v1.use('/companies', express.json({ limit: '16kb' }), apiLimiter, sanitizeInput, companyRoutes);

// --- File upload routes: larger body size + upload rate limit ---
// Note: multer handles multipart parsing, so express.json is only for non-file endpoints in these routers
v1.use('/inspection', express.json({ limit: '20mb' }), uploadLimiter, sanitizeInput, inspectionRoutes);
v1.use('/safety', express.json({ limit: '20mb' }), uploadLimiter, sanitizeInput, safetyRoutes);
v1.use('/maintenance', express.json({ limit: '20mb' }), uploadLimiter, sanitizeInput, maintenanceRoutes);
v1.use('/onboarding', uploadLimiter, sanitizeInput, onboardingRoutes);

// --- Standard API routes: normal body size + api rate limit ---
const standardApiBody = express.json({ limit: '1mb' });

v1.use('/users', standardApiBody, apiLimiter, sanitizeInput, userRoutes);
v1.use('/buses', standardApiBody, apiLimiter, sanitizeInput, busRoutes);
v1.use('/routes', standardApiBody, apiLimiter, sanitizeInput, routeRoutes);
v1.use('/schedules', standardApiBody, apiLimiter, sanitizeInput, scheduleRoutes);
v1.use('/dayoff', standardApiBody, apiLimiter, sanitizeInput, dayOffRoutes);
v1.use('/emergency', standardApiBody, apiLimiter, sanitizeInput, emergencyRoutes);
v1.use('/notifications', standardApiBody, apiLimiter, sanitizeInput, notificationRoutes);
v1.use('/chat', standardApiBody, apiLimiter, sanitizeInput, chatRoutes);
v1.use('/rules', standardApiBody, apiLimiter, sanitizeInput, ruleRoutes);
v1.use('/contacts', standardApiBody, apiLimiter, sanitizeInput, contactRoutes);
v1.use('/attendance', standardApiBody, apiLimiter, sanitizeInput, attendanceRoutes);
// onboarding mounted above with upload routes (multer needs no express.json)
v1.use('/posts', standardApiBody, apiLimiter, sanitizeInput, postRoutes);
v1.use('/dm', standardApiBody, apiLimiter, sanitizeInput, dmRoutes);
v1.use('/audit-logs', standardApiBody, apiLimiter, sanitizeInput, auditRoutes);
v1.use('/search', standardApiBody, apiLimiter, sanitizeInput, searchRoutes);
v1.use('/driver-tags', standardApiBody, apiLimiter, sanitizeInput, driverTagRoutes);
v1.use('/driver-preferences', standardApiBody, apiLimiter, sanitizeInput, driverPreferenceRoutes);
v1.use('/agents', standardApiBody, apiLimiter, sanitizeInput, agentDecisionRoutes);
v1.use('/daily-reports', standardApiBody, apiLimiter, sanitizeInput, dailyReportRoutes);

// --- Error report: no auth required, small body, own rate limit ---
v1.use('/error-report', express.json({ limit: '16kb' }), sanitizeInput, errorReportRoutes);

// URL-encoded body for form submissions
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api/v1', v1);
// Backward-compat: legacy /api/* → same handlers (앱스토어 구버전 앱 지원)
app.use('/api', v1);

// --------------- Swagger API 문서 ---------------
// 프로덕션에선 비공개 (API 표면 enumeration · 자격증명 예시 노출 방지)
//   필요 시 ENABLE_SWAGGER=true 로 명시 활성화 가능
const swaggerEnabled =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true';
if (swaggerEnabled) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Error handler (must be last)
app.use(errorHandler);

export default app;
