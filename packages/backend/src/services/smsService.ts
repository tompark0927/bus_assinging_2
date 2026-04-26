import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';

function makeSignature(apiKey: string, apiSecret: string): { date: string; signature: string } {
  const date = new Date().toISOString();
  const hmac = crypto.createHmac('sha256', apiSecret);
  hmac.update(date);
  hmac.update(apiKey);
  const signature = hmac.digest('base64');
  return { date, signature };
}

export async function sendSms(to: string, text: string): Promise<void> {
  const apiKey = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;
  const from = process.env.COOLSMS_SENDER;
  const devMode = process.env.SMS_DEV_MODE === 'true';

  // 개발 모드: 콘솔 출력
  if (devMode || !apiKey || !apiSecret || !from) {
    logger.info(`[SMS 개발 모드] 수신번호: ${to} | 내용: ${text}`);
    return;
  }

  const { date, signature } = makeSignature(apiKey, apiSecret);

  await axios.post(
    'https://api.coolsms.co.kr/messages/v4/send',
    {
      message: {
        to: to.replace(/-/g, ''),
        from: from.replace(/-/g, ''),
        text,
      },
    },
    {
      headers: {
        Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${apiKey}, signature=${signature}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
