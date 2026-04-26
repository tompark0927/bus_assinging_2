import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bus,
  Plus,
  Search,
  Edit,
  Trash2,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wrench,
} from 'lucide-react';
import { busesApi, routesApi } from '../services/api';
import toast from 'react-hot-toast';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

interface BusData {
  id: number;
  busNumber: string;
  plateNumber: string;
  model: string | null;
  year: number | null;
  capacity: number;
  isActive: boolean;
  totalMileage: number;
  groupType: string | null;
  orderInGroup: number | null;
  route?: { id: number; routeNumber: string; name: string } | null;
  maintenanceRecords?: Array<{ status: string }>;
}

interface Route {
  id: number;
  routeNumber: string;
  name: string;
}

type BusStatus = 'ALL' | 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */

function getBusStatus(bus: BusData): 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE' {
  if (!bus.isActive) return 'INACTIVE';
  const hasMaint = bus.maintenanceRecords?.some(
    (m) => m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS'
  );
  if (hasMaint) return 'MAINTENANCE';
  return 'ACTIVE';
}

function statusLabel(s: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE') {
  switch (s) {
    case 'ACTIVE':
      return '운행중';
    case 'MAINTENANCE':
      return '정비중';
    case 'INACTIVE':
      return '비활성';
  }
}

function statusBadge(s: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE') {
  switch (s) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-700';
    case 'MAINTENANCE':
      return 'bg-yellow-100 text-yellow-700';
    case 'INACTIVE':
      return 'bg-red-100 text-red-700';
  }
}

/* ────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */

export default function BusesPage() {
  const queryClient = useQueryClient();

  // UI state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BusData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<BusData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<BusStatus>('ALL');
  const [form, setForm] = useState({
    busNumber: '',
    plateNumber: '',
    model: '',
    year: '',
    capacity: '40',
    routeId: '',
  });

  // ── Queries ──
  const {
    data: buses = [],
    isLoading,
    isError,
    error,
  } = useQuery<BusData[]>({
    queryKey: ['buses'],
    queryFn: () => busesApi.list().then((r) => r.data.data),
  });

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data),
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => busesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buses'] });
      toast.success('차량이 등록되었습니다.');
      closeModal();
    },
    onError: (err: unknown) =>
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '차량 등록 중 오류가 발생했습니다.'
      ),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      busesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buses'] });
      toast.success('차량 정보가 수정되었습니다.');
      closeModal();
    },
    onError: (err: unknown) =>
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '차량 수정 중 오류가 발생했습니다.'
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => busesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buses'] });
      toast.success('차량이 비활성화되었습니다.');
      setDeleteConfirm(null);
    },
    onError: () => toast.error('차량 비활성화 중 오류가 발생했습니다.'),
  });

  // ── Derived data ──
  const counts = useMemo(() => {
    let active = 0;
    let maintenance = 0;
    let inactive = 0;
    buses.forEach((b) => {
      const s = getBusStatus(b);
      if (s === 'ACTIVE') active++;
      else if (s === 'MAINTENANCE') maintenance++;
      else inactive++;
    });
    return { total: buses.length, active, maintenance, inactive };
  }, [buses]);

  const filteredBuses = useMemo(() => {
    let list = buses;

    // status filter
    if (statusFilter !== 'ALL') {
      list = list.filter((b) => getBusStatus(b) === statusFilter);
    }

    // search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (b) =>
          b.busNumber.toLowerCase().includes(q) ||
          b.plateNumber.toLowerCase().includes(q) ||
          (b.model && b.model.toLowerCase().includes(q))
      );
    }
    return list;
  }, [buses, statusFilter, searchQuery]);

  // ── Handlers ──
  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      busNumber: '',
      plateNumber: '',
      model: '',
      year: '',
      capacity: '40',
      routeId: '',
    });
    setShowModal(true);
  };

  const openEdit = (bus: BusData) => {
    setEditing(bus);
    setForm({
      busNumber: bus.busNumber,
      plateNumber: bus.plateNumber,
      model: bus.model || '',
      year: String(bus.year || ''),
      capacity: String(bus.capacity),
      routeId: String(bus.route?.id || ''),
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Record<string, unknown> = {
      busNumber: form.busNumber.trim(),
      plateNumber: form.plateNumber.trim(),
      model: form.model.trim() || undefined,
      year: form.year ? parseInt(form.year) : undefined,
      capacity: parseInt(form.capacity),
      routeId: form.routeId ? parseInt(form.routeId) : null,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ──

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-gray-400">
        <Loader2 size={48} className="animate-spin mb-4" />
        <p className="text-lg">차량 목록을 불러오는 중입니다...</p>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertTriangle size={48} className="text-red-400 mb-4" />
        <p className="text-lg text-red-600 font-medium mb-2">
          차량 목록을 불러오지 못했습니다
        </p>
        <p className="text-base text-gray-500 mb-6">
          {(error as Error)?.message || '서버 연결을 확인해주세요.'}
        </p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['buses'] })}
          className="btn-primary text-base px-6 py-3"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
            차량 관리
          </h1>
          <p className="text-base text-gray-500 mt-1">
            등록된 전체 차량을 관리합니다
          </p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary flex items-center gap-2 text-base px-5 py-3 min-h-[48px]"
        >
          <Plus size={20} />
          차량 등록
        </button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="전체"
          count={counts.total}
          unit="대"
          icon={<Bus size={24} />}
          color="blue"
          active={statusFilter === 'ALL'}
          onClick={() => setStatusFilter('ALL')}
        />
        <SummaryCard
          label="운행중"
          count={counts.active}
          unit="대"
          icon={<CheckCircle2 size={24} />}
          color="green"
          active={statusFilter === 'ACTIVE'}
          onClick={() =>
            setStatusFilter(statusFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE')
          }
        />
        <SummaryCard
          label="정비중"
          count={counts.maintenance}
          unit="대"
          icon={<Wrench size={24} />}
          color="yellow"
          active={statusFilter === 'MAINTENANCE'}
          onClick={() =>
            setStatusFilter(
              statusFilter === 'MAINTENANCE' ? 'ALL' : 'MAINTENANCE'
            )
          }
        />
        <SummaryCard
          label="비활성"
          count={counts.inactive}
          unit="대"
          icon={<XCircle size={24} />}
          color="red"
          active={statusFilter === 'INACTIVE'}
          onClick={() =>
            setStatusFilter(statusFilter === 'INACTIVE' ? 'ALL' : 'INACTIVE')
          }
        />
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-md">
        <Search
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="차량번호, 차대번호, 모델로 검색..."
          className="input pl-12 text-base py-3 min-h-[48px]"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-base font-semibold text-gray-700 px-6 py-4">
                  차량번호
                </th>
                <th className="text-left text-base font-semibold text-gray-700 px-6 py-4">
                  차대번호
                </th>
                <th className="text-left text-base font-semibold text-gray-700 px-6 py-4 hidden md:table-cell">
                  모델
                </th>
                <th className="text-left text-base font-semibold text-gray-700 px-6 py-4 hidden lg:table-cell">
                  연식
                </th>
                <th className="text-center text-base font-semibold text-gray-700 px-6 py-4 hidden lg:table-cell">
                  정원
                </th>
                <th className="text-left text-base font-semibold text-gray-700 px-6 py-4 hidden md:table-cell">
                  배정 노선
                </th>
                <th className="text-center text-base font-semibold text-gray-700 px-6 py-4">
                  상태
                </th>
                <th className="text-center text-base font-semibold text-gray-700 px-6 py-4">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredBuses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <Bus size={40} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-lg text-gray-400">
                      {searchQuery || statusFilter !== 'ALL'
                        ? '검색 결과가 없습니다'
                        : '등록된 차량이 없습니다'}
                    </p>
                    {!searchQuery && statusFilter === 'ALL' && (
                      <button
                        onClick={openCreate}
                        className="mt-4 text-blue-600 hover:text-blue-700 text-base font-medium"
                      >
                        + 첫 번째 차량을 등록하세요
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredBuses.map((bus) => {
                  const st = getBusStatus(bus);
                  return (
                    <tr
                      key={bus.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                            <Bus size={20} className="text-blue-600" />
                          </div>
                          <span className="text-base font-bold text-gray-900">
                            {bus.busNumber}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-base text-gray-700">
                        {bus.plateNumber}
                      </td>
                      <td className="px-6 py-4 text-base text-gray-600 hidden md:table-cell">
                        {bus.model || '-'}
                      </td>
                      <td className="px-6 py-4 text-base text-gray-600 hidden lg:table-cell">
                        {bus.year ? `${bus.year}년` : '-'}
                      </td>
                      <td className="px-6 py-4 text-base text-gray-600 text-center hidden lg:table-cell">
                        {bus.capacity}명
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        {bus.route ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-50 text-blue-700">
                            {bus.route.routeNumber}번 {bus.route.name}
                          </span>
                        ) : (
                          <span className="text-base text-gray-400">
                            미배정
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`badge text-sm px-3 py-1 ${statusBadge(st)}`}
                        >
                          {statusLabel(st)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(bus)}
                            className="p-3 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
                            title="수정"
                          >
                            <Edit size={20} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(bus)}
                            className="p-3 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
                            title="비활성화"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Table footer */}
        {filteredBuses.length > 0 && (
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-3">
            <p className="text-base text-gray-500">
              총 <span className="font-bold text-gray-700">{filteredBuses.length}</span>대
              {statusFilter !== 'ALL' || searchQuery
                ? ` (전체 ${buses.length}대 중)`
                : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl lg:text-2xl font-bold text-gray-900">
                {editing ? '차량 정보 수정' : '새 차량 등록'}
              </h2>
              <button
                onClick={closeModal}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    차량번호 <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="input text-base py-3 min-h-[48px]"
                    value={form.busNumber}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, busNumber: e.target.value }))
                    }
                    required
                    placeholder="SM001"
                  />
                </div>
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    차대번호 <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="input text-base py-3 min-h-[48px]"
                    value={form.plateNumber}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, plateNumber: e.target.value }))
                    }
                    required
                    placeholder="인천12가3456"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    모델명
                  </label>
                  <input
                    className="input text-base py-3 min-h-[48px]"
                    value={form.model}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, model: e.target.value }))
                    }
                    placeholder="현대 뉴 슈퍼 에어로시티"
                  />
                </div>
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    연식
                  </label>
                  <input
                    type="number"
                    className="input text-base py-3 min-h-[48px]"
                    value={form.year}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, year: e.target.value }))
                    }
                    placeholder="2023"
                    min={1990}
                    max={2030}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    정원 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    className="input text-base py-3 min-h-[48px]"
                    value={form.capacity}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, capacity: e.target.value }))
                    }
                    required
                    min={1}
                    max={100}
                  />
                </div>
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    배정 노선
                  </label>
                  <select
                    className="input text-base py-3 min-h-[48px]"
                    value={form.routeId}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, routeId: e.target.value }))
                    }
                  >
                    <option value="">노선 없음</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.routeNumber}번 - {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="btn-secondary flex-1 text-base py-3 min-h-[48px]"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 text-base py-3 min-h-[48px] flex items-center justify-center gap-2"
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      저장 중...
                    </>
                  ) : editing ? (
                    '수정 완료'
                  ) : (
                    '차량 등록'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirm(null);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 md:p-8">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle size={32} className="text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                차량 비활성화
              </h2>
              <p className="text-base text-gray-600 mb-6">
                <span className="font-bold">{deleteConfirm.busNumber}</span>{' '}
                ({deleteConfirm.plateNumber}) 차량을 비활성화하시겠습니까?
                <br />
                <span className="text-sm text-gray-500">
                  비활성화된 차량은 배차에서 제외됩니다.
                </span>
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="btn-secondary flex-1 text-base py-3 min-h-[48px]"
                >
                  취소
                </button>
                <button
                  onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                  disabled={deleteMutation.isPending}
                  className="btn-danger flex-1 text-base py-3 min-h-[48px] flex items-center justify-center gap-2"
                >
                  {deleteMutation.isPending ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      처리 중...
                    </>
                  ) : (
                    '비활성화'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   Summary Card Sub-component
   ──────────────────────────────────────────── */

function SummaryCard({
  label,
  count,
  unit,
  icon,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  unit: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'yellow' | 'red';
  active: boolean;
  onClick: () => void;
}) {
  const colorMap = {
    blue: {
      bg: 'bg-blue-50',
      icon: 'bg-blue-100 text-blue-600',
      ring: 'ring-blue-300',
    },
    green: {
      bg: 'bg-green-50',
      icon: 'bg-green-100 text-green-600',
      ring: 'ring-green-300',
    },
    yellow: {
      bg: 'bg-yellow-50',
      icon: 'bg-yellow-100 text-yellow-600',
      ring: 'ring-yellow-300',
    },
    red: {
      bg: 'bg-red-50',
      icon: 'bg-red-100 text-red-600',
      ring: 'ring-red-300',
    },
  };
  const c = colorMap[color];

  return (
    <button
      onClick={onClick}
      className={`card text-left transition-all cursor-pointer hover:shadow-md ${
        active ? `ring-2 ${c.ring} ${c.bg}` : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center ${c.icon}`}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">
            {count}
            <span className="text-base font-normal text-gray-500 ml-1">
              {unit}
            </span>
          </p>
        </div>
      </div>
    </button>
  );
}
