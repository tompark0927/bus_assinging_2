import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { prisma } from '../utils/prisma';
import { NotificationType } from '@prisma/client';
import logger from '../utils/logger';
import { emitToUser } from './socketService';

const expo = new Expo();

export async function sendPushNotification(
  userId: number,
  title: string,
  body: string,
  type: NotificationType,
  data?: Record<string, unknown>
) {
  const notification = await prisma.notification.create({
    data: { userId, title, body, type, data: (data as any) || {} },
  });

  // Socket.IO: 실시간 알림 전송
  emitToUser(userId, 'notification:new', { notification });

  // Get user's push token
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { expoPushToken: true },
  });

  if (!user?.expoPushToken) return;

  if (!Expo.isExpoPushToken(user.expoPushToken)) {
    logger.warn(`Invalid Expo push token for user ${userId}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: user.expoPushToken,
    sound: 'default',
    title,
    body,
    data: data || {},
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
  const year = date.getFullYear();

  const route = await prisma.route.findFirst({ where: { id: routeId, companyId }, select: { routeNumber: true, name: true, companyId: true } });
  if (!route) return;

  const schedule = await prisma.schedule.findUnique({
    where: { companyId_year_month: { companyId: route.companyId, year, month } },
    select: { id: true },
  });

  // 그날 쉬는 기사 (스케줄이 없으면 빈 배열)
  const restingDriverSlots = schedule
    ? await prisma.scheduleSlot.findMany({
        where: { scheduleId: schedule.id, date: new Date(dateStr), isRestDay: true },
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
      where: { id: { in: targetDriverIds } },
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
