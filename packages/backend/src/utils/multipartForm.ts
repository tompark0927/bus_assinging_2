/**
 * multipart/form-data 원문(Buffer)에 손을 대는 최소 유틸.
 *
 * 엔진 프록시는 업로드된 엑셀을 **재파싱하지 않고 그대로** 흘려보낸다
 * (express.raw 로 받은 버퍼). 거기에 서버가 아는 정보(회사 정책·승인 휴무)를
 * 얹어야 해서, 파트를 하나 덧붙이는 것만 한다 — 파트 순서는 의미가 없고
 * 파일 파트는 손대지 않으므로 이게 가장 안전하다.
 */

/** content-type 헤더에서 boundary 추출 */
export function multipartBoundary(contentType: string | undefined): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * 단순 폼 필드 값 읽기 (파일 파트는 대상 아님).
 * 값을 못 찾으면 null — 호출부가 그 경우를 처리한다.
 */
export function readFormField(body: Buffer, name: string): string | null {
  const at = body.indexOf(`name="${name}"`);
  if (at < 0) return null;
  const headerEnd = body.indexOf('\r\n\r\n', at);
  if (headerEnd < 0) return null;
  const valueStart = headerEnd + 4;
  const valueEnd = body.indexOf('\r\n', valueStart);
  if (valueEnd < 0) return null;
  return body.subarray(valueStart, valueEnd).toString('utf8');
}

/** 이미 그 이름의 파트가 실려 있는가 (담당자가 직접 보낸 값을 존중하기 위함) */
export function hasFormField(body: Buffer, name: string): boolean {
  return body.includes(`name="${name}"`);
}

/**
 * 문자열 폼 파트 생성.
 * Content-Type 헤더는 붙이지 않는다 — FastAPI 는 filename 없는 파트를
 * UTF-8 문자열 Form 필드로 읽고, 받는 쪽 파라미터가 str 이다.
 */
export function formPart(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`,
    'utf8',
  );
}
