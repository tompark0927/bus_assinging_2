import { useState, useMemo, useCallback } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Search,
  Edit,
  Key,
  UserCheck,
  UserX,
  Shield,
  AlertTriangle,
  X,
  Loader2,
  Filter,
  UserPlus,
  Clock,
} from 'lucide-react';
import { usersApi, routesApi } from '../services/api';
import toast from 'react-hot-toast';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

interface Driver {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  employeeId: string;
  driverType: 'MAIN' | 'SPARE' | null;
  shiftGroup: string | null;
  assignedBusNumber: string | null;
  hoboong: number | null;
  licenseNumber: string | null;
  licenseExpiresAt: string | null;
  qualificationExpiresAt: string | null;
  isActive: boolean;
  routeAssignments?: Array<{
    route: { id: number; routeNumber: string; name: string };
  }>;
}

interface RouteOption {
  id: number;
  routeNumber: string;
  name: string;
}

interface DriverFormData {
  name: string;
  email: string;
  phone: string;
  employeeId: string;
  driverType: string;
  shiftGroup: string;
  assignedBusNumber: string;
  hoboong: string;
  licenseNumber: string;
  licenseExpiresAt: string;
  qualificationExpiresAt: string;
  password: string;
}

const DEFAULT_FORM: DriverFormData = {
  name: '',
  email: '',
  phone: '',
  employeeId: '',
  driverType: 'MAIN',
  shiftGroup: '',
  assignedBusNumber: '',
  hoboong: '',
  licenseNumber: '',
  licenseExpiresAt: '',
  qualificationExpiresAt: '',
  password: '',
};

type DriverTypeFilter = 'ALL' | 'MAIN' | 'SPARE';
type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function getExpiryStyle(dateStr: string | null | undefined): string {
  const remaining = daysUntil(dateStr);
  if (remaining === null) return 'text-gray-500';
  if (remaining < 0) return 'text-red-600 font-semibold';
  if (remaining <= 30) return 'text-yellow-600 font-semibold';
  return 'text-gray-700';
}

function getExpiryBadge(dateStr: string | null | undefined): React.ReactNode {
  const remaining = daysUntil(dateStr);
  if (remaining === null) return null;
  if (remaining < 0) {
    return (
      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-md bg-red-100 px-1.5 py-0.5 text-[13px] font-semibold text-red-700">
        <AlertTriangle size={12} />
        만료됨
      </span>
    );
  }
  if (remaining <= 30) {
    return (
      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-md bg-yellow-100 px-1.5 py-0.5 text-[13px] font-semibold text-yellow-700">
        <Clock size={12} />
        {remaining}일 남음
      </span>
    );
  }
  return null;
}

function extractApiError(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e?.response?.data?.message || '오류가 발생했습니다.';
}

/* ────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */

export default function DriversPage() {
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<DriverTypeFilter>('ALL');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('ALL');
  const [routeFilter, setRouteFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [form, setForm] = useState<DriverFormData>(DEFAULT_FORM);

  /* ── Queries ───────────────────────────── */

  const queryParams: Record<string, string> = {
    role: 'DRIVER',
    page: String(page),
    limit: String(PAGE_SIZE),
  };
  if (search) queryParams.search = search;
  if (typeFilter !== 'ALL') queryParams.driverType = typeFilter;
  if (activeFilter !== 'ALL') queryParams.isActive = activeFilter === 'ACTIVE' ? 'true' : 'false';

  const {
    data: driversResponse,
    isLoading,
    isError,
    error,
  } = useQuery<{ data: Driver[]; pagination: { page: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean } }>({
    queryKey: ['users', 'drivers', page, search, typeFilter, activeFilter],
    queryFn: () =>
      usersApi
        .list(queryParams)
        .then((r) => ({ data: r.data.data, pagination: r.data.pagination })),
    placeholderData: (prev) => prev,
  });

  const drivers: Driver[] = driversResponse?.data ?? [];
  const pagination = driversResponse?.pagination;

  const { data: routes = [] } = useQuery<RouteOption[]>({
    queryKey: ['routes'],
    queryFn: () =>
      routesApi.list().then((r) =>
        (r.data.data ?? r.data).map((rt: RouteOption) => ({
          id: rt.id,
          routeNumber: rt.routeNumber,
          name: rt.name,
        })),
      ),
  });

  /* ── Mutations ─────────────────────────── */

  const createMutation = useMutation({
    mutationFn: (data: DriverFormData) => {
      const payload: Record<string, unknown> = {
        ...data,
        role: 'DRIVER',
        hoboong: data.hoboong ? Number(data.hoboong) : undefined,
        licenseExpiresAt: data.licenseExpiresAt || undefined,
        qualificationExpiresAt: data.qualificationExpiresAt || undefined,
      };
      if (!payload.password) delete payload.password;
      return usersApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('기사님이 등록되었습니다.');
      closeModal();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DriverFormData> }) => {
      const payload: Record<string, unknown> = {
        ...data,
        hoboong: data.hoboong ? Number(data.hoboong) : undefined,
        licenseExpiresAt: data.licenseExpiresAt || undefined,
        qualificationExpiresAt: data.qualificationExpiresAt || undefined,
      };
      delete payload.password;
      return usersApi.update(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('기사님 정보가 수정되었습니다.');
      closeModal();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      usersApi.update(id, { isActive }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(
        variables.isActive
          ? '기사님이 활성화되었습니다.'
          : '기사님이 비활성화되었습니다.',
      );
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: number) => usersApi.resetPassword(id),
    onSuccess: () =>
      toast.success('비밀번호가 초기화되었습니다. (사원번호로 재설정)'),
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  /* ── Derived data ──────────────────────── */

  // 노선 필터는 클라이언트 사이드 (백엔드 API에 routeFilter 미지원)
  const filtered = useMemo(() => {
    if (routeFilter === 'ALL') return drivers;
    return drivers.filter((d) => {
      const hasRoute = d.routeAssignments?.some(
        (a) => String(a.route.id) === routeFilter,
      );
      return hasRoute;
    });
  }, [drivers, routeFilter]);

  const counts = useMemo(() => {
    const total = pagination?.total ?? drivers.length;
    const main = drivers.filter((d) => d.driverType === 'MAIN' && d.isActive).length;
    const spare = drivers.filter((d) => d.driverType === 'SPARE' && d.isActive).length;
    const inactive = drivers.filter((d) => !d.isActive).length;
    return { total, main, spare, inactive };
  }, [drivers, pagination]);

  /* ── Handlers ──────────────────────────── */

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingDriver(null);
    setForm(DEFAULT_FORM);
  }, []);

  const modalRef = useFocusTrap<HTMLDivElement>(showModal);

  const openCreate = useCallback(() => {
    setEditingDriver(null);
    setForm(DEFAULT_FORM);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((driver: Driver) => {
    setEditingDriver(driver);
    setForm({
      name: driver.name,
      email: driver.email || '',
      phone: driver.phone || '',
      employeeId: driver.employeeId,
      driverType: driver.driverType || 'MAIN',
      shiftGroup: driver.shiftGroup || '',
      assignedBusNumber: driver.assignedBusNumber || '',
      hoboong: driver.hoboong != null ? String(driver.hoboong) : '',
      licenseNumber: driver.licenseNumber || '',
      licenseExpiresAt: driver.licenseExpiresAt
        ? driver.licenseExpiresAt.slice(0, 10)
        : '',
      qualificationExpiresAt: driver.qualificationExpiresAt
        ? driver.qualificationExpiresAt.slice(0, 10)
        : '',
      password: '',
    });
    setShowModal(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingDriver) {
      updateMutation.mutate({ id: editingDriver.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleToggleActive = (driver: Driver) => {
    const action = driver.isActive ? '비활성화' : '활성화';
    if (confirm(`${driver.name} 기사님을 ${action}하시겠습니까?`)) {
      toggleActiveMutation.mutate({
        id: driver.id,
        isActive: !driver.isActive,
      });
    }
  };

  const handleResetPassword = (driver: Driver) => {
    if (
      confirm(
        `${driver.name} 기사님의 비밀번호를 사원번호로 초기화하시겠습니까?`,
      )
    ) {
      resetPasswordMutation.mutate(driver.id);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const updateField = (field: keyof DriverFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  /* ── Render ────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-gray-900 dark:text-gray-100">기사 관리</h1>
          <p className="text-[16px] text-gray-500 dark:text-gray-400 mt-1">
            소속 기사 정보를 관리합니다
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 text-[16px] font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
          style={{ height: 48, minWidth: 48 }}
        >
          <UserPlus size={20} />
          기사 등록
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="전체 기사"
          value={counts.total}
          icon={<Users size={22} className="text-blue-600" />}
          bg="bg-blue-50"
        />
        <SummaryCard
          label="정규 기사"
          value={counts.main}
          icon={<UserCheck size={22} className="text-indigo-600" />}
          bg="bg-indigo-50"
        />
        <SummaryCard
          label="예비 기사"
          value={counts.spare}
          icon={<Shield size={22} className="text-orange-600" />}
          bg="bg-orange-50"
        />
        <SummaryCard
          label="비활성"
          value={counts.inactive}
          icon={<UserX size={22} className="text-gray-500" />}
          bg="bg-gray-100"
        />
      </div>

      {/* Search & Filters */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm space-y-4">
        {/* Search */}
        <div className="relative">
          <Search
            size={20}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 py-3 pl-12 pr-4 text-[16px] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 transition-colors"
            placeholder="이름, 사원번호, 전화번호로 검색..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-[15px] font-medium text-gray-600 dark:text-gray-300">
            <Filter size={16} />
            필터
          </div>

          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value as DriverTypeFilter); setPage(1); }}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-[15px] text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
          >
            <option value="ALL">구분: 전체</option>
            <option value="MAIN">정규 기사</option>
            <option value="SPARE">예비 기사</option>
          </select>

          <select
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-[15px] text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
          >
            <option value="ALL">노선: 전체</option>
            {routes.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.routeNumber} {r.name}
              </option>
            ))}
          </select>

          <select
            value={activeFilter}
            onChange={(e) => { setActiveFilter(e.target.value as ActiveFilter); setPage(1); }}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-[15px] text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
          >
            <option value="ALL">상태: 전체</option>
            <option value="ACTIVE">활성</option>
            <option value="INACTIVE">비활성</option>
          </select>

          {(typeFilter !== 'ALL' ||
            activeFilter !== 'ALL' ||
            routeFilter !== 'ALL' ||
            search) && (
            <button
              onClick={() => {
                setSearch('');
                setTypeFilter('ALL');
                setActiveFilter('ALL');
                setRouteFilter('ALL');
                setPage(1);
              }}
              className="rounded-lg px-3 py-2 text-[14px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              필터 초기화
            </button>
          )}

          <span className="ml-auto text-[14px] text-gray-400">
            {filtered.length}명 표시 중
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Loader2 size={36} className="animate-spin mb-3" />
            <p className="text-[16px]">기사 목록을 불러오는 중...</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-24 text-red-500">
            <AlertTriangle size={36} className="mb-3" />
            <p className="text-[16px] font-medium">
              기사 목록을 불러오지 못했습니다
            </p>
            <p className="text-[14px] text-gray-400 mt-1">
              {extractApiError(error)}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Users size={44} className="mb-3 opacity-30" />
            <p className="text-[16px] font-medium">
              {drivers.length === 0
                ? '등록된 기사님이 없습니다'
                : '검색 결과가 없습니다'}
            </p>
            {drivers.length === 0 && (
              <button
                onClick={openCreate}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                <Plus size={18} />
                첫 기사 등록하기
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    이름
                  </th>
                  <th className="text-left px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    사원번호
                  </th>
                  <th className="text-left px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    전화번호
                  </th>
                  <th className="text-left px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    구분
                  </th>
                  <th className="text-left px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    배정 노선
                  </th>
                  <th className="text-left px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    면허 만료일
                  </th>
                  <th className="text-left px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    상태
                  </th>
                  <th className="text-right px-5 py-3.5 text-[13px] font-semibold text-gray-500 uppercase tracking-wider">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((driver) => (
                  <tr
                    key={driver.id}
                    className={`hover:bg-gray-50 transition-colors ${
                      !driver.isActive ? 'opacity-60' : ''
                    }`}
                  >
                    {/* 이름 */}
                    <td className="px-5 py-4">
                      <span className="text-[16px] font-medium text-gray-900">
                        {driver.name}
                      </span>
                    </td>

                    {/* 사원번호 */}
                    <td className="px-5 py-4">
                      <span className="text-[15px] font-mono text-gray-700">
                        {driver.employeeId}
                      </span>
                    </td>

                    {/* 전화번호 */}
                    <td className="px-5 py-4">
                      <span className="text-[15px] text-gray-600">
                        {driver.phone || '-'}
                      </span>
                    </td>

                    {/* 구분 */}
                    <td className="px-5 py-4">
                      {driver.driverType === 'MAIN' ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-[14px] font-semibold text-blue-700">
                          정규
                        </span>
                      ) : driver.driverType === 'SPARE' ? (
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-[14px] font-semibold text-orange-700">
                          예비
                        </span>
                      ) : (
                        <span className="text-[14px] text-gray-400">-</span>
                      )}
                    </td>

                    {/* 배정 노선 */}
                    <td className="px-5 py-4">
                      <span className="text-[15px] text-gray-600">
                        {driver.routeAssignments &&
                        driver.routeAssignments.length > 0
                          ? driver.routeAssignments
                              .map((a) => a.route.routeNumber)
                              .join(', ')
                          : '-'}
                      </span>
                    </td>

                    {/* 면허 만료일 */}
                    <td className="px-5 py-4">
                      <span
                        className={`text-[15px] ${getExpiryStyle(driver.licenseExpiresAt)}`}
                      >
                        {formatDate(driver.licenseExpiresAt)}
                      </span>
                      {getExpiryBadge(driver.licenseExpiresAt)}
                    </td>

                    {/* 상태 */}
                    <td className="px-5 py-4">
                      {driver.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-[14px] font-semibold text-green-700">
                          활성
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-[14px] font-semibold text-red-700">
                          비활성
                        </span>
                      )}
                    </td>

                    {/* 작업 */}
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(driver)}
                          className="inline-flex items-center justify-center rounded-lg p-2.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          style={{ minWidth: 40, minHeight: 40 }}
                          title="수정"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => handleResetPassword(driver)}
                          className="inline-flex items-center justify-center rounded-lg p-2.5 text-gray-400 hover:bg-yellow-50 hover:text-yellow-600 transition-colors"
                          style={{ minWidth: 40, minHeight: 40 }}
                          title="비밀번호 초기화"
                        >
                          <Key size={18} />
                        </button>
                        <button
                          onClick={() => handleToggleActive(driver)}
                          className={`inline-flex items-center justify-center rounded-lg p-2.5 transition-colors ${
                            driver.isActive
                              ? 'text-gray-400 hover:bg-red-50 hover:text-red-600'
                              : 'text-gray-400 hover:bg-green-50 hover:text-green-600'
                          }`}
                          style={{ minWidth: 40, minHeight: 40 }}
                          title={driver.isActive ? '비활성화' : '활성화'}
                        >
                          {driver.isActive ? (
                            <UserX size={18} />
                          ) : (
                            <UserCheck size={18} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between px-2">
            <p className="text-sm text-gray-500">
              {'\uCD1D'} {pagination.total}{'\uBA85 \uC911'} {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, pagination.total)}{'\uBA85'}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!pagination.hasPrev}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                {'\u2190 \uC774\uC804'}
              </button>
              <span className="text-sm font-medium text-gray-700">
                {page} / {pagination.totalPages}
              </span>
              <button
                className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!pagination.hasNext}
                onClick={() => setPage(p => p + 1)}
              >
                {'\uB2E4\uC74C \u2192'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingDriver ? '\uAE30\uC0AC \uC815\uBCF4 \uC218\uC815' : '\uC2E0\uADDC \uAE30\uC0AC \uB4F1\uB85D'}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div ref={modalRef} className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            {/* Modal header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 rounded-t-2xl">
              <h2 className="text-[20px] font-bold text-gray-900">
                {editingDriver ? '기사 정보 수정' : '신규 기사 등록'}
              </h2>
              <button
                onClick={closeModal}
                className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                style={{ minWidth: 40, minHeight: 40 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* 이름 & 사원번호 */}
              <div className="grid grid-cols-2 gap-4">
                <FormField label="이름" required>
                  <input
                    className="form-input"
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="홍길동"
                    required
                  />
                </FormField>
                <FormField label="사원번호" required>
                  <input
                    className="form-input"
                    value={form.employeeId}
                    onChange={(e) => updateField('employeeId', e.target.value)}
                    placeholder="DRV001"
                    required
                    disabled={!!editingDriver}
                  />
                </FormField>
              </div>

              {/* 이메일 */}
              <FormField label="이메일">
                <input
                  type="email"
                  className="form-input"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="driver@company.com"
                />
              </FormField>

              {/* 전화번호 & 구분 */}
              <div className="grid grid-cols-2 gap-4">
                <FormField label="전화번호" required>
                  <input
                    className="form-input"
                    value={form.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="010-1234-5678"
                    required
                  />
                </FormField>
                <FormField label="구분" required>
                  <select
                    className="form-input"
                    value={form.driverType}
                    onChange={(e) => updateField('driverType', e.target.value)}
                  >
                    <option value="MAIN">정규 기사</option>
                    <option value="SPARE">예비 기사</option>
                  </select>
                </FormField>
              </div>

              {/* 면허번호 */}
              <FormField label="면허번호">
                <input
                  className="form-input"
                  value={form.licenseNumber}
                  onChange={(e) => updateField('licenseNumber', e.target.value)}
                  placeholder="12-34-567890-01"
                />
              </FormField>

              {/* 면허 만료일 & 자격증 만료일 */}
              <div className="grid grid-cols-2 gap-4">
                <FormField label="면허 만료일">
                  <input
                    type="date"
                    className="form-input"
                    value={form.licenseExpiresAt}
                    onChange={(e) =>
                      updateField('licenseExpiresAt', e.target.value)
                    }
                  />
                </FormField>
                <FormField label="자격증 만료일">
                  <input
                    type="date"
                    className="form-input"
                    value={form.qualificationExpiresAt}
                    onChange={(e) =>
                      updateField('qualificationExpiresAt', e.target.value)
                    }
                  />
                </FormField>
              </div>

              {/* 교대조 & 담당 차량 */}
              <div className="grid grid-cols-2 gap-4">
                <FormField label="교대조">
                  <select
                    className="form-input"
                    value={form.shiftGroup}
                    onChange={(e) => updateField('shiftGroup', e.target.value)}
                  >
                    <option value="">미지정</option>
                    <option value="1조">1조 (오전)</option>
                    <option value="2조">2조 (오후)</option>
                  </select>
                </FormField>
                <FormField label="담당 차량번호">
                  <input
                    className="form-input"
                    value={form.assignedBusNumber}
                    onChange={(e) =>
                      updateField('assignedBusNumber', e.target.value)
                    }
                    placeholder="예: 2292"
                  />
                </FormField>
              </div>

              {/* 호봉 */}
              <FormField label="호봉">
                <input
                  type="number"
                  min="1"
                  className="form-input"
                  value={form.hoboong}
                  onChange={(e) => updateField('hoboong', e.target.value)}
                  placeholder="예: 5"
                />
              </FormField>

              {/* 비밀번호 (신규 등록 시만) */}
              {!editingDriver && (
                <FormField label="초기 비밀번호" hint="비워두면 사원번호가 비밀번호로 설정됩니다">
                  <input
                    type="password"
                    className="form-input"
                    value={form.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    placeholder="비밀번호 입력 (선택)"
                  />
                </FormField>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-4 text-[16px] font-semibold text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  style={{ height: 48 }}
                  disabled={isSaving}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-[16px] font-semibold text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  style={{ height: 48 }}
                  disabled={isSaving}
                >
                  {isSaving && <Loader2 size={18} className="animate-spin" />}
                  {isSaving
                    ? '저장 중...'
                    : editingDriver
                      ? '수정 저장'
                      : '등록하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global style for form inputs */}
      <style>{`
        .form-input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid #d1d5db;
          background-color: #f9fafb;
          padding: 0.625rem 0.875rem;
          font-size: 16px;
          color: #111827;
          transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
          outline: none;
          min-height: 44px;
        }
        .form-input:focus {
          border-color: #3b82f6;
          background-color: #fff;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
        .form-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .form-input::placeholder {
          color: #9ca3af;
        }
      `}</style>
    </div>
  );
}

/* ────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  icon,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[14px] font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-[28px] font-bold text-gray-900">{value}</p>
        </div>
        <div
          className={`flex items-center justify-center rounded-xl ${bg}`}
          style={{ width: 48, height: 48 }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[14px] font-semibold text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && (
        <p className="mt-1 text-[13px] text-gray-400">{hint}</p>
      )}
    </div>
  );
}
