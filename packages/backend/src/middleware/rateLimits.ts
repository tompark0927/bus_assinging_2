import rateLimit, { type Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedis } from '../config/redis';
import logger from '../utils/logger';

// 'development'에서만 느슨한 제한. 'test'/'production'은 엄격한 실 운영값을 사용해
// rateLimits.test.ts 같은 통합 테스트가 실제 차단 동작을 검증할 수 있도록 한다.
const isDev = process.env.NODE_ENV === 'development';

/**
 * Redis 사용 가능 시 RedisStore 반환, 아니면 undefined (메모리 폴백)
 *
 * ⚠️ prefix 필수: 모든 limiter 가 같은 키(rl:<ip>)를 공유하면 한 limiter 의 카운트가
 * 다른 limiter 까지 오염시킨다. (예: 일반 API 폴링이 login 카운터를 올려 로그인이 막힘)
 * limiter 마다 고유 prefix 를 줘서 카운터를 분리한다.
 */
function createStore(prefix: string): RedisStore | undefined {
  const client = getRedis();
  if (!client) return undefined;

  return new RedisStore({
    prefix,
    // @ts-expect-error ioredis call() returns Promise<unknown>, RedisStore expects Promise<RedisReply>
    sendCommand: (...args: string[]) => client.call(args[0], ...args.slice(1)),
  });
}

function createLimiter(prefix: string, opts: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    // 개발 환경에서는 rate limit 을 적용하지 않는다 (로컬 테스트/스크린샷 작업 편의).
    // 'test'/'production' 은 그대로 엄격하게 동작 → 통합 테스트가 차단을 검증할 수 있음.
    skip: () => isDev,
    store: createStore(prefix),
    ...opts,
  });
}

// 로그인 브루트포스 방지: 15분에 10회 (프로덕션), 개발 100회
export const loginLimiter = createLimiter('rl:login:', {
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 10,
  message: { success: false, message: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.' },
  handler: (req, res, _next, options) => {
    logger.warn('브루트포스 로그인 시도 감지', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
    });
    res.status(429).json(options.message);
  },
});

// OTP 전송 제한: 1분에 1회 (프로덕션), 개발 20회
export const otpSendLimiter = createLimiter('rl:otp:', {
  windowMs: 60 * 1000,
  max: isDev ? 20 : 1,
  message: { success: false, message: '인증번호는 1분에 1번만 요청할 수 있습니다.' },
});

// 회사 등록 제한: 1시간에 5회 (프로덕션), 개발 100회
export const registerLimiter = createLimiter('rl:register:', {
  windowMs: 60 * 60 * 1000,
  max: isDev ? 100 : 5,
  message: { success: false, message: '회사 등록은 1시간에 5회까지 가능합니다.' },
});

// Auth 경로 제한: 15분에 5회 (프로덕션), 개발 200회
export const authLimiter = createLimiter('rl:auth:', {
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 5,
  message: { success: false, message: '인증 요청이 너무 많습니다. 15분 후 다시 시도해주세요.' },
  handler: (req, res, _next, options) => {
    logger.warn('Auth 브루트포스 감지', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
    });
    res.status(429).json(options.message);
  },
});

// 일반 API 경로 제한: 1분에 100회 (프로덕션), 개발 1000회
export const apiLimiter = createLimiter('rl:api:', {
  windowMs: 60 * 1000,
  max: isDev ? 1000 : 100,
  message: { success: false, message: 'API 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

// 파일 업로드 경로 제한: 1분에 10회 (프로덕션), 개발 200회
export const uploadLimiter = createLimiter('rl:upload:', {
  windowMs: 60 * 1000,
  max: isDev ? 200 : 10,
  message: { success: false, message: '파일 업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

// API 전역 제한 (브루트포스 / 무한 폴링 차단용 — 정상 사용은 막지 않는 값)
//   프로덕션: 15분 1500회 (분당 100회 ≈ 어드민 한 명 활발 사용 + 마진)
//   사무실 NAT 뒤 다중 사용자도 안전. 학대 패턴이면 다른 limiter (auth/api/upload)
//   가 더 좁게 잡으므로 여긴 안전 장치 정도.
export const globalLimiter = createLimiter('rl:global:', {
  windowMs: 15 * 60 * 1000,
  max: isDev ? 5000 : 1500,
  message: { success: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
  skip: (req) => req.path === '/health',
});
