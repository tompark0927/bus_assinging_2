import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wrench,
  Plus,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  X,
  Search,
  RefreshCw,
  Calendar,
  Loader2,
  Play,
  Ban,
  Truck,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// ─── Types ───────────────────────────────────────────────────

interface MaintenanceRecord {
  id: number;
  busId: number;
  type: string;
  status: string;
  mileageAtService?: number;
  scheduledAt: string;
  completedAt?: string;
  notes?: string;
  cost?: number;
  mechanic?: string;
  description?: string;
  createdAt: string;
  bus: {
    id: number;
    busNumber: string;
    plateNumber: string;
    totalMileage: number;
  };
}

interface BusOption {
  id: number;
  busNumber: string;
  plateNumber: string;
}

type MaintenanceStatusKey = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type MaintenanceTypeKey = 'OIL_CHANGE' | 'TIRE_ROTATION' | 'BRAKE_INSPECTION' | 'GENERAL_INSPECTION' | 'OTHER';
type FilterKey = 'ALL' | MaintenanceStatusKey;

// ─── Constants ───────────────────────────────────────────────

const MAINTENANCE_TYPES: Record<MaintenanceTypeKey, string> = {
  OIL_CHANGE: '오일교환',
  TIRE_ROTATION: '타이어교체',
  BRAKE_INSPECTION: '브레이크점검',
  GENERAL_INSPECTION: '종합검사',
  OTHER: '기타',
};

const STATUS_CONFIG: Record<MaintenanceStatusKey, {
  label: string;
  bgClass: string;
  textClass: string;
  badgeClass: string;
  icon: React.ElementType;
}> = {
  SCHEDULED: {
    label: '예정',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    badgeClass: 'bg-blue-100 text-blue-700 border border-blue-200',
    icon: Clock,
  },
  IN_PROGRESS: {
    label: '진행중',
    bgClass: 'bg-yellow-50',
    textClass: 'text-yellow-700',
    badgeClass: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
    icon: AlertTriangle,
  },
  COMPLETED: {
    label: '완료',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    badgeClass: 'bg-green-100 text-green-700 border border-green-200',
    icon: CheckCircle,
  },
  CANCELLED: {
    label: '취소',
    bgClass: 'bg-gray-50',
    textClass: 'text-gray-500',
    badgeClass: 'bg-gray-100 text-gray-500 border border-gray-200',
    icon: XCircle,
  },
};

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'SCHEDULED', label: '예정' },
  { key: 'IN_PROGRESS', label: '진행중' },
  { key: 'COMPLETED', label: '완료' },
  { key: 'CANCELLED', label: '취소' },
];

const INITIAL_FORM = {
  busId: '',
  type: 'OIL_CHANGE' as MaintenanceTypeKey,
  description: '',
  scheduledAt: '',
  cost: '',
  mechanic: '',
  mileageAtService: '',
};

// ─── Helpers ─────────────────────────────────────────────────

function formatCurrency(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '-';
  return `₩${value.toLocaleString('ko-KR')}`;
}

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  try {
    return format(new Date(dateStr), 'yyyy.MM.dd (EEE)', { locale: ko });
  } catch {
    return '-';
  }
}

// ─── Component ───────────────────────────────────────────────

export default function MaintenancePage() {
  const queryClient = useQueryClient();

  // UI State
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);
  const [form, setForm] = useState(INITIAL_FORM);

  // ─── Queries ─────────────────────────────────────────────

  const {
    data: records = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<MaintenanceRecord[]>({
    queryKey: ['maintenance'],
    queryFn: () => api.get('/maintenance').then((r) => r.data.data),
  });

  const { data: buses = [] } = useQuery<BusOption[]>({
    queryKey: ['buses'],
    queryFn: () => api.get('/buses').then((r) => r.data.data),
  });

  // ─── Mutations ───────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: typeof INITIAL_FORM) =>
      api.post('/maintenance', {
        busId: parseInt(data.busId),
        type: data.type,
        scheduledAt: data.scheduledAt,
        notes: buildNotes(data),
        mileageAtService: data.mileageAtService ? parseInt(data.mileageAtService) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('정비 일정이 등록되었습니다.');
      closeModal();
    },
    onError: () => toast.error('정비 등록에 실패했습니다. 다시 시도해 주세요.'),
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: number; data: Record<string, unknown> }) =>
      api.put(`/maintenance/${params.id}`, params.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('정비 정보가 업데이트되었습니다.');
      closeModal();
    },
    onError: () => toast.error('업데이트에 실패했습니다. 다시 시도해 주세요.'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.put(`/maintenance/${id}`, {
        status,
        completedAt: status === 'COMPLETED' ? new Date().toISOString() : undefined,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      const statusLabel = STATUS_CONFIG[variables.status as MaintenanceStatusKey]?.label || variables.status;
      toast.success(`상태가 "${statusLabel}"(으)로 변경되었습니다.`);
    },
    onError: () => toast.error('상태 변경에 실패했습니다.'),
  });

  // ─── Derived Data ────────────────────────────────────────

  const statusCounts = useMemo(() => {
    const counts: Record<MaintenanceStatusKey, number> = {
      SCHEDULED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    records.forEach((r) => {
      const key = r.status as MaintenanceStatusKey;
      if (key in counts) counts[key]++;
    });
    return counts;
  }, [records]);

  const filteredRecords = useMemo(() => {
    let result = records;

    // Status filter
    if (activeFilter !== 'ALL') {
      result = result.filter((r) => r.status === activeFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.bus.busNumber.toLowerCase().includes(q) ||
          r.bus.plateNumber.toLowerCase().includes(q) ||
          (MAINTENANCE_TYPES[r.type as MaintenanceTypeKey] || '').includes(q) ||
          (r.notes || '').toLowerCase().includes(q) ||
          (r.mechanic || '').toLowerCase().includes(q)
      );
    }

    // Sort: scheduled/in-progress first, then by scheduled date desc
    return [...result].sort((a, b) => {
      const statusOrder: Record<string, number> = { IN_PROGRESS: 0, SCHEDULED: 1, COMPLETED: 2, CANCELLED: 3 };
      const orderDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (orderDiff !== 0) return orderDiff;
      return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
    });
  }, [records, activeFilter, searchQuery]);

  // ─── Helpers ─────────────────────────────────────────────

  function buildNotes(data: typeof INITIAL_FORM): string {
    const parts: string[] = [];
    if (data.description) parts.push(data.description);
    if (data.mechanic) parts.push(`[정비사: ${data.mechanic}]`);
    if (data.cost) parts.push(`[비용: ₩${parseInt(data.cost).toLocaleString('ko-KR')}]`);
    return parts.join(' ');
  }

  function parseNotes(notes: string | undefined | null) {
    if (!notes) return { description: '', mechanic: '', cost: '' };
    const mechanicMatch = notes.match(/\[정비사:\s*(.+?)\]/);
    const costMatch = notes.match(/\[비용:\s*₩?([\d,]+)\]/);
    let description = notes;
    if (mechanicMatch) description = description.replace(mechanicMatch[0], '');
    if (costMatch) description = description.replace(costMatch[0], '');
    return {
      description: description.trim(),
      mechanic: mechanicMatch?.[1] || '',
      cost: costMatch ? costMatch[1].replace(/,/g, '') : '',
    };
  }

  function openCreateModal() {
    setEditingRecord(null);
    setForm(INITIAL_FORM);
    setShowModal(true);
  }

  function openEditModal(record: MaintenanceRecord) {
    const parsed = parseNotes(record.notes);
    setEditingRecord(record);
    setForm({
      busId: String(record.busId),
      type: record.type as MaintenanceTypeKey,
      description: record.description || parsed.description,
      scheduledAt: record.scheduledAt ? record.scheduledAt.slice(0, 10) : '',
      cost: record.cost != null ? String(record.cost) : parsed.cost,
      mechanic: record.mechanic || parsed.mechanic,
      mileageAtService: record.mileageAtService ? String(record.mileageAtService) : '',
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingRecord(null);
    setForm(INITIAL_FORM);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingRecord) {
      updateMutation.mutate({
        id: editingRecord.id,
        data: {
          busId: parseInt(form.busId),
          type: form.type,
          scheduledAt: form.scheduledAt,
          notes: buildNotes(form),
          mileageAtService: form.mileageAtService ? parseInt(form.mileageAtService) : undefined,
        },
      });
    } else {
      createMutation.mutate(form);
    }
  }

  function handleStatusChange(record: MaintenanceRecord, newStatus: MaintenanceStatusKey) {
    statusMutation.mutate({ id: record.id, status: newStatus });
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <Wrench className="text-blue-600" size={28} />
            차량 정비 관리
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-[16px]">정비 일정 등록 및 이력 관리</p>
        </div>
        <button
          onClick={openCreateModal}
          className="btn-primary flex items-center gap-2 min-h-[48px] px-6 text-[16px] font-semibold rounded-xl"
        >
          <Plus size={20} />
          정비 등록
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { key: 'SCHEDULED' as MaintenanceStatusKey, icon: Clock, color: 'blue' },
          { key: 'IN_PROGRESS' as MaintenanceStatusKey, icon: AlertTriangle, color: 'yellow' },
          { key: 'COMPLETED' as MaintenanceStatusKey, icon: CheckCircle, color: 'green' },
          { key: 'CANCELLED' as MaintenanceStatusKey, icon: XCircle, color: 'gray' },
        ]).map(({ key, icon: Icon, color }) => (
          <button
            key={key}
            onClick={() => setActiveFilter(activeFilter === key ? 'ALL' : key)}
            className={`card p-5 flex items-center gap-4 transition-all cursor-pointer border-2 ${
              activeFilter === key
                ? `border-${color}-400 ring-2 ring-${color}-100`
                : 'border-transparent hover:border-gray-200'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl bg-${color}-100 flex items-center justify-center flex-shrink-0`}>
              <Icon size={24} className={`text-${color}-600`} />
            </div>
            <div className="text-left">
              <p className="text-[14px] text-gray-500 dark:text-gray-400 font-medium">
                {STATUS_CONFIG[key].label}
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{statusCounts[key]}건</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filter Tabs + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex gap-2 flex-wrap">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className={`min-h-[44px] px-5 rounded-xl text-[16px] font-medium transition-all ${
                activeFilter === key
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {label}
              {key !== 'ALL' && (
                <span className="ml-1.5 text-[14px] opacity-80">
                  {statusCounts[key as MaintenanceStatusKey]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="차량번호, 정비유형 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10 min-h-[44px] text-[16px] w-full"
          />
        </div>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div className="card flex flex-col items-center justify-center py-20 text-gray-400">
          <Loader2 size={40} className="animate-spin mb-4" />
          <p className="text-[16px]">정비 데이터를 불러오는 중...</p>
        </div>
      ) : isError ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <XCircle size={40} className="text-red-400 mb-4" />
          <p className="text-[16px] text-gray-600 dark:text-gray-300 mb-4">데이터를 불러오지 못했습니다.</p>
          <button
            onClick={() => refetch()}
            className="btn-primary flex items-center gap-2 min-h-[48px] px-6 text-[16px] rounded-xl"
          >
            <RefreshCw size={18} />
            다시 시도
          </button>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 text-gray-400">
          <Wrench size={48} className="mb-4 opacity-30" />
          <p className="text-[18px] font-medium text-gray-500 dark:text-gray-400 mb-1">
            {activeFilter !== 'ALL' || searchQuery
              ? '검색 결과가 없습니다.'
              : '등록된 정비 내역이 없습니다.'}
          </p>
          <p className="text-[14px] text-gray-400 dark:text-gray-500 mb-6">
            {activeFilter !== 'ALL' || searchQuery
              ? '필터를 변경하거나 검색어를 수정해 보세요.'
              : '새로운 정비 일정을 등록해 주세요.'}
          </p>
          {!searchQuery && activeFilter === 'ALL' && (
            <button
              onClick={openCreateModal}
              className="btn-primary flex items-center gap-2 min-h-[48px] px-6 text-[16px] rounded-xl"
            >
              <Plus size={20} />
              정비 등록
            </button>
          )}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[16px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">차량번호</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">정비유형</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">설명</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">예정일</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">상태</th>
                  <th className="text-right px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">비용</th>
                  <th className="text-left px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">정비사</th>
                  <th className="text-center px-6 py-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredRecords.map((record) => {
                  const statusKey = record.status as MaintenanceStatusKey;
                  const config = STATUS_CONFIG[statusKey] || STATUS_CONFIG.SCHEDULED;
                  const StatusIcon = config.icon;
                  const parsed = parseNotes(record.notes);
                  const displayDescription = record.description || parsed.description;
                  const displayMechanic = record.mechanic || parsed.mechanic;
                  const displayCost = record.cost ?? (parsed.cost ? parseInt(parsed.cost) : null);

                  return (
                    <tr
                      key={record.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      {/* Bus Number */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Truck size={18} className="text-blue-600" />
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{record.bus.busNumber}</div>
                            <div className="text-[13px] text-gray-400 dark:text-gray-500">{record.bus.plateNumber}</div>
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          {MAINTENANCE_TYPES[record.type as MaintenanceTypeKey] || record.type}
                        </span>
                      </td>

                      {/* Description */}
                      <td className="px-6 py-4">
                        <span className="text-gray-600 dark:text-gray-300 text-[15px] max-w-[240px] truncate block">
                          {displayDescription || '-'}
                        </span>
                      </td>

                      {/* Scheduled Date */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                          <Calendar size={15} className="text-gray-400 dark:text-gray-500" />
                          {formatDate(record.scheduledAt)}
                        </div>
                        {record.completedAt && (
                          <div className="text-[13px] text-green-600 mt-0.5">
                            완료: {formatDate(record.completedAt)}
                          </div>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] font-medium ${config.badgeClass}`}
                        >
                          <StatusIcon size={14} />
                          {config.label}
                        </span>
                      </td>

                      {/* Cost */}
                      <td className="px-6 py-4 text-right whitespace-nowrap font-medium text-gray-800 dark:text-gray-200">
                        {formatCurrency(displayCost as number | null)}
                      </td>

                      {/* Mechanic */}
                      <td className="px-6 py-4 whitespace-nowrap text-gray-700 dark:text-gray-200">
                        {displayMechanic || '-'}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {/* Status Transitions */}
                          {statusKey === 'SCHEDULED' && (
                            <button
                              onClick={() => handleStatusChange(record, 'IN_PROGRESS')}
                              disabled={statusMutation.isPending}
                              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-yellow-100 text-yellow-700 hover:bg-yellow-200 text-[14px] font-medium transition-colors disabled:opacity-50"
                              title="진행 시작"
                            >
                              <Play size={14} />
                              진행 시작
                            </button>
                          )}
                          {statusKey === 'IN_PROGRESS' && (
                            <button
                              onClick={() => handleStatusChange(record, 'COMPLETED')}
                              disabled={statusMutation.isPending}
                              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 text-[14px] font-medium transition-colors disabled:opacity-50"
                              title="완료 처리"
                            >
                              <CheckCircle size={14} />
                              완료 처리
                            </button>
                          )}
                          {(statusKey === 'SCHEDULED' || statusKey === 'IN_PROGRESS') && (
                            <button
                              onClick={() => handleStatusChange(record, 'CANCELLED')}
                              disabled={statusMutation.isPending}
                              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 text-[14px] font-medium transition-colors disabled:opacity-50"
                              title="취소"
                            >
                              <Ban size={14} />
                            </button>
                          )}

                          {/* Edit button for non-completed records */}
                          {statusKey !== 'COMPLETED' && statusKey !== 'CANCELLED' && (
                            <button
                              onClick={() => openEditModal(record)}
                              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 text-[14px] font-medium transition-colors"
                              title="수정"
                            >
                              <Wrench size={14} />
                              수정
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 text-[14px] text-gray-500 dark:text-gray-400 flex items-center justify-between">
            <span>총 {filteredRecords.length}건</span>
            {activeFilter !== 'ALL' && (
              <button
                onClick={() => setActiveFilter('ALL')}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                전체 보기
              </button>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Wrench size={22} className="text-blue-600" />
                {editingRecord ? '정비 정보 수정' : '정비 일정 등록'}
              </h2>
              <button
                onClick={closeModal}
                className="w-10 h-10 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Bus Select */}
              <div>
                <label className="block text-[16px] font-semibold text-gray-700 mb-2">
                  차량 선택 <span className="text-red-500">*</span>
                </label>
                <select
                  className="input min-h-[48px] text-[16px] w-full"
                  value={form.busId}
                  onChange={(e) => setForm((p) => ({ ...p, busId: e.target.value }))}
                  required
                >
                  <option value="">차량을 선택해 주세요</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.busNumber} ({b.plateNumber})
                    </option>
                  ))}
                </select>
              </div>

              {/* Maintenance Type */}
              <div>
                <label className="block text-[16px] font-semibold text-gray-700 mb-2">
                  정비 유형 <span className="text-red-500">*</span>
                </label>
                <select
                  className="input min-h-[48px] text-[16px] w-full"
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as MaintenanceTypeKey }))}
                >
                  {(Object.entries(MAINTENANCE_TYPES) as [MaintenanceTypeKey, string][]).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[16px] font-semibold text-gray-700 mb-2">설명</label>
                <textarea
                  className="input min-h-[80px] text-[16px] w-full resize-none"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="정비 내용을 입력해 주세요"
                />
              </div>

              {/* Scheduled Date */}
              <div>
                <label className="block text-[16px] font-semibold text-gray-700 mb-2">
                  예정일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  className="input min-h-[48px] text-[16px] w-full"
                  value={form.scheduledAt}
                  onChange={(e) => setForm((p) => ({ ...p, scheduledAt: e.target.value }))}
                  required
                />
              </div>

              {/* Cost + Mechanic (side by side) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[16px] font-semibold text-gray-700 mb-2">비용 (원)</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-[16px] font-medium">
                      ₩
                    </span>
                    <input
                      type="number"
                      className="input min-h-[48px] text-[16px] w-full pl-9"
                      value={form.cost}
                      onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))}
                      placeholder="0"
                      min="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[16px] font-semibold text-gray-700 mb-2">정비사</label>
                  <input
                    type="text"
                    className="input min-h-[48px] text-[16px] w-full"
                    value={form.mechanic}
                    onChange={(e) => setForm((p) => ({ ...p, mechanic: e.target.value }))}
                    placeholder="담당 정비사 이름"
                  />
                </div>
              </div>

              {/* Mileage */}
              <div>
                <label className="block text-[16px] font-semibold text-gray-700 mb-2">정비 시 주행거리 (km)</label>
                <input
                  type="number"
                  className="input min-h-[48px] text-[16px] w-full"
                  value={form.mileageAtService}
                  onChange={(e) => setForm((p) => ({ ...p, mileageAtService: e.target.value }))}
                  placeholder="예: 150,000"
                  min="0"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="btn-secondary flex-1 min-h-[48px] text-[16px] font-semibold rounded-xl"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 min-h-[48px] text-[16px] font-semibold rounded-xl flex items-center justify-center gap-2"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      {editingRecord ? '수정 중...' : '등록 중...'}
                    </>
                  ) : (
                    editingRecord ? '수정 완료' : '등록'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
