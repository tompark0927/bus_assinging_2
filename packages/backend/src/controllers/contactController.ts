import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { sendEmail } from '../services/emailService';

// 데모/도입 문의 알림을 받을 주소 (환경변수로 덮어쓸 수 있음)
const SALES_INBOX = process.env.SALES_INBOX || 'support.busync@gmail.com';

export const submitContact = async (req: Request, res: Response) => {
  try {
    const { name, phone, email, topic, buses, employees, message } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: '회사명(이름)은 필수입니다.' });
    }

    const contact = await prisma.contactRequest.create({
      data: {
        name,
        phone: phone || '',
        email: email || null,
        topic: topic || null,
        buses: buses ? Number(buses) : null,
        employees: employees ? Number(employees) : null,
        message: message || null,
      },
    });

    // 영업 담당 메일함으로 알림 발송 (실패해도 접수는 성공 처리)
    try {
      const rows = [
        ['회사/이름', name],
        ['이메일', email || '-'],
        ['연락처', phone || '-'],
        ['유형', topic || '-'],
        ['버스 수', buses || '-'],
        ['직원 수', employees || '-'],
        ['메시지', message || '-'],
      ];
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111827">
          <h2 style="margin:0 0 12px;font-size:18px">🚌 새 데모 신청이 접수됐습니다</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${rows.map(([k, v]) => `<tr><td style="padding:6px 10px;background:#f3f4f6;font-weight:600;width:110px">${k}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${v}</td></tr>`).join('')}
          </table>
          <p style="margin-top:14px;color:#9ca3af;font-size:12px">접수 시각: ${new Date().toISOString()}</p>
        </div>`;
      const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
      await sendEmail(SALES_INBOX, `[Busync] 새 데모 신청 — ${name}`, html, text);
    } catch (mailErr) {
      logger.error('데모 신청 알림 메일 발송 실패:', mailErr);
    }

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
