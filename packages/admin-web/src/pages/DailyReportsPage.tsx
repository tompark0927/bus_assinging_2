/**
 * 일일 운영 보고서 페이지.
 *
 * 매일 09:00 KST DailyReportAgent 가 작성한 회사 운영 보고서를 열람·읽음 처리·재생성.
 * 좌측: 보고서 목록 (날짜 + severity 배지 + 읽음 상태)
 * 우측: 선택된 보고서 본문 (마크다운) + 구조화 요약 + 읽음 처리 버튼
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { dailyReportsApi } from '../services/api';
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface DailyReportListItem {
  id: number;
  reportDate: string;
  generatedAt: string;
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
  isRead: boolean;
  readById: number | null;
  readAt: string | null;
  summary: Record<string, unknown>;
}

interface DailyReportDetail extends DailyReportListItem {
  content: string;
  agentDecisionId: number | null;
  readBy: { id: number; name: string; employeeId: string } | null;
}

interface ListResponse {
  items: DailyReportListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function severityBadge(severity: 'INFO' | 'ATTENTION' | 'URGENT') {
  if (severity === 'URGENT') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">
        <AlertCircle size={12} /> URGENT
      </span>
    );
  }
  if (severity === 'ATTENTION') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-700">
        <AlertTriangle size={12} /> ATTENTION
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">
      <FileText size={12} /> INFO
    </span>
  );
}

/**
 * 매우 간단한 마크다운 → JSX 변환기.
 * react-markdown 없이 ## 제목 / - 목록 / 일반 단락만 처리.
 */
function renderMarkdown(content: string): JSX.Element {
  const lines = content.split('\n');
  const blocks: JSX.Element[] = [];
  let currentList: string[] = [];
  let key = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push(
        <ul key={`ul-${key++}`} className="list-disc list-inside space-y-1 my-2 text-gray-700 dark:text-gray-300">
          {currentList.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      flushList();
      blocks.push(
        <h2 key={`h2-${key++}`} className="text-xl font-bold mt-6 mb-2 text-gray-900 dark:text-gray-100">
          {line.replace(/^##\s*/, '')}
        </h2>
      );
    } else if (line.startsWith('# ')) {
      flushList();
      blocks.push(
        <h1 key={`h1-${key++}`} className="text-2xl font-bold mt-6 mb-3 text-gray-900 dark:text-gray-100">
          {line.replace(/^#\s*/, '')}
        </h1>
      );
    } else if (line.startsWith('- ')) {
      currentList.push(line.replace(/^-\s*/, ''));
    } else if (line.length === 0) {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={`p-${key++}`} className="my-2 text-gray-700 dark:text-gray-300 leading-relaxed">
          {line}
        </p>
      );
    }
  }
  flushList();

  return <div>{blocks}</div>;
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────

export default function DailyReportsPage() {
  const [page, setPage] = useState(1);
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pageSize = 30;

  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['daily-reports', page, filterSeverity, unreadOnly],
    queryFn: () =>
      dailyReportsApi
        .list({
          page,
          pageSize,
          ...(filterSeverity ? { severity: filterSeverity } : {}),
          ...(unreadOnly ? { isRead: false } : {}),
        })
        .then((r) => r.data.data as ListResponse),
    placeholderData: keepPreviousData,
  });

  const detailQuery = useQuery({
    queryKey: ['daily-report-detail', selectedId],
    queryFn: () =>
      selectedId
        ? dailyReportsApi.detail(selectedId).then((r) => r.data.data as DailyReportDetail)
        : Promise.resolve(null),
    enabled: selectedId !== null,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => dailyReportsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['daily-report-detail'] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => dailyReportsApi.regenerate(),
    onSuccess: () => {
      toast.success('재생성 완료');
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? // @ts-expect-error narrow
            err.response?.data?.message ?? '재생성 실패'
          : '재생성 실패';
      toast.error(String(msg));
    },
  });

  const list = listQuery.data;
  const detail = detailQuery.data;

  return (
    <div className="max-w-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText size={28} className="text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">일일 운영 보고서</h1>
            <p className="text-base text-gray-500 dark:text-gray-400 mt-1">
              매일 09:00 AI 에이전트가 작성하는 회사 운영 보고서
            </p>
          </div>
        </div>

        <button
          onClick={() => regenerateMutation.mutate()}
          disabled={regenerateMutation.isPending}
          className="flex items-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 min-h-[48px]"
        >
          {regenerateMutation.isPending ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <RefreshCw size={18} />
          )}
          오늘 재생성
        </button>
      </div>

      {/* 필터 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={filterSeverity}
            onChange={(e) => {
              setFilterSeverity(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          >
            <option value="">모든 우선순위</option>
            <option value="URGENT">URGENT</option>
            <option value="ATTENTION">ATTENTION</option>
            <option value="INFO">INFO</option>
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => {
                setUnreadOnly(e.target.checked);
                setPage(1);
              }}
              className="w-4 h-4"
            />
            안 읽은 보고서만
          </label>
        </div>
      </div>

      {/* 본문: 좌측 목록 + 우측 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 목록 */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-purple-600" size={32} />
            </div>
          ) : list && list.items.length > 0 ? (
            <>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {list.items.map((report) => (
                  <button
                    key={report.id}
                    onClick={() => setSelectedId(report.id)}
                    className={`w-full text-left p-4 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors ${
                      selectedId === report.id ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                    } ${!report.isRead ? 'font-semibold' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-base text-gray-900 dark:text-gray-100">
                        {formatDate(report.reportDate)}
                      </span>
                      {severityBadge(report.severity)}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>발행 {formatDateTime(report.generatedAt)}</span>
                      {report.isRead ? (
                        <CheckCircle2 size={12} className="text-green-500" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-purple-500" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* 페이지네이션 */}
              {list.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {list.total}건 중 {(list.page - 1) * list.pageSize + 1}-
                    {Math.min(list.page * list.pageSize, list.total)}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm">
                      {list.page}/{list.totalPages}
                    </span>
                    <button
                      disabled={page >= list.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <FileText size={40} className="mb-3 text-gray-300" />
              <p className="text-sm">아직 작성된 보고서가 없습니다.</p>
              <p className="text-xs mt-2 text-center">
                DailyReportAgent 가 활성화되면 매일 09:00 자동 작성됩니다.
              </p>
            </div>
          )}
        </div>

        {/* 상세 */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <p className="text-sm">보고서를 선택하면 본문이 표시됩니다</p>
            </div>
          ) : detailQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-purple-600" size={32} />
            </div>
          ) : detail ? (
            <div className="p-6">
              {/* 상세 헤더 */}
              <div className="flex items-start justify-between mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {formatDate(detail.reportDate)}
                    </h2>
                    {severityBadge(detail.severity)}
                  </div>
                  <p className="text-xs text-gray-500">
                    AI 에이전트 작성 · {formatDateTime(detail.generatedAt)}
                  </p>
                  {detail.readBy && (
                    <p className="text-xs text-gray-400 mt-1">
                      읽음: {detail.readBy.name} ({formatDateTime(detail.readAt!)})
                    </p>
                  )}
                </div>

                {!detail.isRead && (
                  <button
                    onClick={() => markReadMutation.mutate(detail.id)}
                    disabled={markReadMutation.isPending}
                    className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    <Eye size={14} />
                    읽음 처리
                  </button>
                )}
              </div>

              {/* 본문 (마크다운) */}
              <div className="prose prose-sm max-w-none">{renderMarkdown(detail.content)}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
