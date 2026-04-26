import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { MaintenanceType, MaintenanceStatus } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../utils/pagination';

// GET /api/maintenance?busId=&status=
export async function listMaintenance(req: AuthRequest, res: Response) {
  try {
    const { busId, status } = req.query;

    const where = {
      companyId: req.user!.companyId,
      ...(busId ? { busId: parseInt(busId as string) } : {}),
      ...(status ? { status: status as MaintenanceStatus } : {}),
    };
    const pagination = getPagination(req);
    const [records, total] = await Promise.all([
      prisma.maintenanceRecord.findMany({
        where,
        include: {
          bus: { select: { id: true, busNumber: true, plateNumber: true, totalMileage: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.maintenanceRecord.count({ where }),
    ]);

    res.json({ success: true, ...paginatedResponse(records, total, pagination) });
  } catch (err) {
    res.status(500).json({ success: false, message: '정비 이력 조회 실패' });
  }
}

// POST /api/maintenance
export async function createMaintenance(req: AuthRequest, res: Response) {
  try {
    const { busId, type, scheduledAt, notes, mileageAtService } = req.body;
    if (!busId || !type || !scheduledAt) {
      return res.status(400).json({ success: false, message: '차량, 정비 유형, 예정일은 필수입니다.' });
    }

    const record = await prisma.maintenanceRecord.create({
      data: {
        companyId: req.user!.companyId,
        busId: parseInt(busId),
        type: type as MaintenanceType,
        scheduledAt: new Date(scheduledAt),
        notes,
        mileageAtService: mileageAtService ? parseInt(mileageAtService) : undefined,
      },
      include: { bus: true },
    });

    res.status(201).json({ success: true, data: record, message: '정비 일정이 등록되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: '정비 등록 실패' });
  }
}

// PUT /api/maintenance/:id
export async function updateMaintenance(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { status, completedAt, notes } = req.body;

    const existing = await prisma.maintenanceRecord.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '기록을 찾을 수 없습니다.' });
    }

    const record = await prisma.maintenanceRecord.update({
      where: { id },
      data: {
        ...(status ? { status: status as MaintenanceStatus } : {}),
        ...(completedAt ? { completedAt: new Date(completedAt) } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      include: { bus: true },
    });

    res.json({ success: true, data: record, message: '정비 기록이 업데이트되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: '정비 업데이트 실패' });
  }
}

// DELETE /api/maintenance/:id
export async function deleteMaintenance(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.maintenanceRecord.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '기록을 찾을 수 없습니다.' });
    }

    await prisma.maintenanceRecord.delete({ where: { id } });
    res.json({ success: true, message: '정비 기록이 삭제되었습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: '정비 기록 삭제 실패' });
  }
}
