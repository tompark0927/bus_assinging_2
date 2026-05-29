import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Strip HTML/script tags from all string fields in the request body.
 * Prevents stored XSS by sanitizing input before it reaches handlers.
 */
function stripTags(value: unknown): unknown {
  if (typeof value === 'string') {
    // Remove <script>...</script> blocks (including attributes), then strip remaining HTML tags
    return value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<\/?[^>]+(>|$)/g, '');
  }
  if (Array.isArray(value)) {
    return value.map(stripTags);
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      cleaned[k] = stripTags(v);
    }
    return cleaned;
  }
  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    const original = JSON.stringify(req.body);
    req.body = stripTags(req.body);
    const sanitized = JSON.stringify(req.body);
    if (original !== sanitized) {
      logger.warn('XSS 의심 입력 감지 - 태그 제거됨', {
        ip: req.ip,
        path: req.path,
        method: req.method,
      });
    }
  }
  next();
}
