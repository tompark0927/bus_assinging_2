import logger from '../utils/logger';

/**
 * 이메일 발송 (Resend HTTP API).
 *
 * SMTP(포트 587)를 쓰지 않고 HTTPS API 로 발송한다 → Railway 등 아웃바운드 SMTP 를
 * 차단하는 호스팅에서도 정상 동작 (기존 nodemailer/SMTP 는 프로덕션에서 무한 행 발생).
 *
 *   - EMAIL_DEV_MODE=true 이거나 RESEND_API_KEY 미설정 → 실제 발송 대신 콘솔 출력 (개발용)
 *   - 그 외 → Resend API 로 실제 발송
 *
 * 필요한 환경변수:
 *   RESEND_API_KEY   Resend 대시보드에서 발급한 API 키
 *   EMAIL_FROM       발신 주소 (예: "Busync <no-reply@yourdomain.com>").
 *                    ⚠️ Resend 에서 도메인을 인증해야 발신 가능. 테스트용으로는
 *                    'onboarding@resend.dev' 를 쓸 수 있으나 수신처가 제한된다.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 15_000;

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<void> {
  const devMode = process.env.EMAIL_DEV_MODE === 'true';
  const apiKey = process.env.RESEND_API_KEY;

  // 개발 모드 또는 API 키 미설정: 콘솔에만 출력 (SMS 개발 모드와 동일한 패턴)
  if (devMode || !apiKey) {
    logger.info(`[EMAIL 개발 모드] 수신: ${to} | 제목: ${subject}\n${text || html.replace(/<[^>]+>/g, ' ')}`);
    return;
  }

  const from = process.env.EMAIL_FROM || 'Busync <onboarding@resend.dev>';

  // 절대 무한 대기하지 않도록 타임아웃 — 실패해도 요청이 15초 내 반환된다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, text }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Resend 발송 실패 (${resp.status}): ${detail}`);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Resend 발송 타임아웃 (${SEND_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

/** 회사 코드 찾기 이메일 본문 — 가입된 회사(들)의 코드를 안내 */
export function companyCodeFoundEmailHtml(companies: { name: string; code: string }[]): string {
  const rows = companies
    .map(
      (c) => `
      <div style="background:#f3f4f6;border-radius:12px;padding:16px 20px;margin-bottom:12px">
        <div style="font-size:13px;color:#6b7280;margin-bottom:6px">${c.name}</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:5px;color:#2563eb">${c.code}</div>
      </div>`,
    )
    .join('');
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827">
      <h2 style="margin:0 0 8px;font-size:20px">Busync 회사 코드 안내</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px">입력하신 이메일로 가입된 회사 코드입니다. 로그인 시 이 코드가 필요합니다.</p>
      ${rows}
      <p style="margin:8px 0 0;color:#9ca3af;font-size:13px">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
    </div>
  `;
}

/** 회사 코드 안내 이메일 본문 — 회원가입 완료 시 발송 */
export function companyCodeEmailHtml(companyName: string, companyCode: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827">
      <h2 style="margin:0 0 8px;font-size:20px">Busync 가입을 환영합니다</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px"><strong>${companyName}</strong>의 회사 코드가 발급되었습니다. 로그인 시 이 코드가 필요합니다.</p>
      <div style="background:#f3f4f6;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
        <div style="font-size:13px;color:#6b7280;margin-bottom:6px">회사 코드</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb">${companyCode}</div>
      </div>
      <p style="margin:0 0 8px;color:#6b7280;font-size:14px">기사님들도 모바일 앱 로그인 시 이 회사 코드를 사용합니다. 소속 기사님들께 공유해주세요.</p>
      <p style="margin:0;color:#9ca3af;font-size:13px">본인이 가입하지 않았다면 이 메일을 무시하세요.</p>
    </div>
  `;
}
