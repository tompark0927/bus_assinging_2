import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarOff,
  AlertTriangle,
  Calendar,
  Megaphone,
  ShieldAlert,
  CheckCheck,
  Loader2,
  X,
} from 'lucide-react';
import { notificationsApi } from '../services/api';
import type { LucideIcon } from 'lucide-react';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

type NotificationType =
  | 'SCHEDULE_PUBLISHED'
  | 'DAY_OFF_APPROVED'
  | 'DAY_OFF_REJECTED'
  | 'DAY_OFF_REQUESTED'
  | 'EMERGENCY_SLOT'
  | 'EMERGENCY_FILLED'
  | 'SCHEDULE_CHANGE'
  | 'LICENSE_EXPIRING'
  | 'NEW_POST'
  | 'URGENT_POST'
  | string;

interface Notification {
  id: number;
  title: string;
  body: string;
  type: NotificationType;
  data?: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

// 백엔드 응답 정규화 (다양한 shape를 일관된 구조로)
interface NormalizedInbox {
  notifications: Notification[];
  unreadCount: number;
}

/* ────────────────────────────────────────────
   Type → Icon / 진입 경로 매핑
   ──────────────────────────────────────────── */

const TYPE_META: Record<string, { icon: LucideIcon; color: string; bg: string; pathFromData?: string }> = {
  // 휴무 신청 (백엔드는 APPROVAL_REQUESTED 로 발송, data.kind='DAY_OFF' 로 구분)
  APPROVAL_REQUESTED: { icon: CalendarOff, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', pathFromData: '/dashboard/dayoff' },
  DAY_OFF_REQUESTED: { icon: CalendarOff, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', pathFromData: '/dashboard/dayoff' },
  DAY_OFF_APPROVED: { icon: CalendarOff, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-500/10', pathFromData: '/dashboard/dayoff' },
  DAY_OFF_REJECTED: { icon: CalendarOff, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', pathFromData: '/dashboard/dayoff' },
  EMERGENCY_SLOT: { icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', pathFromData: '/dashboard/emergency' },
  EMERGENCY_FILLED: { icon: AlertTriangle, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', pathFromData: '/dashboard/emergency' },
  SCHEDULE_PUBLISHED: { icon: Calendar, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', pathFromData: '/dashboard/schedule' },
  SCHEDULE_CHANGE: { icon: Calendar, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', pathFromData: '/dashboard/schedule' },
  LICENSE_EXPIRING: { icon: ShieldAlert, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', pathFromData: '/dashboard/data' },
  NEW_POST: { icon: Megaphone, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', pathFromData: '/dashboard' },
  URGENT_POST: { icon: Megaphone, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', pathFromData: '/dashboard' },
};

const DEFAULT_META = { icon: Bell, color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-white/5', pathFromData: undefined as string | undefined };

function pickPath(n: Notification): string | undefined {
  const meta = TYPE_META[n.type] ?? DEFAULT_META;
  return meta.pathFromData;
}

/* ────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */

export default function InboxDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<NormalizedInbox>({
    queryKey: ['notifications'],
    queryFn: () =>
      notificationsApi.list().then((r) => {
        // 백엔드는 { success, data: Notification[], unreadCount } 형태로 반환
        // 일부 버전은 { data: { notifications, unreadCount } } 일 수도 있어 둘 다 지원
        const body = r.data as {
          data?: Notification[] | { notifications?: Notification[]; unreadCount?: number };
          unreadCount?: number;
        };
        if (Array.isArray(body.data)) {
          return { notifications: body.data, unreadCount: body.unreadCount ?? 0 };
        }
        const inner = (body.data as { notifications?: Notification[]; unreadCount?: number } | undefined) ?? {};
        return {
          notifications: inner.notifications ?? [],
          unreadCount: inner.unreadCount ?? 0,
        };
      }),
    refetchInterval: 30000,
  });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const recent = useMemo(() => notifications.slice(0, 8), [notifications]);

  const handleClick = (n: Notification) => {
    if (!n.isRead) markRead.mutate(n.id);
    const path = pickPath(n);
    if (path) {
      navigate(path);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {/* Bell button — 헤더용. 나이드신 사용자 가독성을 위해 큰 사이즈 */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="relative inline-flex items-center justify-center w-12 h-12 text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors"
        aria-label={`알림함 ${unreadCount > 0 ? `(읽지 않음 ${unreadCount}건)` : ''}`}
        title="알림함"
      >
        <Bell size={26} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[12px] font-bold rounded-full min-w-[22px] h-[22px] px-1.5 flex items-center justify-center ring-2 ring-white dark:ring-gray-800">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown popover — pops down */}
      {open && (
        <div className="absolute top-full mt-2 right-0 w-[460px] max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-blue-500" />
              <span className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">알림함</span>
              {unreadCount > 0 && (
                <span className="text-[12px] font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 px-2 py-0.5 rounded-full">
                  {unreadCount}건 미확인
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-[13px] text-blue-600 dark:text-blue-400 hover:underline px-2.5 py-1 inline-flex items-center gap-1.5"
                  disabled={markAllRead.isPending}
                >
                  <CheckCheck size={14} />
                  모두 읽음
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
                aria-label="닫기"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[520px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={22} className="animate-spin" />
              </div>
            ) : recent.length === 0 ? (
              <div className="py-16 text-center">
                <Bell size={38} className="mx-auto text-gray-300 mb-3" />
                <p className="text-[15px] text-gray-500 dark:text-gray-400">새 알림이 없습니다</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-white/5">
                {recent.map((n) => {
                  const meta = TYPE_META[n.type] ?? DEFAULT_META;
                  const Icon = meta.icon;
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => handleClick(n)}
                        className={`w-full text-left px-5 py-4 flex items-start gap-3 transition ${
                          n.isRead
                            ? 'hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                            : 'bg-blue-50/40 dark:bg-blue-500/5 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                        }`}
                      >
                        <div className={`p-2.5 rounded-lg ${meta.bg} shrink-0`}>
                          <Icon size={18} className={meta.color} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[15px] font-semibold truncate ${n.isRead ? 'text-gray-700 dark:text-gray-200' : 'text-gray-900 dark:text-gray-50'}`}>
                              {n.title}
                            </span>
                            {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                          </div>
                          <p className="text-[14px] text-gray-600 dark:text-gray-300 mt-1 line-clamp-2 leading-relaxed">
                            {n.body}
                          </p>
                          <div className="text-[12px] text-gray-400 mt-1.5">{relativeTime(n.createdAt)}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          {notifications.length > recent.length && (
            <div className="px-5 py-3 border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02]">
              <span className="text-[13px] text-gray-500 dark:text-gray-400">
                전체 {notifications.length}건 중 최근 {recent.length}건 표시
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
