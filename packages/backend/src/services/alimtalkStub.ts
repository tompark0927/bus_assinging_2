/**
 * 카카오 알림톡 발송 — 현재는 stub (로그만 기록, 실제 발송/과금 없음).
 *
 * 카카오 비즈니스 채널 개설 + CoolSMS 채널 연동(pfId) + 알림톡 템플릿 사전심사가
 * 끝난 뒤, 이 함수의 본문을 실제 CoolSMS 알림톡 API 호출로 교체한다.
 *
 * 교체 시 변경되는 곳은 이 파일 한 곳뿐 — 호출부(notificationService 등) 는 그대로 둔다.
 *
 * 참고:
 *  - 발송 실패 시 SMS fallback 은 사용하지 않기로 결정함(2026-05-26 논의).
 *  - 호출자가 emergencyDrop.escalationLevel 로 중복 발송을 막는다(이 함수는 멱등성을 보장하지 않음).
 */

import logger from '../utils/logger';

export interface AlimtalkSendArgs {
  /** 수신 전화번호 (한국 휴대폰, 하이픈 포함/미포함 모두 허용) */
  phones: string[];
  /** 카카오 알림톡 템플릿 코드 (사전 심사된 템플릿 식별자) */
  templateCode: string;
  /** 템플릿 변수 (예: { date: '5월 26일', routeNumber: '3-2' }) */
  variables: Record<string, string>;
  /** 운영 추적/로깅용 메타 (예: emergencyDropId) */
  meta?: Record<string, unknown>;
}

export async function sendAlimtalkStub(args: AlimtalkSendArgs): Promise<void> {
  const validPhones = args.phones.filter(Boolean);
  if (validPhones.length === 0) {
    logger.info('[알림톡 stub] 수신자 없음 — 발송 생략', { templateCode: args.templateCode, meta: args.meta });
    return;
  }

  // 실제 발송이 아닌 stub: 운영 로그에 남기기만 한다.
  // (개발/QA 단계에서 어떤 케이스에 호출됐는지 추적할 수 있게 충분한 정보 기록)
  logger.info('[알림톡 stub] 발송 예정 (실발송 미연결)', {
    templateCode: args.templateCode,
    recipientCount: validPhones.length,
    variables: args.variables,
    meta: args.meta,
  });

  // ── 카카오 채널·템플릿 승인 후 아래 형태로 교체 ──
  // const apiKey = process.env.COOLSMS_API_KEY;
  // const apiSecret = process.env.COOLSMS_API_SECRET;
  // const pfId = process.env.COOLSMS_KAKAO_PFID; // 카카오 채널 식별자
  // for (const phone of validPhones) {
  //   await axios.post('https://api.coolsms.co.kr/messages/v4/send', {
  //     message: {
  //       to: phone.replace(/-/g, ''),
  //       from: process.env.COOLSMS_SENDER!.replace(/-/g, ''),
  //       type: 'ATA',
  //       kakaoOptions: { pfId, templateId: args.templateCode, variables: args.variables },
  //     },
  //   }, { headers: { Authorization: hmacAuth(apiKey, apiSecret) } });
  // }
}
