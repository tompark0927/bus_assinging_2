import jwt from 'jsonwebtoken';

/**
 * 회사 등록 API 는 verifyEmailOtp 가 발급한 `email_verify` 토큰을 요구한다.
 * 통합 테스트에서 OTP 메일 왕복 없이 동일한 토큰을 직접 만들어 쓴다.
 * (registerCompany 컨트롤러가 purpose/email 을 검증하므로 형태를 맞춰야 한다)
 */
export function makeEmailVerifyToken(email: string): string {
  return jwt.sign(
    { email: String(email).trim().toLowerCase(), purpose: 'email_verify' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' },
  );
}

/** 전화번호는 회사와 무관하게 전역 유일 — 테스트마다 겹치지 않는 번호를 만든다. */
export function uniquePhone(): string {
  const n = String(Date.now()).slice(-8);
  return `010-${n.slice(0, 4)}-${n.slice(4)}`;
}
