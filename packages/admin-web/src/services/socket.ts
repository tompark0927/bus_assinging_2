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

  const serverUrl = window.location.origin;

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
      s.off('dayoff:reviewed');
    };
  }, [token, queryClient]);

  return socketRef;
}
