import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserCog,
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Search,
  X,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import PageHeader from '../components/PageHeader';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

type Role = 'OWNER' | 'DIRECTOR' | 'ADMIN' | 'DISPATCH' | 'HR' | 'DRIVER';

interface Account {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  employeeId: string;
  role: Role;
  isActive: boolean;
  createdAt?: string;
}

const STAFF_ROLES: Role[] = ['OWNER', 'DIRECTOR', 'ADMIN', 'DISPATCH', 'HR'];

const ROLE_LABELS: Record<Role, string> = {
  OWNER: '대표',
  DIRECTOR: '임원',
  ADMIN: '관리자',
  DISPATCH: '배차담당',
  HR: '인사',
  DRIVER: '기사',
};

const ROLE_COLORS: Record<Role, 'red' | 'purple' | 'blue' | 'emerald' | 'amber' | 'gray'> = {
  OWNER: 'red',
  DIRECTOR: 'purple',
  ADMIN: 'blue',
  DISPATCH: 'emerald',
  HR: 'amber',
  DRIVER: 'gray',
};

/* ────────────────────────────────────────────
   Page
   ──────────────────────────────────────────── */

export default function AccountsPage() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);

  // 직원만 — 기사는 기초 데이터에서 관리
  const { data: list = [], isLoading } = useQuery<Account[]>({
    queryKey: ['users', 'staff'],
    queryFn: () =>
      // staff=1: 서버에서 기사(DRIVER) 제외하고 직원(관리자) 계정만 조회.
      // (역할 필터 없이 받으면 기사 다수에 페이지네이션이 걸려 직원이 누락됨)
      usersApi.list({ staff: '1', limit: '100' }).then((r) => {
        const all = r.data.data as Account[];
        // 삭제(soft-delete=비활성) 계정은 목록에서 완전히 제외 — 노선처럼 "아예 사라지게"
        return all.filter((u) => STAFF_ROLES.includes(u.role) && u.isActive);
      }),
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(
      (u) =>
        u.name.toLowerCase().includes(t) ||
        (u.email || '').toLowerCase().includes(t) ||
        u.employeeId.toLowerCase().includes(t),
    );
  }, [list, q]);

  const remove = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users', 'staff'] }); toast.success('삭제되었습니다.'); },
    onError: (e) => toast.error(extractError(e)),
  });

  const resetPwd = useMutation({
    mutationFn: (id: number) => usersApi.resetPassword(id),
    onSuccess: (res) => {
      const np = (res.data as { data?: { newPassword?: string }; newPassword?: string })?.data?.newPassword
        || (res.data as { newPassword?: string })?.newPassword;
      toast.success(np ? `초기화 완료. 새 비밀번호: ${np}` : '비밀번호가 초기화되었습니다.', { duration: 6000 });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCog}
        title="계정 관리"
        description={<>관리자 직원 계정을 관리합니다. 기사 계정은 <a href="/dashboard/data" className="text-blue-600 dark:text-blue-400 hover:underline">기초 데이터</a>에서 관리하세요.</>}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·이메일·사번 검색"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <span className="text-[14px] text-gray-500 dark:text-gray-400">{filtered.length}명</span>
        <button
          onClick={() => setCreating(true)}
          className="ml-auto px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-2 text-[15px] font-medium"
        >
          <Plus size={16} />계정 추가
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-12 text-center">
          <UserCog className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100">등록된 직원 계정이 없습니다</h3>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
          <table className="w-full text-[15px]">
            <thead className="bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-300">
              <tr>
                <Th>이름</Th>
                <Th>역할</Th>
                <Th>사번</Th>
                <Th>이메일</Th>
                <Th>전화번호</Th>
                <Th>상태</Th>
                <Th align="right">액션</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {filtered.map((u) => {
                const isMe = me?.id === u.id;
                return (
                  <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                    <Td className="font-medium text-gray-900 dark:text-gray-100">
                      {u.name}{isMe && <span className="ml-2 text-[12px] text-blue-600 dark:text-blue-400">(나)</span>}
                    </Td>
                    <Td><Badge color={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge></Td>
                    <Td className="font-mono text-gray-500">{u.employeeId}</Td>
                    <Td>{u.email || '-'}</Td>
                    <Td>{u.phone || '-'}</Td>
                    <Td><Badge color={u.isActive ? 'green' : 'gray'}>{u.isActive ? '활성' : '비활성'}</Badge></Td>
                    <Td align="right">
                      <div className="inline-flex gap-1">
                        <IconBtn title="비밀번호 초기화" onClick={() => { if (confirm(`${u.name} 계정 비밀번호를 초기화하시겠어요?`)) resetPwd.mutate(u.id); }}>
                          <KeyRound size={16} />
                        </IconBtn>
                        <IconBtn title="수정" onClick={() => setEditing(u)}>
                          <Pencil size={16} />
                        </IconBtn>
                        {!isMe && (
                          <IconBtn title="삭제" danger onClick={() => { if (confirm(`${u.name} 계정을 삭제하시겠어요?`)) remove.mutate(u.id); }}>
                            <Trash2 size={16} />
                          </IconBtn>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <AccountFormModal
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['users', 'staff'] }); setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   Form modal
   ──────────────────────────────────────────── */

function AccountFormModal({ initial, onClose, onSaved }: { initial: Account | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [employeeId, setEmployeeId] = useState(initial?.employeeId || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  // 계정 추가 시 역할은 항상 관리자(ADMIN). 기존 계정 수정 시에는 현재 역할을 유지.
  const [role] = useState<Role>(initial?.role || 'ADMIN');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        employeeId: employeeId.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        role,
        isActive,
      };
      return isEdit ? usersApi.update(initial!.id, payload) : usersApi.create(payload);
    },
    onSuccess: () => { toast.success(isEdit ? '수정 완료' : '계정 생성 완료. 초기 비밀번호 = 사번'); onSaved(); },
    onError: (e) => toast.error(extractError(e)),
  });

  // 관리자 계정은 이메일 필수 — 제출 전 검증
  const handleSave = () => {
    if (!name.trim()) { toast.error('이름을 입력해주세요.'); return; }
    if (!employeeId.trim()) { toast.error('사번을 입력해주세요.'); return; }
    if (!email.trim()) { toast.error('이메일을 입력해주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast.error('유효한 이메일 형식이 아닙니다.'); return; }
    save.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h3 className="text-[19px] font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? '계정 수정' : '새 계정 추가'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className={labelCls}>이름<span className="text-red-500 ml-0.5">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>사번<span className="text-red-500 ml-0.5">*</span></label>
            <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="ADM001" className={inputCls} disabled={isEdit} />
            {!isEdit && <p className="text-[13px] text-gray-400 mt-1">초기 비밀번호 = 사번 (첫 로그인 시 변경 권장)</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>이메일<span className="text-red-500 ml-0.5">*</span></label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>전화번호</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>역할</label>
            <div className={`${inputCls} bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-gray-200 flex items-center`}>
              {ROLE_LABELS[role]}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[15px] text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            활성 (로그인 가능)
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-[15px]">
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={save.isPending}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-2 text-[15px] font-medium"
            >
              {save.isPending && <Loader2 size={16} className="animate-spin" />}
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   Atoms
   ──────────────────────────────────────────── */

const inputCls = 'w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60';
const labelCls = 'block text-[14px] font-medium text-gray-700 dark:text-gray-200 mb-1.5';

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-3 text-${align || 'left'} text-[13px] font-semibold uppercase tracking-wide`}>{children}</th>;
}
function Td({ children, className, align }: { children: React.ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <td className={`px-4 py-3 text-${align || 'left'} ${className || ''}`}>{children}</td>;
}

function Badge({ color, children }: { color: 'red' | 'purple' | 'blue' | 'emerald' | 'amber' | 'green' | 'gray'; children: React.ReactNode }) {
  const cls = {
    red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
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

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '오류가 발생했습니다.';
}
