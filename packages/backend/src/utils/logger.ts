import winston from 'winston';
import TransportStream from 'winston-transport';
import type { TransportStreamOptions } from 'winston-transport';
import https from 'https';
import { URL } from 'url';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${timestamp} [${level}] ${stack || message}${metaStr}`;
});

// ─── Slack 웹훅 커스텀 Transport ───────────────────────────────────
// SLACK_ALERT_WEBHOOK 환경변수 설정 시 error 레벨 로그를 Slack으로 전송
class SlackTransport extends TransportStream {
  private webhookUrl: string;

  constructor(opts: TransportStreamOptions & { webhookUrl: string }) {
    super(opts as TransportStreamOptions);
    this.webhookUrl = opts.webhookUrl;
  }

  log(info: { level: string; message: string; stack?: string }, callback: () => void) {
    setImmediate(() => this.emit('logged', info));

    const text = `🚨 *[Busync Error]*\n\`\`\`${info.stack || info.message}\`\`\``;
    try {
      const url = new URL(this.webhookUrl);
      const body = JSON.stringify({ text });
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      });
      req.on('error', () => {}); // 알림 실패가 앱에 영향 주지 않도록
      req.write(body);
      req.end();
    } catch {
      // 웹훅 URL 파싱 실패 시 무시
    }

    callback();
  }
}

// ─── Logger 생성 ───────────────────────────────────────────────────
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
  }),
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 10 * 1024 * 1024,
    maxFiles: 5,
  }),
  new winston.transports.File({
    filename: 'logs/combined.log',
    maxsize: 10 * 1024 * 1024,
    maxFiles: 10,
  }),
];

// Slack 웹훅 설정된 경우에만 추가
if (process.env.SLACK_ALERT_WEBHOOK) {
  transports.push(
    new SlackTransport({ level: 'error', webhookUrl: process.env.SLACK_ALERT_WEBHOOK })
  );
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat,
  ),
  transports,
});

export default logger;
