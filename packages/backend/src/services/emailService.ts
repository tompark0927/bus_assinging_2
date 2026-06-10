import nodemailer, { type Transporter } from 'nodemailer';
import logger from '../utils/logger';

/**
 * 이메일 발송 (nodemailer / SMTP).
 *
 *   - EMAIL_DEV_MODE=true 이거나 SMTP 설정이 없으면 → 실제 발송 대신 콘솔에 출력 (개발용)
 *   - 그 외 → SMTP 로 실제 발송
 *
 * 필요한 환경변수:
 *   SMTP_HOST, SMTP_PORT(기본 587), SMTP_USER, SMTP_PASS, SMTP_FROM(없으면 SMTP_USER)
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SMTPS, 그 외(587 등) = STARTTLS
    auth: { user, pass },
  });
  return transporter;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<void> {
  const devMode = process.env.EMAIL_DEV_MODE === 'true';
  const t = getTransporter();

  // 개발 모드 또는 SMTP 미설정: 콘솔에만 출력 (SMS 개발 모드와 동일한 패턴)
  if (devMode || !t) {
    logger.info(`[EMAIL 개발 모드] 수신: ${to} | 제목: ${subject}\n${text || html.replace(/<[^>]+>/g, ' ')}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  await t.sendMail({ from, to, subject, html, text });
}

/** 인증번호(OTP) 이메일 본문 — 비밀번호 재설정용 */
export function otpEmailHtml(otp: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827">
      <h2 style="margin:0 0 8px;font-size:20px">Busync 비밀번호 재설정</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px">아래 인증번호를 입력해 비밀번호를 재설정하세요.</p>
      <div style="background:#f3f4f6;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2563eb">${otp}</div>
      </div>
      <p style="margin:0;color:#9ca3af;font-size:13px">인증번호는 5분간 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
    </div>
  `;
}
