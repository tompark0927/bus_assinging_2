/**
 * AI 에스컬레이션 엔진
 * 빈 슬롯이 생기면 자동으로 점점 더 긴급하게 기사님들에게 연락하고,
 * 최종적으로 사람(관리자)에게 직접 개입을 요청한다.
 *
 * 에스컬레이션 레벨:
 *  0 = 초기 알림 (쉬는 기사에게) — 드랍 시 즉시 실행
 *  1 = 리마인더 — 15분 후에도 미충원
 *  2 = 전체 기사 블라스트 — 30분 후 또는 출발 2시간 전
 *  3 = 관리자 경보 — 출발 1시간 전
 *  4 = 최종 위기 — 출발 30분 전, 관리자 직접 개입 요청
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { sendPushNotification, sendBulkPushNotifications } from './notificationService';
import logger from '../utils/logger';

const anthropic = new Anthropic();

// 교대 유형별 예상 출발 시각 (KST 시 단위)
const DEPARTURE_HOURS: Record<string, number> = {
  MORNING: 6,
  AFTERNOON: 14,
  FULL_DAY: 6,
};

// KST = UTC+9 (한국은 DST 없음, 고정 오프셋)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 현재 시각을 KST 기준 Date 객체로 반환 (UTC 내부값은 KST wall-clock) */
function nowKST(): Date {
  const now = new Date();
  return new Date(now.getTime() + KST_OFFSET_MS + now.getTimezoneOffset() * 60000);
}

/** slotDate(날짜만)를 KST 출발시각의 UTC 타임스탬프로 변환 */
function getDepartureTime(slotDate: Date, shift: string): Date {
  const hour = DEPARTURE_HOURS[shift] ?? 6;
  // slotDate는 Prisma @db.Date → UTC 00:00으로 들어옴
  // KST 06:00 = UTC 21:00 (전날), KST 14:00 = UTC 05:00 (당일)
  const dateStr = slotDate.toISOString().split('T')[0]; // 'YYYY-MM-DD'
  // KST wall-clock → UTC: KST hour - 9
  const utcHour = hour - 9;
  const dep = new Date(`${dateStr}T00:00:00Z`);
  dep.setUTCHours(utcHour, 0, 0, 0);
  return dep;
}

function minutesUntil(target: Date, from: Date): number {
  return Math.floor((target.getTime() - from.getTime()) / 60000);
}

/** KST 기준으로 같은 날인지 비교 */
function isSameDay(a: Date, b: Date): boolean {
  const aKST = new Date(a.getTime() + KST_OFFSET_MS + a.getTimezoneOffset() * 60000);
  const bKST = new Date(b.getTime() + KST_OFFSET_MS + b.getTimezoneOffset() * 60000);
  return (
    aKST.getFullYear() === bKST.getFullYear() &&
    aKST.getMonth() === bKST.getMonth() &&
    aKST.getDate() === bKST.getDate()
  );
}

/** Claude가 긴급도에 맞는 메시지를 생성한다 */
async function generateAIMessage(context: {
  routeNumber: string;
  routeName: string;
  slotDate: Date;
  shift: string;
  minutesToDeparture: number;
  escalationLevel: number;
  attemptNumber: number;
}): Promise<{ title: string; body: string }> {
  const { routeNumber, slotDate, minutesToDeparture, escalationLevel, attemptNumber } = context;
  const dateStr = `${slotDate.getMonth() + 1}월 ${slotDate.getDate()}일`;

  const urgencyDesc =
    escalationLevel >= 4 ? '출발 30분 이내, 최고 긴급' :
    escalationLevel >= 3 ? '출발 1시간 전, 매우 긴급' :
    escalationLevel >= 2 ? '출발 2시간 전, 긴급' :
    '리마인더';

  try {
    const res = await anthropic.messages.create({
      model: process.env.AI_MODEL_FAST || 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `버스 회사 배차 앱 푸시 알림을 작성해주세요.
상황: ${routeNumber}번 노선 ${dateStr} 운행 기사 부재
출발까지 ${minutesToDeparture}분 남음 (${urgencyDesc})
${attemptNumber}번째 요청

기사님들에게 보낼 짧고 임팩트 있는 메시지:
JSON만 출력: {"title":"(15자 이내)","body":"(55자 이내)"}`,
      }],
    });

    const text = (res.content[0] as { type: string; text: string }).text;
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    logger.error('AI message generation failed:', err);
  }

  // 폴백 메시지
  const fallbacks = [
    { title: `🚨 ${routeNumber}번 기사 필요`, body: `${dateStr} 운행 가능하신 분 즉시 확인해주세요!` },
    { title: `⚠️ 재공지: ${routeNumber}번`, body: `${dateStr} 아직 미충원입니다. 가능하시면 수락해주세요!` },
    { title: `🔴 긴급! ${routeNumber}번 ${dateStr}`, body: `출발 ${minutesToDeparture}분 전! 운행 가능하신 분 즉시 응답해주세요!` },
    { title: `🚨🚨 최급! ${routeNumber}번`, body: `출발 ${minutesToDeparture}분 전! 지금 바로 확인해주세요!!` },
  ];
  return fallbacks[Math.min(escalationLevel - 1, fallbacks.length - 1)] || fallbacks[0];
}

/** 관리자에게 인적 개입 요청 알림 */
async function alertAdmins(
  companyId: number,
  drop: { id: number; slot: { route: { routeNumber: string }; date: Date; shift: string } },
  minutesToDeparture: number,
  level: number
) {
  const admins = await prisma.user.findMany({
    where: { companyId, role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  const route = drop.slot.route.routeNumber;
  const dateStr = `${drop.slot.date.getMonth() + 1}월 ${drop.slot.date.getDate()}일`;

  const isCritical = level >= 4;
  const title = isCritical
    ? `🚨🚨 즉각 개입 필요`
    : `⚠️ 관리자 확인 요청`;
  const body = isCritical
    ? `${dateStr} ${route}번 노선 출발 ${minutesToDeparture}분 전! 아직 미충원입니다. 직접 전화하세요!`
    : `${dateStr} ${route}번 노선 출발 ${minutesToDeparture}분 전. 자동 공지 중이나 관리자 확인 권장.`;

  for (const admin of admins) {
    await sendPushNotification(admin.id, title, body, 'EMERGENCY_SLOT', {
      dropId: drop.id,
      requiresManualAction: isCritical,
    });
  }
}

type DropWithSlot = Awaited<ReturnType<typeof prisma.emergencyDrop.findMany>>[number] & {
  slot: {
    date: Date;
    shift: string;
    routeId: number;
    route: { routeNumber: string; name: string };
    schedule: { companyId: number };
  };
  driver: { name: string };
};

async function escalateDrop(drop: DropWithSlot, now: Date) {
  const { slot, escalationLevel: currentLevel } = drop;
  const companyId = slot.schedule.companyId;
  const slotDate = slot.date;

  const isToday = isSameDay(slotDate, now);
  const isFuture = slotDate > now;
  if (!isToday && !isFuture) return;

  const departure = getDepartureTime(slotDate, slot.shift);
  const minutesToDep = minutesUntil(departure, now);
  if (minutesToDep <= 0) return; // 이미 출발 시각 지남

  const lastEscalated = drop.lastEscalatedAt ?? drop.createdAt;
  const minutesSinceLast = minutesUntil(now, lastEscalated);

  // ── 당일 에스컬레이션 ──────────────────────────────────────────
  if (isToday) {
    if (minutesToDep <= 30 && currentLevel < 4) {
      await doEscalate(drop, 4, companyId, minutesToDep, 'ALL + ADMIN CRITICAL');
    } else if (minutesToDep <= 60 && currentLevel < 3) {
      await doEscalate(drop, 3, companyId, minutesToDep, 'ALL + ADMIN ALERT');
    } else if (minutesToDep <= 120 && currentLevel < 2) {
      await doEscalate(drop, 2, companyId, minutesToDep, 'ALL DRIVERS');
    } else if (currentLevel < 1 && minutesSinceLast >= 15) {
      // 초기 알림 후 15분 경과 — 리마인더
      await doEscalate(drop, 1, companyId, minutesToDep, 'REMINDER');
    } else if (currentLevel === 1 && minutesSinceLast >= 20 && minutesToDep > 120) {
      // 리마인더 후 20분 지났는데도 응답 없음
      await doEscalate(drop, 2, companyId, minutesToDep, 'ALL DRIVERS (early)');
    }
  }

  // ── 미래 날짜 에스컬레이션 (당일 출발 전 날) ───────────────────
  if (isFuture) {
    if (currentLevel < 1 && minutesSinceLast >= 60) {
      // 1시간 후 리마인더
      await doEscalate(drop, 1, companyId, minutesToDep, 'FUTURE REMINDER');
    }
  }
}

async function doEscalate(
  drop: DropWithSlot,
  newLevel: number,
  companyId: number,
  minutesToDep: number,
  reason: string
) {
  // Optimistic lock: 현재 escalationLevel을 조건으로 원자적 업데이트
  // 다른 프로세스(서버 재시작 중복 실행 등)가 먼저 처리했으면 0 rows → 건너뜀
  const claimed = await prisma.emergencyDrop.updateMany({
    where: {
      id: drop.id,
      escalationLevel: drop.escalationLevel, // 내가 읽었을 때의 레벨과 여전히 같아야 함
      status: 'OPEN',
    },
    data: { escalationLevel: newLevel, lastEscalatedAt: new Date() },
  });

  if (claimed.count === 0) {
    logger.info(`[Escalation] Drop #${drop.id} already processed by another run, skipping.`);
    return;
  }

  logger.info(
    `[Escalation] Drop #${drop.id} → Level ${newLevel} (${reason}), T-${minutesToDep}min`
  );

  const slot = drop.slot;
  const attemptNumber = newLevel + 1;

  // AI 메시지 생성 (레벨 1 이상부터)
  const msg = await generateAIMessage({
    routeNumber: slot.route.routeNumber,
    routeName: slot.route.name,
    slotDate: slot.date,
    shift: slot.shift,
    minutesToDeparture: minutesToDep,
    escalationLevel: newLevel,
    attemptNumber,
  });

  const dateStr = `${slot.date.getMonth() + 1}월 ${slot.date.getDate()}일`;

  if (newLevel <= 1) {
    // 레벨 0–1: 쉬는 기사 + 예비 기사에게
    const schedule = await prisma.schedule.findUnique({
      where: {
        companyId_year_month: {
          companyId,
          year: slot.date.getFullYear(),
          month: slot.date.getMonth() + 1,
        },
      },
      select: { id: true },
    });

    let targetIds: number[] = [];
    if (schedule) {
      const restingSlots = await prisma.scheduleSlot.findMany({
        where: { scheduleId: schedule.id, date: slot.date, isRestDay: true },
        select: { driverId: true },
      });
      targetIds = restingSlots.map(s => s.driverId);
    }
    if (targetIds.length === 0) {
      const spares = await prisma.user.findMany({
        where: { companyId, role: 'DRIVER', driverType: 'SPARE', isActive: true },
        select: { id: true },
      });
      targetIds = spares.map(d => d.id);
    }
    if (targetIds.length > 0) {
      await sendBulkPushNotifications(targetIds, msg.title, msg.body, 'EMERGENCY_SLOT', {
        dropId: drop.id, date: slot.date.toISOString().split('T')[0], routeId: slot.routeId,
      });
    }

  } else if (newLevel === 2) {
    // 레벨 2: 전체 활성 기사에게
    const allDrivers = await prisma.user.findMany({
      where: { companyId, role: 'DRIVER', isActive: true },
      select: { id: true },
    });
    const ids = allDrivers.map(d => d.id);
    if (ids.length > 0) {
      await sendBulkPushNotifications(ids, msg.title, msg.body, 'EMERGENCY_SLOT', {
        dropId: drop.id, date: slot.date.toISOString().split('T')[0], routeId: slot.routeId,
      });
    }

  } else if (newLevel >= 3) {
    // 레벨 3–4: 전체 기사 + 관리자 경보
    const allDrivers = await prisma.user.findMany({
      where: { companyId, role: 'DRIVER', isActive: true },
      select: { id: true },
    });
    const ids = allDrivers.map(d => d.id);
    if (ids.length > 0) {
      await sendBulkPushNotifications(ids, msg.title, msg.body, 'EMERGENCY_SLOT', {
        dropId: drop.id, date: slot.date.toISOString().split('T')[0], routeId: slot.routeId,
      });
    }
    await alertAdmins(companyId, drop as never, minutesToDep, newLevel);
  }

  // DB Notification 로그 (관리자 웹 알림 센터에도 표시)
  const admins = await prisma.user.findMany({
    where: { companyId, role: 'ADMIN', isActive: true },
    select: { id: true },
  });
  for (const admin of admins) {
    await prisma.notification.create({
      data: {
        userId: admin.id,
        title: `📊 에스컬레이션 레벨 ${newLevel}`,
        body: `${dateStr} ${slot.route.routeNumber}번 노선 미충원. ${reason}`,
        type: 'EMERGENCY_SLOT',
        data: { dropId: drop.id, escalationLevel: newLevel },
      },
    });
  }
}

/** 메인 에스컬레이션 루프 — 10분마다 실행 */
export async function runEscalationCheck() {
  try {
    const now = new Date();
    const openDrops = await prisma.emergencyDrop.findMany({
      where: { status: 'OPEN' },
      include: {
        slot: {
          include: {
            route: { select: { routeNumber: true, name: true } },
            schedule: { select: { companyId: true } },
          },
        },
        driver: { select: { name: true } },
      },
    });

    for (const drop of openDrops) {
      try {
        // 서버 재시작/다중 인스턴스 시 중복 처리 방지: DB에서 최신 상태 re-fetch
        const freshDrop = await prisma.emergencyDrop.findUnique({ where: { id: drop.id } });
        if (!freshDrop || freshDrop.status !== 'OPEN') continue;
        if (freshDrop.escalationLevel !== drop.escalationLevel) continue;

        // ── 출발시간 경과 시 자동 EXPIRED 처리 ──
        const departure = getDepartureTime(drop.slot.date, drop.slot.shift);
        if (now.getTime() > departure.getTime()) {
          await prisma.$transaction([
            prisma.emergencyDrop.update({
              where: { id: drop.id },
              data: { status: 'EXPIRED' },
            }),
            prisma.scheduleSlot.update({
              where: { id: drop.slotId },
              data: { status: 'ABSENT' },
            }),
          ]);

          // 관리자에게 미충원 인시던트 알림
          const companyId = drop.slot.schedule.companyId;
          const admins = await prisma.user.findMany({
            where: { companyId, role: { in: ['ADMIN', 'DISPATCH'] }, isActive: true },
            select: { id: true },
          });
          if (admins.length > 0) {
            const routeInfo = drop.slot.route?.routeNumber || '?';
            const dateStr = drop.slot.date.toISOString().split('T')[0];
            await sendBulkPushNotifications(
              admins.map(a => a.id),
              `운행 미충원 — ${routeInfo}번`,
              `${dateStr} ${routeInfo}번 노선이 대타 미확보로 결원 처리되었습니다.`,
              'EMERGENCY_SLOT' as never,
              { dropId: drop.id },
            );
          }
          logger.warn(`[Escalation] Drop #${drop.id} EXPIRED — departure passed, marked ABSENT`);
          continue;
        }

        await escalateDrop(drop as DropWithSlot, now);
      } catch (err) {
        logger.error(`Escalation error for drop #${drop.id}:`, err);
      }
    }

    if (openDrops.length > 0) {
      logger.info(`[Escalation] Checked ${openDrops.length} open drop(s).`);
    }
  } catch (err) {
    logger.error('Escalation check failed:', err);
  }
}

/** 당일 드랍 시 즉시 레벨 결정 (출발 시각이 얼마 남았는지에 따라) */
export async function handleImmediateEscalation(
  dropId: number,
  slotDate: Date,
  shift: string,
  companyId: number,
  routeId: number
) {
  const now = new Date();
  const departure = getDepartureTime(slotDate, shift);
  const minutesToDep = minutesUntil(departure, now);

  // 배차표 조회
  const schedule = await prisma.schedule.findUnique({
    where: {
      companyId_year_month: {
        companyId,
        year: slotDate.getFullYear(),
        month: slotDate.getMonth() + 1,
      },
    },
    select: { id: true },
  });

  let targetIds: number[] = [];
  if (schedule) {
    const restingSlots = await prisma.scheduleSlot.findMany({
      where: { scheduleId: schedule.id, date: slotDate, isRestDay: true },
      select: { driverId: true },
    });
    targetIds = restingSlots.map(s => s.driverId);
  }
  if (targetIds.length === 0) {
    const spares = await prisma.user.findMany({
      where: { companyId, role: 'DRIVER', driverType: 'SPARE', isActive: true },
      select: { id: true },
    });
    targetIds = spares.map(d => d.id);
  }

  const route = await prisma.route.findUnique({ where: { id: routeId }, select: { routeNumber: true, name: true } });
  if (!route) return;

  // 당일이고 출발이 가까울수록 더 높은 레벨에서 시작
  let startLevel = 0;
  let startMsg: { title: string; body: string };
  const dateStr = `${slotDate.getMonth() + 1}월 ${slotDate.getDate()}일`;

  if (minutesToDep <= 60 && isSameDay(slotDate, now)) {
    // 1시간 이내: 바로 레벨 3
    startLevel = 3;
    startMsg = {
      title: `🚨 긴급! ${route.routeNumber}번 출발 ${minutesToDep}분 전`,
      body: `${dateStr} 운행 기사님이 필요합니다. 즉시 확인해주세요!`,
    };
    // 관리자에게도 바로 알림
    const drop = await prisma.emergencyDrop.findUnique({ where: { id: dropId } });
    if (drop) {
      await alertAdmins(companyId, { id: dropId, slot: { route, date: slotDate, shift } } as never, minutesToDep, 3);
    }
  } else if (minutesToDep <= 120 && isSameDay(slotDate, now)) {
    // 2시간 이내: 바로 레벨 2
    startLevel = 2;
    startMsg = {
      title: `🔴 ${route.routeNumber}번 긴급 공지`,
      body: `${dateStr} 출발 ${minutesToDep}분 전! 운행 가능하신 분 즉시 확인!`,
    };
  } else {
    // 여유 있음: 레벨 0 (기본)
    startLevel = 0;
    startMsg = {
      title: `🚨 긴급 운행 요청`,
      body: `${dateStr} ${route.routeNumber}번 노선 기사님을 찾습니다. 확인해주세요!`,
    };
  }

  if (targetIds.length > 0) {
    await sendBulkPushNotifications(targetIds, startMsg.title, startMsg.body, 'EMERGENCY_SLOT', {
      dropId, date: slotDate.toISOString().split('T')[0], routeId,
    });
  }

  await prisma.emergencyDrop.update({
    where: { id: dropId },
    data: { escalationLevel: startLevel, lastEscalatedAt: new Date() },
  });
}
