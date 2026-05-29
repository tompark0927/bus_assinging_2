import { Response } from 'express';
import { prisma } from './prisma';

type AssertableModel =
  | 'bus' | 'route' | 'user' | 'schedule' | 'dayOffRequest'
  | 'dailyInspection' | 'payrollRecord' | 'attendanceRecord'
  | 'incidentRecord' | 'trainingRecord' | 'maintenanceRecord';

/**
 * 리소스가 현재 회사 소속인지 검증하는 헬퍼.
 * 멀티테넌시 격리를 보장하기 위해 모든 단일 리소스 조작에 사용.
 *
 * @example
 * const bus = await assertCompany('bus', busId, req.user!.companyId, res);
 * if (!bus) return; // 404 이미 응답됨
 */
export async function assertCompany(
  model: AssertableModel,
  id: number,
  companyId: number,
  res: Response
): Promise<Record<string, unknown> | null> {
  const where = { id, companyId };
  let record: Record<string, unknown> | null = null;

  switch (model) {
    case 'bus':              record = await prisma.bus.findFirst({ where }); break;
    case 'route':            record = await prisma.route.findFirst({ where }); break;
    case 'user':             record = await prisma.user.findFirst({ where }); break;
    case 'schedule':         record = await prisma.schedule.findFirst({ where }); break;
    case 'dayOffRequest':    record = await prisma.dayOffRequest.findFirst({ where }); break;
    case 'dailyInspection':  record = await prisma.dailyInspection.findFirst({ where }); break;
    case 'payrollRecord':    record = await prisma.payrollRecord.findFirst({ where }); break;
    case 'attendanceRecord': record = await prisma.attendanceRecord.findFirst({ where }); break;
    case 'incidentRecord':   record = await prisma.incidentRecord.findFirst({ where }); break;
    case 'trainingRecord':   record = await prisma.trainingRecord.findFirst({ where }); break;
    case 'maintenanceRecord':record = await prisma.maintenanceRecord.findFirst({ where }); break;
  }

  if (!record) {
    res.status(404).json({ success: false, message: '리소스를 찾을 수 없거나 접근 권한이 없습니다.' });
    return null;
  }

  return record;
}
