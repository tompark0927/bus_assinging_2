import { useEffect, useRef } from 'react';

/**
 * 모달 포커스 트래핑 훅.
 * 모달이 열리면 포커스를 내부에 가두고, 닫히면 원래 요소로 복원.
 */
export function useFocusTrap<T extends HTMLElement>(isOpen: boolean) {
  const ref = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !ref.current) return;

    // 모달 열릴 때 현재 포커스 저장
    previousFocusRef.current = document.activeElement as HTMLElement;

    // 포커스 가능한 첫 요소로 이동
    const focusable = ref.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      requestAnimationFrame(() => focusable[0].focus());
    }

    // Tab 키로 포커스 순환
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !ref.current) return;

      const focusableElements = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // 모달 닫힐 때 원래 포커스 복원
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  return ref;
}
