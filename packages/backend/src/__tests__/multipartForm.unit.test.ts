/**
 * 엔진 프록시가 업로드 원문에 파트를 덧붙이는 로직.
 *
 * 파일 파트를 건드리지 않고 필드만 추가하는 게 핵심이라, 실제 FormData 를
 * 만들어 넣고 undici 파서로 되읽어 **엑셀 바이트가 그대로인지**까지 본다.
 */
import {
  multipartBoundary,
  readFormField,
  hasFormField,
  formPart,
} from '../utils/multipartForm';

async function buildBody() {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('EXCEL\r\nBYTES')]), 'sched.xlsx');
  fd.append('year', '2026');
  fd.append('month', '9');
  const req = new Request('http://x/generate', { method: 'POST', body: fd });
  const contentType = req.headers.get('content-type')!;
  return { contentType, body: Buffer.from(await req.arrayBuffer()) };
}

describe('multipartForm', () => {
  it('boundary 를 따옴표 유무에 관계없이 읽는다', () => {
    expect(multipartBoundary('multipart/form-data; boundary=abc123')).toBe('abc123');
    expect(multipartBoundary('multipart/form-data; boundary="a b c"')).toBe('a b c');
    expect(multipartBoundary(undefined)).toBeNull();
    expect(multipartBoundary('application/json')).toBeNull();
  });

  it('폼 필드를 읽고, 없는 필드는 null', async () => {
    const { body } = await buildBody();
    expect(readFormField(body, 'year')).toBe('2026');
    expect(readFormField(body, 'month')).toBe('9');
    expect(readFormField(body, 'policy_json')).toBeNull();
    expect(hasFormField(body, 'year')).toBe(true);
    expect(hasFormField(body, 'leaves_json')).toBe(false);
  });

  it('파트를 덧붙여도 파일 바이트와 기존 필드가 그대로다', async () => {
    const { contentType, body } = await buildBody();
    const boundary = multipartBoundary(contentType)!;
    const injected = Buffer.concat([
      formPart(boundary, 'policy_json', JSON.stringify({ values: { monthly_work_days: [18, 23] } })),
      formPart(boundary, 'leaves_json', JSON.stringify({ 김영수: ['2026-09-02'] })),
      body,
    ]);

    const parsed = await new Request('http://x/generate', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: injected,
    }).formData();

    expect(JSON.parse(String(parsed.get('policy_json'))).values.monthly_work_days).toEqual([18, 23]);
    // 한글 이름이 UTF-8 로 살아 있어야 한다 (Content-Type 헤더 없이 붙인다)
    expect(JSON.parse(String(parsed.get('leaves_json')))).toEqual({ 김영수: ['2026-09-02'] });
    expect(parsed.get('year')).toBe('2026');
    expect(parsed.get('month')).toBe('9');
    const file = parsed.get('file') as File;
    expect(file.name).toBe('sched.xlsx');
    expect(await file.text()).toBe('EXCEL\r\nBYTES');
  });
});
