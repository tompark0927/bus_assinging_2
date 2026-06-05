/**
 * 카카오 알림톡 템플릿 본문 (단일 진실 소스).
 *
 * 여기 작성된 본문을 카카오 비즈니스 관리 페이지에 그대로 등록해 사전 심사를 받는다.
 * 심사 통과 후 templateCode 가 발급되면 아래 `code` 값을 발급된 값으로 갱신한다.
 *
 * 카카오 알림톡 규칙 요약 (등록 시 유의):
 *  - **광고성 금지** — 정보성/거래성 안내만 가능. 본 템플릿은 운영성(대타 요청 안내) 이라 OK.
 *  - **변수 표기**: `#{변수명}` 형태. 본문 길이 1,000자 이내.
 *  - 변수만 바뀌고 본문 구조는 고정. 동적 문장 추가 불가.
 *  - 사전 심사 1~3 영업일 소요. 반려 시 사유 보고 재제출.
 */

export interface AlimtalkTemplate {
  /** 카카오에 등록된 (또는 등록 예정) 템플릿 식별자 — 승인 후 실제 코드로 갱신 */
  code: string;
  /** 카카오 관리 페이지에 등록할 본문 (변수는 #{name} 형식) */
  body: string;
  /** 본문에서 사용하는 변수명 목록 — 호출부 타입 안전성을 위해 명시 */
  variables: readonly string[];
  /** 운영자가 알아보기 위한 설명 */
  description: string;
}

/** D-2 이내 진입한 긴급 대타 요청 알림 (쉬는 기사·예비 기사 대상) */
export const EMERGENCY_DROP_URGENT_V1: AlimtalkTemplate = {
  code: 'EMERGENCY_DROP_URGENT_V1', // ← 카카오 승인 후 발급된 templateId 로 교체
  variables: ['date', 'routeNumber'],
  description: '운행일이 D-2 이내인 대타 슬롯이 발생했을 때 발송 (쉬는 기사 + 예비 기사)',
  body: [
    '[Busync] 긴급 대타 요청',
    '',
    '#{date} #{routeNumber}번 노선에 대타가 필요합니다.',
    '',
    '버스 기사 앱에서 수락 여부를 확인해주세요.',
  ].join('\n'),
};

/**
 * 코드에서 사용하는 모든 알림톡 템플릿 인덱스.
 * 새 템플릿 추가 시 여기에 등록해 호출부에서 typo 없이 참조한다.
 */
export const ALIMTALK_TEMPLATES = {
  EMERGENCY_DROP_URGENT_V1,
} as const;
