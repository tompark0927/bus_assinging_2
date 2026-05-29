import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global error handler.
 *
 * 보안: 스택 트레이스 / err.message (예외 raw 메시지) 는 절대 응답에 포함하지 않는다.
 *   - AppError 경로: 명시적 사용자용 메시지만 반환 (개발자가 의도한 메시지)
 *   - 그 외: "서버 내부 오류" 일반 문구 + 503/500 상태 → 정보 누출 0
 *   - 디버깅 정보는 logger 에만 기록 (콘솔/파일)
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    logger.warn('앱 오류', {
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
    });
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  logger.error('서버 내부 오류', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  // 운영환경에서 절대 err.message / err.stack 을 응답에 노출하지 말 것 — 정보 누출.
  return res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
};
