import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

/**
 * 비밀번호 입력 시 Caps Lock 이 켜져 있으면 작은 인라인 경고를 표시.
 * password input 옆/아래에 마운트해서 사용.
 *
 * 사용:
 *   const [pwFocused, setPwFocused] = useState(false);
 *   <input type="password" onFocus={() => setPwFocused(true)} onBlur={() => setPwFocused(false)} ... />
 *   <CapsLockHint visible={pwFocused} />
 */
export default function CapsLockHint({
  visible = true,
  className = '',
}: {
  visible?: boolean;
  className?: string;
}) {
  const [capsOn, setCapsOn] = useState(false);

  useEffect(() => {
    if (!visible) return;

    const handler = (e: KeyboardEvent) => {
      // getModifierState 는 신뢰성 높은 cross-browser API
      if (typeof e.getModifierState === 'function') {
        setCapsOn(e.getModifierState('CapsLock'));
      }
    };

    // keydown + keyup 둘 다 — 키 누르고 있는 동안에도 정확
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', handler);
    };
  }, [visible]);

  if (!visible || !capsOn) return null;

  return (
    <p
      role="alert"
      className={`flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-300 mt-1.5 ${className}`}
    >
      <ArrowUp size={12} className="text-amber-500" />
      Caps Lock 이 켜져 있습니다
    </p>
  );
}
