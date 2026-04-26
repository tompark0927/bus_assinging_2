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

export async function notifyAvailableDriversForEmergency(
  emergencyDropId: number,
  date: Date,
  routeId: number,
  companyId: number
) {
  const dateStr = date.toISOString().split('T')[0];
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  const route = await prisma.route.findFirst({ where: { id: routeId, companyId }, select: { routeNumber: true, name: true, companyId: true } });
  if (!route) return;

  const schedule = await prisma.schedule.findUnique({
    where: { companyId_year_month: { companyId: route.companyId, year, month } },
    select: { id: true },
  });

  if (!schedule) return;

  const restingDriverSlots = await prisma.scheduleSlot.findMany({
    where: {
      scheduleId: schedule.id,
      date: new Date(dateStr),
      isRestDay: true,
    },
    select: { driverId: true },
  });

  let targetDriverIds = restingDriverSlots.map(s => s.driverId);

  // 쉬는 기사가 없으면 예비 기사 전체에게 알림
  if (targetDriverIds.length === 0) {
    const spareDrivers = await prisma.user.findMany({
      where: { companyId, role: 'DRIVER', driverType: 'SPARE', isActive: true },
      select: { id: true },
    });
    targetDriverIds = spareDrivers.map(d => d.id);
  }

  if (targetDriverIds.length === 0) return;

  const dateFormatted = `${month}월 ${date.getDate()}일`;

  await sendBulkPushNotifications(
    targetDriverIds,
    '🚨 긴급 운행 요청',
    `${dateFormatted} ${route.routeNumber}번 노선 운행 기사님을 찾습니다. 가능하시면 확인해주세요!`,
    'EMERGENCY_SLOT',
    { emergencyDropId, date: dateStr, routeId }
  );
}
