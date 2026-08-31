/**
 * 잘못된 JSON 본문은 400 — 500 "서버 내부 오류"가 아니다.
 *
 * 회귀 방지: 프런트가 axios 에 `null` 본문을 실어 보내 body-parser 가 거부했는데,
 * 서버가 500 "서버 내부 오류가 발생했습니다" 로 답했다. 담당자에게는 서버가
 * 고장 난 것처럼 보였고, 원인을 찾느라 프로덕션 로그까지 봐야 했다.
 */
import { errorHandler, AppError } from '../middleware/errorHandler';

/* eslint-disable @typescript-eslint/no-explicit-any */
function run(err: Error) {
  const req: any = { path: '/api/v1/x', method: 'POST', ip: '1.2.3.4' };
  const json = jest.fn();
  const res: any = { status: jest.fn().mockReturnValue({ json }) };
  errorHandler(err, req, res, jest.fn());
  return { status: res.status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

function bodyParserError(): Error {
  const e = new SyntaxError('Unexpected token \'n\', "null" is not valid JSON') as Error & {
    status?: number; type?: string;
  };
  e.status = 400;
  e.type = 'entity.parse.failed';
  return e;
}

describe('errorHandler', () => {
  it('본문 JSON 파싱 실패는 400 + 무엇이 잘못됐는지 알려준다', () => {
    const { status, body } = run(bodyParserError());
    expect(status).toBe(400);
    expect(body.message).toContain('JSON');
  });

  it('그 밖의 SyntaxError 는 여전히 500 (코드 버그를 감추지 않는다)', () => {
    const { status, body } = run(new SyntaxError('그냥 코드 버그'));
    expect(status).toBe(500);
    expect(body.message).toBe('서버 내부 오류가 발생했습니다.');
  });

  it('AppError 는 그대로 전달된다', () => {
    const { status, body } = run(new AppError('휴무가 겹칩니다', 409));
    expect(status).toBe(409);
    expect(body.message).toBe('휴무가 겹칩니다');
  });

  it('일반 오류는 raw 메시지를 노출하지 않는다', () => {
    const { body } = run(new Error('DB password is hunter2'));
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
