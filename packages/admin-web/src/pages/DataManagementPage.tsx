import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Bus,
  MapPin,
  Plus,
  Search,
  Edit,
  X,
  Loader2,
  Star,
  AlertTriangle,
} from 'lucide-react';
import { usersApi, busesApi, routesApi } from '../services/api';
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
  isActive: boolean;
  routeAssignments?: Array<{
    route: { id: number; routeNumber: string; name: string };
  }>;
}

interface BusItem {
  id: number;
  busNumber: string;
  plateNumber: string;
  model: string | null;
  isActive: boolean;
  routeId: number | null;
  route?: { id: number; routeNumber: string; name: string } | null;
}

interface RouteItem {
  id: number;
  routeNumber: string;
  name: string;
  fatigueScore: number | null;
  fatigueReason: string | null;
  isActive: boolean;
  _count?: { buses?: number };
  buses?: unknown[];
}

type TabKey = 'drivers' | 'buses' | 'routes';

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */

function extractApiError(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e?.response?.data?.message || '오류가 발생했습니다.';
}

/* ────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */

export default function DataManagementPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('drivers');

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'drivers', label: '기사 관리', icon: <Users size={20} /> },
    { key: 'buses', label: '버스 관리', icon: <Bus size={20} /> },
    { key: 'routes', label: '노선 관리', icon: <MapPin size={20} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-bold text-gray-900 dark:text-gray-100">
          기초 데이터 관리
        </h1>
        <p className="text-[16px] text-gray-500 dark:text-gray-400 mt-1">
          기사, 버스, 노선 정보를 한곳에서 관리합니다
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-2 px-6 pb-3 pt-2 text-[16px] font-semibold border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
            }`}
            style={{ minHeight: 48 }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'drivers' && <DriversTab />}
      {activeTab === 'buses' && <BusesTab />}
      {activeTab === 'routes' && <RoutesTab />}
    </div>
  );
}

/* ════════════════════════════════════════════
   Tab 1: 기사 관리
   ════════════════════════════════════════════ */

function DriversTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    employeeId: '',
    driverType: 'MAIN',
    password: '',
  });

  const { data: drivers = [], isLoading } = useQuery<Driver[]>({
    queryKey: ['users', 'drivers'],
    queryFn: () =>
      usersApi.list({ role: 'DRIVER', limit: '500' }).then((r) => r.data.data),
  });

  const { data: routesList = [] } = useQuery<RouteItem[]>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data ?? r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const payload: Record<string, unknown> = { ...data, role: 'DRIVER' };
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
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('기사님 정보가 수정되었습니다.');
      closeModal();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const filtered = useMemo(() => {
    if (!search) return drivers;
    const q = search.toLowerCase();
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.employeeId.toLowerCase().includes(q)
    );
  }, [drivers, search]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingDriver(null);
    setForm({ name: '', email: '', phone: '', employeeId: '', driverType: 'MAIN', password: '' });
  }, []);

  const openCreate = useCallback(() => {
    setEditingDriver(null);
    setForm({ name: '', email: '', phone: '', employeeId: '', driverType: 'MAIN', password: '' });
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
      password: '',
    });
    setShowModal(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingDriver) {
      const { password, ...rest } = form;
      void password;
      updateMutation.mutate({ id: editingDriver.id, data: rest });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      {/* Search + Add */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 py-3 pl-12 pr-4 text-[16px] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 transition-colors"
            placeholder="이름 또는 사원번호로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 text-[16px] font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors whitespace-nowrap"
          style={{ height: 48 }}
        >
          <Plus size={20} />
          기사 추가
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Loader2 size={36} className="animate-spin mb-3" />
            <p className="text-[16px]">불러오는 중...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Users size={44} className="mb-3 opacity-30" />
            <p className="text-[16px] font-medium">
              {drivers.length === 0 ? '등록된 기사님이 없습니다' : '검색 결과가 없습니다'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">이름</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">사원번호</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">구분</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">배정노선</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">상태</th>
                  <th className="text-right px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((driver) => (
                  <tr key={driver.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${!driver.isActive ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-4 text-[16px] font-medium text-gray-900 dark:text-gray-100">{driver.name}</td>
                    <td className="px-5 py-4 text-[16px] font-mono text-gray-700 dark:text-gray-300">{driver.employeeId}</td>
                    <td className="px-5 py-4">
                      {driver.driverType === 'MAIN' ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/50 px-3 py-1 text-[14px] font-semibold text-blue-700 dark:text-blue-300">정규</span>
                      ) : driver.driverType === 'SPARE' ? (
                        <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/50 px-3 py-1 text-[14px] font-semibold text-orange-700 dark:text-orange-300">예비</span>
                      ) : (
                        <span className="text-[14px] text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[16px] text-gray-600 dark:text-gray-400">
                      {driver.routeAssignments && driver.routeAssignments.length > 0
                        ? driver.routeAssignments.map((a) => a.route.routeNumber).join(', ')
                        : '-'}
                    </td>
                    <td className="px-5 py-4">
                      {driver.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/50 px-3 py-1 text-[14px] font-semibold text-green-700 dark:text-green-300">활성</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/50 px-3 py-1 text-[14px] font-semibold text-red-700 dark:text-red-300">비활성</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => openEdit(driver)}
                        className="inline-flex items-center justify-center rounded-lg p-2.5 text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 transition-colors"
                        style={{ minWidth: 48, minHeight: 48 }}
                        title="수정"
                      >
                        <Edit size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ModalWrapper onClose={closeModal}>
          <h2 className="text-[20px] font-bold text-gray-900 dark:text-gray-100 mb-6">
            {editingDriver ? '기사 정보 수정' : '신규 기사 등록'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <FieldWrapper label="이름" required>
                <input className="form-input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </FieldWrapper>
              <FieldWrapper label="사원번호" required>
                <input className="form-input-field" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required disabled={!!editingDriver} />
              </FieldWrapper>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FieldWrapper label="이메일">
                <input type="email" className="form-input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </FieldWrapper>
              <FieldWrapper label="전화번호">
                <input className="form-input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="010-1234-5678" />
              </FieldWrapper>
            </div>
            <FieldWrapper label="구분" required>
              <select className="form-input-field" value={form.driverType} onChange={(e) => setForm({ ...form, driverType: e.target.value })}>
                <option value="MAIN">정규 기사</option>
                <option value="SPARE">예비 기사</option>
              </select>
            </FieldWrapper>
            {!editingDriver && (
              <FieldWrapper label="초기 비밀번호" hint="비워두면 사원번호가 비밀번호가 됩니다">
                <input type="password" className="form-input-field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </FieldWrapper>
            )}
            <ModalActions onCancel={closeModal} isSaving={isSaving} isEditing={!!editingDriver} />
          </form>
        </ModalWrapper>
      )}

      {/* Keep routesList reference to avoid unused warning */}
      <span className="hidden">{routesList.length}</span>
    </>
  );
}

/* ════════════════════════════════════════════
   Tab 2: 버스 관리
   ════════════════════════════════════════════ */

function BusesTab() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingBus, setEditingBus] = useState<BusItem | null>(null);
  const [form, setForm] = useState({ busNumber: '', plateNumber: '', model: '', routeId: '' });

  const { data: buses = [], isLoading } = useQuery<BusItem[]>({
    queryKey: ['buses'],
    queryFn: () => busesApi.list().then((r) => r.data.data ?? r.data),
  });

  const { data: routesList = [] } = useQuery<RouteItem[]>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data ?? r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const payload: Record<string, unknown> = {
        busNumber: data.busNumber,
        plateNumber: data.plateNumber,
        model: data.model || undefined,
        routeId: data.routeId ? Number(data.routeId) : undefined,
      };
      return busesApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buses'] });
      toast.success('버스가 등록되었습니다.');
      closeModal();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof form }) => {
      const payload: Record<string, unknown> = {
        busNumber: data.busNumber,
        plateNumber: data.plateNumber,
        model: data.model || undefined,
        routeId: data.routeId ? Number(data.routeId) : null,
      };
      return busesApi.update(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buses'] });
      toast.success('버스 정보가 수정되었습니다.');
      closeModal();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingBus(null);
    setForm({ busNumber: '', plateNumber: '', model: '', routeId: '' });
  }, []);

  const openCreate = useCallback(() => {
    setEditingBus(null);
    setForm({ busNumber: '', plateNumber: '', model: '', routeId: '' });
    setShowModal(true);
  }, []);

  const openEdit = useCallback((bus: BusItem) => {
    setEditingBus(bus);
    setForm({
      busNumber: bus.busNumber,
      plateNumber: bus.plateNumber,
      model: bus.model || '',
      routeId: bus.routeId ? String(bus.routeId) : '',
    });
    setShowModal(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBus) {
      updateMutation.mutate({ id: editingBus.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      {/* Add button */}
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 text-[16px] font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
          style={{ height: 48 }}
        >
          <Plus size={20} />
          버스 추가
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Loader2 size={36} className="animate-spin mb-3" />
            <p className="text-[16px]">불러오는 중...</p>
          </div>
        ) : buses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Bus size={44} className="mb-3 opacity-30" />
            <p className="text-[16px] font-medium">등록된 버스가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">차량번호</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">번호판</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">모델</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">배정노선</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">상태</th>
                  <th className="text-right px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {buses.map((bus) => (
                  <tr key={bus.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${!bus.isActive ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-4 text-[16px] font-medium text-gray-900 dark:text-gray-100">{bus.busNumber}</td>
                    <td className="px-5 py-4 text-[16px] text-gray-700 dark:text-gray-300">{bus.plateNumber}</td>
                    <td className="px-5 py-4 text-[16px] text-gray-600 dark:text-gray-400">{bus.model || '-'}</td>
                    <td className="px-5 py-4 text-[16px] text-gray-600 dark:text-gray-400">
                      {bus.route ? `${bus.route.routeNumber} ${bus.route.name}` : '-'}
                    </td>
                    <td className="px-5 py-4">
                      {bus.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/50 px-3 py-1 text-[14px] font-semibold text-green-700 dark:text-green-300">운행중</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/50 px-3 py-1 text-[14px] font-semibold text-red-700 dark:text-red-300">미운행</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => openEdit(bus)}
                        className="inline-flex items-center justify-center rounded-lg p-2.5 text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 transition-colors"
                        style={{ minWidth: 48, minHeight: 48 }}
                        title="수정"
                      >
                        <Edit size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ModalWrapper onClose={closeModal}>
          <h2 className="text-[20px] font-bold text-gray-900 dark:text-gray-100 mb-6">
            {editingBus ? '버스 정보 수정' : '신규 버스 등록'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <FieldWrapper label="차량번호" required>
                <input className="form-input-field" value={form.busNumber} onChange={(e) => setForm({ ...form, busNumber: e.target.value })} placeholder="예: 2292" required />
              </FieldWrapper>
              <FieldWrapper label="번호판" required>
                <input className="form-input-field" value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} placeholder="예: 인천70바1234" required />
              </FieldWrapper>
            </div>
            <FieldWrapper label="모델">
              <input className="form-input-field" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="예: 현대 뉴슈퍼" />
            </FieldWrapper>
            <FieldWrapper label="배정 노선">
              <select className="form-input-field" value={form.routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value })}>
                <option value="">미배정</option>
                {routesList.map((r) => (
                  <option key={r.id} value={String(r.id)}>{r.routeNumber} {r.name}</option>
                ))}
              </select>
            </FieldWrapper>
            <ModalActions onCancel={closeModal} isSaving={isSaving} isEditing={!!editingBus} />
          </form>
        </ModalWrapper>
      )}
    </>
  );
}

/* ════════════════════════════════════════════
   Tab 3: 노선 관리
   ════════════════════════════════════════════ */

function RoutesTab() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState<RouteItem | null>(null);
  const [form, setForm] = useState({ routeNumber: '', name: '' });
  const [fatigueEditId, setFatigueEditId] = useState<number | null>(null);
  const [fatigueScore, setFatigueScore] = useState(3);
  const [fatigueReason, setFatigueReason] = useState('');

  const { data: routes = [], isLoading } = useQuery<RouteItem[]>({
    queryKey: ['routes'],
    queryFn: () => routesApi.list().then((r) => r.data.data ?? r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => routesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('노선이 등록되었습니다.');
      closeModal();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => routesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('노선 정보가 수정되었습니다.');
      closeModal();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const fatigueMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { fatigueScore: number; fatigueReason?: string } }) =>
      routesApi.updateFatigue(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success('피로도가 저장되었습니다.');
      setFatigueEditId(null);
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingRoute(null);
    setForm({ routeNumber: '', name: '' });
  }, []);

  const openCreate = useCallback(() => {
    setEditingRoute(null);
    setForm({ routeNumber: '', name: '' });
    setShowModal(true);
  }, []);

  const openEdit = useCallback((route: RouteItem) => {
    setEditingRoute(route);
    setForm({ routeNumber: route.routeNumber, name: route.name });
    setShowModal(true);
  }, []);

  const openFatigueEdit = useCallback((route: RouteItem) => {
    setFatigueEditId(route.id);
    setFatigueScore(route.fatigueScore ?? 3);
    setFatigueReason(route.fatigueReason ?? '');
  }, []);

  const saveFatigue = useCallback(() => {
    if (fatigueEditId === null) return;
    fatigueMutation.mutate({
      id: fatigueEditId,
      data: { fatigueScore, fatigueReason: fatigueReason || undefined },
    });
  }, [fatigueEditId, fatigueScore, fatigueReason, fatigueMutation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRoute) {
      updateMutation.mutate({ id: editingRoute.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const fatigueLabels: Record<number, string> = {
    1: '꿀노선',
    2: '쉬움',
    3: '보통',
    4: '힘듦',
    5: '기피노선',
  };

  return (
    <>
      {/* Add button */}
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 text-[16px] font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
          style={{ height: 48 }}
        >
          <Plus size={20} />
          노선 추가
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Loader2 size={36} className="animate-spin mb-3" />
            <p className="text-[16px]">불러오는 중...</p>
          </div>
        ) : routes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <MapPin size={44} className="mb-3 opacity-30" />
            <p className="text-[16px] font-medium">등록된 노선이 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">노선번호</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">이름</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">피로도</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">배정 버스 수</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">상태</th>
                  <th className="text-right px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {routes.map((route) => (
                  <tr key={route.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-5 py-4 text-[16px] font-medium text-gray-900 dark:text-gray-100">{route.routeNumber}</td>
                    <td className="px-5 py-4 text-[16px] text-gray-700 dark:text-gray-300">{route.name}</td>
                    <td className="px-5 py-4">
                      {fatigueEditId === route.id ? (
                        <div className="space-y-3">
                          {/* Star rating */}
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setFatigueScore(n)}
                                className="p-0.5 transition-colors"
                                title={fatigueLabels[n]}
                              >
                                <Star
                                  size={24}
                                  className={n <= fatigueScore ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-gray-500'}
                                />
                              </button>
                            ))}
                            <span className="ml-2 text-[14px] font-medium text-gray-600 dark:text-gray-400">
                              {fatigueLabels[fatigueScore]}
                            </span>
                          </div>
                          {/* Reason */}
                          <input
                            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-[16px] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                            placeholder="사유 입력 (선택)"
                            value={fatigueReason}
                            onChange={(e) => setFatigueReason(e.target.value)}
                          />
                          {/* Actions */}
                          <div className="flex gap-2">
                            <button
                              onClick={saveFatigue}
                              disabled={fatigueMutation.isPending}
                              className="rounded-lg bg-blue-600 px-4 py-2 text-[14px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                              style={{ minHeight: 40 }}
                            >
                              {fatigueMutation.isPending ? '저장 중...' : '저장'}
                            </button>
                            <button
                              onClick={() => setFatigueEditId(null)}
                              className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-[14px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              style={{ minHeight: 40 }}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              size={18}
                              className={n <= (route.fatigueScore ?? 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-gray-500'}
                            />
                          ))}
                          {route.fatigueScore ? (
                            <span className="ml-1 text-[14px] text-gray-500 dark:text-gray-400">
                              ({fatigueLabels[route.fatigueScore] || route.fatigueScore})
                            </span>
                          ) : (
                            <span className="ml-1 text-[14px] text-gray-400">미설정</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[16px] text-gray-600 dark:text-gray-400">
                      {route._count?.buses ?? route.buses?.length ?? 0}대
                    </td>
                    <td className="px-5 py-4">
                      {route.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/50 px-3 py-1 text-[14px] font-semibold text-green-700 dark:text-green-300">운행중</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/50 px-3 py-1 text-[14px] font-semibold text-red-700 dark:text-red-300">미운행</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openFatigueEdit(route)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-medium text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors"
                          style={{ minHeight: 48 }}
                          title="피로도 설정"
                        >
                          <Star size={16} />
                          피로도
                        </button>
                        <button
                          onClick={() => openEdit(route)}
                          className="inline-flex items-center justify-center rounded-lg p-2.5 text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 transition-colors"
                          style={{ minWidth: 48, minHeight: 48 }}
                          title="수정"
                        >
                          <Edit size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ModalWrapper onClose={closeModal}>
          <h2 className="text-[20px] font-bold text-gray-900 dark:text-gray-100 mb-6">
            {editingRoute ? '노선 정보 수정' : '신규 노선 등록'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <FieldWrapper label="노선번호" required>
              <input className="form-input-field" value={form.routeNumber} onChange={(e) => setForm({ ...form, routeNumber: e.target.value })} placeholder="예: 520" required />
            </FieldWrapper>
            <FieldWrapper label="노선 이름" required>
              <input className="form-input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 인천역 - 송도" required />
            </FieldWrapper>
            <ModalActions onCancel={closeModal} isSaving={isSaving} isEditing={!!editingRoute} />
          </form>
        </ModalWrapper>
      )}
    </>
  );
}

/* ════════════════════════════════════════════
   Shared Sub-components
   ════════════════════════════════════════════ */

function ModalWrapper({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-800 shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          style={{ minWidth: 40, minHeight: 40 }}
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}

function FieldWrapper({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[14px] font-semibold text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[13px] text-gray-400">{hint}</p>}

      <style>{`
        .form-input-field {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid #d1d5db;
          background-color: #f9fafb;
          padding: 0.625rem 0.875rem;
          font-size: 16px;
          color: #111827;
          transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
          outline: none;
          min-height: 48px;
        }
        .form-input-field:focus {
          border-color: #3b82f6;
          background-color: #fff;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
        .form-input-field:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .form-input-field::placeholder {
          color: #9ca3af;
        }
        @media (prefers-color-scheme: dark) {
          .form-input-field {
            border-color: #4b5563;
            background-color: #111827;
            color: #f3f4f6;
          }
          .form-input-field:focus {
            border-color: #3b82f6;
            background-color: #1f2937;
          }
        }
      `}</style>
    </div>
  );
}

function ModalActions({ onCancel, isSaving, isEditing }: { onCancel: () => void; isSaving: boolean; isEditing: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 text-[16px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 active:bg-gray-100 transition-colors"
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
        {isSaving ? '저장 중...' : isEditing ? '수정 저장' : '등록하기'}
      </button>
    </div>
  );
}
