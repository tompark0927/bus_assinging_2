import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Plus,
  Search,
  Edit,
  X,
  Loader2,
  AlertTriangle,
  UserPlus,
  UserMinus,
  Bus,
  Users,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { routesApi, usersApi } from '../services/api';
import toast from 'react-hot-toast';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

interface RouteData {
  id: number;
  routeNumber: string;
  name: string;
  description: string | null;
  startPoint: string | null;
  endPoint: string | null;
  isActive: boolean;
  buses: Array<{ id: number; busNumber: string; plateNumber: string }>;
  routeAssignments: Array<{
    id: number;
    driver: {
      id: number;
      name: string;
      employeeId: string;
      driverType: string;
    };
  }>;
}

interface Driver {
  id: number;
  name: string;
  employeeId: string;
  driverType: string | null;
}

/* ────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */

export default function RoutesPage() {
  const queryClient = useQueryClient();

  // UI state
  const [showModal, setShowModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState<RouteData | null>(
    null
  );
  const [editing, setEditing] = useState<RouteData | null>(null);
  const [expandedRoute, setExpandedRoute] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [removeConfirm, setRemoveConfirm] = useState<{
    routeId: number;
    driverId: number;
    driverName: string;
  } | null>(null);
  const [form, setForm] = useState({
    routeNumber: '',
    name: '',
    description: '',
    startPoint: '',
    endPoint: '',
  });

  // ── Queries ──
  const {
    data: routes = [],
    isLoading,
    isError,
    error,
  } = useQuery<RouteData[]>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data),
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ['users', 'drivers'],
    queryFn: () =>
      usersApi
        .list({ role: 'DRIVER', isActive: 'true' })
        .then((r) => r.data.data),
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => routesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('노선이 등록되었습니다.');
      closeModal();
    },
    onError: (err: unknown) =>
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '노선 등록 중 오류가 발생했습니다.'
      ),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      routesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('노선 정보가 수정되었습니다.');
      closeModal();
    },
    onError: (err: unknown) =>
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '노선 수정 중 오류가 발생했습니다.'
      ),
  });

  const assignMutation = useMutation({
    mutationFn: ({
      routeId,
      driverId,
    }: {
      routeId: number;
      driverId: number;
    }) =>
      routesApi.assignDriver(routeId, driverId, new Date().toISOString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('기사님이 노선에 배정되었습니다.');
      setShowAssignModal(null);
      setSelectedDriverId('');
    },
    onError: (err: unknown) =>
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '기사 배정 중 오류가 발생했습니다.'
      ),
  });

  const removeMutation = useMutation({
    mutationFn: ({
      routeId,
      driverId,
    }: {
      routeId: number;
      driverId: number;
    }) => routesApi.removeDriver(routeId, driverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('기사님이 노선에서 해제되었습니다.');
      setRemoveConfirm(null);
    },
    onError: () => toast.error('기사 해제 중 오류가 발생했습니다.'),
  });

  // ── Derived data ──
  const counts = useMemo(() => {
    const activeRoutes = routes.filter((r) => r.isActive).length;
    const totalDrivers = routes.reduce(
      (sum, r) => sum + r.routeAssignments.length,
      0
    );
    const totalBuses = routes.reduce((sum, r) => sum + r.buses.length, 0);
    return {
      total: routes.length,
      active: activeRoutes,
      drivers: totalDrivers,
      buses: totalBuses,
    };
  }, [routes]);

  const filteredRoutes = useMemo(() => {
    if (!searchQuery.trim()) return routes;
    const q = searchQuery.trim().toLowerCase();
    return routes.filter(
      (r) =>
        r.routeNumber.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.startPoint && r.startPoint.toLowerCase().includes(q)) ||
        (r.endPoint && r.endPoint.toLowerCase().includes(q))
    );
  }, [routes, searchQuery]);

  // Drivers not already assigned to the selected route
  const availableDrivers = useMemo(() => {
    if (!showAssignModal) return drivers;
    const assignedIds = new Set(
      showAssignModal.routeAssignments.map((a) => a.driver.id)
    );
    return drivers.filter((d) => !assignedIds.has(d.id));
  }, [drivers, showAssignModal]);

  // ── Handlers ──
  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      routeNumber: '',
      name: '',
      description: '',
      startPoint: '',
      endPoint: '',
    });
    setShowModal(true);
  };

  const openEdit = (route: RouteData) => {
    setEditing(route);
    setForm({
      routeNumber: route.routeNumber,
      name: route.name,
      description: route.description || '',
      startPoint: route.startPoint || '',
      endPoint: route.endPoint || '',
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Record<string, unknown> = {
      routeNumber: form.routeNumber.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      startPoint: form.startPoint.trim() || undefined,
      endPoint: form.endPoint.trim() || undefined,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const toggleExpand = (routeId: number) => {
    setExpandedRoute(expandedRoute === routeId ? null : routeId);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ──

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-gray-400">
        <Loader2 size={48} className="animate-spin mb-4" />
        <p className="text-lg">노선 목록을 불러오는 중입니다...</p>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertTriangle size={48} className="text-red-400 mb-4" />
        <p className="text-lg text-red-600 font-medium mb-2">
          노선 목록을 불러오지 못했습니다
        </p>
        <p className="text-base text-gray-500 mb-6">
          {(error as Error)?.message || '서버 연결을 확인해주세요.'}
        </p>
        <button
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ['routes'] })
          }
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
            노선 관리
          </h1>
          <p className="text-base text-gray-500 mt-1">
            운행 노선과 배정 현황을 관리합니다
          </p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary flex items-center gap-2 text-base px-5 py-3 min-h-[48px]"
        >
          <Plus size={20} />
          노선 등록
        </button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="전체 노선"
          count={counts.total}
          unit="개"
          icon={<MapPin size={24} />}
          color="purple"
        />
        <SummaryCard
          label="활성 노선"
          count={counts.active}
          unit="개"
          icon={<CheckCircle2 size={24} />}
          color="green"
        />
        <SummaryCard
          label="배정 기사"
          count={counts.drivers}
          unit="명"
          icon={<Users size={24} />}
          color="blue"
        />
        <SummaryCard
          label="배정 차량"
          count={counts.buses}
          unit="대"
          icon={<Bus size={24} />}
          color="orange"
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
          placeholder="노선번호, 노선명, 출발지/종점으로 검색..."
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
                  노선번호
                </th>
                <th className="text-left text-base font-semibold text-gray-700 px-6 py-4">
                  노선명
                </th>
                <th className="text-left text-base font-semibold text-gray-700 px-6 py-4 hidden md:table-cell">
                  구간
                </th>
                <th className="text-center text-base font-semibold text-gray-700 px-6 py-4">
                  배정 차량
                </th>
                <th className="text-center text-base font-semibold text-gray-700 px-6 py-4">
                  배정 기사
                </th>
                <th className="text-center text-base font-semibold text-gray-700 px-6 py-4 hidden md:table-cell">
                  상태
                </th>
                <th className="text-center text-base font-semibold text-gray-700 px-6 py-4">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRoutes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <MapPin size={40} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-lg text-gray-400">
                      {searchQuery
                        ? '검색 결과가 없습니다'
                        : '등록된 노선이 없습니다'}
                    </p>
                    {!searchQuery && (
                      <button
                        onClick={openCreate}
                        className="mt-4 text-blue-600 hover:text-blue-700 text-base font-medium"
                      >
                        + 첫 번째 노선을 등록하세요
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredRoutes.map((route) => {
                  const isExpanded = expandedRoute === route.id;
                  return (
                    <RouteRow
                      key={route.id}
                      route={route}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleExpand(route.id)}
                      onEdit={() => openEdit(route)}
                      onAssign={() => {
                        setShowAssignModal(route);
                        setSelectedDriverId('');
                      }}
                      onRemoveDriver={(driverId, driverName) =>
                        setRemoveConfirm({
                          routeId: route.id,
                          driverId,
                          driverName,
                        })
                      }
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Table footer */}
        {filteredRoutes.length > 0 && (
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-3">
            <p className="text-base text-gray-500">
              총{' '}
              <span className="font-bold text-gray-700">
                {filteredRoutes.length}
              </span>
              개 노선
              {searchQuery ? ` (전체 ${routes.length}개 중)` : ''}
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
                {editing ? '노선 정보 수정' : '새 노선 등록'}
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
                    노선번호 <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="input text-base py-3 min-h-[48px]"
                    value={form.routeNumber}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, routeNumber: e.target.value }))
                    }
                    required
                    placeholder="16"
                  />
                </div>
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    노선명 <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="input text-base py-3 min-h-[48px]"
                    value={form.name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, name: e.target.value }))
                    }
                    required
                    placeholder="인천 16번"
                  />
                </div>
              </div>

              <div>
                <label className="block text-base font-medium text-gray-700 mb-2">
                  설명
                </label>
                <textarea
                  className="input text-base py-3 resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, description: e.target.value }))
                  }
                  placeholder="노선에 대한 추가 설명을 입력하세요"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    출발지
                  </label>
                  <input
                    className="input text-base py-3 min-h-[48px]"
                    value={form.startPoint}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, startPoint: e.target.value }))
                    }
                    placeholder="인천시청"
                  />
                </div>
                <div>
                  <label className="block text-base font-medium text-gray-700 mb-2">
                    종점
                  </label>
                  <input
                    className="input text-base py-3 min-h-[48px]"
                    value={form.endPoint}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, endPoint: e.target.value }))
                    }
                    placeholder="연수구"
                  />
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
                    '노선 등록'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assign Driver Modal ── */}
      {showAssignModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAssignModal(null);
              setSelectedDriverId('');
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">기사 배정</h2>
                <p className="text-base text-gray-500 mt-1">
                  {showAssignModal.routeNumber}번 {showAssignModal.name}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAssignModal(null);
                  setSelectedDriverId('');
                }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
              >
                <X size={24} />
              </button>
            </div>

            {/* Currently assigned */}
            {showAssignModal.routeAssignments.length > 0 && (
              <div className="mb-5">
                <p className="text-sm font-medium text-gray-500 mb-2">
                  현재 배정 기사 ({showAssignModal.routeAssignments.length}명)
                </p>
                <div className="space-y-2">
                  {showAssignModal.routeAssignments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3"
                    >
                      <div>
                        <span className="text-base font-medium text-gray-900">
                          {a.driver.name}
                        </span>
                        <span className="text-sm text-gray-500 ml-2">
                          ({a.driver.employeeId})
                        </span>
                        <span
                          className={`badge ml-2 text-xs ${
                            a.driver.driverType === 'MAIN'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}
                        >
                          {a.driver.driverType === 'MAIN' ? '메인' : '스페어'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-5">
              <label className="block text-base font-medium text-gray-700 mb-2">
                기사 선택
              </label>
              <select
                className="input text-base py-3 min-h-[48px]"
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
              >
                <option value="">기사님을 선택하세요</option>
                {availableDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.employeeId}) -{' '}
                    {d.driverType === 'MAIN' ? '메인' : '스페어'}
                  </option>
                ))}
              </select>
              {availableDrivers.length === 0 && (
                <p className="text-sm text-gray-400 mt-2">
                  배정 가능한 기사가 없습니다.
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowAssignModal(null);
                  setSelectedDriverId('');
                }}
                className="btn-secondary flex-1 text-base py-3 min-h-[48px]"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  if (selectedDriverId && showAssignModal) {
                    assignMutation.mutate({
                      routeId: showAssignModal.id,
                      driverId: parseInt(selectedDriverId),
                    });
                  }
                }}
                disabled={!selectedDriverId || assignMutation.isPending}
                className="btn-primary flex-1 text-base py-3 min-h-[48px] flex items-center justify-center gap-2"
              >
                {assignMutation.isPending ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    배정 중...
                  </>
                ) : (
                  <>
                    <UserPlus size={20} />
                    배정
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Driver Confirm Modal ── */}
      {removeConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRemoveConfirm(null);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 md:p-8">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <UserMinus size={32} className="text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                기사 해제
              </h2>
              <p className="text-base text-gray-600 mb-6">
                <span className="font-bold">{removeConfirm.driverName}</span>{' '}
                기사님을 이 노선에서 해제하시겠습니까?
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setRemoveConfirm(null)}
                  className="btn-secondary flex-1 text-base py-3 min-h-[48px]"
                >
                  취소
                </button>
                <button
                  onClick={() =>
                    removeMutation.mutate({
                      routeId: removeConfirm.routeId,
                      driverId: removeConfirm.driverId,
                    })
                  }
                  disabled={removeMutation.isPending}
                  className="btn-danger flex-1 text-base py-3 min-h-[48px] flex items-center justify-center gap-2"
                >
                  {removeMutation.isPending ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      처리 중...
                    </>
                  ) : (
                    '해제'
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
   Route Table Row (with expandable detail)
   ──────────────────────────────────────────── */

function RouteRow({
  route,
  isExpanded,
  onToggleExpand,
  onEdit,
  onAssign,
  onRemoveDriver,
}: {
  route: RouteData;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onRemoveDriver: (driverId: number, driverName: string) => void;
}) {
  return (
    <>
      {/* Main row */}
      <tr
        className={`hover:bg-gray-50 transition-colors cursor-pointer ${
          isExpanded ? 'bg-blue-50/50' : ''
        }`}
        onClick={onToggleExpand}
      >
        <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <MapPin size={20} className="text-purple-600" />
            </div>
            <span className="text-base font-bold text-gray-900">
              {route.routeNumber}번
            </span>
          </div>
        </td>
        <td className="px-6 py-4 text-base text-gray-700">{route.name}</td>
        <td className="px-6 py-4 hidden md:table-cell">
          {route.startPoint || route.endPoint ? (
            <div className="flex items-center gap-2 text-base text-gray-600">
              <span>{route.startPoint || '-'}</span>
              <ArrowRight size={16} className="text-gray-400 flex-shrink-0" />
              <span>{route.endPoint || '-'}</span>
            </div>
          ) : (
            <span className="text-base text-gray-400">미설정</span>
          )}
        </td>
        <td className="px-6 py-4 text-center">
          <span className="inline-flex items-center gap-1.5 text-base font-medium text-gray-700">
            <Bus size={16} className="text-blue-500" />
            {route.buses.length}대
          </span>
        </td>
        <td className="px-6 py-4 text-center">
          <span className="inline-flex items-center gap-1.5 text-base font-medium text-gray-700">
            <Users size={16} className="text-green-500" />
            {route.routeAssignments.length}명
          </span>
        </td>
        <td className="px-6 py-4 text-center hidden md:table-cell">
          <span
            className={`badge text-sm px-3 py-1 ${
              route.isActive
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {route.isActive ? '운행' : '중단'}
          </span>
        </td>
        <td className="px-6 py-4">
          <div
            className="flex items-center justify-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onAssign}
              className="p-3 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-xl transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
              title="기사 배정"
            >
              <UserPlus size={20} />
            </button>
            <button
              onClick={onEdit}
              className="p-3 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
              title="수정"
            >
              <Edit size={20} />
            </button>
            <button
              onClick={onToggleExpand}
              className="p-3 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
              title="상세 보기"
            >
              {isExpanded ? (
                <ChevronUp size={20} />
              ) : (
                <ChevronDown size={20} />
              )}
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && (
        <tr className="bg-blue-50/30">
          <td colSpan={7} className="px-6 py-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Description */}
              {route.description && (
                <div className="md:col-span-2">
                  <p className="text-sm font-medium text-gray-500 mb-1">설명</p>
                  <p className="text-base text-gray-700">{route.description}</p>
                </div>
              )}

              {/* Assigned Buses */}
              <div>
                <p className="text-sm font-medium text-gray-500 mb-3">
                  배정 차량 ({route.buses.length}대)
                </p>
                {route.buses.length === 0 ? (
                  <p className="text-base text-gray-400">
                    배정된 차량이 없습니다
                  </p>
                ) : (
                  <div className="space-y-2">
                    {route.buses.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-gray-200"
                      >
                        <Bus size={18} className="text-blue-500" />
                        <div>
                          <span className="text-base font-medium text-gray-900">
                            {b.busNumber}
                          </span>
                          <span className="text-sm text-gray-500 ml-2">
                            {b.plateNumber}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Assigned Drivers */}
              <div>
                <p className="text-sm font-medium text-gray-500 mb-3">
                  배정 기사 ({route.routeAssignments.length}명)
                </p>
                {route.routeAssignments.length === 0 ? (
                  <p className="text-base text-gray-400">
                    배정된 기사가 없습니다
                  </p>
                ) : (
                  <div className="space-y-2">
                    {route.routeAssignments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-gray-200"
                      >
                        <div className="flex items-center gap-3">
                          <Users size={18} className="text-green-500" />
                          <div>
                            <span className="text-base font-medium text-gray-900">
                              {a.driver.name}
                            </span>
                            <span className="text-sm text-gray-500 ml-2">
                              ({a.driver.employeeId})
                            </span>
                          </div>
                          <span
                            className={`badge text-xs ${
                              a.driver.driverType === 'MAIN'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}
                          >
                            {a.driver.driverType === 'MAIN'
                              ? '메인'
                              : '스페어'}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            onRemoveDriver(a.driver.id, a.driver.name)
                          }
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="해제"
                        >
                          <UserMinus size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
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
}: {
  label: string;
  count: number;
  unit: string;
  icon: React.ReactNode;
  color: 'purple' | 'green' | 'blue' | 'orange';
}) {
  const colorMap = {
    purple: 'bg-purple-100 text-purple-600',
    green: 'bg-green-100 text-green-600',
    blue: 'bg-blue-100 text-blue-600',
    orange: 'bg-orange-100 text-orange-600',
  };

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorMap[color]}`}
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
    </div>
  );
}
