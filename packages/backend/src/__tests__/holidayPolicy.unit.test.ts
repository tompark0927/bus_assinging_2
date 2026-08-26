import type { EnginePolicyDoc } from '../services/enginePolicyMapper';

// 저장소는 통째로 가짜로 — 이 테스트가 보는 것은 "회사 선택이 감차 목록으로
// 어떻게 번역되는가" 지, DB 왕복이 아니다.
let stored: EnginePolicyDoc = {};
jest.mock('../services/enginePolicyStore', () => ({
  loadEnginePolicy: jest.fn(async () => stored),
  persistEnginePolicy: jest.fn(async (_companyId: number, doc: EnginePolicyDoc) => {
    stored = doc;
  }),
}));

import {
  getHolidayReview,
  saveHolidayReview,
  getAppliedHolidaysForMonth,
  HolidayReviewValidationError,
} from '../services/holidayPolicyService';

beforeEach(() => {
  stored = {};
});

describe('공휴일 확인 — 확정 전', () => {
  it('법정공휴일 전부가 기본 적용이고 confirmed 는 false 다', async () => {
    const r = await getHolidayReview(1, 2026);
    expect(r.confirmed).toBe(false);
    expect(r.confirmedAt).toBeNull();
    expect(r.items.every((i) => i.applied)).toBe(true);
    expect(r.appliedCount).toBe(r.items.length);
  });

  it('확정 전에도 감차 계산은 카탈로그 기본값을 쓴다', async () => {
    const oct = await getAppliedHolidaysForMonth(1, 2026, 10);
    expect([...oct.keys()]).toEqual(['2026-10-03', '2026-10-05', '2026-10-09']);
  });
});

describe('공휴일 확인 — 확정', () => {
  it('체크를 푼 날은 감차 목록에서 빠지고 다음 조회에도 유지된다', async () => {
    const before = await getHolidayReview(1, 2026);
    const applied = before.items.map((i) => i.date).filter((d) => d !== '2026-05-01');

    const after = await saveHolidayReview(1, 2026, { applied });

    expect(after.confirmed).toBe(true);
    expect(after.confirmedAt).not.toBeNull();
    expect(after.items.find((i) => i.date === '2026-05-01')?.applied).toBe(false);
    expect(after.appliedCount).toBe(before.appliedCount - 1);

    const reread = await getHolidayReview(1, 2026);
    expect(reread.items.find((i) => i.date === '2026-05-01')?.applied).toBe(false);

    const may = await getAppliedHolidaysForMonth(1, 2026, 5);
    expect([...may.keys()]).not.toContain('2026-05-01');
    expect([...may.keys()]).toContain('2026-05-05');
  });

  it('직접 추가한 날(선거일 등)이 목록과 감차에 들어간다', async () => {
    const base = await getHolidayReview(1, 2026);
    const extra = [{ date: '2026-06-03', name: '지방선거일' }];
    const r = await saveHolidayReview(1, 2026, {
      applied: [...base.items.map((i) => i.date), '2026-06-03'],
      extra,
    });

    const added = r.items.find((i) => i.date === '2026-06-03');
    expect(added).toMatchObject({ name: '지방선거일', source: 'CUSTOM', applied: true });
    expect(added?.reason).toContain('직접 추가');

    const jun = await getAppliedHolidaysForMonth(1, 2026, 6);
    expect(jun.get('2026-06-03')).toBe('지방선거일');
  });

  it('엔진에 넘길 평평한 목록은 그 해만 갈아끼운다', async () => {
    stored = { holidays: ['2025-01-01', '2026-01-01'] };
    await saveHolidayReview(1, 2026, { applied: ['2026-03-01'] });
    expect(stored.holidays).toContain('2025-01-01'); // 다른 해는 그대로
    expect(stored.holidays).toContain('2026-03-01');
    expect(stored.holidays).not.toContain('2026-01-01'); // 그 해는 새 선택으로 교체
  });

  it('한 해를 확정해도 다른 해 확정 이력은 남는다', async () => {
    await saveHolidayReview(1, 2026, { applied: ['2026-03-01'] });
    await saveHolidayReview(1, 2027, { applied: ['2027-03-01'] });
    expect((await getHolidayReview(1, 2026)).confirmed).toBe(true);
    expect((await getHolidayReview(1, 2027)).confirmed).toBe(true);
  });

  it('전부 체크 해제도 허용한다 (그 해는 감차 없음)', async () => {
    const r = await saveHolidayReview(1, 2026, { applied: [] });
    expect(r.confirmed).toBe(true);
    expect(r.appliedCount).toBe(0);
    expect((await getAppliedHolidaysForMonth(1, 2026, 10)).size).toBe(0);
  });
});

describe('공휴일 확인 — 잘못된 입력', () => {
  it('목록에 없는 날짜를 적용하려 하면 막는다', async () => {
    await expect(saveHolidayReview(1, 2026, { applied: ['2026-07-07'] })).rejects.toThrow(
      HolidayReviewValidationError,
    );
  });

  it('다른 해 날짜는 무시한다', async () => {
    const r = await saveHolidayReview(1, 2026, { applied: ['2026-03-01', '2027-03-01'] });
    expect(r.appliedCount).toBe(1);
    expect(stored.holidays).toEqual(['2026-03-01']);
  });

  it('연도가 이상하면 막는다', async () => {
    await expect(saveHolidayReview(1, 1899, { applied: [] })).rejects.toThrow(
      HolidayReviewValidationError,
    );
  });

  it('이름 없이 추가한 날은 기본 이름을 붙인다', async () => {
    const r = await saveHolidayReview(1, 2026, {
      applied: ['2026-11-11'],
      extra: [{ date: '2026-11-11', name: '  ' }],
    });
    expect(r.items.find((i) => i.date === '2026-11-11')?.name).toBe('회사 지정 휴일');
  });
});
