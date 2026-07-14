// CORS 허용 origin 목록 — REST(app.ts)와 Socket.IO(socketService.ts)가 공유한다.
// 프로덕션 도메인은 기본 허용. ALLOWED_ORIGINS/FRONTEND_URL 은 덮어쓰지 않고 "추가"만 →
// 환경변수가 비어 있어도 실서비스 도메인이 막혀 500/CORS 실패 나는 사고를 방지.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://busync.kr',
  'https://www.busync.kr',
  'https://busync.co.kr',
  'https://www.busync.co.kr',
  'http://localhost:3000',
  'http://localhost:5173',
];

export const allowedOrigins: string[] = Array.from(
  new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...`${process.env.ALLOWED_ORIGINS || ''},${process.env.FRONTEND_URL || ''}`
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ]),
);
