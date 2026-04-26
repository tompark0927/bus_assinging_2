import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';

function generateEmployeeId(): string {
  return 'ADM' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

export const registerCompany = async (req: Request, res: Response) => {
  try {
    const { companyName, companyCode, adminName, adminEmail, adminPassword, adminPhone } = req.body;

    if (!companyName || !companyCode || !adminName || !adminEmail || !adminPassword || !adminPhone) {
      return res.status(400).json({ success: false, message: '모든 필드를 입력해주세요.' });
    }

    if (companyCode.length < 2 || companyCode.length > 10 || !/^[A-Za-z0-9]+$/.test(companyCode)) {
      return res.status(400).json({ success: false, message: '회사 코드는 영문/숫자 2~10자로 입력해주세요.' });
    }

    if (adminPassword.length < 8) {
      return res.status(400).json({ success: false, message: '비밀번호는 8자 이상이어야 합니다.' });
    }

    const existingCompany = await prisma.company.findUnique({ where: { code: companyCode.toUpperCase() } });
    if (existingCompany) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 회사 코드입니다.' });
    }

    const existingUser = await prisma.user.findFirst({ where: { email: adminEmail } });
    if (existingUser) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다.' });
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const employeeId = generateEmployeeId();

    // batch transaction: $use 미들웨어와 interactive transaction 충돌 회피
    const company = await prisma.company.create({
      data: { name: companyName, code: companyCode.toUpperCase() },
    });

    let user;
    try {
      user = await prisma.user.create({
        data: {
          companyId: company.id,
          name: adminName,
          email: adminEmail,
          phone: adminPhone,
          password: hashedPassword,
          role: 'ADMIN',
          employeeId,
        },
      });
    } catch (userError) {
      // 유저 생성 실패 시 회사도 롤백
      await prisma.company.delete({ where: { id: company.id } }).catch(() => {});
      throw userError;
    }

    const token = jwt.sign(
      { id: user.id, companyId: company.id, email: adminEmail, role: 'ADMIN', name: adminName },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as jwt.SignOptions
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...safeUser } = user as Record<string, unknown>;

    return res.status(201).json({
      success: true,
      data: { token, user: safeUser, company },
      message: `${companyName} 등록이 완료되었습니다.`,
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const checkCompanyCode = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const existing = await prisma.company.findUnique({ where: { code: code.toUpperCase() } });
    return res.json({ success: true, available: !existing });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
