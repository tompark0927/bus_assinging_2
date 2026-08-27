import type { ServiceType } from '@prisma/client';

/**
 * 노선 종류(간선/지선/광역) — 한 회사가 셋을 동시에 운영하는 경우가 있어
 * 노선·기사·배차표가 모두 이 값을 갖는다.
 *
 * 배차표에서 `null` 은 "구분 없음(전체)" 버킷이다. 종류를 나누기 전에 만든
 * 배차표가 전부 여기 남아 있으므로, 미지정과 '전체'를 같은 값으로 다뤄야
 * 기존 데이터가 그대로 보인다.
 */
export const SERVICE_TYPES: readonly ServiceType[] = ['TRUNK', 'BRANCH', 'WIDE_AREA'] as const;

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  TRUNK: '간선',
  BRANCH: '지선',
  WIDE_AREA: '광역',
};

/** 라벨 — null 은 '전체'(구분 없음) */
export function serviceTypeLabel(v: ServiceType | null | undefined): string {
  return v ? SERVICE_TYPE_LABEL[v] : '전체';
}

/**
 * 쿼리스트링·요청 본문의 값을 ServiceType 으로 해석한다.
 * 빈 값 / 'ALL' / 알 수 없는 값 → null (구분 없음 버킷).
 */
export function parseServiceType(v: unknown): ServiceType | null {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s || s === 'ALL' || s === 'NULL') return null;
  return (SERVICE_TYPES as readonly string[]).includes(s) ? (s as ServiceType) : null;
}

/**
 * 배차표에 쓸 기사를 고르는 Prisma where 조각.
 *
 * 간선 기사는 간선 배차표에만, 지선은 지선에만 있어야 한다 — 종류가 정해진
 * 배차표에서는 **그 종류 기사만** 쓴다. 구분 미지정(null) 기사는 어느 종류
 * 표에도 넣지 않는다: 세 표에 다 넣으면 같은 사람이 같은 날 세 번 배차되고,
 * 한 곳만 골라 넣으면 그 선택이 조용한 추측이 된다. 대신 제외된 인원을
 * 호출측이 경고로 드러내 담당자가 기초 데이터에서 종류를 지정하게 한다.
 *
 * `null`(구분 없음 = '전체' 배차표)이면 아무도 거르지 않는다.
 */
export function driverScopeFor(serviceType: ServiceType | null | undefined) {
  return serviceType ? { serviceType } : {};
}

/** 배차표에 쓸 노선을 고르는 Prisma where 조각 */
export function routeScopeFor(serviceType: ServiceType | null | undefined) {
  return serviceType ? { serviceType } : {};
}
