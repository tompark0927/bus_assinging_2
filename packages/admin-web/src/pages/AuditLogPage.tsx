import { useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { auditApi, usersApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Navigate } from 'react-router-dom';
import {
  ScrollText,
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  FileQuestion,
  Filter,
  X,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface AuditLogUser {
  id: number;
  name: string;
  employeeId: string;
  role: string;
}

interface AuditLog {
  id: number;
  companyId: number;
  userId: number;
  action: string;
  entityType: string;
  entityId: number;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: AuditLogUser;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

const ALLOWED_ROLES = ['OWNER', 'DIRECTOR'];

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  CREATE: { label: '생성', color: 'text-green-700', bg: 'bg-green-100' },
  UPDATE: { label: '수정', color: 'text-blue-700', bg: 'bg-blue-100' },
  DELETE: { label: '삭제', color: 'text-red-700', bg: 'bg-red-100' },
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  User: '사용자',
  Schedule: '배차표',
  ScheduleSlot: '배차 슬롯',
  Bus: '버스',
  Route: '노선',
  DayOffRequest: '휴무 요청',
  EmergencySlot: '긴급 슬롯',
  Rule: '규칙',
  Post: '게시글',
  Attendance: '근태',
  Incident: '사고',
  Training: '교육',
  Inspection: '점검',
  Company: '회사',
};

const ENTITY_TYPE_OPTIONS = Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const ACTION_OPTIONS = [
  { value: 'CREATE', label: '생성' },
  { value: 'UPDATE', label: '수정' },
  { value: 'DELETE', label: '삭제' },
];

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '(없음)';
  if (typeof val === 'boolean') return val ? '예' : '아니오';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

function summarizeChanges(changes: Record<string, { old: unknown; new: unknown }> | null): string {
  if (!changes || typeof changes !== 'object') return '-';
  const keys = Object.keys(changes);
  if (keys.length === 0) return '-';
  if (keys.length <= 3) return keys.join(', ') + ' 변경';
  return `${keys.slice(0, 3).join(', ')} 외 ${keys.length - 3}건 변경`;
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const info = ACTION_LABELS[action] || { label: action, color: 'text-gray-700', bg: 'bg-gray-100' };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${info.color} ${info.bg}`}>
      {info.label}
    </span>
  );
}

function ChangeDetail({ changes }: { changes: Record<string, { old: unknown; new: unknown }> | null }) {
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
    return <p className="text-base text-gray-500 py-4 px-6">변경 상세 정보가 없습니다.</p>;
  }

  return (
    <div className="px-6 py-4">
      <table className="w-full text-base">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="py-2 pr-4 font-medium w-1/4">필드</th>
            <th className="py-2 pr-4 font-medium w-[37.5%]">이전 값</th>
            <th className="py-2 font-medium w-[37.5%]">변경 값</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(changes).map(([field, diff]) => (
            <tr key={field} className="border-b border-gray-100 last:border-0">
              <td className="py-3 pr-4 font-medium text-gray-700">{field}</td>
              <td className="py-3 pr-4">
                <span className="inline-block bg-red-50 text-red-700 px-2 py-1 rounded text-sm font-mono break-all whitespace-pre-wrap max-w-xs">
                  {formatValue(diff?.old)}
                </span>
              </td>
              <td className="py-3">
                <span className="inline-block bg-green-50 text-green-700 px-2 py-1 rounded text-sm font-mono break-all whitespace-pre-wrap max-w-xs">
                  {formatValue(diff?.new)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────

export default function AuditLogPage() {
  const user = useAuthStore((s) => s.user);

  // Redirect non-authorized roles
  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <AuditLogContent />;
}

function AuditLogContent() {
  // Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const limit = 20;

  // Build query params
  const buildParams = useCallback(() => {
    const params: Record<string, string | number> = { page, limit };
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (entityType) params.entityType = entityType;
    if (action) params.action = action;
    if (selectedUserId) params.userId = Number(selectedUserId);
    return params;
  }, [page, startDate, endDate, entityType, action, selectedUserId]);

  // Fetch audit logs
  const {
    data: logsData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['audit-logs', page, startDate, endDate, entityType, action, selectedUserId],
    queryFn: () => auditApi.list(buildParams()).then((r) => r.data as { data: AuditLog[]; pagination: Pagination }),
    placeholderData: keepPreviousData,
  });

  // Fetch users for filter dropdown
  const { data: usersData } = useQuery({
    queryKey: ['users-for-audit-filter'],
    queryFn: () => usersApi.list().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const logs: AuditLog[] = logsData?.data || [];
  const pagination: Pagination | null = logsData?.pagination || null;
  const users: { id: number; name: string; employeeId: string }[] = usersData || [];

  const handleClearFilters = () => {
    setStartDate('');
    setEndDate('');
    setEntityType('');
    setAction('');
    setSelectedUserId('');
    setPage(1);
  };

  const hasActiveFilters = startDate || endDate || entityType || action || selectedUserId;

  const toggleRow = (id: number) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  return (
    <div className="max-w-full">
      {/* Header */}
      <PageHeader
        icon={ScrollText}
        title="감사 로그"
        description="시스템 변경 이력을 조회합니다"
        actions={
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-2 px-4 py-3 text-base font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors min-h-[48px]"
          >
            <Filter size={18} />
            필터 {showFilters ? '숨기기' : '보기'}
          </button>
        }
      />

      {/* Filters */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Date range - start */}
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-200 mb-2">시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>

            {/* Date range - end */}
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-200 mb-2">종료일</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>

            {/* Entity type */}
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-200 mb-2">대상 유형</label>
              <select
                value={entityType}
                onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
                className="w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="">전체</option>
                {ENTITY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Action type */}
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-200 mb-2">작업 유형</label>
              <select
                value={action}
                onChange={(e) => { setAction(e.target.value); setPage(1); }}
                className="w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="">전체</option>
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* User */}
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-200 mb-2">사용자</label>
              <select
                value={selectedUserId}
                onChange={(e) => { setSelectedUserId(e.target.value); setPage(1); }}
                className="w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="">전체</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleClearFilters}
                className="flex items-center gap-2 px-4 py-3 text-base font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors min-h-[48px]"
              >
                <X size={18} />
                필터 초기화
              </button>
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <Loader2 size={40} className="text-blue-500 animate-spin mb-4" />
          <p className="text-lg text-gray-500 dark:text-gray-400">감사 로그를 불러오는 중...</p>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-red-200 shadow-sm">
          <AlertCircle size={40} className="text-red-500 mb-4" />
          <p className="text-lg text-red-600 font-medium">오류가 발생했습니다</p>
          <p className="text-base text-gray-500 mt-2">
            {(error as Error)?.message || '감사 로그를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.'}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-gray-200 shadow-sm">
          <FileQuestion size={40} className="text-gray-400 mb-4" />
          <p className="text-lg text-gray-600 font-medium">감사 로그가 없습니다</p>
          <p className="text-base text-gray-500 mt-2">
            {hasActiveFilters ? '필터 조건을 변경해보세요.' : '아직 기록된 감사 로그가 없습니다.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && logs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">일시</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">사용자</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">작업</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">대상 유형</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">대상 ID</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">변경 요약</th>
                  <th className="text-center px-6 py-4 font-semibold text-gray-700 whitespace-nowrap w-16">상세</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isExpanded = expandedRow === log.id;
                  return (
                    <tr key={log.id} className="group">
                      <td colSpan={7} className="p-0">
                        {/* Main row */}
                        <div
                          className={`grid grid-cols-[minmax(180px,1fr)_minmax(120px,1fr)_100px_120px_80px_minmax(160px,1.5fr)_64px] items-center cursor-pointer hover:bg-gray-50 transition-colors ${
                            isExpanded ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => toggleRow(log.id)}
                        >
                          <div className="px-6 py-4 text-gray-600 whitespace-nowrap">
                            {formatDateTime(log.createdAt)}
                          </div>
                          <div className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                            {log.user?.name || `사용자 #${log.userId}`}
                          </div>
                          <div className="px-6 py-4">
                            <ActionBadge action={log.action} />
                          </div>
                          <div className="px-6 py-4 text-gray-700 whitespace-nowrap">
                            {ENTITY_TYPE_LABELS[log.entityType] || log.entityType}
                          </div>
                          <div className="px-6 py-4 text-gray-500 font-mono text-sm">
                            #{log.entityId}
                          </div>
                          <div className="px-6 py-4 text-gray-600 truncate">
                            {summarizeChanges(log.changes)}
                          </div>
                          <div className="px-6 py-4 text-center">
                            {isExpanded ? (
                              <ChevronUp size={20} className="text-blue-500 mx-auto" />
                            ) : (
                              <ChevronDown size={20} className="text-gray-400 mx-auto" />
                            )}
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="border-t border-gray-200 bg-gray-50">
                            <ChangeDetail changes={log.changes} />
                            {(log.ipAddress || log.userAgent) && (
                              <div className="px-6 pb-4 flex gap-6 text-sm text-gray-400">
                                {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                                {log.userAgent && (
                                  <span className="truncate max-w-md" title={log.userAgent}>
                                    UA: {log.userAgent}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
              <p className="text-base text-gray-600">
                전체 <span className="font-semibold">{pagination.total.toLocaleString()}</span>건 중{' '}
                <span className="font-semibold">
                  {((pagination.page - 1) * pagination.limit + 1).toLocaleString()}
                </span>
                -
                <span className="font-semibold">
                  {Math.min(pagination.page * pagination.limit, pagination.total).toLocaleString()}
                </span>
                건
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!pagination.hasPrev}
                  className="flex items-center gap-1 px-4 py-3 text-base font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[48px]"
                >
                  <ChevronLeft size={18} />
                  이전
                </button>
                <div className="flex items-center gap-1">
                  {generatePageNumbers(pagination.page, pagination.totalPages).map((p, idx) =>
                    p === '...' ? (
                      <span key={`ellipsis-${idx}`} className="px-2 py-1 text-gray-400">
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`min-w-[48px] min-h-[48px] px-3 py-2 text-base font-medium rounded-lg transition-colors ${
                          p === pagination.page
                            ? 'bg-blue-600 text-white'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={!pagination.hasNext}
                  className="flex items-center gap-1 px-4 py-3 text-base font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[48px]"
                >
                  다음
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Pagination helpers
// ─────────────────────────────────────────

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | string)[] = [1];

  if (current > 3) {
    pages.push('...');
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push('...');
  }

  pages.push(total);

  return pages;
}
