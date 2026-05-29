import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';

export const submitContact = async (req: Request, res: Response) => {
  try {
    const { name, phone, email, topic, buses, employees, message } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: '이름과 연락처는 필수입니다.' });
    }

    const contact = await prisma.contactRequest.create({
      data: {
        name,
        phone,
        email: email || null,
        topic: topic || null,
        buses: buses ? Number(buses) : null,
        employees: employees ? Number(employees) : null,
        message: message || null,
      },
    });

    // In a real app we'd trigger an email/slack alert to sales team here
    return res.status(201).json({ success: true, data: contact });
  } catch (error) {
    logger.error('Contact submit error:', error);
    return res.status(500).json({ success: false, message: '도입 문의 접수 중 오류가 발생했습니다.' });
  }
};

export const getContacts = async (req: Request, res: Response) => {
  try {
    const contacts = await prisma.contactRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ success: true, data: contacts });
  } catch (error) {
    logger.error('Get contacts error:', error);
    return res.status(500).json({ success: false, message: '문의 내역 조회 중 오류가 발생했습니다.' });
  }
};
