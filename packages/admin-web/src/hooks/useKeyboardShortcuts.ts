// Global keyboard shortcuts for power users
// All shortcuts work when no input/textarea is focused

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const shortcuts: Shortcut[] = [
      // Navigation shortcuts (Alt + key)
      { key: 'd', alt: true, action: () => navigate('/dashboard'), description: '대시보드' },
      { key: 's', alt: true, action: () => navigate('/dashboard/schedule'), description: 'AI 배차표' },
      { key: 'e', alt: true, action: () => navigate('/dashboard/emergency'), description: '대타 관리' },
      { key: 'o', alt: true, action: () => navigate('/dashboard/dayoff'), description: '휴무 요청' },
      { key: 't', alt: true, action: () => navigate('/dashboard/today'), description: '오늘 운행 현황' },
      { key: 'g', alt: true, action: () => navigate('/dashboard/data'), description: '기초 데이터' },
      { key: ',', alt: true, action: () => navigate('/dashboard/settings'), description: '배차 설정' },
      // Escape = close any modal (handled by individual components)
    ];

    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;

        if (e.key.toLowerCase() === shortcut.key && ctrlMatch && altMatch && shiftMatch) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}

// Export shortcut list for display
export const SHORTCUT_LIST = [
  { keys: '⌘K', description: '전체 검색' },
  { keys: 'Alt+D', description: '대시보드' },
  { keys: 'Alt+S', description: 'AI 배차표' },
  { keys: 'Alt+E', description: '대타 관리' },
  { keys: 'Alt+O', description: '휴무 요청' },
  { keys: 'Alt+T', description: '오늘 운행 현황' },
  { keys: 'Alt+N', description: '공지사항' },
  { keys: 'Alt+G', description: '기초 데이터' },
  { keys: 'Alt+,', description: '배차 설정' },
  { keys: 'Esc', description: '모달 닫기' },
  { keys: '?', description: '단축키 도움말' },
];
