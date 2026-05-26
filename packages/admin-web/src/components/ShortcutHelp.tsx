import { useEffect, useState, useCallback } from 'react';
import { X, Keyboard } from 'lucide-react';
import { SHORTCUT_LIST } from '../hooks/useKeyboardShortcuts';

const NAV_SHORTCUTS = SHORTCUT_LIST.filter(s =>
  ['Alt+D', 'Alt+S', 'Alt+G', 'Alt+B', 'Alt+M', 'Alt+A', 'Alt+P'].includes(s.keys)
);

const GENERAL_SHORTCUTS = SHORTCUT_LIST.filter(s =>
  ['\u2318K', 'Esc', '?'].includes(s.keys)
);

function KeyBadge({ keys }: { keys: string }) {
  const parts = keys.split('+');
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, i) => (
        <span key={i}>
          <kbd className="inline-block min-w-[24px] px-1.5 py-0.5 text-xs font-mono font-semibold text-center bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded shadow-sm text-gray-700 dark:text-gray-200">
            {part}
          </kbd>
          {i < parts.length - 1 && <span className="mx-0.5 text-gray-400 dark:text-gray-500">+</span>}
        </span>
      ))}
    </span>
  );
}

interface ShortcutSectionProps {
  title: string;
  shortcuts: { keys: string; description: string }[];
}

function ShortcutSection({ title, shortcuts }: ShortcutSectionProps) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
        {title}
      </h3>
      <div className="space-y-2">
        {shortcuts.map(s => (
          <div
            key={s.keys}
            className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
          >
            <span className="text-sm text-gray-700 dark:text-gray-300">{s.description}</span>
            <KeyBadge keys={s.keys} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Close on Escape
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      return;
    }

    // Open on '?'
    if (e.key === '?' && !open) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    }
  }, [open]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="키보드 단축키 도움말"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Keyboard size={20} className="text-blue-500" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">키보드 단축키</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 max-h-[60vh] overflow-y-auto">
          <ShortcutSection title="일반" shortcuts={GENERAL_SHORTCUTS} />
          <ShortcutSection title="페이지 이동" shortcuts={NAV_SHORTCUTS} />
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            입력 필드에 포커스되어 있을 때는 단축키가 작동하지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
