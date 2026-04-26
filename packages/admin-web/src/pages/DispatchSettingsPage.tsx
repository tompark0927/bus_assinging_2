import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag,
  Ticket,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Shield,
  Filter,
} from 'lucide-react';
import { usersApi, driverTagsApi, goldenTicketsApi } from '../services/api';
import toast from 'react-hot-toast';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

interface Driver {
  id: number;
  name: string;
  employeeId: string;
}

interface DriverTag {
  id: number;
  driverId: number;
  driver?: { id: number; name: string };
  targetDriverId: number | null;
  targetDriver?: { id: number; name: string } | null;
  tagText: string;
  isHardRule: boolean;
  createdAt: string;
}

interface GoldenTicket {
  id: number;
  driverId: number;
  driver?: { id: number; name: string };
  earnedAt: string;
  expiresAt: string;
  isUsed: boolean;
  usedAt: string | null;
}

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */

function extractApiError(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e?.response?.data?.message || '오류가 발생했습니다.';
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/* ────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */

export default function DispatchSettingsPage() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-bold text-gray-900 dark:text-gray-100">
          배차 설정
        </h1>
        <p className="text-[16px] text-gray-500 dark:text-gray-400 mt-1">
          블랙리스트 태그와 황금 티켓을 관리합니다
        </p>
      </div>

      {/* Section 1: Driver Tags */}
      <DriverTagsSection />

      {/* Section 2: Golden Tickets */}
      <GoldenTicketsSection />
    </div>
  );
}

/* ════════════════════════════════════════════
   Section 1: 블랙리스트 태그 관리
   ════════════════════════════════════════════ */

function DriverTagsSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formDriverId, setFormDriverId] = useState('');
  const [formTagText, setFormTagText] = useState('');
  const [formIsHardRule, setFormIsHardRule] = useState(false);
  const [formTargetDriverId, setFormTargetDriverId] = useState('');

  const { data: tags = [], isLoading } = useQuery<DriverTag[]>({
    queryKey: ['driver-tags'],
    queryFn: () => driverTagsApi.list().then((r) => r.data.data ?? r.data),
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ['users', 'drivers'],
    queryFn: () =>
      usersApi.list({ role: 'DRIVER', limit: '500' }).then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => driverTagsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-tags'] });
      toast.success('태그가 추가되었습니다.');
      resetForm();
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => driverTagsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-tags'] });
      toast.success('태그가 삭제되었습니다.');
    },
    onError: (err: unknown) => toast.error(extractApiError(err)),
  });

  const resetForm = () => {
    setShowForm(false);
    setFormDriverId('');
    setFormTagText('');
    setFormIsHardRule(false);
    setFormTargetDriverId('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDriverId || !formTagText.trim()) {
      toast.error('기사와 태그 내용을 입력해주세요.');
      return;
    }
    createMutation.mutate({
      driverId: Number(formDriverId),
      tagText: formTagText.trim(),
      isHardRule: formIsHardRule,
      targetDriverId: formTargetDriverId ? Number(formTargetDriverId) : undefined,
    });
  };

  const handleDelete = (tag: DriverTag) => {
    const driverName = tag.driver?.name || `기사 #${tag.driverId}`;
    if (confirm(`"${driverName}"의 태그 "${tag.tagText}"를 삭제하시겠습니까?`)) {
      deleteMutation.mutate(tag.id);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/30" style={{ width: 48, height: 48 }}>
            <Tag size={24} className="text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-[22px] font-bold text-gray-900 dark:text-gray-100">
              블랙리스트 태그 관리
            </h2>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">
              기사 간 배차 제한 태그를 설정합니다
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 text-[16px] font-semibold text-white shadow-sm hover:bg-red-700 active:bg-red-800 transition-colors"
          style={{ height: 48 }}
        >
          <Plus size={20} />
          태그 추가
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
          <h3 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100 mb-4">
            새 태그 추가
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-[14px] font-semibold text-gray-700 dark:text-gray-300">
                  기사 선택 <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-[16px] text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  style={{ minHeight: 48 }}
                  value={formDriverId}
                  onChange={(e) => setFormDriverId(e.target.value)}
                  required
                >
                  <option value="">기사를 선택하세요</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name} ({d.employeeId})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[14px] font-semibold text-gray-700 dark:text-gray-300">
                  대상 기사 (선택)
                </label>
                <select
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-[16px] text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  style={{ minHeight: 48 }}
                  value={formTargetDriverId}
                  onChange={(e) => setFormTargetDriverId(e.target.value)}
                >
                  <option value="">없음</option>
                  {drivers
                    .filter((d) => String(d.id) !== formDriverId)
                    .map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        {d.name} ({d.employeeId})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[14px] font-semibold text-gray-700 dark:text-gray-300">
                태그 내용 <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-[16px] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                style={{ minHeight: 48 }}
                placeholder="예: 같은 노선 배치 금지"
                value={formTagText}
                onChange={(e) => setFormTagText(e.target.value)}
                required
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={formIsHardRule}
                  onChange={(e) => setFormIsHardRule(e.target.checked)}
                />
                <div className="w-12 h-7 bg-gray-300 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-200 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
              </label>
              <span className="text-[16px] font-medium text-gray-700 dark:text-gray-300">
                절대 규칙 (하드 룰)
              </span>
              <span className="text-[14px] text-gray-400">
                - 어떤 상황에서도 배차하지 않음
              </span>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-6 text-[16px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                style={{ height: 48 }}
              >
                취소
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 text-[16px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                style={{ height: 48 }}
              >
                {createMutation.isPending && <Loader2 size={18} className="animate-spin" />}
                {createMutation.isPending ? '추가 중...' : '태그 추가'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tags list */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={36} className="animate-spin mb-3" />
            <p className="text-[16px]">불러오는 중...</p>
          </div>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Tag size={44} className="mb-3 opacity-30" />
            <p className="text-[16px] font-medium">등록된 태그가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">태그 내용</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">기사</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">대상 기사</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">구분</th>
                  <th className="text-right px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">삭제</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {tags.map((tag) => (
                  <tr key={tag.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-5 py-4 text-[16px] text-gray-900 dark:text-gray-100 font-medium">
                      {tag.tagText}
                    </td>
                    <td className="px-5 py-4 text-[16px] text-gray-700 dark:text-gray-300">
                      {tag.driver?.name || `기사 #${tag.driverId}`}
                    </td>
                    <td className="px-5 py-4 text-[16px] text-gray-600 dark:text-gray-400">
                      {tag.targetDriver?.name || (tag.targetDriverId ? `기사 #${tag.targetDriverId}` : '-')}
                    </td>
                    <td className="px-5 py-4">
                      {tag.isHardRule ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/50 px-3 py-1 text-[14px] font-semibold text-red-700 dark:text-red-300">
                          <Shield size={14} />
                          절대 규칙
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/50 px-3 py-1 text-[14px] font-semibold text-yellow-700 dark:text-yellow-300">
                          소프트 룰
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => handleDelete(tag)}
                        disabled={deleteMutation.isPending}
                        className="inline-flex items-center justify-center rounded-lg p-2.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 transition-colors"
                        style={{ minWidth: 48, minHeight: 48 }}
                        title="삭제"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════
   Section 2: 황금 티켓 현황
   ════════════════════════════════════════════ */

function GoldenTicketsSection() {
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);

  const { data: tickets = [], isLoading } = useQuery<GoldenTicket[]>({
    queryKey: ['golden-tickets'],
    queryFn: () => goldenTicketsApi.list().then((r) => r.data.data ?? r.data),
  });

  const filtered = useMemo(() => {
    if (!showUnusedOnly) return tickets;
    return tickets.filter((t) => !t.isUsed);
  }, [tickets, showUnusedOnly]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-xl bg-yellow-50 dark:bg-yellow-900/30" style={{ width: 48, height: 48 }}>
            <Ticket size={24} className="text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <h2 className="text-[22px] font-bold text-gray-900 dark:text-gray-100">
              황금 티켓 현황
            </h2>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">
              기사별 황금 티켓 획득 및 사용 내역
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowUnusedOnly(!showUnusedOnly)}
          className={`inline-flex items-center gap-2 rounded-xl px-5 text-[16px] font-semibold transition-colors ${
            showUnusedOnly
              ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700'
              : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
          }`}
          style={{ height: 48 }}
        >
          <Filter size={18} />
          {showUnusedOnly ? '미사용만 보기' : '전체 보기'}
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={36} className="animate-spin mb-3" />
            <p className="text-[16px]">불러오는 중...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Ticket size={44} className="mb-3 opacity-30" />
            <p className="text-[16px] font-medium">
              {tickets.length === 0 ? '황금 티켓이 없습니다' : '미사용 티켓이 없습니다'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <tr>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">기사명</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">획득일</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">만료일</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">사용여부</th>
                  <th className="text-left px-5 py-3.5 text-[14px] font-semibold text-gray-500 dark:text-gray-300">사용날짜</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((ticket) => {
                  const isExpired = !ticket.isUsed && new Date(ticket.expiresAt) < new Date();
                  return (
                    <tr key={ticket.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${isExpired ? 'opacity-60' : ''}`}>
                      <td className="px-5 py-4 text-[16px] font-medium text-gray-900 dark:text-gray-100">
                        {ticket.driver?.name || `기사 #${ticket.driverId}`}
                      </td>
                      <td className="px-5 py-4 text-[16px] text-gray-600 dark:text-gray-400">
                        {formatDate(ticket.earnedAt)}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-[16px] ${isExpired ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-gray-400'}`}>
                          {formatDate(ticket.expiresAt)}
                        </span>
                        {isExpired && (
                          <span className="ml-2 inline-flex items-center gap-0.5 rounded-md bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-[13px] font-semibold text-red-700 dark:text-red-300">
                            <AlertTriangle size={12} />
                            만료
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {ticket.isUsed ? (
                          <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/50 px-3 py-1 text-[14px] font-semibold text-blue-700 dark:text-blue-300">
                            사용완료
                          </span>
                        ) : isExpired ? (
                          <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/50 px-3 py-1 text-[14px] font-semibold text-red-700 dark:text-red-300">
                            만료됨
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/50 px-3 py-1 text-[14px] font-semibold text-green-700 dark:text-green-300">
                            미사용
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-[16px] text-gray-600 dark:text-gray-400">
                        {formatDate(ticket.usedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
