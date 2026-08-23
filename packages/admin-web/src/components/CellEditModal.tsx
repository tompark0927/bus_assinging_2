import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Info, Loader2, Search, UserMinus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulesApi } from '../services/api';

/**
 * 셀 편집 — "이 칸은 이 사람" 하고 바꾸는 창.
 *
 * 단순 수정이 아니라 **학습 입력**이다. 왜 바꿨는지(사유)를 함께 받아 두면
 * 같은 유형이 반복될 때 그 회사의 숨은 규칙으로 승격시킬 수 있다.
 * 그래서 사유 선택을 건너뛸 수 없게 했다 — 다만 '기타'로 빠져나갈 수는 있다.
 */

interface Candidate {
  id: number;
  name: string;
  employeeId: string | null;
  driverType: string | null;
  warnings: string[];
  reasons: string[];
  score: number;
}

export interface CellTarget {
  date: string;
  vehicle: string;
  shift: 'MORNING' | 'AFTERNOON';
  currentName?: string | null;
}

const SHIFT_KO = { MORNING: '오전', AFTERNOON: '오후' } as const;

export default function CellEditModal({
  scheduleId, target, onClose,
}: {
  scheduleId: number;
  target: CellTarget;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [code, setCode] = useState<string>('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');

  // 먼저 "왜 이렇게 됐나"를 보여준다. 바꾸기 전에 이유를 알면
  // "내 방식과 다르다"가 "아 그래서 그랬구나"로 바뀐다.
  const { data: explain } = useQuery({
    queryKey: ['cell-explain', scheduleId, target.date, target.vehicle, target.shift],
    queryFn: async () => (await schedulesApi.cellExplain(scheduleId, {
      date: target.date, vehicle: target.vehicle, shift: target.shift,
    })).data.data as { driver: string | null; summary: string; reasons: { code: string; text: string }[] },
    retry: 0,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['cell-candidates', scheduleId, target.date, target.vehicle, target.shift],
    queryFn: async () => (await schedulesApi.cellCandidates(scheduleId, {
      date: target.date, vehicle: target.vehicle, shift: target.shift,
    })).data.data as {
      current: { id: number; name: string } | null;
      candidates: Candidate[];
      codes: Record<string, string>;
    },
  });

  const save = useMutation({
    mutationFn: (driverId: number | null) => schedulesApi.setCell(scheduleId, {
      date: target.date, vehicle: target.vehicle, shift: target.shift,
      driverId, code: code || undefined, note: note.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-posting'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('변경되었습니다.');
      onClose();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err?.response?.data?.message ?? '변경에 실패했습니다.'),
  });

  const list = (data?.candidates ?? []).filter(
    (c) => !q || c.name.includes(q) || (c.employeeId ?? '').includes(q),
  );
  const codes = data?.codes ?? {};
  const currentName = data?.current?.name ?? target.currentName ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between border-b border-gray-100 p-4 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {target.date} · {target.vehicle} · {SHIFT_KO[target.shift]}
            </h3>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              현재: {currentName ?? '(배정 없음)'}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X size={18} />
          </button>
        </div>

        {/* 배정 근거 — 바꾸기 전에 이유부터 */}
        {explain && explain.reasons.length > 0 && (
          <div className="border-b border-gray-100 bg-blue-50/50 px-4 py-3 dark:border-gray-700 dark:bg-blue-900/10">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-300">
              <Info size={13} /> 왜 이렇게 배정됐나
            </p>
            <ul className="space-y-0.5">
              {explain.reasons.slice(0, 4).map((r) => (
                <li key={r.code} className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                  · {r.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 후보 목록 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="기사 이름 또는 사번 검색"
              className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>

          {isLoading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-gray-400">
              <Loader2 size={15} className="animate-spin" /> 후보를 계산하는 중…
            </p>
          ) : (
            <ul className="space-y-1.5">
              {list.slice(0, 60).map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setPicked(c)}
                    className={`w-full rounded-lg border p-2.5 text-left transition ${
                      picked?.id === c.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{c.name}</span>
                      {c.employeeId && (
                        <span className="text-xs text-gray-400">{c.employeeId}</span>
                      )}
                      {picked?.id === c.id && <Check size={14} className="ml-auto text-blue-600" />}
                    </div>
                    {c.reasons.length > 0 && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{c.reasons.join(' · ')}</p>
                    )}
                    {c.warnings.map((w) => (
                      <p key={w} className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle size={11} /> {w}
                      </p>
                    ))}
                  </button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="py-6 text-center text-sm text-gray-400">검색 결과가 없습니다.</li>
              )}
            </ul>
          )}
        </div>

        {/* 사유 + 확정 */}
        <div className="border-t border-gray-100 p-4 dark:border-gray-700">
          <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">
            왜 바꾸시나요? <span className="font-normal text-gray-400">— 반복되면 규칙으로 배웁니다</span>
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {Object.entries(codes).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setCode(k)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  code === k
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="메모 (선택)"
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />

          {picked?.warnings.length ? (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
              ⚠ {picked.name} — {picked.warnings.join(', ')}. 그래도 배정하시겠습니까?
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              onClick={() => save.mutate(null)}
              disabled={save.isPending || !currentName}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300"
            >
              <UserMinus size={15} /> 배정 해제
            </button>
            <button
              onClick={() => save.mutate(picked!.id)}
              disabled={!picked || !code || save.isPending}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              {save.isPending ? '저장 중…' : picked ? `${picked.name}(으)로 변경` : '기사를 선택하세요'}
            </button>
          </div>
          {picked && !code && (
            <p className="mt-1.5 text-center text-xs text-gray-400">사유를 선택해야 저장할 수 있습니다</p>
          )}
        </div>
      </div>
    </div>
  );
}
