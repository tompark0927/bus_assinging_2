import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { prisma } from '../utils/prisma';
import { allowedOrigins } from '../config/allowedOrigins';

let io: Server;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // JWT 인증 미들웨어
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('인증 토큰이 필요합니다.'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as { id: number; companyId: number; role: string };
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error('유효하지 않은 토큰입니다.'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;

    // 연결당 레이트 리미팅 (분당 30이벤트)
    const RATE_LIMIT = 30;
    const RATE_WINDOW_MS = 60000;
    let eventCount = 0;
    let windowStart = Date.now();

    function checkRateLimit(): boolean {
      const now = Date.now();
      if (now - windowStart > RATE_WINDOW_MS) {
        eventCount = 0;
        windowStart = now;
      }
      eventCount++;
      if (eventCount > RATE_LIMIT) {
        logger.warn(`Socket rate limit exceeded: userId=${user.id}, events=${eventCount}`);
        socket.emit('error', { message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
        socket.disconnect(true);
        return false;
      }
      return true;
    }

    // 회사 룸 자동 참가
    socket.join(`company:${user.companyId}`);
    // 개인 룸 참가
    socket.join(`user:${user.id}`);

    logger.info(`Socket 연결: userId=${user.id}, companyId=${user.companyId}`);

    // DM 읽음 처리
    //   보안: partnerId 가 정말 사용자와 대화 중인 상대인지 DB 로 검증해야
    //   임의 사용자에게 거짓 read receipt 를 발송하는 spoof 차단.
    //   (검증 비용은 DM 1조회 — 분당 30 이벤트 제한 안에서 무리 없음)
    socket.on('dm:read', async (data: { partnerId: number }) => {
      if (!checkRateLimit()) return;
      const partnerId = Number(data?.partnerId);
      if (!Number.isInteger(partnerId) || partnerId <= 0 || partnerId === user.id) return;

      try {
        const exists = await prisma.directMessage.findFirst({
          where: {
            OR: [
              { senderId: user.id, receiverId: partnerId },
              { senderId: partnerId, receiverId: user.id },
            ],
          },
          select: { id: true },
        });
        if (!exists) {
          logger.warn(`dm:read spoof 차단 — userId=${user.id}, partnerId=${partnerId}`);
          return;
        }
      } catch (err) {
        logger.warn(`dm:read 검증 실패 — userId=${user.id}`, err);
        return;
      }
      io.to(`user:${partnerId}`).emit('dm:read', { readBy: user.id });
    });

    socket.on('disconnect', () => {
      logger.info(`Socket 연결 해제: userId=${user.id}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO가 초기화되지 않았습니다.');
  return io;
}

// 특정 회사에 이벤트 브로드캐스트
export function emitToCompany(companyId: number, event: string, data: unknown) {
  if (!io) return;
  io.to(`company:${companyId}`).emit(event, data);
}

// 특정 사용자에게 이벤트
export function emitToUser(userId: number, event: string, data: unknown) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}
