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
      { key: 's', alt: true, action: () => navigate('/dashboard/schedule'), description: '배차표' },
      { key: 'g', alt: true, action: () => navigate('/dashboard/drivers'), description: '기사 관리' },
      { key: 'b', alt: true, action: () => navigate('/dashboard/board'), description: '게시판' },
      { key: 'm', alt: true, action: () => navigate('/dashboard/messages'), description: '메시지' },
      { key: 'a', alt: true, action: () => navigate('/dashboard/approvals'), description: '결재함' },
      { key: 'p', alt: true, action: () => navigate('/dashboard/payroll'), description: '급여 관리' },
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
  { keys: '\u2318K', description: '전체 검색' },
  { keys: 'Alt+D', description: '대시보드' },
  { keys: 'Alt+S', description: '배차표' },
  { keys: 'Alt+G', description: '기사 관리' },
  { keys: 'Alt+B', description: '게시판' },
  { keys: 'Alt+M', description: '메시지' },
  { keys: 'Alt+A', description: '결재함' },
  { keys: 'Alt+P', description: '급여 관리' },
  { keys: 'Esc', description: '모달 닫기' },
  { keys: '?', description: '단축키 도움말' },
];
