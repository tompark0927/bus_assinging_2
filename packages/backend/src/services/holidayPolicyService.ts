import {
  getHolidayCatalog,
  hasLunarData,
  type HolidayEntry,
} from '../utils/holidays';
import { loadEnginePolicy, persistEnginePolicy } from './enginePolicyStore';

/**
 * "올해 빨간날이 언제인지" 를 회사가 확인하고 확정하는 곳.
 *
 * 왜 회사가 정하는가: 법정공휴일 목록은 나라가 정하지만 **그날 버스를 줄이느냐**
 * 는 회사가 정한다. 근로자의 날처럼 법정공휴일이 아닌 날, 지역 행사(아시아드)나
 * 선거일처럼 그 해에만 있는 날은 회사마다 판단이 다르다. 그래서 시스템은
 * 후보 목록만 만들고(holidays.ts), 담당자가 체크로 고른 결과를 여기에 저장한다.
 *
 * 저장 위치는 엔진 튜닝 정책(`Company.policy.__engineTuning`) 안이다.
 * 엔진에 넘어가는 `holidays` 는 이미 그 자리에 있었고, 여기서 다루는 선택
 * 이력(`holiday_review`)만 옆에 붙인다 — 새 컬럼을 만들지 않는 이유는
 * enginePolicyStore 상단 주석 참조.
 */

/** 한 해의 확정 이력 */
export interface HolidayReviewYear {
  /** 확정 시각 (ISO) */
  confirmedAt: string;
  /** 카탈로그에 있지만 이 회사는 감차하지 않는 날 */
  excluded: string[];
  /** 회사가 직접 추가한 날 (선거일·지역 행사 등) */
  extra: { date: string; name: string }[];
}

export type HolidayReviewStore = Record<string, HolidayReviewYear>;

export interface HolidayReviewItem extends HolidayEntry {
  /** 이 회사가 이 날 감차를 적용하는가 */
  applied: boolean;
  /** 시스템이 계산한 날인가, 회사가 직접 넣은 날인가 */
  source: 'CATALOG' | 'CUSTOM';
}

export interface HolidayReview {
  year: number;
  /** 담당자가 이 해를 확인했는가 — false 면 화면이 "확인해 주세요" 를 띄운다 */
  confirmed: boolean;
  confirmedAt: string | null;
  /** 음력 공휴일 데이터가 있는 해인가 (없으면 설·추석이 목록에서 빠진다) */
  hasLunarData: boolean;
  items: HolidayReviewItem[];
  appliedCount: number;
}

export class HolidayReviewValidationError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function reviewStoreOf(doc: { holiday_review?: unknown }): HolidayReviewStore {
  const raw = doc.holiday_review;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: HolidayReviewStore = {};
  for (const [year, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    out[year] = {
      confirmedAt: typeof v.confirmedAt === 'string' ? v.confirmedAt : '',
      excluded: Array.isArray(v.excluded)
        ? (v.excluded as unknown[]).filter((d): d is string => typeof d === 'string' && ISO_DATE.test(d))
        : [],
      extra: Array.isArray(v.extra)
        ? (v.extra as unknown[])
            .filter(
              (e): e is { date: string; name: string } =>
                !!e &&
                typeof e === 'object' &&
                ISO_DATE.test(String((e as { date?: unknown }).date ?? '')),
            )
            .map((e) => ({ date: e.date, name: String(e.name ?? '').trim() || '회사 지정 휴일' }))
        : [],
    };
  }
  return out;
}

/** 카탈로그 + 회사 선택 → 화면이 그대로 그릴 수 있는 목록 */
function buildItems(year: number, saved: HolidayReviewYear | undefined): HolidayReviewItem[] {
  const excluded = new Set(saved?.excluded ?? []);
  const items: HolidayReviewItem[] = getHolidayCatalog(year).map((h) => ({
    ...h,
    source: 'CATALOG',
    // 기본값은 전부 적용 — 담당자가 뺄 것만 체크를 푼다.
    applied: !excluded.has(h.date),
  }));

  const catalogDates = new Set(items.map((i) => i.date));
  for (const e of saved?.extra ?? []) {
    if (catalogDates.has(e.date)) continue; // 카탈로그와 겹치면 카탈로그 쪽을 남긴다
    items.push({
      date: e.date,
      name: e.name,
      kind: 'FIXED',
      weekday: weekdayOf(e.date),
      reason: '회사가 직접 추가한 날',
      source: 'CUSTOM',
      applied: !excluded.has(e.date),
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function weekdayOf(dateStr: string): string {
  return WEEKDAYS[new Date(`${dateStr}T00:00:00.000Z`).getUTCDay()];
}

/** 이 회사가 이 해를 어떻게 보고 있는가 (확정 전이면 기본값 = 전부 적용) */
export async function getHolidayReview(companyId: number, year: number): Promise<HolidayReview> {
  const doc = await loadEnginePolicy(companyId);
  const store = reviewStoreOf(doc);
  const saved = store[String(year)];
  const items = buildItems(year, saved);
  return {
    year,
    confirmed: Boolean(saved?.confirmedAt),
    confirmedAt: saved?.confirmedAt || null,
    hasLunarData: hasLunarData(year),
    items,
    appliedCount: items.filter((i) => i.applied).length,
  };
}

export interface SaveHolidayReviewInput {
  /** 감차를 적용할 날짜 — 화면에서 체크된 것들 */
  applied: string[];
  /** 회사가 직접 추가한 날 (카탈로그에 없는 날짜만 의미가 있다) */
  extra?: { date: string; name: string }[];
}

/**
 * 확정 저장.
 *
 * 엔진에 넘어가는 평평한 `holidays` 배열은 여기서 다시 계산한다 — **그 해 것만**
 * 갈아끼우고 다른 해는 그대로 둔다. 선택 이력(`holiday_review`)을 따로 남기는
 * 이유는, 나중에 공휴일 표가 바뀌어도 "이 회사가 무엇을 뺐는지" 를 알아야
 * 다시 물어볼 수 있기 때문이다.
 */
export async function saveHolidayReview(
  companyId: number,
  year: number,
  input: SaveHolidayReviewInput,
): Promise<HolidayReview> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HolidayReviewValidationError('연도가 올바르지 않습니다.');
  }
  const yearPrefix = `${year}-`;

  const extra = (input.extra ?? [])
    .filter((e) => e && ISO_DATE.test(String(e.date)))
    .map((e) => ({ date: e.date, name: String(e.name ?? '').trim() || '회사 지정 휴일' }))
    .filter((e) => e.date.startsWith(yearPrefix));

  const appliedSet = new Set(
    (input.applied ?? []).filter((d) => typeof d === 'string' && ISO_DATE.test(d) && d.startsWith(yearPrefix)),
  );

  const catalog = getHolidayCatalog(year);
  const known = new Set([...catalog.map((h) => h.date), ...extra.map((e) => e.date)]);
  const unknownPicked = [...appliedSet].filter((d) => !known.has(d));
  if (unknownPicked.length) {
    throw new HolidayReviewValidationError(
      `목록에 없는 날짜입니다: ${unknownPicked.join(', ')} — 직접 추가로 넣어주세요.`,
    );
  }

  const excluded = [...known].filter((d) => !appliedSet.has(d)).sort();

  const doc = await loadEnginePolicy(companyId);
  const store = reviewStoreOf(doc);
  store[String(year)] = { confirmedAt: new Date().toISOString(), excluded, extra };

  // 엔진용 평평한 목록 — 그 해만 교체
  const others = (doc.holidays ?? []).filter((d) => !d.startsWith(yearPrefix));
  const holidays = [...others, ...[...appliedSet].sort()];

  await persistEnginePolicy(companyId, { ...doc, holidays, holiday_review: store });
  return getHolidayReview(companyId, year);
}

/**
 * 그 달에 실제로 감차를 적용할 날 — **회사 확정본 기준**.
 * 아직 확정하지 않은 해는 카탈로그 기본값(전부 적용)을 쓴다.
 */
export async function getAppliedHolidaysForMonth(
  companyId: number,
  year: number,
  month: number,
): Promise<Map<string, string>> {
  const review = await getHolidayReview(companyId, year);
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const map = new Map<string, string>();
  for (const item of review.items) {
    if (item.applied && item.date.startsWith(prefix)) map.set(item.date, item.name);
  }
  return map;
}
