/**
 * 결원(드랍) 만료 처리 서비스.
 *
 * ⚠️ 기존의 단계별 자동 에스컬레이션(반복 푸시 알림 / 관리자 경보 / 레벨 상승)은
 *    제거되었습니다. 기사 대상 "대타 구함" 알림은 드랍 발생 시점에
 *    emergencyController 에서 1회만 발송합니다.
 *
 * 이 서비스에 남은 책임:
 *  - 미충원(OPEN) 드랍이 출발시간을 넘기면 자동으로 EXPIRED 처리하고
 *    해당 운행 슬롯을 ABSENT(결원)으로 마킹.
 */

import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { notifyAvailableDriversForEmergency } from './notificationService';

/** D-2 긴급 임계 (2일, ms 단위) */
const URGENT_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

// 교대 유형별 예상 출발 시각 (KST 시 단위)
const DEPARTURE_HOURS: Record<string, number> = {
  MORNING: 6,
  AFTERNOON: 14,
  FULL_DAY: 6,
};

/** slotDate(날짜만)를 KST 출발시각의 UTC 타임스탬프로 변환 */
function getDepartureTime(slotDate: Date, shift: string): Date {
  const hour = DEPARTURE_HOURS[shift] ?? 6;
  // slotDate는 Prisma @db.Date → UTC 00:00으로 들어옴
  const dateStr = slotDate.toISOString().split('T')[0]; // 'YYYY-MM-DD'
  const utcHour = hour - 9; // KST wall-clock → UTC
  const dep = new Date(`${dateStr}T00:00:00Z`);
  dep.setUTCHours(utcHour, 0, 0, 0);
  return dep;
}

/**
 * 미충원 드랍 만료 스윕.
 * 출발시간이 지난 OPEN 드랍을 EXPIRED 로, 해당 슬롯을 ABSENT 로 처리한다.
 * (알림은 발송하지 않음)
 */
export async function runEscalationCheck() {
  try {
    const now = new Date();
    const openDrops = await prisma.emergencyDrop.findMany({
      where: { status: 'OPEN' },
      include: {
        slot: { select: { id: true, date: true, shift: true } },
      },
    });

    let expired = 0;
    for (const drop of openDrops) {
      try {
        // 다중 인스턴스/재시작 시 중복 처리 방지
        const fresh = await prisma.emergencyDrop.findUnique({ where: { id: drop.id } });
        if (!fresh || fresh.status !== 'OPEN') continue;

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
          expired++;
          logger.warn(`[Escalation] Drop #${drop.id} EXPIRED — 출발시간 경과, ABSENT 처리`);
        }
      } catch (err) {
        logger.error(`Escalation error for drop #${drop.id}:`, err);
      }
    }

    if (expired > 0) {
      logger.info(`[Escalation] ${expired}건 만료 처리 (총 OPEN ${openDrops.length}건)`);
    }

    // ── D-2 긴급 알림 스윕 ──
    // 아직 긴급 단계(level≥1)로 안 올라간 OPEN 드랍 중 운행일이 2일 이내인 건을 찾아
    // 푸시 + 알림톡(stub) 을 발송하고 escalationLevel=1 로 락 → 중복 발송 방지.
    await runD2UrgentSweep(now);
  } catch (err) {
    logger.error('Escalation check failed:', err);
  }
}

/**
 * D-2 진입한 OPEN 드랍을 골라 긴급 알림(푸시 + 알림톡 stub) 을 발송한다.
 * escalationLevel=0 인 드랍만 대상으로 하고, 발송 후 1 로 올려 다음 cron 에서 중복 발송되지 않게 한다.
 */
async function runD2UrgentSweep(now: Date) {
  const cutoff = new Date(now.getTime() + URGENT_THRESHOLD_MS);

  const dueDrops = await prisma.emergencyDrop.findMany({
    where: {
      status: 'OPEN',
      escalationLevel: 0,
      slot: { date: { lte: cutoff } },
    },
    include: { slot: { select: { date: true, routeId: true, schedule: { select: { companyId: true } } } } },
  });

  let promoted = 0;
  for (const drop of dueDrops) {
    try {
      // 멱등성 재확인 (동시 인스턴스 대비)
      const fresh = await prisma.emergencyDrop.findUnique({ where: { id: drop.id } });
      if (!fresh || fresh.status !== 'OPEN' || fresh.escalationLevel !== 0) continue;

      await notifyAvailableDriversForEmergency(
        drop.id,
        drop.slot.date,
        drop.slot.routeId,
        drop.slot.schedule.companyId,
        true,
      );

      await prisma.emergencyDrop.update({
        where: { id: drop.id },
        data: { escalationLevel: 1, lastEscalatedAt: now },
      });
      promoted++;
    } catch (err) {
      logger.error(`[Escalation] D-2 sweep error for drop #${drop.id}:`, err);
    }
  }

  if (promoted > 0) {
    logger.info(`[Escalation] D-2 긴급 알림 ${promoted}건 발송 (대상 ${dueDrops.length}건 검토)`);
  }
}

/**
 * (이전) 당일 드랍 시 즉시 에스컬레이션 시작.
 * 단계별 자동 알림이 제거되어 현재는 동작 없음 — 시그니처만 유지하여
 * emergencyAgentRunner 의 폴백 호출이 안전하게 no-op 되도록 한다.
 */
export async function handleImmediateEscalation(
  _dropId: number,
  _slotDate: Date,
  _shift: string,
  _companyId: number,
  _routeId: number,
): Promise<void> {
  // 의도적 no-op: 기사 알림은 emergencyController 가 드랍 시 1회 발송한다.
}
