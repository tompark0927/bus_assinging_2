import { Response } from 'express';
import {
  getConversations,
  getMessages,
  sendMessage,
  getUnreadCount,
  getCompanyUsers,
} from '../../controllers/dmController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/socketService', () => ({
  emitToUser: jest.fn(),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function createAuthReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { id: 10, companyId: 1, email: 'driver@test.busync.kr', role: 'DRIVER', name: '김기사' },
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as AuthRequest;
}

// ─────────────────────────────────────────
// getConversations
// ─────────────────────────────────────────

describe('getConversations controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return grouped conversations with unread counts', async () => {
    const req = createAuthReq({ query: { page: '1', limit: '10' } });
    const res = createMockRes();

    const messages = [
      {
        id: 1, senderId: 10, receiverId: 20, content: '안녕하세요', isRead: true,
        createdAt: new Date('2026-03-14T10:00:00'),
        sender: { id: 10, name: '김기사', role: 'DRIVER', employeeId: 'DRV010' },
        receiver: { id: 20, name: '이기사', role: 'DRIVER', employeeId: 'DRV020' },
      },
      {
        id: 2, senderId: 20, receiverId: 10, content: '네 안녕하세요!', isRead: false,
        createdAt: new Date('2026-03-14T10:05:00'),
        sender: { id: 20, name: '이기사', role: 'DRIVER', employeeId: 'DRV020' },
        receiver: { id: 10, name: '김기사', role: 'DRIVER', employeeId: 'DRV010' },
      },
    ];

    mockPrisma.directMessage.findMany.mockResolvedValue(messages);

    await getConversations(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            partner: expect.objectContaining({ id: 20, name: '이기사' }),
            unreadCount: 1,
          }),
        ]),
      }),
    );
  });

  it('should return empty conversations', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.directMessage.findMany.mockResolvedValue([]);

    await getConversations(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.directMessage.findMany.mockRejectedValue(new Error('DB error'));

    await getConversations(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// getMessages
// ─────────────────────────────────────────

describe('getMessages controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return messages with partner and mark as read', async () => {
    const req = createAuthReq({ params: { partnerId: '20' }, query: { page: '1', limit: '20' } });
    const res = createMockRes();

    const messages = [
      { id: 1, senderId: 10, receiverId: 20, content: '내일 근무 교대 가능할까요?', sender: { id: 10, name: '김기사' } },
      { id: 2, senderId: 20, receiverId: 10, content: '네 가능합니다!', sender: { id: 20, name: '이기사' } },
    ];

    mockPrisma.directMessage.findMany.mockResolvedValue(messages);
    mockPrisma.directMessage.count.mockResolvedValue(2);
    mockPrisma.directMessage.updateMany.mockResolvedValue({ count: 1 });

    await getMessages(req, res);

    expect(mockPrisma.directMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          senderId: 20,
          receiverId: 10,
          isRead: false,
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { partnerId: '20' }, query: {} });
    const res = createMockRes();

    mockPrisma.directMessage.findMany.mockRejectedValue(new Error('DB error'));

    await getMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// sendMessage
// ─────────────────────────────────────────

describe('sendMessage controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 if receiverId or content is missing', async () => {
    const req = createAuthReq({ body: { content: '안녕' } });
    const res = createMockRes();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 if content is empty', async () => {
    const req = createAuthReq({ body: { receiverId: 20, content: '   ' } });
    const res = createMockRes();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 404 if receiver not found or not in same company', async () => {
    const req = createAuthReq({ body: { receiverId: 999, content: '테스트 메시지' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should send message successfully', async () => {
    const req = createAuthReq({ body: { receiverId: 20, content: '근무 교대 부탁드립니다.' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({
      id: 20, name: '이기사', expoPushToken: null,
    });
    // 알림 발송(fire-and-forget)에서 sendPushNotification 이 수신자를 조회
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.directMessage.create.mockResolvedValue({
      id: 3, senderId: 10, receiverId: 20, content: '근무 교대 부탁드립니다.',
      sender: { id: 10, name: '김기사' },
      receiver: { id: 20, name: '이기사' },
    });

    await sendMessage(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should create in-app notification for receiver (fire-and-forget push)', async () => {
    const req = createAuthReq({ body: { receiverId: 20, content: '확인 부탁합니다.' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({
      id: 20, name: '이기사',
    });
    // sendPushNotification: 수신자 companyId + 토큰 조회 → 알림함(companyId 포함) 기록
    mockPrisma.user.findUnique.mockResolvedValue({ companyId: 1, expoPushToken: null });
    mockPrisma.directMessage.create.mockResolvedValue({
      id: 4, senderId: 10, receiverId: 20, content: '확인 부탁합니다.',
      sender: { id: 10, name: '김기사' },
      receiver: { id: 20, name: '이기사' },
    });
    mockPrisma.notification.create.mockResolvedValue({ id: 1 });

    await sendMessage(req, res);
    // fire-and-forget 푸시 체인이 끝날 때까지 마이크로태스크 플러시
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 20 },
      select: { companyId: true, expoPushToken: true },
    });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 20, companyId: 1, type: 'NEW_MESSAGE' }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ body: { receiverId: 20, content: '테스트' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// getUnreadCount
// ─────────────────────────────────────────

describe('getUnreadCount controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return unread message count', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    mockPrisma.directMessage.count.mockResolvedValue(3);

    await getUnreadCount(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { unreadCount: 3 },
    });
  });

  it('should return 0 when no unread messages', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    mockPrisma.directMessage.count.mockResolvedValue(0);

    await getUnreadCount(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { unreadCount: 0 },
    });
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    mockPrisma.directMessage.count.mockRejectedValue(new Error('DB error'));

    await getUnreadCount(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
