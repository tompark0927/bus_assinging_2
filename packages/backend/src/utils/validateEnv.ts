import logger from './logger';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ANTHROPIC_API_KEY',
] as const;

const WARNINGS = [
  'COOLSMS_API_KEY',
  'KAKAO_CLIENT_ID',
] as const;

export function validateEnv(): void {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    logger.error(`필수 환경변수가 설정되지 않았습니다: ${missing.join(', ')}`);
    logger.error('.env.example 파일을 참고해서 .env 파일을 설정해주세요.');
    process.exit(1);
  }

  // JWT_SECRET 강도 검증
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    logger.error('JWT_SECRET은 32자 이상이어야 합니다. 보안 위협이 있습니다.');
    process.exit(1);
  }
  if (['secret', 'password', '12345678', 'jwt_secret'].includes(jwtSecret.toLowerCase())) {
    logger.error('JWT_SECRET이 너무 단순합니다. 강력한 랜덤 문자열로 변경하세요.');
    process.exit(1);
  }

  // 선택적 환경변수 경고
  for (const key of WARNINGS) {
    if (!process.env[key]) {
      logger.warn(`선택적 환경변수 미설정: ${key} (관련 기능이 작동하지 않습니다)`);
    }
  }

  logger.info('✅ 환경변수 검증 완료');
}
