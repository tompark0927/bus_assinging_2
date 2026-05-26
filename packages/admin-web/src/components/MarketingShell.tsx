import { Link, useLocation, useNavigate } from 'react-router-dom';

/* ------------------------------------------------------------------ */
/*  Shared marketing nav                                               */
/*  Used by /, /pricing, /support so they share one consistent header  */
/* ------------------------------------------------------------------ */

interface NavItem {
  label: string;
  /** Either a route path (`/foo`) or a same-page anchor id (`features`) */
  to: string;
  /** When true, treat `to` as a section id and scrollTo on landing only */
  scroll?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: '기능', to: 'features', scroll: true },
  { label: '요금제', to: '/pricing' },
  { label: '후기', to: 'testimonials', scroll: true },
  { label: '고객 지원', to: '/support' },
];

export function MarketingNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleNavClick = (item: NavItem) => {
    if (item.scroll) {
      // anchor links only work on the landing page
      if (pathname === '/') {
        document.getElementById(item.to)?.scrollIntoView({ behavior: 'smooth' });
      } else {
        navigate(`/#${item.to}`);
      }
      return;
    }
    navigate(item.to);
  };

  const isActive = (item: NavItem) => {
    if (item.scroll) return false;
    return pathname === item.to;
  };

  return (
    <nav className="sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-200 dark:border-white/10">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center shrink-0" aria-label="Busync 홈">
          <img
            src="/busync-lockup.png"
            alt="Busync"
            className="h-8 w-auto object-contain dark:bg-white dark:rounded-lg dark:px-2 dark:py-1"
          />
        </Link>

        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-300">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => handleNavClick(item)}
              className={`transition-colors ${
                isActive(item)
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'hover:text-blue-600 dark:hover:text-blue-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <Link
            to="/login"
            className="hidden sm:inline-flex items-center text-sm font-medium px-4 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            로그인
          </Link>
          <Link
            to="/register"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
          >
            무료 시작
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared marketing footer                                            */
/* ------------------------------------------------------------------ */

export function MarketingFooter() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const scroll = (id: string) => {
    if (pathname === '/') {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(`/#${id}`);
    }
  };

  return (
    <footer className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-900 py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="mb-3">
              <img
                src="/busync-lockup.png"
                alt="Busync"
                className="h-7 w-auto object-contain dark:bg-white dark:rounded-lg dark:px-2 dark:py-1"
              />
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">AI 기반 버스 배차 자동화 솔루션</p>
          </div>

          {/* Product */}
          <FooterColumn title="제품">
            <FooterLink onClick={() => scroll('features')}>기능 소개</FooterLink>
            <FooterLink onClick={() => navigate('/pricing')}>요금제</FooterLink>
            <FooterLink onClick={() => scroll('testimonials')}>고객 후기</FooterLink>
          </FooterColumn>

          {/* Support */}
          <FooterColumn title="지원">
            <FooterLink onClick={() => navigate('/support')}>고객 지원</FooterLink>
            <FooterLink onClick={() => navigate('/support#contact')}>도입 문의</FooterLink>
            <FooterLink onClick={() => navigate('/login')}>로그인</FooterLink>
          </FooterColumn>

          {/* Company */}
          <FooterColumn title="회사">
            <FooterText>인천광역시 남동구</FooterText>
            <FooterText>support@busync.co.kr</FooterText>
            <FooterText>032-000-0000</FooterText>
          </FooterColumn>
        </div>

        <div className="border-t border-gray-200 dark:border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-400 text-sm">&copy; 2026 Busync. All rights reserved.</p>
          <div className="flex gap-6 text-sm text-gray-400">
            <Link to="/terms" className="hover:text-gray-600 dark:hover:text-gray-200 transition-colors">이용약관</Link>
            <Link to="/privacy" className="hover:text-gray-600 dark:hover:text-gray-200 transition-colors">개인정보처리방침</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-semibold text-sm mb-3">{title}</h4>
      <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">{children}</ul>
    </div>
  );
}

function FooterLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button onClick={onClick} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left">
        {children}
      </button>
    </li>
  );
}

function FooterText({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}
