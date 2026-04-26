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

  return res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
};
