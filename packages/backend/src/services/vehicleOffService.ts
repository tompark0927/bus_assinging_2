import { prisma } from '../utils/prisma';

/**
 * 감차(휴차) 표기 — "이 차는 이 날 안 나간다"를 기록한다.
 *
 * 저장 위치는 SchedulePattern.operating (false = 감차 휴차). 이 컬럼은
 * 일일배차 엑셀(dailyPostingExport)과 게시 양식(getPostingView)이 이미 읽는
 * 값이라, 여기에 쓰면 화면·인쇄물·기사앱이 자동으로 같은 사실을 본다.
 * (notes JSON 등 별도 저장소를 쓰면 화면은 '휴'인데 벽에 붙는 종이에는
 * 기사 이름이 인쇄되는 — 현장이 종이를 믿는 — 사고가 난다.)
 *
 * 규칙: 배정(slot)이 남아 있는 차량은 감차할 수 없다. 먼저 배정을 지워야
 * 한다. 그래서 "감차 = 그 차·그날 슬롯 0개"가 불변식이 되고, 기사앱은
 * 슬롯이 없으니 자연히 빈 날로 보인다.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SHIFT_KO: Record<string, string> = {
  MORNING: '오전',
  AFTERNOON: '오후',
  FULL_DAY: '종일',
};

/** Schedule.notes 의 meta JSON 파싱 — JSON 이 아니면 legacyNotes 로 보존 */
export function parseScheduleMeta(notes: string | null): Record<string, unknown> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { legacyNotes: notes };
  } catch {
    return { legacyNotes: notes };
  }
}

export async function setVehicleOff(
  companyId: number,
  scheduleId: number,
  busNumber: string,
  date: string,
  off: boolean,
): Promise<{ off: boolean }> {
  if (!DATE_RE.test(date)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const busNo = String(busNumber ?? '').trim();
  if (!busNo || busNo.length > 20) throw new Error('차량번호가 올바르지 않습니다.');

  const [schedule, bus] = await Promise.all([
    prisma.schedule.findFirst({
      where: { id: scheduleId, companyId },
      select: { id: true, status: true },
    }),
    prisma.bus.findFirst({
      where: { companyId, busNumber: busNo },
      select: { id: true },
    }),
  ]);
  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');
  if (schedule.status !== 'DRAFT') throw new Error('초안 상태에서만 감차를 변경할 수 있습니다.');
  if (!bus) throw new Error(`차량 ${busNo} 이(가) 기초 데이터에 없습니다.`);

  const slotDate = new Date(`${date}T00:00:00.000Z`);

  await prisma.$transaction(async (tx) => {
    if (off) {
      // 배정이 남아 있으면 감차 불가 — 누가 남아 있는지 이름으로 알려준다.
      // 조용히 배정을 지우면 담당자가 모르는 새 기사가 배차표에서 사라진다.
      const remaining = await tx.scheduleSlot.findMany({
        where: { scheduleId, busId: bus.id, date: slotDate },
        select: { shift: true, driver: { select: { name: true } } },
      });
      if (remaining.length > 0) {
        const who = remaining
          .map((s) => `${s.driver.name}(${SHIFT_KO[s.shift] ?? s.shift})`)
          .join(', ');
        throw new Error(
          `이 차량에 배정이 남아 있습니다: ${who}. 먼저 배정을 지운 뒤 감차 처리하세요.`,
        );
      }
    }

    await tx.schedulePattern.upsert({
      where: {
        scheduleId_date_busId: { scheduleId, date: slotDate, busId: bus.id },
      },
      update: { operating: !off },
      create: {
        scheduleId,
        busId: bus.id,
        date: slotDate,
        operating: !off,
        // 수동 감차로 만들어진 행 — 순번(로테이션) 정보는 없다.
        // underlyingSlot 0 = 미상 (engineScheduleService 의 옛 응답 처리와 동일 관례)
        underlyingSlot: 0,
        displaySlot: null,
      },
    });
  });

  return { off };
}
