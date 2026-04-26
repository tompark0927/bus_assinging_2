import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LayoutDashboard, Calendar, Users, Bus, Map,
  CalendarOff, AlertTriangle, Clock, DollarSign, ShieldAlert,
  FileText, Megaphone, MessageSquare, BookOpen, ArrowRight,
  CornerDownLeft, ChevronUp, ChevronDown, X, History,
  type LucideIcon,
} from 'lucide-react';
import { searchApi } from '../services/api';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface SearchResult {
  id: string;
  category: '페이지' | '기사' | '차량' | '노선' | '최근 검색';
  icon: LucideIcon;
  title: string;
  subtitle: string;
  path: string;
}

interface SearchAPIResponse {
  data: {
    drivers: Array<{
      id: number;
      name: string;
      employeeId: string;
      phone?: string;
      driverType?: string;
    }>;
    buses: Array<{
      id: number;
      busNumber: string;
      plateNumber: string;
      model?: string;
      route?: { routeNumber: string; name: string } | null;
    }>;
    routes: Array<{
      id: number;
      routeNumber: string;
      name: string;
      startPoint?: string;
      endPoint?: string;
    }>;
  };
}

// ─────────────────────────────────────────
// Static page items
// ─────────────────────────────────────────
const PAGE_ITEMS: SearchResult[] = [
  { id: 'page-dashboard', category: '페이지', icon: LayoutDashboard, title: '대시보드', subtitle: '메인 대시보드로 이동', path: '/dashboard' },
  { id: 'page-schedule', category: '페이지', icon: Calendar, title: '배차표', subtitle: '월별 배차표 관리', path: '/dashboard/schedule' },
  { id: 'page-drivers', category: '페이지', icon: Users, title: '기사 관리', subtitle: '기사 목록 및 정보 관리', path: '/dashboard/drivers' },
  { id: 'page-buses', category: '페이지', icon: Bus, title: '버스 관리', subtitle: '차량 목록 및 정보 관리', path: '/dashboard/buses' },
  { id: 'page-routes', category: '페이지', icon: Map, title: '노선 관리', subtitle: '노선 목록 및 배정 관리', path: '/dashboard/routes' },
  { id: 'page-dayoff', category: '페이지', icon: CalendarOff, title: '휴무 요청', subtitle: '기사 휴무 요청 승인/반려', path: '/dashboard/dayoff' },
  { id: 'page-emergency', category: '페이지', icon: AlertTriangle, title: '긴급 슬롯', subtitle: '당일 긴급 배차 관리', path: '/dashboard/emergency' },
  { id: 'page-attendance', category: '페이지', icon: Clock, title: '근태 (52시간)', subtitle: '근태 관리 및 52시간 모니터링', path: '/dashboard/attendance' },
  { id: 'page-payroll', category: '페이지', icon: DollarSign, title: '급여 관리', subtitle: '급여 계산 및 명세서', path: '/dashboard/payroll' },
  { id: 'page-safety', category: '페이지', icon: ShieldAlert, title: '안전 관리', subtitle: '사고/교육/면허 관리', path: '/dashboard/safety' },
  { id: 'page-approvals', category: '페이지', icon: FileText, title: '결재함', subtitle: '전자결재 문서 처리', path: '/dashboard/approvals' },
  { id: 'page-board', category: '페이지', icon: Megaphone, title: '게시판', subtitle: '공지사항 및 게시글', path: '/dashboard/board' },
  { id: 'page-messages', category: '페이지', icon: MessageSquare, title: '메시지', subtitle: '1:1 메시지 관리', path: '/dashboard/messages' },
  { id: 'page-rules', category: '페이지', icon: BookOpen, title: '회사 규칙', subtitle: 'AI 챗봇으로 규칙 설정', path: '/dashboard/rules' },
];

// ─────────────────────────────────────────
// localStorage helpers for recent searches
// ─────────────────────────────────────────
const RECENT_KEY = 'command-palette-recent';
const MAX_RECENT = 5;

function getRecent(): SearchResult[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SearchResult[];
  } catch {
    return [];
  }
}

function saveRecent(item: SearchResult) {
  const prev = getRecent().filter(r => r.id !== item.id);
  const next = [{ ...item, category: '최근 검색' as const }, ...prev].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

// Icon resolver for recent items (stored items lose their icon reference)
const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, Calendar, Users, Bus, Map, CalendarOff,
  AlertTriangle, Clock, DollarSign, ShieldAlert, FileText,
  Megaphone, MessageSquare, BookOpen,
};

function resolveIcon(item: SearchResult): LucideIcon {
  // For recent items the icon is serialized as a string
  if (typeof item.icon === 'string') {
    return ICON_MAP[item.icon as string] || Search;
  }
  return item.icon || Search;
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────
export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  // ── Keyboard shortcut: Cmd+K / Ctrl+K ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Focus input when opened ──
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      // Small delay so the DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // ── Close ──
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
  }, []);

  // ── Navigate to result ──
  const selectResult = useCallback((item: SearchResult) => {
    // Save icon name for serialization
    const iconName = item.icon?.displayName || item.icon?.name || 'Search';
    saveRecent({ ...item, icon: iconName as unknown as LucideIcon });
    close();
    navigate(item.path);
  }, [close, navigate]);

  // ── Filter pages + debounced API search ──
  useEffect(() => {
    if (!isOpen) return;

    const q = query.trim().toLowerCase();

    // No query → show recent searches
    if (!q) {
      const recent = getRecent().map(r => ({ ...r, icon: resolveIcon(r) }));
      setResults(recent);
      setSelectedIndex(0);
      return;
    }

    // Immediate: filter pages
    const pageResults = PAGE_ITEMS.filter(
      p => p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q)
    );

    setResults(pageResults);
    setSelectedIndex(0);

    // Debounced: API search
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (q.length < 1) return;
      setIsLoading(true);
      try {
        const resp = await searchApi.search(q);
        const data = (resp.data as SearchAPIResponse).data;

        const driverResults: SearchResult[] = data.drivers.map(d => ({
          id: `driver-${d.id}`,
          category: '기사',
          icon: Users,
          title: d.name,
          subtitle: `사번: ${d.employeeId}${d.phone ? ` · ${d.phone}` : ''}`,
          path: '/dashboard/drivers',
        }));

        const busResults: SearchResult[] = data.buses.map(b => ({
          id: `bus-${b.id}`,
          category: '차량',
          icon: Bus,
          title: `${b.busNumber}`,
          subtitle: `${b.plateNumber}${b.model ? ` · ${b.model}` : ''}${b.route ? ` · ${b.route.routeNumber}번` : ''}`,
          path: '/dashboard/buses',
        }));

        const routeResults: SearchResult[] = data.routes.map(r => ({
          id: `route-${r.id}`,
          category: '노선',
          icon: Map,
          title: `${r.routeNumber}번 ${r.name}`,
          subtitle: r.startPoint && r.endPoint ? `${r.startPoint} → ${r.endPoint}` : '노선 정보',
          path: '/dashboard/routes',
        }));

        // Merge with page results (pages first)
        const currentPageResults = PAGE_ITEMS.filter(
          p => p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q)
        );
        setResults([...currentPageResults, ...driverResults, ...busResults, ...routeResults]);
        setSelectedIndex(0);
      } catch {
        // Keep page results on API error
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen]);

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      selectResult(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }, [results, selectedIndex, selectResult, close]);

  // ── Scroll selected item into view ──
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ── Group results by category ──
  const grouped = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    results.forEach(r => {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r);
    });
    return groups;
  }, [results]);

  if (!isOpen) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn"
        onClick={close}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-slideDown">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
          <Search className="text-gray-400 flex-shrink-0" size={22} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="검색어를 입력하세요... (기사, 노선, 차량, 페이지)"
            className="flex-1 text-[16px] text-gray-900 placeholder-gray-400 bg-transparent outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {isLoading && (
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          <button
            onClick={close}
            className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 bg-gray-100 rounded-md text-xs font-medium flex-shrink-0"
            title="닫기 (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto overscroll-contain">
          {results.length === 0 && query.trim() && !isLoading ? (
            <div className="px-5 py-12 text-center text-gray-400 text-[15px]">
              &ldquo;{query}&rdquo;에 대한 검색 결과가 없습니다.
            </div>
          ) : results.length === 0 && !query.trim() ? (
            <div className="px-5 py-12 text-center text-gray-400 text-[15px]">
              검색어를 입력하여 페이지, 기사, 차량, 노선을 찾으세요.
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <Fragment key={category}>
                {/* Category Header */}
                <div className="px-5 pt-3 pb-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50/80 sticky top-0">
                  {category === '최근 검색' && <History size={12} className="inline mr-1.5 -mt-0.5" />}
                  {category} <span className="text-gray-300 ml-1">{items.length}</span>
                </div>
                {items.map(item => {
                  flatIndex++;
                  const idx = flatIndex;
                  const isSelected = idx === selectedIndex;
                  const Icon = resolveIcon(item);
                  return (
                    <button
                      key={item.id}
                      data-index={idx}
                      onClick={() => selectResult(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full flex items-center gap-3.5 px-5 py-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-50 text-blue-900'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                        isSelected ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-medium truncate">{item.title}</p>
                        <p className="text-[13px] text-gray-400 truncate">{item.subtitle}</p>
                      </div>
                      {isSelected && (
                        <div className="flex-shrink-0 flex items-center gap-1 text-blue-400">
                          <ArrowRight size={16} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </Fragment>
            ))
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center gap-4 px-5 py-2.5 border-t border-gray-100 bg-gray-50/80 text-[12px] text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[11px] font-mono shadow-sm">
              <ChevronUp size={10} className="inline" />
            </kbd>
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[11px] font-mono shadow-sm">
              <ChevronDown size={10} className="inline" />
            </kbd>
            <span className="ml-0.5">탐색</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[11px] font-mono shadow-sm">
              <CornerDownLeft size={10} className="inline" />
            </kbd>
            <span className="ml-0.5">이동</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[11px] font-mono shadow-sm">Esc</kbd>
            <span className="ml-0.5">닫기</span>
          </span>
        </div>
      </div>

      {/* Tailwind animation keyframes (injected once) */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-16px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-fadeIn { animation: fadeIn 0.15s ease-out; }
        .animate-slideDown { animation: slideDown 0.2s ease-out; }
      `}</style>
    </div>
  );
}
