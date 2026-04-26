import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert,
  AlertTriangle,
  GraduationCap,
  IdCard,
  Plus,
  Check,
  Trash2,
  Loader2,
  X,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  ChevronDown,
  CalendarDays,
  Edit3,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { safetyApi, usersApi } from '../services/api';

/* ================================================================
   타입 정의
   ================================================================ */

type Tab = 'incidents' | 'training' | 'license';

interface Driver {
  id: number;
  name: string;
  employeeId: string;
  licenseNumber?: string;
  licenseExpiresAt?: string;
  qualificationExpiresAt?: string;
}

interface Incident {
  id: number;
  date: string;
  type: string;
  description: string;
  notes?: string;
  penalty?: number;
  isResolved: boolean;
  resolvedAt?: string;
  driver: { name: string; employeeId: string };
}

interface Training {
  id: number;
  type: string;
  completedAt: string;
  expiresAt?: string;
  institution?: string;
  notes?: string;
  driver: { name: string; employeeId: string };
}

interface LicenseAlert {
  id: number;
  name: string;
  employeeId: string;
  licenseNumber?: string;
  licenseExpiresAt?: string;
  qualificationExpiresAt?: string;
  isUrgent: boolean;
  licenseExpired?: boolean;
  qualExpired?: boolean;
}

interface SafetyStats {
  totalIncidents: number;
  unresolvedIncidents: number;
  thisMonthIncidents: number;
  totalPenalty: number;
  licenseExpiredCount: number;
}

interface LicenseData {
  urgentCount: number;
  warningCount: number;
  licenseAlerts: LicenseAlert[];
}

/* ================================================================
   상수
   ================================================================ */

const INCIDENT_TYPES: Record<string, { label: string; color: string; bg: string }> = {
  ACCIDENT: { label: '사고', color: 'text-red-700', bg: 'bg-red-100' },
  TRAFFIC_VIOLATION: { label: '교통위반', color: 'text-orange-700', bg: 'bg-orange-100' },
  COMPLAINT: { label: '민원', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  OTHER: { label: '기타', color: 'text-gray-600', bg: 'bg-gray-100' },
};

const TRAINING_TYPES = [
  '신규교육',
  '보수교육(3년)',
  '안전교육',
  '응급처치교육',
  '음주측정교육',
  '기타',
];

/* ================================================================
   유틸리티 함수
   ================================================================ */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCurrency(value: number): string {
  return value.toLocaleString('ko-KR') + '원';
}

/* ================================================================
   메인 컴포넌트
   ================================================================ */

export default function SafetyPage() {
  const [tab, setTab] = useState<Tab>('incidents');

  const { data: stats } = useQuery<SafetyStats>({
    queryKey: ['safety-stats'],
    queryFn: () => safetyApi.getStats().then((r) => r.data.data),
  });

  const { data: licenseData } = useQuery<LicenseData>({
    queryKey: ['license-alerts'],
    queryFn: () => safetyApi.getLicenseAlerts().then((r) => r.data.data),
  });

  const { data: trainings } = useQuery<Training[]>({
    queryKey: ['trainings'],
    queryFn: () => safetyApi.getTrainings().then((r) => r.data.data),
  });

  // 교육 만료 임박 수 계산
  const trainingsDueCount = useMemo(() => {
    if (!trainings) return 0;
    return trainings.filter((t) => {
      if (!t.expiresAt) return false;
      const days = daysUntil(t.expiresAt);
      return days <= 30;
    }).length;
  }, [trainings]);

  const tabs: { key: Tab; label: string; icon: typeof ShieldAlert }[] = [
    { key: 'incidents', label: '사고/위반 기록', icon: AlertTriangle },
    { key: 'training', label: '교육 이력', icon: GraduationCap },
    { key: 'license', label: '면허 관리', icon: IdCard },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 pb-12">
      {/* 페이지 헤더 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <ShieldAlert size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-[28px] font-bold text-gray-900">안전 관리</h1>
            <p className="text-[16px] text-gray-500 mt-0.5">
              사고/위반 이력, 교육 이수, 면허 만료를 통합 관리합니다
            </p>
          </div>
        </div>
      </div>

      {/* 긴급 알림 배너 */}
      {licenseData && licenseData.urgentCount > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 rounded-xl p-5 mb-6 flex items-start gap-4">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <div>
            <p className="text-[17px] font-bold text-red-800">
              면허/자격증 만료 긴급 알림
            </p>
            <p className="text-[16px] text-red-700 mt-1">
              {licenseData.urgentCount}명의 기사 면허 또는 자격증이 이미 만료되었습니다.
              즉시 갱신이 필요합니다.
            </p>
          </div>
        </div>
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon={<FileText size={20} className="text-blue-600" />}
          label="이번 달 사고/위반"
          value={stats?.thisMonthIncidents ?? 0}
          unit="건"
          bg="bg-blue-50"
          valueColor="text-blue-700"
        />
        <SummaryCard
          icon={<XCircle size={20} className="text-red-600" />}
          label="미처리 건수"
          value={stats?.unresolvedIncidents ?? 0}
          unit="건"
          bg="bg-red-50"
          valueColor="text-red-700"
          highlight={!!stats && stats.unresolvedIncidents > 0}
        />
        <SummaryCard
          icon={<Clock size={20} className="text-yellow-600" />}
          label="교육 만료 임박"
          value={trainingsDueCount}
          unit="건"
          bg="bg-yellow-50"
          valueColor="text-yellow-700"
          highlight={trainingsDueCount > 0}
        />
        <SummaryCard
          icon={<IdCard size={20} className="text-purple-600" />}
          label="면허 만료 예정"
          value={(licenseData?.urgentCount ?? 0) + (licenseData?.warningCount ?? 0)}
          unit="명"
          bg="bg-purple-50"
          valueColor="text-purple-700"
          highlight={!!licenseData && (licenseData.urgentCount + licenseData.warningCount) > 0}
        />
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-2 mb-6 border-b border-gray-200 pb-0">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`
              flex items-center gap-2.5 px-5 py-3.5 rounded-t-xl font-semibold text-[16px] transition-all
              min-h-[48px]
              ${
                tab === key
                  ? 'bg-white text-blue-700 border border-gray-200 border-b-white -mb-px shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }
            `}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {tab === 'incidents' && <IncidentsTab />}
        {tab === 'training' && <TrainingTab />}
        {tab === 'license' && <LicenseTab />}
      </div>
    </div>
  );
}

/* ================================================================
   요약 카드
   ================================================================ */

function SummaryCard({
  icon,
  label,
  value,
  unit,
  bg,
  valueColor,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  unit?: string;
  bg: string;
  valueColor: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`
        rounded-xl border p-5 transition-all
        ${highlight ? `${bg} border-current/20 ring-2 ring-current/10` : 'bg-white border-gray-200'}
      `}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center`}>
          {icon}
        </div>
        <p className="text-[14px] font-medium text-gray-500">{label}</p>
      </div>
      <p className={`text-[32px] font-bold ${valueColor} leading-none`}>
        {value}
        {unit && <span className="text-[18px] font-medium ml-1">{unit}</span>}
      </p>
    </div>
  );
}

/* ================================================================
   모달 오버레이
   ================================================================ */

function Modal({
  title,
  onClose,
  children,
  width = 'max-w-2xl',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* content */}
      <div
        className={`relative bg-white rounded-2xl shadow-2xl w-full ${width} max-h-[90vh] overflow-y-auto`}
      >
        <div className="sticky top-0 bg-white rounded-t-2xl border-b border-gray-100 px-6 py-5 flex items-center justify-between z-10">
          <h2 className="text-[20px] font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ================================================================
   공통 UI 컴포넌트
   ================================================================ */

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[14px] font-semibold text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  'w-full border border-gray-300 rounded-xl px-4 py-3 text-[16px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all';
const selectClass = `${inputClass} appearance-none bg-white`;

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
        <Icon size={28} className="text-gray-400" />
      </div>
      <p className="text-[18px] font-semibold text-gray-700 mb-1">{title}</p>
      <p className="text-[16px] text-gray-400">{description}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 size={36} className="text-blue-500 animate-spin mb-4" />
      <p className="text-[16px] text-gray-500">데이터를 불러오는 중...</p>
    </div>
  );
}

function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6">
      <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
        <XCircle size={28} className="text-red-400" />
      </div>
      <p className="text-[18px] font-semibold text-red-700 mb-1">오류가 발생했습니다</p>
      <p className="text-[16px] text-gray-500">
        {message || '잠시 후 다시 시도해 주세요.'}
      </p>
    </div>
  );
}

/* ================================================================
   사고/위반 기록 탭
   ================================================================ */

function IncidentsTab() {
  const qc = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<Incident | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const { data: drivers } = useQuery<Driver[]>({
    queryKey: ['drivers-simple'],
    queryFn: () => usersApi.list({ role: 'DRIVER' }).then((r) => r.data.data),
  });

  const {
    data: incidents,
    isLoading,
    isError,
  } = useQuery<Incident[]>({
    queryKey: ['incidents'],
    queryFn: () => safetyApi.getIncidents().then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: safetyApi.createIncident,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['safety-stats'] });
      setShowCreateModal(false);
      toast.success('사고/위반 이력이 등록되었습니다.');
    },
    onError: () => toast.error('등록 중 오류가 발생했습니다.'),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) =>
      safetyApi.resolveIncident(id, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['safety-stats'] });
      setResolveTarget(null);
      toast.success('처리 완료로 변경되었습니다.');
    },
    onError: () => toast.error('처리 중 오류가 발생했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: safetyApi.deleteIncident,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['safety-stats'] });
      toast.success('삭제되었습니다.');
    },
    onError: () => toast.error('삭제 중 오류가 발생했습니다.'),
  });

  // 필터링
  const filteredIncidents = useMemo(() => {
    if (!incidents) return [];
    return incidents.filter((r) => {
      if (typeFilter !== 'ALL' && r.type !== typeFilter) return false;
      if (statusFilter === 'RESOLVED' && !r.isResolved) return false;
      if (statusFilter === 'UNRESOLVED' && r.isResolved) return false;
      if (
        searchQuery &&
        !r.driver.name.includes(searchQuery) &&
        !r.driver.employeeId.includes(searchQuery) &&
        !r.description.includes(searchQuery)
      )
        return false;
      return true;
    });
  }, [incidents, typeFilter, statusFilter, searchQuery]);

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  return (
    <div className="p-6">
      {/* 상단 액션 바 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* 검색 */}
        <div className="relative flex-1">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="기사 이름, 사원번호, 내용 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-[16px] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* 유형 필터 */}
        <div className="relative">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-gray-300 rounded-xl px-4 py-3 pr-10 text-[16px] bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
          >
            <option value="ALL">전체 유형</option>
            {Object.entries(INCIDENT_TYPES).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {/* 상태 필터 */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-xl px-4 py-3 pr-10 text-[16px] bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
          >
            <option value="ALL">전체 상태</option>
            <option value="UNRESOLVED">미처리</option>
            <option value="RESOLVED">처리완료</option>
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {/* 등록 버튼 */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-semibold text-[16px] transition-colors min-h-[48px] min-w-[48px] shadow-sm"
        >
          <Plus size={20} />
          이력 등록
        </button>
      </div>

      {/* 테이블 */}
      {filteredIncidents.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="등록된 사고/위반 기록이 없습니다"
          description={searchQuery || typeFilter !== 'ALL' || statusFilter !== 'ALL'
            ? '검색 조건을 변경해 보세요.'
            : '이력 등록 버튼을 눌러 새 기록을 추가하세요.'
          }
        />
      ) : (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b-2 border-gray-100">
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">날짜</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">기사</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">유형</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">내용</th>
                <th className="text-right px-6 py-4 text-[14px] font-semibold text-gray-500">과태료</th>
                <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500">상태</th>
                <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500">조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredIncidents.map((r) => {
                const typeInfo = INCIDENT_TYPES[r.type] || { label: r.type, color: 'text-gray-600', bg: 'bg-gray-100' };
                return (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <CalendarDays size={16} className="text-gray-400" />
                        <span className="text-[16px] text-gray-700">{formatDate(r.date)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-[16px] font-semibold text-gray-900">{r.driver.name}</p>
                      <p className="text-[13px] text-gray-400 mt-0.5">{r.driver.employeeId}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-3 py-1.5 rounded-lg text-[14px] font-semibold ${typeInfo.bg} ${typeInfo.color}`}
                      >
                        {typeInfo.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-[16px] text-gray-700 max-w-xs truncate">{r.description}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`text-[16px] font-medium ${r.penalty ? 'text-red-600' : 'text-gray-300'}`}>
                        {r.penalty ? formatCurrency(r.penalty) : '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {r.isResolved ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-green-100 text-green-700">
                          <CheckCircle2 size={14} />
                          처리완료
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-orange-100 text-orange-700">
                          <Clock size={14} />
                          미처리
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center gap-1.5">
                        {!r.isResolved && (
                          <button
                            onClick={() => setResolveTarget(r)}
                            className="w-[48px] h-[48px] rounded-xl bg-green-50 hover:bg-green-100 text-green-600 hover:text-green-700 flex items-center justify-center transition-colors"
                            title="처리완료"
                          >
                            <Check size={20} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm('이 기록을 삭제하시겠습니까?')) {
                              deleteMutation.mutate(r.id);
                            }
                          }}
                          className="w-[48px] h-[48px] rounded-xl bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 flex items-center justify-center transition-colors"
                          title="삭제"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 등록 모달 */}
      {showCreateModal && (
        <IncidentCreateModal
          drivers={drivers || []}
          onSubmit={(data) => createMutation.mutate(data)}
          loading={createMutation.isPending}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* 처리완료 모달 */}
      {resolveTarget && (
        <ResolveModal
          incident={resolveTarget}
          onSubmit={(notes) =>
            resolveMutation.mutate({ id: resolveTarget.id, notes })
          }
          loading={resolveMutation.isPending}
          onClose={() => setResolveTarget(null)}
        />
      )}
    </div>
  );
}

/* ================================================================
   사고/위반 등록 모달
   ================================================================ */

function IncidentCreateModal({
  drivers,
  onSubmit,
  loading,
  onClose,
}: {
  drivers: Driver[];
  onSubmit: (data: Record<string, unknown>) => void;
  loading: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    driverId: '',
    date: new Date().toISOString().split('T')[0],
    type: 'ACCIDENT',
    description: '',
    notes: '',
    penalty: '',
  });

  const set =
    (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const canSubmit = form.driverId && form.date && form.description.trim();

  const handleSubmit = () => {
    if (!canSubmit) {
      toast.error('필수 항목을 모두 입력해 주세요.');
      return;
    }
    onSubmit({
      ...form,
      driverId: Number(form.driverId),
      penalty: form.penalty ? Number(form.penalty) : undefined,
    });
  };

  return (
    <Modal title="사고/위반 이력 등록" onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="기사 선택" required>
            <div className="relative">
              <select value={form.driverId} onChange={set('driverId')} className={selectClass}>
                <option value="">기사를 선택하세요</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.employeeId})
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </FormField>

          <FormField label="발생일" required>
            <input type="date" value={form.date} onChange={set('date')} className={inputClass} />
          </FormField>

          <FormField label="유형" required>
            <div className="relative">
              <select value={form.type} onChange={set('type')} className={selectClass}>
                {Object.entries(INCIDENT_TYPES).map(([key, { label }]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </FormField>

          <FormField label="과태료 (원)">
            <input
              type="number"
              value={form.penalty}
              onChange={set('penalty')}
              placeholder="금액을 입력하세요 (선택)"
              className={inputClass}
            />
          </FormField>
        </div>

        <FormField label="사고/위반 내용" required>
          <textarea
            value={form.description}
            onChange={set('description')}
            placeholder="사고 또는 위반 내용을 상세히 기재해 주세요"
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </FormField>

        <FormField label="상세 참고사항">
          <textarea
            value={form.notes}
            onChange={set('notes')}
            placeholder="추가 참고사항이 있으면 기재해 주세요 (선택)"
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </FormField>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-6 py-3 text-[16px] font-semibold text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors min-h-[48px]"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            className="flex items-center gap-2 px-6 py-3 text-[16px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[48px] shadow-sm"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            등록하기
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================
   처리완료 모달
   ================================================================ */

function ResolveModal({
  incident,
  onSubmit,
  loading,
  onClose,
}: {
  incident: Incident;
  onSubmit: (notes?: string) => void;
  loading: boolean;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState('');
  const typeInfo = INCIDENT_TYPES[incident.type] || { label: incident.type, color: 'text-gray-600', bg: 'bg-gray-100' };

  return (
    <Modal title="사고/위반 처리완료" onClose={onClose} width="max-w-lg">
      <div className="space-y-5">
        {/* 대상 정보 */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-gray-500">기사</span>
            <span className="text-[16px] font-semibold text-gray-900">
              {incident.driver.name} ({incident.driver.employeeId})
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-gray-500">발생일</span>
            <span className="text-[16px] text-gray-700">{formatDate(incident.date)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-gray-500">유형</span>
            <span className={`px-2.5 py-1 rounded-lg text-[14px] font-semibold ${typeInfo.bg} ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
          </div>
          <div className="pt-1">
            <span className="text-[14px] text-gray-500">내용</span>
            <p className="text-[16px] text-gray-700 mt-1">{incident.description}</p>
          </div>
        </div>

        <FormField label="처리 내용 (메모)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="처리 결과나 후속 조치 내용을 입력하세요 (선택)"
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </FormField>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-6 py-3 text-[16px] font-semibold text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors min-h-[48px]"
          >
            취소
          </button>
          <button
            onClick={() => onSubmit(notes || undefined)}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 text-[16px] font-semibold bg-green-600 hover:bg-green-700 text-white rounded-xl disabled:opacity-50 transition-colors min-h-[48px] shadow-sm"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            <CheckCircle2 size={18} />
            처리완료
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================
   교육 이력 탭
   ================================================================ */

function TrainingTab() {
  const qc = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const { data: drivers } = useQuery<Driver[]>({
    queryKey: ['drivers-simple'],
    queryFn: () => usersApi.list({ role: 'DRIVER' }).then((r) => r.data.data),
  });

  const {
    data: trainings,
    isLoading,
    isError,
  } = useQuery<Training[]>({
    queryKey: ['trainings'],
    queryFn: () => safetyApi.getTrainings().then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: safetyApi.createTraining,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trainings'] });
      setShowCreateModal(false);
      toast.success('교육 이수 기록이 등록되었습니다.');
    },
    onError: () => toast.error('등록 중 오류가 발생했습니다.'),
  });

  // 필터링
  const filteredTrainings = useMemo(() => {
    if (!trainings) return [];
    return trainings.filter((t) => {
      if (typeFilter !== 'ALL' && t.type !== typeFilter) return false;
      if (
        searchQuery &&
        !t.driver.name.includes(searchQuery) &&
        !t.driver.employeeId.includes(searchQuery) &&
        !t.type.includes(searchQuery)
      )
        return false;
      return true;
    });
  }, [trainings, typeFilter, searchQuery]);

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  return (
    <div className="p-6">
      {/* 상단 액션 바 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="기사 이름, 사원번호, 교육명 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-[16px] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="relative">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-gray-300 rounded-xl px-4 py-3 pr-10 text-[16px] bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
          >
            <option value="ALL">전체 교육 종류</option>
            {TRAINING_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-semibold text-[16px] transition-colors min-h-[48px] min-w-[48px] shadow-sm"
        >
          <Plus size={20} />
          교육 등록
        </button>
      </div>

      {/* 테이블 */}
      {filteredTrainings.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="교육 이수 기록이 없습니다"
          description={searchQuery || typeFilter !== 'ALL'
            ? '검색 조건을 변경해 보세요.'
            : '교육 등록 버튼을 눌러 새 기록을 추가하세요.'
          }
        />
      ) : (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b-2 border-gray-100">
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">기사</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">교육 종류</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">이수일</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">만료일</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">상태</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">교육 기관</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredTrainings.map((t) => {
                const isExpired = t.expiresAt ? daysUntil(t.expiresAt) < 0 : false;
                const isExpiringSoon = t.expiresAt
                  ? !isExpired && daysUntil(t.expiresAt) <= 30
                  : false;
                const remainingDays = t.expiresAt ? daysUntil(t.expiresAt) : null;

                return (
                  <tr
                    key={t.id}
                    className={`
                      transition-colors
                      ${isExpired ? 'bg-red-50/60' : isExpiringSoon ? 'bg-yellow-50/60' : 'hover:bg-gray-50/50'}
                    `}
                  >
                    <td className="px-6 py-4">
                      <p className="text-[16px] font-semibold text-gray-900">{t.driver.name}</p>
                      <p className="text-[13px] text-gray-400 mt-0.5">{t.driver.employeeId}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-blue-50 text-blue-700">
                        {t.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[16px] text-gray-700">
                      {formatDate(t.completedAt)}
                    </td>
                    <td className="px-6 py-4">
                      {t.expiresAt ? (
                        <div>
                          <span
                            className={`text-[16px] font-medium ${
                              isExpired
                                ? 'text-red-600'
                                : isExpiringSoon
                                  ? 'text-yellow-600'
                                  : 'text-gray-700'
                            }`}
                          >
                            {formatDate(t.expiresAt)}
                          </span>
                          {remainingDays !== null && remainingDays <= 30 && (
                            <p
                              className={`text-[13px] mt-0.5 font-medium ${
                                isExpired ? 'text-red-500' : 'text-yellow-500'
                              }`}
                            >
                              {isExpired
                                ? `${Math.abs(remainingDays)}일 경과`
                                : `${remainingDays}일 남음`}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-[16px] text-gray-300">무기한</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isExpired ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-red-100 text-red-700">
                          <XCircle size={14} />
                          만료됨
                        </span>
                      ) : isExpiringSoon ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-yellow-100 text-yellow-700">
                          <AlertTriangle size={14} />
                          만료 임박
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-green-100 text-green-700">
                          <CheckCircle2 size={14} />
                          유효
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[16px] text-gray-500">
                      {t.institution || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 등록 모달 */}
      {showCreateModal && (
        <TrainingCreateModal
          drivers={drivers || []}
          onSubmit={(data) => createMutation.mutate(data)}
          loading={createMutation.isPending}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

/* ================================================================
   교육 등록 모달
   ================================================================ */

function TrainingCreateModal({
  drivers,
  onSubmit,
  loading,
  onClose,
}: {
  drivers: Driver[];
  onSubmit: (data: Record<string, unknown>) => void;
  loading: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    driverId: '',
    type: '신규교육',
    completedAt: new Date().toISOString().split('T')[0],
    expiresAt: '',
    institution: '',
    notes: '',
  });

  const set =
    (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const canSubmit = form.driverId && form.completedAt;

  const handleSubmit = () => {
    if (!canSubmit) {
      toast.error('필수 항목을 모두 입력해 주세요.');
      return;
    }
    onSubmit({
      ...form,
      driverId: Number(form.driverId),
      expiresAt: form.expiresAt || undefined,
      institution: form.institution || undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <Modal title="교육 이수 등록" onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="기사 선택" required>
            <div className="relative">
              <select value={form.driverId} onChange={set('driverId')} className={selectClass}>
                <option value="">기사를 선택하세요</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.employeeId})
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </FormField>

          <FormField label="교육 종류" required>
            <div className="relative">
              <select value={form.type} onChange={set('type')} className={selectClass}>
                {TRAINING_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </FormField>

          <FormField label="이수일" required>
            <input
              type="date"
              value={form.completedAt}
              onChange={set('completedAt')}
              className={inputClass}
            />
          </FormField>

          <FormField label="만료일">
            <input
              type="date"
              value={form.expiresAt}
              onChange={set('expiresAt')}
              className={inputClass}
            />
          </FormField>
        </div>

        <FormField label="교육 기관">
          <input
            type="text"
            value={form.institution}
            onChange={set('institution')}
            placeholder="교육을 실시한 기관명 (선택)"
            className={inputClass}
          />
        </FormField>

        <FormField label="비고">
          <textarea
            value={form.notes}
            onChange={set('notes')}
            placeholder="추가 메모 (선택)"
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </FormField>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-6 py-3 text-[16px] font-semibold text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors min-h-[48px]"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            className="flex items-center gap-2 px-6 py-3 text-[16px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[48px] shadow-sm"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            등록하기
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================
   면허 관리 탭
   ================================================================ */

function LicenseTab() {
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<LicenseAlert | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const {
    data: licenseData,
    isLoading,
    isError,
  } = useQuery<LicenseData>({
    queryKey: ['license-alerts'],
    queryFn: () => safetyApi.getLicenseAlerts().then((r) => r.data.data),
  });

  const { data: allDrivers } = useQuery<Driver[]>({
    queryKey: ['drivers-simple'],
    queryFn: () => usersApi.list({ role: 'DRIVER' }).then((r) => r.data.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      safetyApi.updateLicense(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['license-alerts'] });
      qc.invalidateQueries({ queryKey: ['safety-stats'] });
      setEditTarget(null);
      toast.success('면허 정보가 업데이트되었습니다.');
    },
    onError: () => toast.error('업데이트 중 오류가 발생했습니다.'),
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  const alerts = licenseData?.licenseAlerts || [];

  // 전체 기사 중 알림 대상이 아닌 기사도 보여주기 위한 병합
  const allLicenseEntries = useMemo(() => {
    const alertIds = new Set(alerts.map((a) => a.id));
    const nonAlertDrivers: LicenseAlert[] = (allDrivers || [])
      .filter((d) => !alertIds.has(d.id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        employeeId: d.employeeId,
        licenseNumber: d.licenseNumber,
        licenseExpiresAt: d.licenseExpiresAt,
        qualificationExpiresAt: d.qualificationExpiresAt,
        isUrgent: false,
        licenseExpired: false,
        qualExpired: false,
      }));

    const merged = [...alerts, ...nonAlertDrivers];

    if (!searchQuery) return merged;
    return merged.filter(
      (d) =>
        d.name.includes(searchQuery) ||
        d.employeeId.includes(searchQuery) ||
        (d.licenseNumber && d.licenseNumber.includes(searchQuery))
    );
  }, [alerts, allDrivers, searchQuery]);

  return (
    <div className="p-6">
      {/* 상태 요약 */}
      {alerts.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6 flex items-center gap-4">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} className="text-green-600" />
          </div>
          <div>
            <p className="text-[17px] font-bold text-green-800">
              만료 예정인 면허 또는 자격증이 없습니다
            </p>
            <p className="text-[15px] text-green-600 mt-0.5">
              모든 기사의 면허 및 자격증이 유효 상태입니다.
            </p>
          </div>
        </div>
      )}

      {/* 검색 */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="기사 이름, 사원번호, 면허번호 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-[16px] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* 테이블 */}
      {allLicenseEntries.length === 0 ? (
        <EmptyState
          icon={IdCard}
          title="등록된 기사가 없습니다"
          description="기사 관리에서 기사를 먼저 등록해 주세요."
        />
      ) : (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b-2 border-gray-100">
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">기사</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">면허 번호</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">운전면허 만료</th>
                <th className="text-left px-6 py-4 text-[14px] font-semibold text-gray-500">버스자격증 만료</th>
                <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500">상태</th>
                <th className="text-center px-6 py-4 text-[14px] font-semibold text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allLicenseEntries.map((d) => {
                const licDays = d.licenseExpiresAt ? daysUntil(d.licenseExpiresAt) : null;
                const qualDays = d.qualificationExpiresAt ? daysUntil(d.qualificationExpiresAt) : null;

                const licStatus =
                  licDays === null ? 'none' : licDays < 0 ? 'expired' : licDays <= 30 ? 'warning' : 'ok';
                const qualStatus =
                  qualDays === null ? 'none' : qualDays < 0 ? 'expired' : qualDays <= 30 ? 'warning' : 'ok';

                const rowBg =
                  licStatus === 'expired' || qualStatus === 'expired'
                    ? 'bg-red-50/60'
                    : licStatus === 'warning' || qualStatus === 'warning'
                      ? 'bg-yellow-50/40'
                      : 'hover:bg-gray-50/50';

                return (
                  <tr key={d.id} className={`${rowBg} transition-colors`}>
                    <td className="px-6 py-4">
                      <p className="text-[16px] font-semibold text-gray-900">{d.name}</p>
                      <p className="text-[13px] text-gray-400 mt-0.5">{d.employeeId}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[16px] text-gray-700">
                        {d.licenseNumber || (
                          <span className="text-gray-300">미등록</span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <LicenseDateCell dateStr={d.licenseExpiresAt} status={licStatus} days={licDays} />
                    </td>
                    <td className="px-6 py-4">
                      <LicenseDateCell dateStr={d.qualificationExpiresAt} status={qualStatus} days={qualDays} />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <LicenseStatusBadge licStatus={licStatus} qualStatus={qualStatus} />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => setEditTarget(d)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[14px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors min-h-[48px]"
                      >
                        <Edit3 size={16} />
                        수정
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 수정 모달 */}
      {editTarget && (
        <LicenseEditModal
          driver={editTarget}
          onSubmit={(data) => updateMutation.mutate({ id: editTarget.id, data })}
          loading={updateMutation.isPending}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}

/* ================================================================
   면허 날짜 셀
   ================================================================ */

function LicenseDateCell({
  dateStr,
  status,
  days,
}: {
  dateStr?: string;
  status: 'none' | 'expired' | 'warning' | 'ok';
  days: number | null;
}) {
  if (!dateStr || status === 'none') {
    return <span className="text-[16px] text-gray-300">미등록</span>;
  }

  const colorMap = {
    expired: 'text-red-600',
    warning: 'text-yellow-600',
    ok: 'text-gray-700',
  };

  return (
    <div>
      <span className={`text-[16px] font-medium ${colorMap[status]}`}>
        {formatDate(dateStr)}
      </span>
      {days !== null && days <= 30 && (
        <p className={`text-[13px] mt-0.5 font-medium ${status === 'expired' ? 'text-red-500' : 'text-yellow-500'}`}>
          {days < 0 ? `${Math.abs(days)}일 경과` : `${days}일 남음`}
        </p>
      )}
    </div>
  );
}

/* ================================================================
   면허 상태 배지
   ================================================================ */

function LicenseStatusBadge({
  licStatus,
  qualStatus,
}: {
  licStatus: string;
  qualStatus: string;
}) {
  const hasExpired = licStatus === 'expired' || qualStatus === 'expired';
  const hasWarning = licStatus === 'warning' || qualStatus === 'warning';
  const hasNone = licStatus === 'none' || qualStatus === 'none';

  if (hasExpired) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-red-100 text-red-700">
        <XCircle size={14} />
        만료
      </span>
    );
  }

  if (hasWarning) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-yellow-100 text-yellow-700">
        <AlertTriangle size={14} />
        만료 임박
      </span>
    );
  }

  if (hasNone) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-gray-100 text-gray-500">
        정보 없음
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-green-100 text-green-700">
      <CheckCircle2 size={14} />
      정상
    </span>
  );
}

/* ================================================================
   면허 수정 모달
   ================================================================ */

function LicenseEditModal({
  driver,
  onSubmit,
  loading,
  onClose,
}: {
  driver: LicenseAlert;
  onSubmit: (data: Record<string, unknown>) => void;
  loading: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    licenseNumber: driver.licenseNumber || '',
    licenseExpiresAt: driver.licenseExpiresAt
      ? new Date(driver.licenseExpiresAt).toISOString().split('T')[0]
      : '',
    qualificationExpiresAt: driver.qualificationExpiresAt
      ? new Date(driver.qualificationExpiresAt).toISOString().split('T')[0]
      : '',
  });

  const set =
    (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = () => {
    onSubmit({
      licenseNumber: form.licenseNumber || undefined,
      licenseExpiresAt: form.licenseExpiresAt || undefined,
      qualificationExpiresAt: form.qualificationExpiresAt || undefined,
    });
  };

  return (
    <Modal title="면허 정보 수정" onClose={onClose} width="max-w-lg">
      <div className="space-y-5">
        {/* 대상 기사 정보 */}
        <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <IdCard size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-[16px] font-semibold text-gray-900">{driver.name}</p>
            <p className="text-[14px] text-gray-500">{driver.employeeId}</p>
          </div>
        </div>

        <FormField label="면허 번호">
          <input
            type="text"
            value={form.licenseNumber}
            onChange={set('licenseNumber')}
            placeholder="면허 번호를 입력하세요"
            className={inputClass}
          />
        </FormField>

        <FormField label="운전면허 만료일">
          <input
            type="date"
            value={form.licenseExpiresAt}
            onChange={set('licenseExpiresAt')}
            className={inputClass}
          />
        </FormField>

        <FormField label="버스운전자격증 만료일">
          <input
            type="date"
            value={form.qualificationExpiresAt}
            onChange={set('qualificationExpiresAt')}
            className={inputClass}
          />
        </FormField>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-6 py-3 text-[16px] font-semibold text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors min-h-[48px]"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 text-[16px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors min-h-[48px] shadow-sm"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            저장하기
          </button>
        </div>
      </div>
    </Modal>
  );
}
