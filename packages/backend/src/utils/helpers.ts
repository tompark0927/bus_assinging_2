import { Response } from 'express';

/**
 * req.params의 문자열을 안전하게 정수로 변환.
 * NaN이면 res에 400을 보내고 null 반환 → 호출부는 null 체크 후 return.
 *
 * 사용 예:
 *   const id = parseIdParam(req.params.id, res, 'ID');
 *   if (id === null) return;
 */
export function parseIdParam(raw: string, res: Response, label = 'ID'): number | null {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    res.status(400).json({ success: false, message: `유효하지 않은 ${label}입니다.` });
    return null;
  }
  return n;
}
