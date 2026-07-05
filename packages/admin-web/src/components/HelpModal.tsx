import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';

/** 한 섹션 = 소제목 + 항목 리스트 */
export interface HelpSection {
  heading: string;
  /** 각 항목. 문자열 또는 JSX(강조·링크 등) 허용 */
  items: ReactNode[];
}

/** 페이지별 사용법 콘텐츠 */
export interface HelpContent {
  /** 모달 헤더 제목 (보통 "<페이지명> 사용법") */
  title: string;
  /** 상단 한 줄 요약 (선택) */
  intro?: string;
  sections: HelpSection[];
  /** 하단 보조 안내 문구 (선택) */
  footnote?: string;
}

interface HelpModalProps {
  content: HelpContent;
  onClose: () => void;
}

export default function HelpModal({ content, onClose }: HelpModalProps) {
  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={content.title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <HelpCircle size={20} className="text-blue-500" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{content.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {content.intro && (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{content.intro}</p>
          )}
          {content.sections.map((section) => (
            <div key={section.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
                {section.heading}
              </h3>
              <ul className="space-y-2">
                {section.items.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400 dark:bg-blue-500" />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        {content.footnote && (
          <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">{content.footnote}</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
