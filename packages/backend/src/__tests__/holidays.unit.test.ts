import { getHolidayCatalog, getHolidaysForMonth, hasLunarData } from '../utils/holidays';

/**
 * 공휴일 카탈로그 — 감차(그날 몇 대를 세울지)가 이 목록으로 갈리므로
 * 실제 달력과 어긋나면 그날 운행 대수가 틀린다.
 */
describe('getHolidayCatalog', () => {
  const dates = (year: number) => getHolidayCatalog(year).map((h) => h.date);
  const subs = (year: number) => getHolidayCatalog(year).filter((h) => h.kind === 'SUBSTITUTE');

  it('2026년 대체공휴일 4건을 실제 달력대로 계산한다', () => {
    // 삼일절(일)·부처님오신날(일)·광복절(토)·개천절(토) — 2026년은 유난히 많이 겹친다
    expect(subs(2026).map((h) => h.date)).toEqual([
      '2026-03-02',
      '2026-05-25',
      '2026-08-17',
      '2026-10-05',
    ]);
  });

  it('2021년 실제 대체공휴일(광복절·개천절·한글날)을 재현한다', () => {
    expect(subs(2021).map((h) => h.date)).toEqual(['2021-08-16', '2021-10-04', '2021-10-11']);
  });

  it('제도 시행 전(2020년)에는 대체공휴일을 만들지 않는다', () => {
    // 2020-10-03 개천절이 토요일이지만 그해엔 대체공휴일 제도가 없었다.
    expect(subs(2020)).toHaveLength(0);
    expect(dates(2020)).not.toContain('2020-10-05');
  });

  it('현충일은 주말과 겹쳐도 대체공휴일이 없다', () => {
    // 2026-06-06 은 토요일
    expect(getHolidayCatalog(2026).find((h) => h.name === '현충일')?.weekday).toBe('토');
    expect(subs(2026).some((h) => h.name.startsWith('현충일'))).toBe(false);
  });

  it('연휴가 주말에 걸리면 대체공휴일이 서로 다른 날로 밀린다', () => {
    // 2027 설날: 2/5(금) 2/6(토) 2/7(일) → 일요일 1건만 대체 → 2/8(월)
    const s = subs(2027).filter((h) => h.name.includes('설날'));
    expect(s.map((h) => h.date)).toEqual(['2027-02-08']);
  });

  it('대체공휴일은 주말도 기존 공휴일도 아닌 날로 간다', () => {
    for (const year of [2024, 2025, 2026, 2027, 2028, 2029, 2030]) {
      const all = getHolidayCatalog(year);
      const nonSub = new Set(all.filter((h) => h.kind !== 'SUBSTITUTE').map((h) => h.date));
      for (const s of all.filter((h) => h.kind === 'SUBSTITUTE')) {
        expect(['토', '일']).not.toContain(s.weekday);
        expect(nonSub.has(s.date)).toBe(false);
      }
    }
  });

  it('같은 날짜가 두 번 나오지 않는다', () => {
    for (const year of [2024, 2026, 2027, 2030]) {
      const d = dates(year);
      expect(new Set(d).size).toBe(d.length);
    }
  });

  it('근로자의 날은 법정공휴일이 아닌 것으로 구분한다', () => {
    const may1 = getHolidayCatalog(2026).find((h) => h.date === '2026-05-01');
    expect(may1?.kind).toBe('PAID_LEAVE');
    expect(may1?.reason).toContain('법정공휴일은 아님');
  });

  it('모든 항목에 왜 빨간날인지 설명이 붙는다', () => {
    for (const h of getHolidayCatalog(2026)) {
      expect(h.reason.length).toBeGreaterThan(0);
      expect(h.weekday).toMatch(/[월화수목금토일]/);
    }
  });

  it('음력 데이터가 없는 해는 설·추석이 빠지고 hasLunarData 가 false 다', () => {
    expect(hasLunarData(2026)).toBe(true);
    expect(hasLunarData(2035)).toBe(false);
    expect(getHolidayCatalog(2035).some((h) => h.name === '설날')).toBe(false);
  });
});

describe('getHolidaysForMonth', () => {
  it('그 달 것만 돌려주고 대체공휴일도 포함한다', () => {
    const oct = getHolidaysForMonth(2026, 10);
    expect([...oct.keys()]).toEqual(['2026-10-03', '2026-10-05', '2026-10-09']);
    expect(oct.get('2026-10-05')).toBe('개천절 대체공휴일');
  });

  it('공휴일이 없는 달은 빈 맵', () => {
    expect(getHolidaysForMonth(2026, 11).size).toBe(0);
  });
});
