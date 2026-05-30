import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 모든 대시보드 페이지의 상단 헤더를 통일하는 공용 컴포넌트.
 *   - 제목 크기/굵기/정렬 동일 (text-[28px] font-bold)
 *   - 아이콘 위치/크기/색 동일 (제목 왼쪽 인라인, size 26, text-blue-600)
 *   - 설명문 스타일 동일
 *   - 우측 액션 영역(actions)과 제목 아래 부가 영역(children)은 페이지별로 자유롭게 전달
 */
interface PageHeaderProps {
  /** 사이드바와 동일한 lucide 아이콘 */
  icon: LucideIcon;
  title: string;
  /** 제목 아래 설명. 링크 등 JSX 허용 */
  description?: ReactNode;
  /** 헤더 우측에 배치할 버튼/컨트롤 */
  actions?: ReactNode;
  /** 설명 아래에 들어갈 부가 요소(상태 뱃지, 안내 배너 등) */
  children?: ReactNode;
}

export default function PageHeader({ icon: Icon, title, description, actions, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
          <Icon size={26} className="text-blue-600 dark:text-blue-400 shrink-0" />
          <span>{title}</span>
        </h1>
        {description && (
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        )}
        {children}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
