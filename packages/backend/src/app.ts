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
import payrollRoutes from './routes/payroll';
import inspectionRoutes from './routes/inspection';
import safetyRoutes from './routes/safety';
import onboardingRoutes from './routes/onboarding';
import approvalRoutes from './routes/approvals';
import postRoutes from './routes/posts';
import dmRoutes from './routes/dm';
import auditRoutes from './routes/audit';
import searchRoutes from './routes/search';
import driverTagRoutes from './routes/driverTags';
import driverPreferenceRoutes from './routes/driverPreferences';
import goldenTicketRoutes from './routes/goldenTickets';
import agentDecisionRoutes from './routes/agentDecisions';
import dailyReportRoutes from './routes/dailyReports';
import errorReportRoutes from './routes/error-report';
import { errorHandler } from './middleware/errorHandler';
import { globalLimiter, authLimiter, apiLimiter, uploadLimiter } from './middleware/rateLimits';
import { sanitizeInput } from './middleware/security';
import logger from './utils/logger';
import { prisma } from './utils/prisma';

const app = express();

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
app.use(helmet({
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
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

// --- Auth routes: strict body size + rate limit ---
v1.use('/auth', express.json({ limit: '16kb' }), authLimiter, sanitizeInput, authRoutes);
v1.use('/companies', express.json({ limit: '16kb' }), authLimiter, sanitizeInput, companyRoutes);

// --- File upload routes: larger body size + upload rate limit ---
// Note: multer handles multipart parsing, so express.json is only for non-file endpoints in these routers
v1.use('/inspection', express.json({ limit: '20mb' }), uploadLimiter, sanitizeInput, inspectionRoutes);
v1.use('/safety', express.json({ limit: '20mb' }), uploadLimiter, sanitizeInput, safetyRoutes);
v1.use('/maintenance', express.json({ limit: '20mb' }), uploadLimiter, sanitizeInput, maintenanceRoutes);
v1.use('/onboarding', uploadLimiter, sanitizeInput, onboardingRoutes);
v1.use('/payroll', uploadLimiter, sanitizeInput, payrollRoutes);

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
// payroll & onboarding mounted above with upload routes (multer needs no express.json)
v1.use('/approvals', standardApiBody, apiLimiter, sanitizeInput, approvalRoutes);
v1.use('/posts', standardApiBody, apiLimiter, sanitizeInput, postRoutes);
v1.use('/dm', standardApiBody, apiLimiter, sanitizeInput, dmRoutes);
v1.use('/audit-logs', standardApiBody, apiLimiter, sanitizeInput, auditRoutes);
v1.use('/search', standardApiBody, apiLimiter, sanitizeInput, searchRoutes);
v1.use('/driver-tags', standardApiBody, apiLimiter, sanitizeInput, driverTagRoutes);
v1.use('/driver-preferences', standardApiBody, apiLimiter, sanitizeInput, driverPreferenceRoutes);
v1.use('/golden-tickets', standardApiBody, apiLimiter, sanitizeInput, goldenTicketRoutes);
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
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Error handler (must be last)
app.use(errorHandler);

export default app;
