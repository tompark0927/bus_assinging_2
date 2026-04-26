/**
 * AI 에이전트 결정 추적 페이지 (Co-pilot 모드 핵심 UI).
 *
 * 관리자가 에이전트가 내린 결정을 검토하고 승인·거부하는 화면.
 * 거부 시 사유를 입력하면 PromptEvolver 가 다음 결정의 학습 컨텍스트로 사용한다.
 *
 * PHASE 4 자율 모드 진입 조건도 상단에 표시:
 *   - 14일 거부율 < 5%
 *   - 14일 실패율 < 5%
 *   - 샘플 ≥ 20건
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { agentDecisionsApi } from '../services/api';
import {
  Bot,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface ToolCall {
  tool: string;
  args: unknown;
  result?: unknown;
  error?: string;
  ts: string;
  durationMs: number;
}

interface AgentDecisionListItem {
  id: number;
  agentName: string;
  sessionId: string;
  triggerType: string;
  triggerRefId: number | null;
  finalAction: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'OVERRIDDEN';
  humanOverride: boolean;
  tokensIn: number;
  tokensOut: number;
  costKrw: number | string;
  durationMs: number;
  isSimulation: boolean;
  createdAt: string;
}

interface AgentDecisionDetail extends AgentDecisionListItem {
  toolCalls: ToolCall[];
  reasoning: string;
  errorMessage: string | null;
  overrideReason: string | null;
  overriddenById: number | null;
  overriddenBy?: { id: number; name: string; employeeId: string } | null;
}

interface ListResponse {
  items: AgentDecisionListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface StatsResponse {
  windowDays: number;
  agentName: string;
  total: number;
  completed: number;
  failed: number;
  overridden: number;
  overrideRate: number;
  failureRate: number;
  totalCostKrw: number | string;
  totalTokens: number;
  meetsAutonomyCriteria: boolean;
  blockers: string[];
}

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatKrw(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return `₩${n.toFixed(2)}`;
}

function statusBadge(item: { status: string; humanOverride: boolean; isSimulation: boolean }) {
  if (item.isSimulation) {
    return <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">시뮬레이션</span>;
  }
  if (item.humanOverride) {
    return <span className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-700">거부됨</span>;
  }
  if (item.status === 'COMPLETED') {
    return <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">완료</span>;
  }
  if (item.status === 'FAILED') {
    return <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">실패</span>;
  }
  return <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">{item.status}</span>;
}

function agentNameLabel(name: string): string {
  if (name === 'emergency') return '🚨 EmergencyAgent';
  if (name === 'dispatch') return '📅 DispatchAgent';
  return name;
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────

export default function AgentDecisionsPage() {
  const [page, setPage] = useState(1);
  const [filterAgent, setFilterAgent] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [includeSimulation, setIncludeSimulation] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pageSize = 30;

  const queryClient = useQueryClient();

  // ── 결정 목록 ──
  const listQuery = useQuery({
    queryKey: ['agent-decisions', page, filterAgent, filterStatus, includeSimulation],
    queryFn: () =>
      agentDecisionsApi
        .list({
          page,
          pageSize,
          ...(filterAgent ? { agentName: filterAgent } : {}),
          ...(filterStatus ? { status: filterStatus } : {}),
          isSimulation: includeSimulation,
        })
        .then((r) => r.data.data as ListResponse),
    placeholderData: keepPreviousData,
  });

  // ── 자율 모드 통계 (실 운영만) ──
  const statsQuery = useQuery({
    queryKey: ['agent-decisions-stats', filterAgent],
    queryFn: () =>
      agentDecisionsApi
        .stats({ days: 14, ...(filterAgent ? { agentName: filterAgent } : {}) })
        .then((r) => r.data.data as StatsResponse),
    refetchInterval: 60000,
  });

  // ── 상세 ──
  const detailQuery = useQuery({
    queryKey: ['agent-decision-detail', selectedId],
    queryFn: () =>
      selectedId
        ? agentDecisionsApi.detail(selectedId).then((r) => r.data.data as AgentDecisionDetail)
        : Promise.resolve(null),
    enabled: selectedId !== null,
  });

  // ── 오버라이드 ──
  const overrideMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      agentDecisionsApi.override(id, reason),
    onSuccess: () => {
      toast.success('결정이 거부되었습니다. 다음 결정에 학습됩니다.');
      queryClient.invalidateQueries({ queryKey: ['agent-decisions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-decision-detail'] });
      queryClient.invalidateQueries({ queryKey: ['agent-decisions-stats'] });
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? // @ts-expect-error narrow
            err.response?.data?.message ?? '거부 실패'
          : '거부 실패';
      toast.error(String(msg));
    },
  });

  const list = listQuery.data;
  const stats = statsQuery.data;
  const detail = detailQuery.data;

  return (
    <div className="max-w-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Bot size={28} className="text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">AI 에이전트 결정 추적</h1>
          <p className="text-base text-gray-500 dark:text-gray-400 mt-1">
            에이전트가 내린 결정을 검토하고 거부 사유는 다음 결정에 학습됩니다 (Co-pilot 모드)
          </p>
        </div>
      </div>

      {/* PHASE 4 자율 모드 통계 카드 */}
      {stats && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              자율 모드 진입 조건 ({stats.windowDays}일 기준)
            </h2>
            {stats.meetsAutonomyCriteria ? (
              <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-100 text-green-700 font-medium">
                <CheckCircle2 size={18} /> 자율 모드 가능
              </span>
            ) : (
              <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-orange-100 text-orange-700 font-medium">
                <AlertTriangle size={18} /> 미달
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="총 결정" value={stats.total.toString()} />
            <StatCard
              label="거부율"
              value={`${(stats.overrideRate * 100).toFixed(1)}%`}
              target="< 5%"
              good={stats.overrideRate < 0.05}
            />
            <StatCard
              label="실패율"
              value={`${(stats.failureRate * 100).toFixed(1)}%`}
              target="< 5%"
              good={stats.failureRate < 0.05}
            />
            <StatCard label="누적 비용" value={formatKrw(stats.totalCostKrw)} />
          </div>

          {stats.blockers.length > 0 && (
            <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
              <p className="text-sm font-medium text-orange-700 dark:text-orange-300 mb-1">미달 사유:</p>
              <ul className="text-sm text-orange-700 dark:text-orange-300 list-disc list-inside">
                {stats.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 필터 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={filterAgent}
            onChange={(e) => {
              setFilterAgent(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          >
            <option value="">모든 에이전트</option>
            <option value="emergency">EmergencyAgent</option>
            <option value="dispatch">DispatchAgent</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          >
            <option value="">모든 상태</option>
            <option value="COMPLETED">완료</option>
            <option value="FAILED">실패</option>
            <option value="OVERRIDDEN">거부됨</option>
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSimulation}
              onChange={(e) => {
                setIncludeSimulation(e.target.checked);
                setPage(1);
              }}
              className="w-4 h-4"
            />
            시뮬레이션 포함
          </label>
        </div>
      </div>

      {/* 본문: 좌측 목록 + 우측 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 목록 */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
          ) : list && list.items.length > 0 ? (
            <>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 text-left">
                  <tr>
                    <th className="px-4 py-3">시각</th>
                    <th className="px-4 py-3">에이전트</th>
                    <th className="px-4 py-3">결정 요약</th>
                    <th className="px-4 py-3">상태</th>
                    <th className="px-4 py-3 text-right">비용</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className={`border-t border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                        selectedId === d.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatDateTime(d.createdAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{agentNameLabel(d.agentName)}</td>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100 max-w-md truncate">
                        {d.finalAction}
                      </td>
                      <td className="px-4 py-3">{statusBadge(d)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                        {formatKrw(d.costKrw)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 페이지네이션 */}
              {list.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
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
                      {list.page} / {list.totalPages}
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
              <Bot size={40} className="mb-3 text-gray-300" />
              <p>아직 기록된 에이전트 결정이 없습니다.</p>
              <p className="text-sm mt-2">
                EmergencyAgent 가 활성화되면 결원 발생 시 자동으로 결정이 기록됩니다.
              </p>
            </div>
          )}
        </div>

        {/* 상세 패널 */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <p className="text-sm">결정을 선택하면 상세 내용이 표시됩니다</p>
            </div>
          ) : detailQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={24} />
            </div>
          ) : detail ? (
            <DetailPanel
              detail={detail}
              onOverride={(reason) => overrideMutation.mutate({ id: detail.id, reason })}
              isOverriding={overrideMutation.isPending}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// 통계 카드
// ─────────────────────────────────────────

function StatCard({
  label,
  value,
  target,
  good,
}: {
  label: string;
  value: string;
  target?: string;
  good?: boolean;
}) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        {good !== undefined &&
          (good ? (
            <TrendingUp size={14} className="text-green-600" />
          ) : (
            <TrendingDown size={14} className="text-orange-600" />
          ))}
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</p>
      {target && <p className="text-xs text-gray-400 mt-1">목표 {target}</p>}
    </div>
  );
}

// ─────────────────────────────────────────
// 상세 패널
// ─────────────────────────────────────────

function DetailPanel({
  detail,
  onOverride,
  isOverriding,
  onClose,
}: {
  detail: AgentDecisionDetail;
  onOverride: (reason: string) => void;
  isOverriding: boolean;
  onClose: () => void;
}) {
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    if (reason.trim().length < 5) {
      toast.error('거부 사유는 최소 5자 이상 입력하세요 (학습 데이터로 사용됨)');
      return;
    }
    onOverride(reason.trim());
    setShowOverrideForm(false);
    setReason('');
  };

  return (
    <div className="p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-gray-500">{agentNameLabel(detail.agentName)}</p>
          <p className="text-xs text-gray-400 mt-1">{detail.sessionId}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <XCircle size={18} />
        </button>
      </div>

      {/* 결정 + 추론 */}
      <div className="mb-4">
        <p className="text-xs uppercase text-gray-500 mb-1">최종 결정</p>
        <p className="text-sm text-gray-900 dark:text-gray-100 font-medium">{detail.finalAction}</p>
      </div>

      <div className="mb-4">
        <p className="text-xs uppercase text-gray-500 mb-1">추론</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {detail.reasoning}
        </p>
      </div>

      {detail.errorMessage && (
        <div className="mb-4 p-2 bg-red-50 rounded border border-red-200">
          <p className="text-xs text-red-700">{detail.errorMessage}</p>
        </div>
      )}

      {/* 도구 호출 */}
      <div className="mb-4">
        <p className="text-xs uppercase text-gray-500 mb-2">
          도구 호출 ({detail.toolCalls.length})
        </p>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {detail.toolCalls.map((call, i) => (
            <div
              key={i}
              className={`p-2 rounded text-xs border ${
                call.error
                  ? 'bg-red-50 border-red-200'
                  : 'bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium">{call.tool}</span>
                <span className="text-gray-400">{call.durationMs}ms</span>
              </div>
              {call.error ? (
                <p className="text-red-700 mt-1">에러: {call.error}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* 오버라이드 영역 */}
      {detail.humanOverride ? (
        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300 mb-1">
            거부됨 — {detail.overriddenBy?.name}
          </p>
          <p className="text-sm text-orange-900 dark:text-orange-100">{detail.overrideReason}</p>
        </div>
      ) : showOverrideForm ? (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="거부 사유 (5자 이상 — 다음 결정에 학습됨)"
            rows={3}
            className="w-full p-2 text-sm border border-gray-300 rounded-lg"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={isOverriding}
              className="flex-1 px-3 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
            >
              거부 확정
            </button>
            <button
              onClick={() => setShowOverrideForm(false)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowOverrideForm(true)}
          className="w-full px-3 py-2 border border-orange-300 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-50"
        >
          이 결정 거부하기
        </button>
      )}
    </div>
  );
}
