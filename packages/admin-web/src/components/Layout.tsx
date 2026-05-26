import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { companyInfoApi } from '../services/api';
import {
  LayoutDashboard, Calendar, AlertTriangle, Database, LogOut,
  Settings, FileText,
  CalendarOff, Bus, UserCog, Building2, ScrollText,
  PanelLeftClose, PanelLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSocket, disconnectSocket } from '../services/socket';
import CommandPalette from './CommandPalette';
import ShortcutHelp from './ShortcutHelp';
import InboxDropdown from './InboxDropdown';

// 헤더용 alias — InboxDropdown 자체가 header-friendly (compact bell + dropdown pops down)
const HeaderInbox = InboxDropdown;
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

interface NavGroup {
  label: string;
  items: NavItem[];
}

const FULL_ACCESS = ['OWNER', 'DIRECTOR', 'ADMIN'];

// 사이드바 — 3개 그룹 + 권한 제한 섹션
const navGroups: NavGroup[] = [
  {
    label: '일일 운영',
    items: [
      { to: '/dashboard', labelKey: '대시보드', icon: LayoutDashboard },
      { to: '/dashboard/schedule', labelKey: 'AI 배차표', icon: Calendar, roles: ['DISPATCH'] },
      { to: '/dashboard/emergency', labelKey: '대타 관리', icon: AlertTriangle, roles: ['DISPATCH'] },
      { to: '/dashboard/dayoff', labelKey: '휴무 요청', icon: CalendarOff, roles: ['DISPATCH', 'HR'] },
      { to: '/dashboard/today', labelKey: '오늘 운행 현황', icon: Bus, roles: ['DISPATCH'] },
    ],
  },
  {
    label: '데이터·정보',
    items: [
      { to: '/dashboard/daily-reports', labelKey: '일일 보고서', icon: FileText, roles: ['DISPATCH'] },
      { to: '/dashboard/data', labelKey: '기초 데이터', icon: Database, roles: ['DISPATCH', 'HR'] },
    ],
  },
  {
    label: '설정',
    items: [
      { to: '/dashboard/settings', labelKey: '배차 설정', icon: Settings, roles: ['DISPATCH'] },
      { to: '/dashboard/accounts', labelKey: '계정 관리', icon: UserCog, restrictTo: ['OWNER', 'DIRECTOR', 'ADMIN'] },
      { to: '/dashboard/company', labelKey: '회사 정보', icon: Building2, restrictTo: ['OWNER', 'DIRECTOR', 'ADMIN'] },
    ],
  },
];

// 별도 — OWNER/DIRECTOR 만 보이는 운영 추적 도구
const ownerOnlyGroup: NavGroup = {
  label: '운영 추적',
  items: [
    { to: '/dashboard/audit', labelKey: '감사 로그', icon: ScrollText, restrictTo: ['OWNER', 'DIRECTOR'] },
  ],
};

function canAccess(item: NavItem, userRole: string): boolean {
  if (item.restrictTo && item.restrictTo.length > 0) return item.restrictTo.includes(userRole);
  if (!item.roles || item.roles.length === 0) return true;
  if (FULL_ACCESS.includes(userRole)) return true;
  return item.roles.includes(userRole);
}

function filterGroup(group: NavGroup, userRole: string): NavGroup | null {
  const items = group.items.filter((it) => canAccess(it, userRole));
  if (items.length === 0) return null;
  return { ...group, items };
}

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const userRole = user?.role || 'DRIVER';
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 사이드바 브랜드 영역에 표시할 회사 이름
  const { data: company } = useQuery<{ name?: string } | null>({
    queryKey: ['company', 'me'],
    queryFn: () => companyInfoApi.get().then((r) => r.data?.data ?? null).catch(() => null),
    staleTime: 1000 * 60 * 30,
  });

  useSocket();
  useKeyboardShortcuts();

  const handleLogout = async () => {
    disconnectSocket();
    // Best-effort: 서버 refresh token 폐기 + 로컬 정리. 네트워크 오류여도 로그인 페이지로 이동.
    await logout();
    navigate('/login');
  };

  const visibleGroups = navGroups
    .map((g) => filterGroup(g, userRole))
    .filter((g): g is NavGroup => g !== null);
  const visibleOwnerGroup = filterGroup(ownerOnlyGroup, userRole);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Sidebar — 나이드신 사용자 가독성을 위해 폰트/터치 영역 한 단계씩 크게 */}
      <aside
        className={`${sidebarOpen ? 'flex w-72' : 'hidden'} bg-gray-800 dark:bg-gray-900 text-white flex-col shadow-xl`}
        role="navigation"
        aria-label="메인 네비게이션"
      >
        {/* Logo */}
        <div className="h-20 px-6 flex items-center border-b border-gray-700">
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="min-w-0">
              <img
                src="/busync-lockup.png"
                alt="Busync"
                className="h-8 w-auto object-contain"
              />
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="shrink-0 p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="사이드바 닫기"
              title="사이드바 닫기"
            >
              <PanelLeftClose size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 overflow-y-auto" aria-label="사이드바 메뉴">
          {visibleGroups.map((group, idx) => (
            <div key={group.label} className={idx > 0 ? 'mt-6' : ''}>
              <div className="px-3 mb-2 text-[13px] font-semibold text-gray-400">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map(({ to, labelKey, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/dashboard'}
                    aria-label={labelKey}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-lg text-[16px] font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-200 hover:bg-gray-700 hover:text-white'
                      }`
                    }
                  >
                    <Icon size={22} aria-hidden="true" />
                    {labelKey}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          {visibleOwnerGroup && (
            <div className="mt-6 pt-4 border-t border-gray-700">
              <div className="px-3 mb-2 text-[13px] font-semibold text-gray-400">
                {visibleOwnerGroup.label}
              </div>
              <div className="space-y-1">
                {visibleOwnerGroup.items.map(({ to, labelKey, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    aria-label={labelKey}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-lg text-[15px] font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                      }`
                    }
                  >
                    <Icon size={20} aria-hidden="true" />
                    {labelKey}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* User info + Dark mode */}
        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 bg-blue-500 rounded-full flex items-center justify-center text-lg font-bold" aria-hidden="true">
              {user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold truncate">{user?.name}</p>
              <p className="text-sm text-gray-400 truncate">{company?.name || '배차 관리 시스템'}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 text-[15px] font-medium text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="로그아웃"
          >
            <LogOut size={18} aria-hidden="true" />
            로그아웃
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto admin-scope" role="main">
        {/* Top bar — 검색/단축키 도움말 버튼은 제거됨. 키보드 shortcut (Cmd+K, ?) 자체는 여전히 동작. */}
        <div className="sticky top-0 z-20 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-8 h-20 flex items-center justify-between gap-2">
          {!sidebarOpen ? (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="사이드바 열기"
              title="사이드바 열기"
            >
              <PanelLeft size={20} aria-hidden="true" />
            </button>
          ) : (
            <span />
          )}
          <HeaderInbox />
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
