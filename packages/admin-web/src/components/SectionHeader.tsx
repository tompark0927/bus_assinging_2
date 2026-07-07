import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 카드/섹션 상단 헤더를 통일하는 공용 컴포넌트.
 *   - 아이콘: size 20, text-gray-900 (다크: white) — 제목과 같은 검정 계열로 통일
 *   - 제목: text-[18px] font-bold text-gray-900 (다크: white) 로 굵기·크기·색 통일
 *   - hint: 제목 옆 옅은 설명 문구(선택)
 *   - right: 우측 정렬 보조 컨텐츠(뱃지·카운트·화살표 등, 선택)
 *
 * 페이지 최상단 타이틀은 PageHeader 를, 카드 안쪽 섹션 제목은 이 컴포넌트를 사용한다.
 */
export default function SectionHeader({
  icon: Icon,
  title,
  hint,
  right,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  hint?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {Icon && <Icon size={20} className="text-gray-900 dark:text-white shrink-0" />}
      <h3 className="text-[18px] font-bold text-gray-900 dark:text-white">{title}</h3>
      {hint && <span className="text-sm font-normal text-gray-400">{hint}</span>}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
