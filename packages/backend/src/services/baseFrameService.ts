import type { ServiceType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { loadEnginePolicy } from './enginePolicyStore';
import { loadCompanyPolicy } from './solverDispatchService';
import { mergeEnginePolicy } from './enginePolicyMapper';
import { monthScheduleAsCells, routeOperatingCounts } from './scheduleToCellsService';
import { saveEngineDraft } from './engineScheduleService';
import { approvedLeavesByName } from '../routes/engine';
import { serviceTypeLabel } from '../utils/serviceType';

/**
 * 기본 틀을 달마다 미리 깔아 둔다.
 *
 * 담당자가 매달 처음부터 짜는 게 아니라, 이미 깔린 틀 위에서 **스페어만**
 * 채우게 하는 것이 목적이다(사장님 지시 2026-08-31).
 *
 * 기본 틀 자체는 결정론이다 — 엔진 `frame.py` 의 12일 계단 사이클은 위상
 * 앵커만 있으면 어느 달이든 계산된다. 다만 **순번 로테이션**은 전월 말일
 * 상태에서 이어받아야 하므로, 여러 달을 미리 만들 때는 앞 달부터 차례로
 * 만들어 그 결과를 다음 달의 입력으로 넘긴다.
 *
 * 안전 규칙 — 담당자가 손댄 것은 절대 건드리지 않는다:
 *   · 발행본(PUBLISHED)이 있는 달은 통째로 건너뛴다
 *   · 같은 이름 초안에 수동 수정(isManualOverride)이 하나라도 있으면 건너뛴다
 *   · 그 외에는 같은 이름 초안을 다시 만든다 (틀이 바뀌면 반영되어야 한다)
 */

/** 미리 깔아 둘 개월 수 — 이번 달부터 세어 이만큼 앞까지 유지한다 */
export const FRAME_WINDOW_MONTHS = 12;

/** 기본 틀 초안의 이름. 담당자가 만든 초안과 섞이지 않게 고정한다. */
export const BASE_FRAME_NAME = '기본 틀';

export interface EnsureResult {
  year: number;
  month: number;
  serviceType: ServiceType | null;
  status: 'created' | 'skipped' | 'failed';
  reason?: string;
  scheduleId?: number;
  slotCount?: number;
}

function nextMonth(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

function prevMonth(year: number, month: number): [number, number] {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

/**
 * 이 달을 건너뛰어야 하는가 — 건너뛸 이유가 있으면 그 이유를 돌려준다.
 */
async function skipReason(
  companyId: number,
  year: number,
  month: number,
  serviceType: ServiceType | null,
): Promise<string | null> {
  const published = await prisma.schedule.findFirst({
    where: { companyId, year, month, serviceType, status: 'PUBLISHED' },
    select: { id: true },
  });
  if (published) return '이미 발행된 달';

  const draft = await prisma.schedule.findFirst({
    where: { companyId, year, month, serviceType, name: BASE_FRAME_NAME, status: 'DRAFT' },
    select: { id: true },
  });
  if (!draft) return null;

  const touched = await prisma.scheduleSlot.count({
    where: { scheduleId: draft.id, isManualOverride: true },
  });
  if (touched > 0) return `담당자가 ${touched}칸을 직접 고쳐 둠`;

  return null;
}

/**
 * 한 달치 기본 틀을 만들어 저장한다. 이미 있으면(또는 손댄 흔적이 있으면) 건너뛴다.
 *
 * 엔진이 꺼져 있으면 조용히 실패로 남긴다 — 기본 틀이 없다고 다른 기능이
 * 멈추면 안 된다.
 */
export async function ensureBaseFrameSchedule(
  companyId: number,
  createdBy: number,
  year: number,
  month: number,
  serviceType: ServiceType | null,
  /** true = 메인만 깔고 스페어 자리는 비워 둔다 (기본). false = 엔진이 스페어까지 채운다. */
  mainsOnly = true,
): Promise<EnsureResult> {
  const base: Pick<EnsureResult, 'year' | 'month' | 'serviceType'> = { year, month, serviceType };
  const engineUrl = process.env.ENGINE_URL;
  if (!engineUrl) {
    return { ...base, status: 'failed', reason: 'ENGINE_URL 미설정' };
  }

  const skip = await skipReason(companyId, year, month, serviceType);
  if (skip) return { ...base, status: 'skipped', reason: skip };

  const [py, pm] = prevMonth(year, month);
  const prev = await monthScheduleAsCells(companyId, py, pm, serviceType);
  if (!prev || prev.dateCount === 0) {
    return {
      ...base,
      status: 'failed',
      reason: `${py}년 ${pm}월 배차표가 없어 순번을 이어받을 수 없음`,
    };
  }

  const [enginePolicy, companyPolicy, leaves, operatingCounts] = await Promise.all([
    loadEnginePolicy(companyId),
    loadCompanyPolicy(companyId),
    approvedLeavesByName(companyId, year, month),
    routeOperatingCounts(companyId, serviceType),
  ]);

  const upstream = await fetch(`${engineUrl}/generate-from-cells`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-company-id': String(companyId) },
    body: JSON.stringify({
      year,
      month,
      history: [{ year: prev.year, month: prev.month, cells: prev.cells, groups: prev.groups }],
      policy: mergeEnginePolicy(enginePolicy, companyPolicy),
      leaves,
      operating_counts: operatingCounts,
      mains_only: mainsOnly,
    }),
  });
  if (!upstream.ok) {
    const text = await upstream.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      /* 원문 사용 */
    }
    return { ...base, status: 'failed', reason: String(detail).slice(0, 300) };
  }
  const data = (await upstream.json()) as { cells?: unknown };

  const saved = await saveEngineDraft(companyId, createdBy, {
    year,
    month,
    name: BASE_FRAME_NAME,
    serviceType,
    cells: data.cells as never,
    // 같은 이름 초안 교체는 의도된 동작이다. 손댄 초안은 위 skipReason 이
    // 이미 걸러 냈으므로 여기까지 온 것은 기계가 만든 틀뿐이다.
    confirmOverwrite: true,
    confirmMismatch: true,
  });

  return {
    ...base,
    status: 'created',
    scheduleId: saved.scheduleId,
    slotCount: saved.slotCount,
  };
}

/**
 * 회사가 운영하는 노선 종류들 — 기본 틀은 종류마다 따로 깐다.
 * 종류를 안 나눈 회사는 '전체'(null) 하나만 돌린다.
 */
async function serviceTypesOf(companyId: number): Promise<(ServiceType | null)[]> {
  const rows = await prisma.route.findMany({
    where: { companyId },
    select: { serviceType: true },
    distinct: ['serviceType'],
  });
  const types = rows.map((r) => r.serviceType);
  const named = types.filter((t): t is ServiceType => t !== null);
  return named.length > 0 ? named : [null];
}

/**
 * 이번 달부터 `months` 개월치 기본 틀을 채운다.
 *
 * 앞 달이 있어야 다음 달을 만들 수 있으므로 **순서대로** 돈다. 중간에 한
 * 달이 실패하면 그 뒤는 이어받을 게 없으니 그 종류는 거기서 멈춘다.
 */
export async function fillBaseFrameWindow(
  companyId: number,
  createdBy: number,
  from: { year: number; month: number },
  months: number = FRAME_WINDOW_MONTHS,
): Promise<EnsureResult[]> {
  const out: EnsureResult[] = [];
  for (const serviceType of await serviceTypesOf(companyId)) {
    let { year, month } = from;
    for (let i = 0; i < months; i++) {
      const r = await ensureBaseFrameSchedule(companyId, createdBy, year, month, serviceType);
      out.push(r);
      if (r.status === 'failed') {
        logger.warn(
          `[baseFrame] ${companyId} ${year}-${month} ` +
            `${serviceType ? serviceTypeLabel(serviceType) : '전체'} 중단: ${r.reason}`,
        );
        break; // 이 달이 없으면 다음 달 순번을 이어받을 수 없다
      }
      [year, month] = nextMonth(year, month);
    }
  }
  return out;
}

/**
 * 모든 회사의 기본 틀 창을 유지한다 (하루 1회 틱).
 *
 * 실패해도 절대 던지지 않는다 — 서버 기동·다른 틱을 막으면 안 된다.
 */
export async function tickBaseFrames(): Promise<void> {
  if (!process.env.ENGINE_URL) return;
  try {
    const now = new Date();
    const from = { year: now.getFullYear(), month: now.getMonth() + 1 };
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const { id } of companies) {
      // 자동 생성의 작성자는 그 회사의 배차 담당자(없으면 관리자) 계정으로 남긴다.
      const owner = await prisma.user.findFirst({
        where: { companyId: id, role: { in: ['DISPATCH', 'ADMIN', 'OWNER'] }, isActive: true },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (!owner) continue;
      const results = await fillBaseFrameWindow(id, owner.id, from);
      const created = results.filter((r) => r.status === 'created').length;
      if (created) logger.info(`[baseFrame] 회사 ${id}: ${created}개월 기본 틀 생성`);
    }
  } catch (error) {
    logger.error(
      `[baseFrame] 틱 실패: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
