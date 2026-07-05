import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Database,
  Users,
  Bus as BusIcon,
  Map,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Search,
  KeyRound,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi, busesApi, routesApi } from '../services/api';
import PageHeader from '../components/PageHeader';
import { basicDataHelp } from '../help/helpContent';
import ExcelUploadModal from '../components/ExcelUploadModal';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

type Tab = 'drivers' | 'buses' | 'routes';

interface Driver {
  id: number;
  name: string;
  phone: string | null;
  employeeId: string;
  driverType: 'MAIN' | 'SPARE' | null;
  assignedBusNumber: string | null;
  isActive: boolean;
  vacationDays: number; // 보유 휴가 (연간)
  vacationUsed?: number; // 올해 사용(비반려 휴무요청 수) — 서버 계산
  licenseExpiresAt?: string | null;
  qualificationExpiresAt?: string | null;
}

interface Bus {
  id: number;
  busNumber: string;
  plateNumber: string;
  model?: string | null;
  year?: number | null;
  routeId: number | null;
  isActive: boolean;
}

interface Route {
  id: number;
  routeNumber: string;
  name: string;
  startPoint?: string | null;
  endPoint?: string | null;
  isActive: boolean;
}

/* ────────────────────────────────────────────
   Page
   ──────────────────────────────────────────── */

export default function BasicDataPage() {
  // 탭을 URL ?tab= 으로 제어 → 회사 정보 등에서 특정 탭으로 바로 진입 가능
  const [searchParams, setSearchParams] = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);
  const tabParam = searchParams.get('tab');
  const tab: Tab = tabParam === 'buses' || tabParam === 'routes' ? tabParam : 'drivers';
  const setTab = (t: Tab) => setSearchParams(t === 'drivers' ? {} : { tab: t }, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader
        help={basicDataHelp}
        icon={Database}
        title="기초 데이터"
        description="기사·버스·노선 등록 및 관리. AI 배차의 입력 데이터입니다."
        actions={
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-2.5 text-[15px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
          >
            <Upload size={17} />
            데이터 업로드
          </button>
        }
      />

      <ExcelUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-white/10">
        <div className="flex gap-1">
          <TabButton active={tab === 'drivers'} icon={<Users size={16} />} label="기사" onClick={() => setTab('drivers')} />
          <TabButton active={tab === 'buses'} icon={<BusIcon size={16} />} label="버스" onClick={() => setTab('buses')} />
          <TabButton active={tab === 'routes'} icon={<Map size={16} />} label="노선" onClick={() => setTab('routes')} />
        </div>
      </div>

      {tab === 'drivers' && <DriversTab />}
      {tab === 'buses' && <BusesTab />}
      {tab === 'routes' && <RoutesTab />}
    </div>
  );
}

/* ────────────────────────────────────────────
   Drivers Tab
   ──────────────────────────────────────────── */

function DriversTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Driver | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: list = [], isLoading } = useQuery<Driver[]>({
    queryKey: ['users', 'DRIVER'],
    // 목록은 페이지당 최대 100건 → 기사가 100명을 넘어도 전부 나오도록 모든 페이지를 받아온다.
    // 삭제(비활성 폴백) 기사는 목록에서 제외 — 관리자 계정 목록과 동일한 정책.
    queryFn: async () => {
      const all: Driver[] = [];
      for (let page = 1; page <= 100; page++) {
        const r = await usersApi.list({ role: 'DRIVER', page: String(page), limit: '100' });
        all.push(...(r.data.data as Driver[]));
        if (!r.data.pagination?.hasNext) break;
      }
      return all.filter((d) => d.isActive);
    },
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((d) =>
      d.name.toLowerCase().includes(t) ||
      d.employeeId.toLowerCase().includes(t) ||
      (d.phone || '').includes(t),
    );
  }, [list, q]);

  const remove = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users', 'DRIVER'] }); toast.success('삭제되었습니다.'); },
    onError: (e) => toast.error(extractError(e)),
  });

  const resetPwd = useMutation({
    mutationFn: (id: number) => usersApi.resetPassword(id),
    onSuccess: (res) => {
      const np = (res.data as { data?: { newPassword?: string }; newPassword?: string })?.data?.newPassword || (res.data as { newPassword?: string })?.newPassword;
      toast.success(np ? `초기화 완료. 새 비밀번호: ${np}` : '비밀번호가 초기화되었습니다.', { duration: 6000 });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <>
      <Toolbar
        searchValue={q}
        onSearch={setQ}
        searchPlaceholder="이름·사번·전화번호 검색"
        onCreate={() => setCreating(true)}
        createLabel="기사 추가"
        count={filtered.length}
      />

      {isLoading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty label="등록된 기사가 없습니다" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
          <table className="w-full text-[15px]">
            <thead className="bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-300">
              <tr>
                <Th>이름</Th>
                <Th>사번</Th>
                <Th>전화번호</Th>
                <Th>구분</Th>
                <Th>담당 버스</Th>
                <Th>남은 휴가</Th>
                <Th align="right">액션</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {filtered.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                  <Td className="font-medium text-gray-900 dark:text-gray-100">{d.name}</Td>
                  <Td className="font-mono text-gray-500">{d.employeeId}</Td>
                  <Td>{d.phone || '-'}</Td>
                  <Td>
                    <Badge color={d.driverType === 'MAIN' ? 'blue' : d.driverType === 'SPARE' ? 'amber' : 'gray'}>
                      {d.driverType === 'MAIN' ? '메인' : d.driverType === 'SPARE' ? '스페어' : '-'}
                    </Badge>
                  </Td>
                  <Td>{d.assignedBusNumber || '-'}</Td>
                  <Td>
                    <span
                      title={`보유 ${d.vacationDays}일 · 올해 사용 ${d.vacationUsed ?? 0}일`}
                      className={`font-semibold ${(d.vacationDays - (d.vacationUsed ?? 0)) <= 0 ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'}`}
                    >
                      {d.vacationDays - (d.vacationUsed ?? 0)}일
                    </span>
                  </Td>
                  <Td align="right">
                    <div className="inline-flex gap-1">
                      <IconBtn title="비밀번호 초기화" onClick={() => { if (confirm(`${d.name} 기사 비밀번호를 초기화하시겠어요?`)) resetPwd.mutate(d.id); }}>
                        <KeyRound size={16} />
                      </IconBtn>
                      <IconBtn title="수정" onClick={() => setEditing(d)}>
                        <Pencil size={16} />
                      </IconBtn>
                      <IconBtn title="삭제" danger onClick={() => { if (confirm(`${d.name} 기사를 삭제하시겠어요?`)) remove.mutate(d.id); }}>
                        <Trash2 size={16} />
                      </IconBtn>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <DriverFormModal
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['users', 'DRIVER'] }); setEditing(null); setCreating(false); }}
        />
      )}
    </>
  );
}

function DriverFormModal({ initial, onClose, onSaved }: { initial: Driver | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const employeeId = initial?.employeeId || ''; // 표시용(수정 시 읽기 전용) — 생성 시 서버가 자동 발급(DRV###)
  const [driverType, setDriverType] = useState<'MAIN' | 'SPARE'>((initial?.driverType as 'MAIN' | 'SPARE') || 'MAIN');
  const [assignedBusNumber, setAssignedBusNumber] = useState(initial?.assignedBusNumber || '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string }>({});
  // 폼은 '잔여 휴가' 기준으로 입력받는다. 저장 시 보유 = 잔여 + 올해 사용분으로 환산
  // → 입력한 숫자가 그대로 목록의 '남은 휴가'로 표시된다.
  const vacationUsed = initial?.vacationUsed ?? 0;
  const [vacationRemaining, setVacationRemaining] = useState(
    String((initial?.vacationDays ?? 15) - vacationUsed),
  );

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim() || null,
        role: 'DRIVER',
        driverType,
        assignedBusNumber: assignedBusNumber.trim() || null,
        isActive,
        vacationDays: Math.max(0, parseInt(vacationRemaining, 10) || 0) + vacationUsed,
      };
      // 사번은 생성 시 서버 자동 발급(DRV###), 수정 시 변경 불가 → payload 에 미포함
      return isEdit ? usersApi.update(initial!.id, payload) : usersApi.create(payload);
    },
    onSuccess: () => { toast.success(isEdit ? '수정 완료' : '등록 완료'); onSaved(); },
    onError: (e) => {
      // 중복 전화번호 등은 입력칸 아래에 인라인으로 표시 (toast 대신)
      const resp = (e as { response?: { data?: { message?: string; errors?: { field: string; message: string }[] } } })?.response?.data;
      const fe: { phone?: string } = {};
      if (Array.isArray(resp?.errors)) {
        for (const it of resp!.errors) if (it.field === 'phone') fe.phone = it.message;
      }
      const msg = resp?.message || '오류가 발생했습니다.';
      if (!fe.phone && msg.includes('전화번호')) fe.phone = msg;
      if (fe.phone) setFieldErrors(fe);
      else toast.error(msg);
    },
  });

  const handleSave = () => {
    setFieldErrors({});
    if (!name.trim()) { toast.error('이름을 입력해주세요.'); return; }
    if (!phone.trim()) { setFieldErrors({ phone: '전화번호를 입력해주세요.' }); return; }
    save.mutate();
  };

  return (
    <FormModal title={isEdit ? '기사 수정' : '기사 추가'} onClose={onClose}>
      <FormField label="이름" required>
        <Input value={name} onChange={setName} placeholder="홍길동" />
      </FormField>
      {isEdit && (
        <FormField label="사번">
          <Input value={employeeId} onChange={() => {}} disabled />
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="전화번호" required error={fieldErrors.phone}>
          <Input value={phone} onChange={(v) => { setPhone(v); setFieldErrors((p) => ({ ...p, phone: undefined })); }} placeholder="010-1234-5678" />
        </FormField>
        <FormField label="구분">
          <select className={inputCls} value={driverType} onChange={(e) => setDriverType(e.target.value as 'MAIN' | 'SPARE')}>
            <option value="MAIN">메인 (정·부 페어 소속)</option>
            <option value="SPARE">스페어 (예비)</option>
          </select>
        </FormField>
      </div>
      <FormField label="담당 버스 번호" hint="메인 기사만. 같은 버스에 정·부 2명을 같은 번호로 연결.">
        <Input value={assignedBusNumber} onChange={setAssignedBusNumber} placeholder="2292" />
      </FormField>
      <FormField label="잔여 휴가 일수" hint="휴무 신청 시 자동으로 차감됩니다.">
        <input
          type="number"
          min={0}
          max={366}
          className={inputCls}
          value={vacationRemaining}
          onChange={(e) => setVacationRemaining(e.target.value)}
        />
      </FormField>
      <label className="flex items-center gap-2 text-[15px] text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        활성 (배차 대상)
      </label>
      {!isEdit && (
        <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">
          로그인 시 초기 비밀번호는 <b className="text-gray-700 dark:text-gray-200">이름(영문 자판) + 전화번호 뒤 4자리</b>입니다.
          <br />기사님은 앱 첫 로그인 시 비밀번호를 반드시 변경해야 합니다.
        </p>
      )}

      <ModalFooter onCancel={onClose} onSave={handleSave} saving={save.isPending} />
    </FormModal>
  );
}

/* ────────────────────────────────────────────
   Buses Tab
   ──────────────────────────────────────────── */

function BusesTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Bus | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: list = [], isLoading } = useQuery<Bus[]>({
    queryKey: ['buses'],
    // 페이지당 최대 100건 → 버스가 100대를 넘어도 전부 나오도록 모든 페이지를 받아온다.
    queryFn: async () => {
      const all: Bus[] = [];
      for (let page = 1; page <= 100; page++) {
        const r = await busesApi.list({ page: String(page), limit: '100' });
        all.push(...(r.data.data as Bus[]));
        if (!r.data.pagination?.hasNext) break;
      }
      return all;
    },
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((b) =>
      b.busNumber.toLowerCase().includes(t) ||
      b.plateNumber.toLowerCase().includes(t) ||
      (b.model || '').toLowerCase().includes(t),
    );
  }, [list, q]);

  const remove = useMutation({
    mutationFn: (id: number) => busesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['buses'] }); toast.success('삭제되었습니다.'); },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <>
      <Toolbar searchValue={q} onSearch={setQ} searchPlaceholder="차번·차종 검색" onCreate={() => setCreating(true)} createLabel="버스 추가" count={filtered.length} />
      {isLoading ? <Loading /> : filtered.length === 0 ? <Empty label="등록된 버스가 없습니다" /> : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
          <table className="w-full text-[15px]">
            <thead className="bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-300">
              <tr>
                <Th>차번</Th>
                <Th>번호판</Th>
                <Th>차종</Th>
                <Th>연식</Th>
                <Th>상태</Th>
                <Th align="right">액션</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                  <Td className="font-mono font-medium">{b.busNumber}</Td>
                  <Td className="font-mono text-gray-500">{b.plateNumber}</Td>
                  <Td>{b.model || '-'}</Td>
                  <Td>{b.year || '-'}</Td>
                  <Td><Badge color={b.isActive ? 'green' : 'gray'}>{b.isActive ? '운행' : '운휴'}</Badge></Td>
                  <Td align="right">
                    <div className="inline-flex gap-1">
                      <IconBtn title="수정" onClick={() => setEditing(b)}><Pencil size={16} /></IconBtn>
                      <IconBtn title="삭제" danger onClick={() => { if (confirm(`${b.busNumber}호를 삭제하시겠어요?`)) remove.mutate(b.id); }}>
                        <Trash2 size={16} />
                      </IconBtn>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <BusFormModal
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['buses'] }); setEditing(null); setCreating(false); }}
        />
      )}
    </>
  );
}

function BusFormModal({ initial, onClose, onSaved }: { initial: Bus | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial;
  const [busNumber, setBusNumber] = useState(initial?.busNumber || '');
  const [plateNumber, setPlateNumber] = useState(initial?.plateNumber || '');
  const [model, setModel] = useState(initial?.model || '');
  const [year, setYear] = useState<string>(initial?.year ? String(initial.year) : '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      // 배정 노선(routeId)은 UI에서 제거됨 — payload 에 포함하지 않아 기존 DB 값/솔버 로직을 보존한다.
      const payload: Record<string, unknown> = {
        busNumber: busNumber.trim(),
        plateNumber: plateNumber.trim(),
        model: model.trim() || null,
        year: year ? parseInt(year, 10) : null,
        isActive,
      };
      return isEdit ? busesApi.update(initial!.id, payload) : busesApi.create(payload);
    },
    onSuccess: () => { toast.success(isEdit ? '수정 완료' : '등록 완료'); onSaved(); },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <FormModal title={isEdit ? '버스 수정' : '버스 추가'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="차번" required><Input value={busNumber} onChange={setBusNumber} placeholder="2292" /></FormField>
        <FormField label="번호판" required><Input value={plateNumber} onChange={setPlateNumber} placeholder="인천70바2292" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="차종"><Input value={model} onChange={setModel} placeholder="현대 슈퍼에어로시티" /></FormField>
        <FormField label="연식"><Input value={year} onChange={setYear} placeholder="2024" /></FormField>
      </div>
      <label className="flex items-center gap-2 text-[15px] text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        운행 중
      </label>

      <ModalFooter onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} />
    </FormModal>
  );
}

/* ────────────────────────────────────────────
   Routes Tab
   ──────────────────────────────────────────── */

function RoutesTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Route | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: list = [], isLoading } = useQuery<Route[]>({
    queryKey: ['routes'],
    // 페이지당 최대 100건 → 노선이 100개를 넘어도 전부 나오도록 모든 페이지를 받아온다.
    queryFn: async () => {
      const all: Route[] = [];
      for (let page = 1; page <= 100; page++) {
        const r = await routesApi.list({ page: String(page), limit: '100' });
        all.push(...(r.data.data as Route[]));
        if (!r.data.pagination?.hasNext) break;
      }
      return all;
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => routesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['routes'] }); toast.success('삭제되었습니다.'); },
    onError: (e) => toast.error(extractError(e)),
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((r) =>
      r.routeNumber.toLowerCase().includes(t) ||
      r.name.toLowerCase().includes(t),
    );
  }, [list, q]);

  return (
    <>
      <Toolbar searchValue={q} onSearch={setQ} searchPlaceholder="노선번호·이름 검색" onCreate={() => setCreating(true)} createLabel="노선 추가" count={filtered.length} />
      {isLoading ? <Loading /> : filtered.length === 0 ? <Empty label="등록된 노선이 없습니다" /> : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
          <table className="w-full text-[15px]">
            <thead className="bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-300">
              <tr>
                <Th>번호</Th>
                <Th>이름</Th>
                <Th>기점</Th>
                <Th>종점</Th>
                <Th>상태</Th>
                <Th align="right">액션</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                  <Td className="font-mono font-medium">{r.routeNumber}번</Td>
                  <Td>{r.name}</Td>
                  <Td>{r.startPoint || '-'}</Td>
                  <Td>{r.endPoint || '-'}</Td>
                  <Td><Badge color={r.isActive ? 'green' : 'gray'}>{r.isActive ? '운행' : '운휴'}</Badge></Td>
                  <Td align="right">
                    <div className="inline-flex gap-1">
                      <IconBtn title="수정" onClick={() => setEditing(r)}><Pencil size={16} /></IconBtn>
                      <IconBtn title="삭제" danger onClick={() => { if (confirm(`${r.routeNumber}번 노선을 삭제하시겠어요?`)) remove.mutate(r.id); }}>
                        <Trash2 size={16} />
                      </IconBtn>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <RouteFormModal
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['routes'] }); setEditing(null); setCreating(false); }}
        />
      )}
    </>
  );
}

function RouteFormModal({ initial, onClose, onSaved }: { initial: Route | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial;
  const [routeNumber, setRouteNumber] = useState(initial?.routeNumber || '');
  const [name, setName] = useState(initial?.name || '');
  const [startPoint, setStartPoint] = useState(initial?.startPoint || '');
  const [endPoint, setEndPoint] = useState(initial?.endPoint || '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        routeNumber: routeNumber.trim(),
        name: name.trim(),
        startPoint: startPoint.trim() || null,
        endPoint: endPoint.trim() || null,
        isActive,
      };
      return isEdit ? routesApi.update(initial!.id, payload) : routesApi.create(payload);
    },
    onSuccess: () => { toast.success(isEdit ? '수정 완료' : '등록 완료'); onSaved(); },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <FormModal title={isEdit ? '노선 수정' : '노선 추가'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="노선 번호" required><Input value={routeNumber} onChange={setRouteNumber} placeholder="16" /></FormField>
        <FormField label="이름" required><Input value={name} onChange={setName} placeholder="16번" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="기점"><Input value={startPoint} onChange={setStartPoint} placeholder="가좌동" /></FormField>
        <FormField label="종점"><Input value={endPoint} onChange={setEndPoint} placeholder="동춘동" /></FormField>
      </div>
      <label className="flex items-center gap-2 text-[15px] text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        운행 중
      </label>

      <ModalFooter onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} />
    </FormModal>
  );
}

/* ────────────────────────────────────────────
   Shared atoms
   ──────────────────────────────────────────── */

const inputCls = 'w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60';

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 inline-flex items-center gap-2 border-b-2 text-[15px] font-medium transition ${
        active
          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      {icon}{label}
    </button>
  );
}

function Toolbar({ searchValue, onSearch, searchPlaceholder, onCreate, createLabel, count }: { searchValue: string; onSearch: (v: string) => void; searchPlaceholder: string; onCreate: () => void; createLabel: string; count: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={searchValue}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>
      <span className="text-[14px] text-gray-500 dark:text-gray-400">{count}건</span>
      <div className="ml-auto">
        <button onClick={onCreate} className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-2 text-[15px] font-medium">
          <Plus size={16} />{createLabel}
        </button>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-3 text-${align || 'left'} text-[13px] font-semibold uppercase tracking-wide`}>{children}</th>;
}
function Td({ children, className, align }: { children: React.ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <td className={`px-4 py-3 text-${align || 'left'} ${className || ''}`}>{children}</td>;
}

function Badge({ color, children }: { color: 'green' | 'blue' | 'amber' | 'red' | 'gray'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  }[color];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${cls}`}>{children}</span>;
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-2 rounded-lg transition ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-[15px]">{label}</div>;
}
function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
    </div>
  );
}

function FormModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  // document.body 로 포탈 — <main> 의 overflow/backdrop-blur/sticky 영향을 받지 않고
  // 오버레이가 뷰포트 최상단까지 완전히 덮이도록 한다.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto admin-scope" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h3 className="text-[19px] font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function FormField({ label, hint, required, error, children }: { label: string; hint?: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-200 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error
        ? <p className="text-red-500 text-[13px] mt-1">{error}</p>
        : hint && <p className="text-[13px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className={inputCls} />;
}

function ModalFooter({ onCancel, onSave, saving }: { onCancel: () => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-[15px]">취소</button>
      <button onClick={onSave} disabled={saving} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-2 text-[15px] font-medium">
        {saving && <Loader2 size={16} className="animate-spin" />}
        저장
      </button>
    </div>
  );
}

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string; error?: { message?: string } } } })?.response?.data?.error?.message
    || (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    || '오류가 발생했습니다.';
}
