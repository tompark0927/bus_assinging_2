import Redis from 'ioredis';
import logger from '../utils/logger';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL 미설정 — 메모리 기반 rate limiting 사용');
    return null;
  }

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      // 연결이 끊긴 상태에서 명령을 쌓아두지 않고 즉시 실패시켜, flushQueue 로 인한
      // 프로세스 크래시를 방지한다. (Redis 는 선택적 — 실패해도 메모리 rate limit 으로 동작)
      enableOfflineQueue: false,
      // 10회 재시도 후 포기 (무한 재연결 폭주 방지). 도달 불가한 Redis 여도 서버는 계속 동작.
      retryStrategy: (times) => (times > 10 ? null : Math.min(times * 200, 3000)),
    });

    redis.on('connect', () => logger.info('Redis 연결 성공'));
    // 에러는 로그만 — 크래시 금지 (index.ts 의 안전망과 함께 이중 방어)
    redis.on('error', (err) => logger.warn('Redis 오류(무시, 메모리 폴백 유지):', (err as Error).message));

    return redis;
  } catch (err) {
    logger.error('Redis 초기화 실패(메모리 폴백):', err);
    return null;
  }
}
