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
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    redis.on('connect', () => logger.info('Redis 연결 성공'));
    redis.on('error', (err) => logger.error('Redis 오류:', err));

    return redis;
  } catch (err) {
    logger.error('Redis 초기화 실패:', err);
    return null;
  }
}
