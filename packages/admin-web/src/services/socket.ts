import { io, Socket } from 'socket.io-client';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

let socket: Socket | null = null;

/**
 * Socket.IO 연결 생성/반환
 * 이미 연결된 소켓이 있으면 재사용
 */
export function getSocket(token: string): Socket {
  if (socket?.connected) return socket;

  // 기존 연결 정리
  if (socket) {
    socket.disconnect();
  }

  // Vercel(프로덕션)은 WebSocket 프록시를 지원하지 않아 wss://www.busync.kr/socket.io 가
  // 실패한다(polling 폴백도 rewrite 가 SPA index.html 로 떨어짐). → 프로덕션에서는
  // Railway 백엔드에 직접 연결한다. dev 는 vite 프록시가 ws 까지 처리하므로 same-origin 유지.
  const serverUrl = import.meta.env.DEV
    ? window.location.origin
    : (import.meta.env.VITE_SOCKET_URL as string) || 'https://busyncbackend-production.up.railway.app';

  socket = io(serverUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    console.log('[Socket.IO] 연결됨');
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket.IO] 연결 오류:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket.IO] 연결 해제:', reason);
  });

  return socket;
}

/**
 * Socket.IO 연결 해제
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * useSocket 훅
 * Layout에서 호출하여 소켓 연결 및 이벤트 리스너 자동 관리
 */
export function useSocket() {
  const queryClient = useQueryClient();
  const { token } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      disconnectSocket();
      return;
    }

    const s = getSocket(token);
    socketRef.current = s;

    // 알림 수신 → React Query 캐시 무효화 + 토스트
    s.on('notification:new', (data: { notification: { title: string; body: string } }) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast(data.notification.body, {
        icon: '🔔',
        duration: 4000,
      });
    });

    // DM 수신 → 대화 목록 캐시 무효화
    s.on('dm:new', (data: { senderName: string }) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['dm-messages'] });
      toast(`${data.senderName}님의 새 메시지`, {
        icon: '💬',
        duration: 3000,
      });
    });

    // DM 읽음 처리
    s.on('dm:read', () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['dm-messages'] });
    });

    // 배차표 발행
    s.on('schedule:published', (data: { year: number; month: number }) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast(`${data.year}년 ${data.month}월 배차표가 발행되었습니다.`, {
        icon: '📅',
        duration: 5000,
      });
    });

    // 긴급 슬롯
    s.on('emergency:new', (data: { slotDate: string; routeNumber: string }) => {
      queryClient.invalidateQueries({ queryKey: ['emergency'] });
      queryClient.invalidateQueries({ queryKey: ['emergencyDrops'] });
      toast(`긴급: ${data.slotDate} ${data.routeNumber}번 노선 슬롯 드랍`, {
        icon: '🚨',
        duration: 6000,
        style: { background: '#FEE2E2', color: '#991B1B' },
      });
    });

    // D-2 긴급 — 운행 2일 이내 미충원, 관리자 직접 조치 필요 (일반 드랍보다 강한 경보)
    s.on('emergency:urgent', (data: { slotDate: string; routeNumber: string; message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['emergency'] });
      queryClient.invalidateQueries({ queryKey: ['emergencyDrops'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast(
        data.message ??
          `🚨 긴급: ${data.slotDate} ${data.routeNumber}번 — 운행 2일 전인데 대타 미충원. 관리자님의 직접 조치(전화 등)가 필요합니다.`,
        {
          icon: '🚨',
          duration: 15000,
          style: {
            background: '#991B1B',
            color: '#ffffff',
            fontWeight: 'bold',
            fontSize: '15px',
            border: '2px solid #7F1D1D',
            maxWidth: '440px',
          },
        },
      );
    });

    // 휴무 심사 결과
    s.on('dayoff:reviewed', (data: { status: string; date: string }) => {
      queryClient.invalidateQueries({ queryKey: ['dayoff'] });
      queryClient.invalidateQueries({ queryKey: ['dayoffRequests'] });
      const label = data.status === 'APPROVED' ? '승인' : '거절';
      toast(`${data.date} 휴무 요청이 ${label}되었습니다.`, {
        icon: data.status === 'APPROVED' ? '✅' : '❌',
        duration: 5000,
      });
    });

    return () => {
      s.off('notification:new');
      s.off('dm:new');
      s.off('dm:read');
      s.off('schedule:published');
      s.off('emergency:new');
      s.off('emergency:urgent');
      s.off('dayoff:reviewed');
    };
  }, [token, queryClient]);

  return socketRef;
}
