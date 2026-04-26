import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import {
  LayoutDashboard, Calendar, AlertTriangle, Database, LogOut,
  Sun, Moon, Search, Keyboard, Settings, Bot, FileText,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../services/api';
import type { LucideIcon } from 'lucide-react';
import { useSocket, disconnectSocket } from '../services/socket';
import CommandPalette from './CommandPalette';
import ShortcutHelp from './ShortcutHelp';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

// ─────────────────────────────────────────
// 한국 버스 회사 조직 구조 기반 역할별 메뉴 접근 권한
// ─────────────────────────────────────────
interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles?: string[];
  restrictTo?: string[];
}

const FULL_ACCESS = ['OWNER', 'DIRECTOR', 'ADMIN'];

// ── MVP 핵심 메뉴만 표시 ──────────────────────────────
const navItems: NavItem[] = [
  // 핵심
  { to: '/dashboard', labelKey: '대시보드', icon: LayoutDashboard },
  { to: '/dashboard/schedule', labelKey: 'AI 배차표', icon: Calendar, roles: ['DISPATCH'] },
  { to: '/dashboard/emergency', labelKey: '대타 관리', icon: AlertTriangle, roles: ['DISPATCH'] },
  // AI 에이전트 결정 추적 (Co-pilot 모드)
  { to: '/dashboard/agent-decisions', labelKey: 'AI 에이전트', icon: Bot, roles: ['DISPATCH'] },
  // 매일 09시 자동 발행 운영 보고서
  { to: '/dashboard/daily-reports', labelKey: '일일 보고서', icon: FileText, roles: ['DISPATCH'] },
  // 기초 데이터
  { to: '/dashboard/data', labelKey: '기초 데이터', icon: Database, roles: ['DISPATCH'] },
  // 설정
  { to: '/dashboard/settings', labelKey: '배차 설정', icon: Settings, roles: ['DISPATCH'] },
];

function canAccess(item: NavItem, userRole: string): boolean {
  if (item.restrictTo && item.restrictTo.length > 0) return item.restrictTo.includes(userRole);
  if (!item.roles || item.roles.length === 0) return true;
  if (FULL_ACCESS.includes(userRole)) return true;
  return item.roles.includes(userRole);
}

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { toggleTheme, isDark } = useThemeStore();
  const navigate = useNavigate();
  const userRole = user?.role || 'DRIVER';

  useSocket();
  useKeyboardShortcuts();

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then(r => r.data.data),
    refetchInterval: 30000,
  });

  const unreadCount = notifData?.unreadCount || 0;

  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate('/login');
  };

  const visibleItems = navItems.filter(item => canAccess(item, userRole));

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 dark:bg-gray-950 text-white flex flex-col shadow-xl" role="navigation" aria-label="메인 네비게이션">
        {/* Logo */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center" aria-hidden="true">
              <span className="font-bold text-white text-lg">B</span>
            </div>
            <div>
              <h1 className="font-bold text-sm">Busync</h1>
              <p className="text-xs text-gray-400">{user?.name ? `${user.name}` : '배차 관리 시스템'}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="사이드바 메뉴">
          {visibleItems.map(({ to, labelKey, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              aria-label={labelKey}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon size={20} aria-hidden="true" />
              {labelKey}
            </NavLink>
          ))}
        </nav>

        {/* User info + Dark mode */}
        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold" aria-hidden="true">
              {user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-gray-400">{
                ({ OWNER: '대표이사', DIRECTOR: '관리소장', ADMIN: '관리자', DISPATCH: '배차담당', HR: '총무/인사', ACCOUNTING: '경리', SAFETY_MGR: '안전관리', DRIVER: '기사' } as Record<string, string>)[userRole] || userRole
              }</p>
            </div>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center" aria-label={`읽지 않은 알림 ${unreadCount}개`}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={toggleTheme}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              aria-label={isDark() ? '라이트' : '다크'}
              title={isDark() ? '라이트 모드' : '다크 모드'}
            >
              {isDark() ? <Sun size={16} /> : <Moon size={16} />}
              {isDark() ? '라이트' : '다크'}
            </button>
            <button
              onClick={handleLogout}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="로그아웃"
            >
              <LogOut size={16} aria-hidden="true" />
              로그아웃
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto" role="main">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-8 py-3 flex items-center justify-end">
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            aria-label="전체 검색 열기 (Cmd+K)"
          >
            <Search size={15} aria-hidden="true" />
            <span>검색</span>
            <kbd className="ml-1 px-1.5 py-0.5 text-[11px] font-mono bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded shadow-sm">⌘K</kbd>
          </button>
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            aria-label="키보드 단축키 도움말"
            title="단축키 도움말"
          >
            <Keyboard size={15} aria-hidden="true" />
            <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded shadow-sm">?</kbd>
          </button>
        </div>
        <div className="p-8 text-gray-900 dark:text-gray-100">
          <Outlet />
        </div>
      </main>

      <CommandPalette />
      <ShortcutHelp />
    </div>
  );
}
