import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  FileText,
  Plus,
  Check,
  X,
  Clock,
  Send,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  FileQuestion,
  UserCheck,
  ArrowRight,
  MessageSquare,
  Calendar,
  User as UserIcon,
  Hash,
  Trash2,
} from 'lucide-react';
import { approvalsApi, usersApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

// ── Types ────────────────────────────────────────────────
type ApprovalType = 'DAY_OFF' | 'SHIFT_CHANGE' | 'EXPENSE' | 'MAINTENANCE' | 'INCIDENT' | 'PURCHASE' | 'OTHER';
type ApprovalStatus = 'DRAFT' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type TabKey = 'ALL' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

interface ApprovalStep {
  id: number;
  step: number;
  approverId: number;
  status: string;
  comment: string | null;
  actedAt: string | null;
  approver: { id: number; name: string; role: string };
}

interface Approval {
  id: number;
  type: ApprovalType;
  title: string;
  content: string;
  data: any;
  status: ApprovalStatus;
  requesterId: number;
  currentStep: number;
  totalSteps: number;
  rejectReason: string | null;
  completedAt: string | null;
  createdAt: string;
  requester: { id: number; name: string; employeeId: string };
  steps: ApprovalStep[];
}

interface AdminUser {
  id: number;
  name: string;
  role: string;
  employeeId: string;
  isActive?: boolean;
}

// ── Constants ────────────────────────────────────────────
const TYPE_CONFIG: Record<ApprovalType, { label: string; color: string; bgColor: string }> = {
  DAY_OFF:      { label: '휴무신청', color: 'text-blue-700',   bgColor: 'bg-blue-100' },
  SHIFT_CHANGE: { label: '근무변경', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  EXPENSE:      { label: '경비청구', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  MAINTENANCE:  { label: '정비요청', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  INCIDENT:     { label: '사고보고', color: 'text-red-700',    bgColor: 'bg-red-100' },
  PURCHASE:     { label: '구매요청', color: 'text-teal-700',   bgColor: 'bg-teal-100' },
  OTHER:        { label: '기타',     color: 'text-gray-600',   bgColor: 'bg-gray-100' },
};

const STATUS_CONFIG: Record<ApprovalStatus, { label: string; color: string; bgColor: string; dotColor: string }> = {
  DRAFT:     { label: '임시저장', color: 'text-gray-600',   bgColor: 'bg-gray-100',   dotColor: 'bg-gray-400' },
  PENDING:   { label: '대기중',   color: 'text-yellow-700', bgColor: 'bg-yellow-100', dotColor: 'bg-yellow-500' },
  IN_REVIEW: { label: '진행중',   color: 'text-blue-700',   bgColor: 'bg-blue-100',   dotColor: 'bg-blue-500' },
  APPROVED:  { label: '승인됨',   color: 'text-green-700',  bgColor: 'bg-green-100',  dotColor: 'bg-green-500' },
  REJECTED:  { label: '반려됨',   color: 'text-red-700',    bgColor: 'bg-red-100',    dotColor: 'bg-red-500' },
  CANCELLED: { label: '취소됨',   color: 'text-gray-500',   bgColor: 'bg-gray-100',   dotColor: 'bg-gray-400' },
};

const STEP_STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  APPROVED: '승인',
  REJECTED: '반려',
  IN_REVIEW: '검토중',
};

const TABS: { key: TabKey; label: string; statusFilter?: string }[] = [
  { key: 'ALL',       label: '전체' },
  { key: 'PENDING',   label: '대기중',  statusFilter: 'PENDING' },
  { key: 'IN_REVIEW', label: '진행중',  statusFilter: 'IN_REVIEW' },
  { key: 'APPROVED',  label: '승인됨',  statusFilter: 'APPROVED' },
  { key: 'REJECTED',  label: '반려됨',  statusFilter: 'REJECTED' },
];

const ROLE_LABELS: Record<string, string> = {
  OWNER: '대표이사',
  DIRECTOR: '관리소장',
  DISPATCH: '배차담당',
  HR: '총무/인사',
  ACCOUNTING: '경리/회계',
  SAFETY_MGR: '안전관리자',
  ADMIN: '관리자',
  DRIVER: '기사',
};

// ── Utility ──────────────────────────────────────────────
function formatDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'yyyy년 M월 d일', { locale: ko });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'yyyy년 M월 d일 HH:mm', { locale: ko });
  } catch {
    return dateStr;
  }
}

// ── Main Component ───────────────────────────────────────
export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<TabKey>('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [processModal, setProcessModal] = useState<{ id: number; action: 'approve' | 'reject' } | null>(null);
  const [processComment, setProcessComment] = useState('');

  // ── Queries ──────────────────────────────
  const queryParams = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab);
    return tab?.statusFilter ? { status: tab.statusFilter } : {};
  }, [activeTab]);

  const {
    data: approvals = [],
    isLoading,
    isError,
    error,
  } = useQuery<Approval[]>({
    queryKey: ['approvals', activeTab],
    queryFn: () => approvalsApi.list(queryParams as Record<string, string>).then((r) => r.data.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['approval-stats'],
    queryFn: () => approvalsApi.stats().then((r) => r.data.data),
  });

  // ── Mutations ──────────────────────────────
  const processMutation = useMutation({
    mutationFn: ({ id, action, comment }: { id: number; action: 'approve' | 'reject'; comment: string }) =>
      approvalsApi.process(id, action, comment),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      toast.success(vars.action === 'approve' ? '결재가 승인되었습니다.' : '결재가 반려되었습니다.');
      setProcessModal(null);
      setProcessComment('');
      setExpandedId(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || '처리 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => approvalsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      toast.success('결재가 취소되었습니다.');
      setExpandedId(null);
    },
    onError: () => {
      toast.error('취소 중 오류가 발생했습니다.');
    },
  });

  const handleProcess = useCallback(() => {
    if (!processModal) return;
    if (processModal.action === 'reject' && !processComment.trim()) {
      toast.error('반려 사유를 입력해주세요.');
      return;
    }
    processMutation.mutate({
      id: processModal.id,
      action: processModal.action,
      comment: processComment,
    });
  }, [processModal, processComment, processMutation]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Count for tab badges
  const tabCounts: Partial<Record<TabKey, number>> = {
    ALL: stats?.total ?? approvals.length,
    PENDING: stats?.pending ?? 0,
    IN_REVIEW: stats?.inReview ?? 0,
    APPROVED: stats?.approved ?? 0,
    REJECTED: stats?.rejected ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <FileText size={28} className="text-blue-600" />
            전자결재
          </h1>
          <p className="text-gray-500 mt-1 text-[16px]">결재 문서를 조회하고 승인 또는 반려합니다.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 px-7 py-3.5 bg-blue-600 text-white rounded-xl font-semibold text-[16px] hover:bg-blue-700 active:bg-blue-800 transition-colors min-h-[48px] shadow-sm"
        >
          <Plus size={22} strokeWidth={2.5} />
          새 결재 기안
        </button>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="대기중"
          value={stats?.pending ?? 0}
          bgColor="bg-yellow-50"
          borderColor="border-yellow-200"
          textColor="text-yellow-700"
          icon={<Clock size={26} />}
        />
        <StatsCard
          label="진행중"
          value={stats?.inReview ?? 0}
          bgColor="bg-blue-50"
          borderColor="border-blue-200"
          textColor="text-blue-700"
          icon={<Send size={26} />}
        />
        <StatsCard
          label="승인됨"
          value={stats?.approved ?? 0}
          bgColor="bg-green-50"
          borderColor="border-green-200"
          textColor="text-green-700"
          icon={<Check size={26} />}
        />
        <StatsCard
          label="반려됨"
          value={stats?.rejected ?? 0}
          bgColor="bg-red-50"
          borderColor="border-red-200"
          textColor="text-red-700"
          icon={<X size={26} />}
        />
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((tab) => {
          const count = tabCounts[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-[16px] transition-all min-h-[48px] ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              {tab.label}
              {count !== undefined && count > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-[13px] font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as any)?.message || '결재 목록을 불러오지 못했습니다.'} />
      ) : approvals.length === 0 ? (
        <EmptyState activeTab={activeTab} />
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              isExpanded={expandedId === approval.id}
              currentUserId={currentUser?.id ?? 0}
              onToggleExpand={() => toggleExpand(approval.id)}
              onApprove={(id) => {
                setProcessModal({ id, action: 'approve' });
                setProcessComment('');
              }}
              onReject={(id) => {
                setProcessModal({ id, action: 'reject' });
                setProcessComment('');
              }}
              onCancel={(id) => {
                if (window.confirm('이 결재를 취소하시겠습니까?')) {
                  cancelMutation.mutate(id);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* ── Create Modal ── */}
      {showCreateModal && (
        <CreateApprovalModal onClose={() => setShowCreateModal(false)} />
      )}

      {/* ── Process (Approve/Reject) Modal ── */}
      {processModal && (
        <ProcessModal
          action={processModal.action}
          isPending={processMutation.isPending}
          comment={processComment}
          onCommentChange={setProcessComment}
          onConfirm={handleProcess}
          onClose={() => {
            setProcessModal(null);
            setProcessComment('');
          }}
        />
      )}
    </div>
  );
}

// ── Stats Card ───────────────────────────────────────────
function StatsCard({
  label,
  value,
  bgColor,
  borderColor,
  textColor,
  icon,
}: {
  label: string;
  value: number;
  bgColor: string;
  borderColor: string;
  textColor: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border-2 p-5 ${bgColor} ${borderColor}`}>
      <div className={`flex items-center justify-between mb-2 ${textColor}`}>
        <span className="text-[16px] font-semibold">{label}</span>
        {icon}
      </div>
      <p className={`text-3xl font-bold ${textColor}`}>{value}</p>
    </div>
  );
}

// ── Loading State ────────────────────────────────────────
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 size={40} className="animate-spin text-blue-500 mb-4" />
      <p className="text-gray-500 text-[16px]">결재 목록을 불러오는 중입니다...</p>
    </div>
  );
}

// ── Error State ──────────────────────────────────────────
function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border-2 border-red-200 rounded-xl p-10 text-center">
      <AlertCircle size={48} className="mx-auto text-red-400 mb-4" />
      <p className="text-red-700 text-[18px] font-semibold mb-2">오류가 발생했습니다</p>
      <p className="text-red-500 text-[16px]">{message}</p>
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────
function EmptyState({ activeTab }: { activeTab: TabKey }) {
  const tabLabel = TABS.find((t) => t.key === activeTab)?.label ?? '전체';
  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-14 text-center">
      <FileQuestion size={56} className="mx-auto text-gray-300 mb-4" />
      <p className="text-gray-500 text-[18px] font-medium">
        {activeTab === 'ALL' ? '등록된 결재 문서가 없습니다.' : `"${tabLabel}" 상태의 결재 문서가 없습니다.`}
      </p>
      <p className="text-gray-400 text-[16px] mt-2">
        상단의 "새 결재 기안" 버튼으로 결재를 생성하세요.
      </p>
    </div>
  );
}

// ── Approval Card ────────────────────────────────────────
function ApprovalCard({
  approval,
  isExpanded,
  currentUserId,
  onToggleExpand,
  onApprove,
  onReject,
  onCancel,
}: {
  approval: Approval;
  isExpanded: boolean;
  currentUserId: number;
  onToggleExpand: () => void;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  const typeConfig = TYPE_CONFIG[approval.type] || TYPE_CONFIG.OTHER;
  const statusConfig = STATUS_CONFIG[approval.status] || STATUS_CONFIG.PENDING;

  // Check if the current user is the approver for the current step
  const currentStepData = approval.steps.find(
    (s) => s.step === approval.currentStep && s.status === 'PENDING'
  );
  const isCurrentApprover = currentStepData?.approverId === currentUserId;
  const isPendingOrReview = approval.status === 'PENDING' || approval.status === 'IN_REVIEW';
  const canAct = isPendingOrReview && isCurrentApprover;
  const isRequester = approval.requesterId === currentUserId;
  const canCancel = isRequester && (approval.status === 'PENDING' || approval.status === 'DRAFT');

  return (
    <div
      className={`bg-white rounded-xl border-2 transition-all ${
        isExpanded ? 'border-blue-300 shadow-lg' : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
      }`}
    >
      {/* ── Collapsed Header ── */}
      <button
        onClick={onToggleExpand}
        className="w-full p-5 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded-xl"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Left: type badge + title */}
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span
              className={`inline-flex items-center px-3.5 py-1.5 rounded-lg text-[14px] font-bold ${typeConfig.bgColor} ${typeConfig.color}`}
            >
              {typeConfig.label}
            </span>
            <h3 className="text-[18px] font-bold text-gray-900 truncate">{approval.title}</h3>
          </div>
          {/* Right: status + expand icon */}
          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[14px] font-bold ${statusConfig.bgColor} ${statusConfig.color}`}
            >
              <span className={`w-2 h-2 rounded-full ${statusConfig.dotColor}`} />
              {statusConfig.label}
            </span>
            {isExpanded ? (
              <ChevronUp size={22} className="text-gray-400" />
            ) : (
              <ChevronDown size={22} className="text-gray-400" />
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-[15px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <UserIcon size={16} />
            기안자: <strong className="text-gray-700">{approval.requester.name}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <Hash size={16} />
            {approval.requester.employeeId}
          </span>
          {approval.data?.date && (
            <span className="flex items-center gap-1.5 text-blue-600 font-bold">
              <Calendar size={16} />
              희망일: {formatDate(approval.data.date)}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Calendar size={16} />
            {formatDate(approval.createdAt)}
          </span>
          {approval.totalSteps > 0 && (
            <span className="flex items-center gap-1.5">
              <UserCheck size={16} />
              결재 {approval.currentStep}/{approval.totalSteps}단계
            </span>
          )}
        </div>

        {/* Step progress dots (compact) */}
        {approval.totalSteps > 0 && (
          <div className="flex items-center gap-1.5 mt-3">
            {approval.steps.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-1.5">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-[13px] font-bold border-2 ${
                    step.status === 'APPROVED'
                      ? 'bg-green-500 border-green-500 text-white'
                      : step.status === 'REJECTED'
                        ? 'bg-red-500 border-red-500 text-white'
                        : step.status === 'PENDING' || step.status === 'IN_REVIEW'
                          ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
                          : 'bg-gray-100 border-gray-300 text-gray-400'
                  }`}
                  title={`${step.approver.name} - ${STEP_STATUS_LABEL[step.status] ?? step.status}`}
                >
                  {step.status === 'APPROVED' ? (
                    <Check size={14} strokeWidth={3} />
                  ) : step.status === 'REJECTED' ? (
                    <X size={14} strokeWidth={3} />
                  ) : (
                    step.step + 1
                  )}
                </div>
                {idx < approval.steps.length - 1 && (
                  <ArrowRight size={14} className="text-gray-300" />
                )}
              </div>
            ))}
          </div>
        )}
      </button>

      {/* Quick Action Buttons (visible without expanding) */}
      {canAct && (
        <div className="flex gap-3 px-5 pb-4 -mt-1">
          <button
            onClick={(e) => { e.stopPropagation(); onApprove(approval.id); }}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold text-[15px] hover:bg-green-700 active:bg-green-800 transition-colors shadow-sm"
          >
            <Check size={18} strokeWidth={2.5} />
            승인
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReject(approval.id); }}
            className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-xl font-bold text-[15px] hover:bg-red-700 active:bg-red-800 transition-colors shadow-sm"
          >
            <X size={18} strokeWidth={2.5} />
            반려
          </button>
        </div>
      )}

      {/* ── Expanded Detail ── */}
      {isExpanded && (
        <div className="border-t-2 border-gray-100 px-5 pb-5">
          {/* Content */}
          <div className="mt-5">
            <h4 className="text-[16px] font-bold text-gray-700 mb-2 flex items-center gap-2">
              <FileText size={18} />
              결재 내용
            </h4>
            <div className="bg-gray-50 rounded-lg p-4 text-[16px] text-gray-800 leading-relaxed whitespace-pre-wrap min-h-[60px]">
              {approval.content || '(내용 없음)'}
            </div>
          </div>

          {/* Rejection reason */}
          {approval.rejectReason && (
            <div className="mt-4 bg-red-50 border-2 border-red-200 rounded-lg p-4">
              <p className="text-[15px] font-bold text-red-700 mb-1 flex items-center gap-2">
                <AlertCircle size={18} />
                반려 사유
              </p>
              <p className="text-[16px] text-red-600">{approval.rejectReason}</p>
            </div>
          )}

          {/* Approval Steps Detail */}
          {approval.steps.length > 0 && (
            <div className="mt-5">
              <h4 className="text-[16px] font-bold text-gray-700 mb-3 flex items-center gap-2">
                <UserCheck size={18} />
                결재 단계 상세
              </h4>
              <div className="space-y-3">
                {approval.steps.map((step) => {
                  const stepStatusLabel = STEP_STATUS_LABEL[step.status] ?? step.status;
                  const isStepApproved = step.status === 'APPROVED';
                  const isStepRejected = step.status === 'REJECTED';
                  const isStepPending = step.status === 'PENDING' || step.status === 'IN_REVIEW';

                  return (
                    <div
                      key={step.id}
                      className={`flex flex-col sm:flex-row sm:items-start gap-3 rounded-lg p-4 border-2 ${
                        isStepApproved
                          ? 'bg-green-50 border-green-200'
                          : isStepRejected
                            ? 'bg-red-50 border-red-200'
                            : isStepPending
                              ? 'bg-yellow-50 border-yellow-200'
                              : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      {/* Step number */}
                      <div
                        className={`flex items-center justify-center w-10 h-10 rounded-full text-[15px] font-bold shrink-0 ${
                          isStepApproved
                            ? 'bg-green-500 text-white'
                            : isStepRejected
                              ? 'bg-red-500 text-white'
                              : 'bg-yellow-400 text-white'
                        }`}
                      >
                        {isStepApproved ? (
                          <Check size={20} strokeWidth={3} />
                        ) : isStepRejected ? (
                          <X size={20} strokeWidth={3} />
                        ) : (
                          step.step + 1
                        )}
                      </div>
                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[16px]">
                          <span className="font-bold text-gray-900">{step.approver.name}</span>
                          <span className="text-gray-400">
                            ({ROLE_LABELS[step.approver.role] ?? step.approver.role})
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded text-[13px] font-bold ${
                              isStepApproved
                                ? 'bg-green-200 text-green-800'
                                : isStepRejected
                                  ? 'bg-red-200 text-red-800'
                                  : 'bg-yellow-200 text-yellow-800'
                            }`}
                          >
                            {stepStatusLabel}
                          </span>
                        </div>
                        {step.actedAt && (
                          <p className="text-[14px] text-gray-400 mt-1">
                            처리 일시: {formatDateTime(step.actedAt)}
                          </p>
                        )}
                        {step.comment && (
                          <div className="mt-2 flex items-start gap-2 text-[15px] text-gray-600">
                            <MessageSquare size={16} className="mt-0.5 shrink-0 text-gray-400" />
                            <span>{step.comment}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed info */}
          {approval.completedAt && (
            <p className="mt-4 text-[15px] text-gray-500">
              최종 완료: {formatDateTime(approval.completedAt)}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t-2 border-gray-100">
            {canAct && (
              <>
                <button
                  onClick={() => onApprove(approval.id)}
                  className="flex items-center gap-2 px-7 py-3.5 bg-green-600 text-white rounded-xl font-bold text-[16px] hover:bg-green-700 active:bg-green-800 transition-colors min-h-[48px] shadow-sm"
                >
                  <Check size={20} strokeWidth={2.5} />
                  승인
                </button>
                <button
                  onClick={() => onReject(approval.id)}
                  className="flex items-center gap-2 px-7 py-3.5 bg-red-600 text-white rounded-xl font-bold text-[16px] hover:bg-red-700 active:bg-red-800 transition-colors min-h-[48px] shadow-sm"
                >
                  <X size={20} strokeWidth={2.5} />
                  반려
                </button>
              </>
            )}
            {canCancel && (
              <button
                onClick={() => onCancel(approval.id)}
                className="flex items-center gap-2 px-7 py-3.5 bg-gray-100 text-gray-700 rounded-xl font-bold text-[16px] hover:bg-gray-200 active:bg-gray-300 transition-colors min-h-[48px] border-2 border-gray-300"
              >
                <Trash2 size={20} />
                기안 취소
              </button>
            )}
            {!canAct && !canCancel && (
              <p className="text-[15px] text-gray-400 py-3">
                {isPendingOrReview
                  ? '현재 단계의 결재자만 승인/반려할 수 있습니다.'
                  : approval.status === 'APPROVED'
                    ? '승인 완료된 결재입니다.'
                    : approval.status === 'REJECTED'
                      ? '반려된 결재입니다.'
                      : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Process Modal (Approve / Reject) ─────────────────────
function ProcessModal({
  action,
  isPending,
  comment,
  onCommentChange,
  onConfirm,
  onClose,
}: {
  action: 'approve' | 'reject';
  isPending: boolean;
  comment: string;
  onCommentChange: (val: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isApprove = action === 'approve';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          {isApprove ? (
            <Check size={24} className="text-green-600" />
          ) : (
            <X size={24} className="text-red-600" />
          )}
          {isApprove ? '결재 승인' : '결재 반려'}
        </h2>

        <div>
          <label className="block text-[16px] font-semibold text-gray-700 mb-2">
            {isApprove ? '승인 의견 (선택사항)' : '반려 사유 (필수)'}
          </label>
          <textarea
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder={
              isApprove
                ? '승인 의견이 있으시면 입력해주세요...'
                : '반려 사유를 반드시 입력해주세요...'
            }
            rows={4}
            autoFocus
            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-7 py-3.5 rounded-xl border-2 border-gray-300 text-gray-700 font-bold text-[16px] hover:bg-gray-50 min-h-[48px]"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[16px] text-white min-h-[48px] transition-colors shadow-sm ${
              isApprove
                ? 'bg-green-600 hover:bg-green-700 active:bg-green-800'
                : 'bg-red-600 hover:bg-red-700 active:bg-red-800'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isPending ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                처리 중...
              </>
            ) : isApprove ? (
              <>
                <Check size={18} strokeWidth={2.5} />
                승인 확인
              </>
            ) : (
              <>
                <X size={18} strokeWidth={2.5} />
                반려 확인
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Approval Modal ────────────────────────────────
function CreateApprovalModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ApprovalType>('DAY_OFF');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedApprovers, setSelectedApprovers] = useState<number[]>([]);

  // Fetch admin users for approver selection
  const { data: usersData } = useQuery<AdminUser[]>({
    queryKey: ['users-for-approver'],
    queryFn: () =>
      usersApi.list().then((r) => {
        const users = r.data.data ?? r.data ?? [];
        // Filter to non-driver roles (potential approvers)
        return users.filter(
          (u: AdminUser) => u.role !== 'DRIVER' && u.isActive !== false
        );
      }),
  });

  const availableApprovers = usersData ?? [];

  const createMutation = useMutation({
    mutationFn: (data: {
      type: ApprovalType;
      title: string;
      content: string;
      approverIds?: number[];
    }) => approvalsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval-stats'] });
      toast.success('결재가 기안되었습니다.');
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || '기안 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      toast.error('내용을 입력해주세요.');
      return;
    }
    createMutation.mutate({
      type,
      title,
      content,
      ...(selectedApprovers.length > 0 ? { approverIds: selectedApprovers } : {}),
    });
  };

  const addApprover = (userId: number) => {
    if (!selectedApprovers.includes(userId)) {
      setSelectedApprovers((prev) => [...prev, userId]);
    }
  };

  const removeApprover = (userId: number) => {
    setSelectedApprovers((prev) => prev.filter((id) => id !== userId));
  };

  const moveApprover = (index: number, direction: 'up' | 'down') => {
    const newArr = [...selectedApprovers];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newArr.length) return;
    [newArr[index], newArr[targetIdx]] = [newArr[targetIdx], newArr[index]];
    setSelectedApprovers(newArr);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Plus size={24} className="text-blue-600" />
          새 결재 기안
        </h2>

        {/* Type */}
        <div>
          <label className="block text-[16px] font-semibold text-gray-700 mb-2">결재 유형</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ApprovalType)}
            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-h-[48px]"
          >
            {(Object.entries(TYPE_CONFIG) as [ApprovalType, { label: string }][]).map(
              ([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-[16px] font-semibold text-gray-700 mb-2">제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="결재 제목을 입력하세요"
            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[48px]"
          />
        </div>

        {/* Content */}
        <div>
          <label className="block text-[16px] font-semibold text-gray-700 mb-2">내용</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="결재 내용을 상세히 작성해주세요"
            rows={6}
            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          />
        </div>

        {/* Approver Selection (Multi-step) */}
        <div>
          <label className="block text-[16px] font-semibold text-gray-700 mb-2">
            결재자 선택 (결재 순서대로 추가)
          </label>

          {/* Selected approvers */}
          {selectedApprovers.length > 0 && (
            <div className="mb-3 space-y-2">
              {selectedApprovers.map((userId, idx) => {
                const user = availableApprovers.find((u) => u.id === userId);
                if (!user) return null;
                return (
                  <div
                    key={userId}
                    className="flex items-center gap-3 bg-blue-50 border-2 border-blue-200 rounded-lg px-4 py-3"
                  >
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-[14px] font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[16px] font-bold text-gray-900">{user.name}</span>
                      <span className="text-[14px] text-gray-500 ml-2">
                        ({ROLE_LABELS[user.role] ?? user.role})
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => moveApprover(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1.5 rounded hover:bg-blue-200 disabled:opacity-30 text-blue-700"
                        title="위로"
                      >
                        <ChevronUp size={18} />
                      </button>
                      <button
                        onClick={() => moveApprover(idx, 'down')}
                        disabled={idx === selectedApprovers.length - 1}
                        className="p-1.5 rounded hover:bg-blue-200 disabled:opacity-30 text-blue-700"
                        title="아래로"
                      >
                        <ChevronDown size={18} />
                      </button>
                      <button
                        onClick={() => removeApprover(userId)}
                        className="p-1.5 rounded hover:bg-red-100 text-red-500"
                        title="제거"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Approver dropdown */}
          <select
            value=""
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val)) addApprover(val);
            }}
            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white min-h-[48px]"
          >
            <option value="">결재자를 선택하세요</option>
            {availableApprovers
              .filter((u) => !selectedApprovers.includes(u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({ROLE_LABELS[u.role] ?? u.role})
                </option>
              ))}
          </select>

          {selectedApprovers.length === 0 && (
            <p className="text-[14px] text-gray-400 mt-2">
              결재자를 선택하지 않으면 기본 결재 라인이 적용됩니다.
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-7 py-3.5 rounded-xl border-2 border-gray-300 text-gray-700 font-bold text-[16px] hover:bg-gray-50 min-h-[48px]"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-7 py-3.5 bg-blue-600 text-white rounded-xl font-bold text-[16px] hover:bg-blue-700 active:bg-blue-800 transition-colors min-h-[48px] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                제출 중...
              </>
            ) : (
              <>
                <Send size={18} />
                기안 제출
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
