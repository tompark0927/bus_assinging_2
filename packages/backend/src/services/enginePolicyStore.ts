import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import type { EnginePolicyDoc } from './enginePolicyMapper';

/**
 * AI 엔진 튜닝 정책 저장소 — **단일 소스는 Postgres (`Company.policy.__engineTuning`)**.
 *
 * 예전에는 엔진 컨테이너의 파일(`ENGINE_DATA_DIR/policies/{companyId}.json`)이
 * 정책의 주인이었다. 볼륨이 붙어 있지 않으면 재배포마다 설정이 초기화되고,
 * 백업·감사로그·멀티테넌시가 전부 DB에 있는데 정책만 밖에 있는 구조였다.
 * 이제 저장은 DB가 하고, 엔진은 요청마다 policy_json 을 받는 stateless 계산기다.
 *
 * **전용 컬럼이 아니라 기존 policy JSON 안에 두는 이유**: 이 프로젝트는
 * 마이그레이션 이력이 깨져 있어(`20260428000000` 이 "column already exists"로
 * 실패) `prisma migrate deploy` 가 거기서 멈춘다. 컬럼을 추가하면 스키마에는
 * 있고 DB에는 없는 상태가 되어 Company 를 읽는 모든 쿼리가 500이 된다 —
 * 2026-08-25 프로덕션 로그인 장애가 정확히 이것이었다. 마이그레이션 이력을
 * 고치기 전까지는 컬럼을 늘리지 않는다.
 *
 * 기존에 엔진 파일에 저장돼 있던 회사는 처음 읽을 때 한 번 DB로 옮긴다
 * (lazy migration — 별도 운영 작업 없이 이관된다).
 */

const EMPTY: EnginePolicyDoc = { values: {}, holidays: [], special_reductions: [] };

/** Company.policy JSON 안에서 엔진 튜닝이 사는 키 */
export const ENGINE_TUNING_KEY = '__engineTuning';

/** policy JSON 에서 엔진 튜닝 부분만 꺼낸다 */
function tuningOf(policy: unknown): unknown {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
  return (policy as Record<string, unknown>)[ENGINE_TUNING_KEY] ?? null;
}

const ENGINE_URL = () => process.env.ENGINE_URL;

/** DB 에 저장된 JSON → EnginePolicyDoc (형식이 깨졌으면 빈 문서) */
function coerce(raw: unknown): EnginePolicyDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  const values = doc.values;
  return {
    values: values && typeof values === 'object' && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {},
    holidays: Array.isArray(doc.holidays) ? (doc.holidays as string[]) : [],
    special_reductions: Array.isArray(doc.special_reductions)
      ? (doc.special_reductions as [string, string, string][])
      : [],
  };
}

/** 엔진 파일 저장소에 남아 있는 구 정책 (이관용) */
async function fetchLegacyFromEngine(companyId: number): Promise<EnginePolicyDoc | null> {
  const url = ENGINE_URL();
  if (!url) return null;
  try {
    const r = await fetch(`${url}/policy`, { headers: { 'x-company-id': String(companyId) } });
    if (!r.ok) return null;
    const data = (await r.json()) as { policy?: unknown; is_default?: boolean };
    if (data.is_default) return null; // 엔진도 기본값 — 옮길 게 없다
    return coerce(data.policy);
  } catch {
    return null;
  }
}

/**
 * 회사의 엔진 튜닝 정책. DB → (없으면) 엔진 파일 1회 이관 → (없으면) 빈 문서.
 * 빈 문서면 엔진이 카탈로그 기본값을 쓴다.
 */
export async function loadEnginePolicy(companyId: number): Promise<EnginePolicyDoc> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { policy: true },
  });
  const stored = coerce(tuningOf(company?.policy));
  if (stored) return stored;

  const legacy = await fetchLegacyFromEngine(companyId);
  if (!legacy) return EMPTY;
  try {
    await persist(companyId, legacy);
    logger.info(`[EnginePolicy] 엔진 파일 정책을 DB 로 이관 — companyId=${companyId}`);
  } catch (err) {
    // 이관 실패해도 읽은 값으로 진행한다 (다음 요청에서 다시 시도)
    logger.warn(`[EnginePolicy] 이관 실패 companyId=${companyId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return legacy;
}

/** 카탈로그 키 캐시 — 저장 시 오타·스키마 드리프트를 막는다 */
let catalogKeys: { keys: Set<string>; at: number } | null = null;
const CATALOG_TTL_MS = 10 * 60 * 1000;

async function knownKeys(): Promise<Set<string> | null> {
  const url = ENGINE_URL();
  if (!url) return null;
  if (catalogKeys && Date.now() - catalogKeys.at < CATALOG_TTL_MS) return catalogKeys.keys;
  try {
    const r = await fetch(`${url}/catalog`);
    if (!r.ok) return null;
    const data = (await r.json()) as { settings?: { key: string }[] };
    const keys = new Set((data.settings ?? []).map((s) => s.key));
    if (keys.size === 0) return null;
    catalogKeys = { keys, at: Date.now() };
    return keys;
  } catch {
    return null;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EnginePolicyValidationError extends Error {}

/**
 * 저장 — 형식 검증 후 DB 에 쓴다.
 * 카탈로그를 읽을 수 있으면 모르는 키는 거부한다 (엔진 PUT /policy 와 같은 규칙).
 * 엔진이 꺼져 있으면 형식 검증만 하고 저장한다 — 설정 화면이 카탈로그를 이미
 * 읽어 그린 값이라 키가 틀릴 여지가 거의 없고, 엔진 장애가 저장 실패로
 * 번지지 않게 한다.
 */
export async function saveEnginePolicy(
  companyId: number,
  raw: unknown,
): Promise<EnginePolicyDoc> {
  const doc = coerce(raw);
  if (!doc) throw new EnginePolicyValidationError('정책 JSON 이 필요합니다.');

  const keys = await knownKeys();
  if (keys) {
    const unknown = Object.keys(doc.values ?? {}).filter((k) => !keys.has(k));
    if (unknown.length) {
      throw new EnginePolicyValidationError(`알 수 없는 설정 키: ${unknown.join(', ')}`);
    }
  }

  const holidays = (doc.holidays ?? []).filter((d) => typeof d === 'string' && ISO_DATE.test(d));
  const special = (doc.special_reductions ?? []).filter(
    (t) => Array.isArray(t) && t.length === 3 && ISO_DATE.test(t[0]) && ISO_DATE.test(t[1]),
  );

  const next: EnginePolicyDoc = {
    values: doc.values ?? {},
    holidays,
    special_reductions: special,
  };
  await persist(companyId, next);
  return next;
}

/**
 * policy JSON 안의 엔진 튜닝만 갈아끼운다 — 운영 정책 쪽은 그대로 둔다.
 * (반대 방향 보호는 companiesController.updateCompanyPolicy 에 있다)
 */
async function persist(companyId: number, doc: EnginePolicyDoc): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { policy: true },
  });
  const base =
    company?.policy && typeof company.policy === 'object' && !Array.isArray(company.policy)
      ? { ...(company.policy as Record<string, unknown>) }
      : {};
  base[ENGINE_TUNING_KEY] = doc;
  await prisma.company.update({
    where: { id: companyId },
    data: { policy: base as unknown as object },
  });
}
