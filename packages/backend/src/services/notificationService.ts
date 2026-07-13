import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { prisma } from '../utils/prisma';
import { NotificationType, Role } from '@prisma/client';
import logger from '../utils/logger';
import { emitToUser, emitToCompany } from './socketService';

const expo = new Expo();

/* ────────────────────────────────────────────
   관리자(웹) 대상 알림 — 운영 이벤트를 관리자 알림함으로 전달
   ──────────────────────────────────────────── */

const SHIFT_LABEL_KO: Record<string, string> = {
  MORNING: '오전',
  AFTERNOON: '오후',
  FULL_DAY: '종일',
};

/**
 * 회사의 활성 관리자 전원에게 개인 알림(저장 + 벨/푸시)을 보낸다. 보낸 인원수 반환.
 * 역할은 '관리자 계정'으로 통일 — 기사(DRIVER) 외 모든 활성 계정이 대상.
 */
async function notifyAllAdmins(
  companyId: number,
  title: string,
  body: string,
  type: NotificationType,
  data: Record<string, unknown>,
): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { companyId, isActive: true, role: { not: Role.DRIVER } },
    select: { id: true },
  });
  await Promise.all(
    admins.map((a) =>
      sendPushNotification(a.id, title, body, type, data).catch((e) =>
        logger.error(`[AdminNotify] 개인 알림 실패 user=${a.id}:`, e),
      ),
    ),
  );
  return admins.length;
}

/**
 * 긴급(D-2) 대타 발생 시 관리자에게 "일반보다 강한" 알림.
 *  1) 관리자 개인 알림(벨/푸시) 저장  2) 회사 룸에 'emergency:urgent' 라우드 이벤트(admin-web 큰 경보 토스트).
 *  (모바일 앱은 'emergency:urgent' 를 구독하지 않으므로 기사에게는 영향 없음)
 */
export async function notifyAdminsUrgentEmergency(params: {
  companyId: number;
  dropId: number;
  slotDate: Date;
  routeNumber: string;
  shift: string;
}): Promise<void> {
  const { companyId, dropId, slotDate, routeNumber, shift } = params;
  const dateLabel = `${slotDate.getUTCMonth() + 1}월 ${slotDate.getUTCDate()}일`;
  const title = '🚨 긴급 대타 — 관리자 조치 필요';
  const body = `${dateLabel} ${routeNumber}번 노선 운행까지 2일밖에 안 남았는데 대타가 비어 있습니다. 기사에게 직접 연락하는 등 즉시 조치가 필요합니다.`;

  try {
    const count = await notifyAllAdmins(companyId, title, body, 'EMERGENCY_SLOT', {
      kind: 'ADMIN_URGENT',
      dropId,
      routeNumber,
      shift,
      slotDate: slotDate.toISOString(),
    });

    emitToCompany(companyId, 'emergency:urgent', { dropId, slotDate: dateLabel, routeNumber, shift, message: body });
    logger.info(`[AdminNotify] 긴급(D-2) 관리자 알림 — drop=${dropId}, ${count}명`);
  } catch (err) {
    logger.error('[AdminNotify] 긴급 관리자 알림 실패:', err);
  }
}

/** 일반(비긴급) 대타 발생 시 관리자 알림함에 "🚨 대타 발생" 기록. */
export async function notifyAdminsNewDrop(params: {
  companyId: number;
  dropId: number;
  slotDate: Date;
  routeNumber: string;
  shift: string;
  driverName: string;
}): Promise<void> {
  const { companyId, dropId, slotDate, routeNumber, shift, driverName } = params;
  const dateLabel = `${slotDate.getUTCMonth() + 1}월 ${slotDate.getUTCDate()}일`;
  const shiftLabel = SHIFT_LABEL_KO[shift] ?? shift;
  try {
    const count = await notifyAllAdmins(
      companyId,
      '🚨 대타 발생',
      `${routeNumber}번 노선 / ${driverName} 기사 / ${dateLabel} ${shiftLabel} 충원 필요`,
      'EMERGENCY_SLOT',
      { kind: 'ADMIN_DROP', dropId, routeNumber, shift },
    );
    logger.info(`[AdminNotify] 대타 발생 관리자 알림 — drop=${dropId}, ${count}명`);
  } catch (err) {
    logger.error('[AdminNotify] 대타 발생 관리자 알림 실패:', err);
  }
}

/** 기사가 휴무를 신청하면 관리자 알림함에 "📋 새 휴무 요청" 기록. */
export async function notifyAdminsNewDayoffRequest(params: {
  companyId: number;
  requestId: number;
  driverName: string;
  date: Date;
}): Promise<void> {
  const { companyId, requestId, driverName, date } = params;
  // 휴무 날짜는 @db.Date(UTC 자정) — 서버 TZ 무관하게 그 날짜 그대로 표시하려면 getUTC* 사용
  const dateLabel = `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
  try {
    const count = await notifyAllAdmins(
      companyId,
      '📋 새 휴무 요청',
      `${driverName} 기사님이 ${dateLabel} 휴무를 요청했습니다.`,
      'APPROVAL_REQUESTED',
      { kind: 'DAY_OFF', requestId },
    );
    logger.info(`[AdminNotify] 새 휴무 요청 관리자 알림 — req=${requestId}, ${count}명`);
  } catch (err) {
    logger.error('[AdminNotify] 새 휴무 요청 관리자 알림 실패:', err);
  }
}

export async function sendPushNotification(
  userId: number,
  title: string,
  body: string,
  type: NotificationType,
  data?: Record<string, unknown>
) {
  // 대상 사용자의 companyId 를 먼저 조회 — 알림함 조회가 companyId 로 필터되므로
  // 생성 시 반드시 실제 회사 ID를 넣어야 한다 (미지정 시 default 1 로 저장되어 안 보임).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyId: true, expoPushToken: true },
  });
  if (!user) return;

  const notification = await prisma.notification.create({
    data: { userId, companyId: user.companyId, title, body, type, data: (data as any) || {} },
  });

  // Socket.IO: 실시간 알림 전송
  emitToUser(userId, 'notification:new', { notification });

  if (!user.expoPushToken) return;

  if (!Expo.isExpoPushToken(user.expoPushToken)) {
    logger.warn(`Invalid Expo push token for user ${userId}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: user.expoPushToken,
    sound: 'default',
    title,
    body,
    // type 을 payload 에 포함 — 앱이 푸시 탭 시 알림 유형별 화면 라우팅에 사용
    data: { ...(data || {}), type },
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          logger.error(`Push notification error: ${ticket.message}`);
        }
      }
    }
  } catch (error) {
    logger.error('Failed to send push notification:', error);
  }
}

export async function sendBulkPushNotifications(
  userIds: number[],
  title: string,
  body: string,
  type: NotificationType,
  data?: Record<string, unknown>
) {
  if (userIds.length === 0) return;

  const results = await Promise.allSettled(
    userIds.map(userId => sendPushNotification(userId, title, body, type, data))
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    logger.warn(`Bulk notification: ${failed.length}/${userIds.length} failed`);
  }
}

import { sendAlimtalkStub } from './alimtalkStub';
import { EMERGENCY_DROP_URGENT_V1 } from './alimtalkTemplates';

/**
 * 대타 요청 알림 발송.
 *
 * 수신 대상: "그날 쉬는 기사" + "예비 기사 전체" (둘을 합집합으로 동시 발송).
 *  - 예전엔 쉬는 기사가 없을 때만 예비 기사로 폴백했지만, 도달률을 위해 항상 둘 다 보낸다.
 *
 * 채널:
 *  - urgent=false (기본): 푸시만.
 *  - urgent=true (D-2 이내): 푸시 + 카카오 알림톡 (현재 stub — 로그만 남기고 실제 발송은 미연결).
 *
 * 멱등성: 호출자(컨트롤러/escalation cron)가 emergencyDrop.escalationLevel 로 중복 발송을 막는다.
 */
export async function notifyAvailableDriversForEmergency(
  emergencyDropId: number,
  date: Date,
  routeId: number,
  companyId: number,
  urgent: boolean = false,
) {
  const dateStr = date.toISOString().split('T')[0];
  const month = date.getUTCMonth() + 1;

  const route = await prisma.route.findFirst({ where: { id: routeId, companyId }, select: { routeNumber: true, name: true, companyId: true } });
  if (!route) return;

  // 드랍된 슬롯이 속한 배차표 기준으로 그날 쉬는 기사를 찾는다 (멀티 초안 대응)
  const drop = await prisma.emergencyDrop.findUnique({
    where: { id: emergencyDropId },
    select: { slot: { select: { scheduleId: true } } },
  });

  // 그날 쉬는 기사 (스케줄이 없으면 빈 배열)
  const restingDriverSlots = drop
    ? await prisma.scheduleSlot.findMany({
        where: { scheduleId: drop.slot.scheduleId, date: new Date(dateStr), isRestDay: true },
        select: { driverId: true },
      })
    : [];

  // 예비 기사 전체 (항상 합집합)
  const spareDrivers = await prisma.user.findMany({
    where: { companyId, role: 'DRIVER', driverType: 'SPARE', isActive: true },
    select: { id: true },
  });

  const targetDriverIds = Array.from(
    new Set<number>([
      ...restingDriverSlots.map((s) => s.driverId),
      ...spareDrivers.map((d) => d.id),
    ]),
  );

  if (targetDriverIds.length === 0) return;

  const dateFormatted = `${month}월 ${date.getUTCDate()}일`;
  const pushTitle = urgent ? '🚨 긴급 대타 (D-2) 🚨' : '🚨 긴급 🚨';
  const pushBody = `${dateFormatted} ${route.routeNumber}번 노선 운행 기사님이 대타를 구합니다.`;

  await sendBulkPushNotifications(
    targetDriverIds,
    pushTitle,
    pushBody,
    'EMERGENCY_SLOT',
    { emergencyDropId, date: dateStr, routeId, urgent },
  );

  // 긴급 단계(D-2 이내): 알림톡 stub 호출 — 카카오 채널·템플릿 승인 후 실제 발송으로 스왑.
  if (urgent) {
    const drivers = await prisma.user.findMany({
      where: { companyId, id: { in: targetDriverIds } },
      select: { id: true, name: true, phone: true },
    });
    const phones = drivers.map((d) => d.phone).filter((p): p is string => !!p);
    await sendAlimtalkStub({
      phones,
      templateCode: EMERGENCY_DROP_URGENT_V1.code,
      variables: {
        date: dateFormatted,
        routeNumber: route.routeNumber,
      },
      meta: { emergencyDropId, recipients: drivers.length },
    });
  }
}
