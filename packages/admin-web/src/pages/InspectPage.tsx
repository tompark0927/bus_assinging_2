import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle, AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Loader2, Upload, ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { engineApi } from '../services/api';
import PageHeader from '../components/PageHeader';
import { inspectHelp } from '../help/helpContent';

/**
 * 배차표 검산 — 이미 짜 놓은 엑셀을 올려서 빠진 곳만 찾아준다.
 *
 * 이 화면은 도입의 첫 관문이다. 배차 담당자에게 "우리 시스템으로 바꾸세요"는
 * 팔리지 않지만 "당신이 짠 걸 그대로 올려보세요"는 거절할 이유가 없다.
 * 아무것도 바꾸지 않고, 저장하지도 않기 때문이다.
 *
 * 그래서 화면 설계도 그 약속을 지켜야 한다:
 *   · 통과한 항목을 위반과 같은 비중으로 보여준다 (트집 아닌 검산)
 *   · 검사하지 못한 항목은 이유를 밝힌다 (조용히 빼면 '다 봤다'로 읽힌다)
 *   · 확실한 것만 '오류', 애매한 건 '확인 필요'로 내린다
 */

interface Finding {
  rule: string;
  severity: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
  date: string | null;
  vehicle: string | null;
  shift: string | null;
  driver: string | null;
  group: string | null;
}

interface Check {
  rule: string;
  label: string;
  checked: number;
  violations: number;
  note: string;
}

interface Report {
  year: number;
  month: number;
  division: string;
  summary: {
    drivers: number; vehicles: number; days: number; cells: number;
    errors: number; warns: number; infos: number;
  };
  checks: Check[];
  findings: Finding[];
}

const SEV = {
  error: { label: '오류', icon: AlertCircle, tone: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800' },
  warn: { label: '확인 필요', icon: AlertTriangle, tone: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
  info: { label: '참고', icon: Info, tone: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
} as const;

export default function InspectPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');

  const run = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await engineApi.inspect(form);
      return res.data.reports as Report[];
    },
    onSuccess: (data) => {
      setReports(data);
      const errs = data.reduce((n, r) => n + r.summary.errors, 0);
      toast.success(errs === 0 ? '오류 없이 깨끗합니다.' : `오류 ${errs}건을 찾았습니다.`);
    },
    onError: (err: { response?: { data?: { message?: string; detail?: string } } }) =>
      toast.error(
        err?.response?.data?.detail ?? err?.response?.data?.message ?? '검산에 실패했습니다.',
      ),
  });

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setReports(null);
    run.mutate(f);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="배차표 검산"
        help={inspectHelp}
        description={
          <>
            짜 놓으신 배차표 엑셀을 올리면 규칙에 어긋난 곳만 찾아 드립니다.
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {' '}배차표를 고치지도, 저장하지도 않습니다.
            </span>
          </>
        }
      />

      {/* 업로드 */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
        className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-600 dark:bg-gray-800"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? undefined)}
        />
        {run.isPending ? (
          <p className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" /> {fileName} 검사하는 중…
          </p>
        ) : (
          <>
            <FileSpreadsheet size={32} className="mx-auto mb-2 text-gray-400" />
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              <Upload size={15} /> 엑셀 파일 선택
            </button>
            <p className="mt-2 text-xs text-gray-400">
              {fileName || '월간배차·주간배차표 어느 양식이든 됩니다. 끌어다 놓아도 됩니다.'}
            </p>
          </>
        )}
      </div>

      {reports?.map((rep) => {
        const s = rep.summary;
        const findings = rep.findings.filter((f) => filter === 'all' || f.severity === filter);
        const clean = s.errors === 0 && s.warns === 0;
        return (
          <section key={`${rep.year}-${rep.month}`} className="space-y-4">
            {/* 요약 */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                  {rep.year}년 {rep.month}월 {rep.division}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  기사 {s.drivers}명 · 차량 {s.vehicles}대 · {s.days}일 · {s.cells.toLocaleString()}칸 검사
                </p>
              </div>

              {clean ? (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300">
                  <CheckCircle2 size={16} />
                  {s.cells.toLocaleString()}칸을 모두 확인했고 어긋난 곳이 없습니다.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['error', 'warn', 'info'] as const).map((k) => {
                    const n = k === 'error' ? s.errors : k === 'warn' ? s.warns : s.infos;
                    if (n === 0) return null;
                    const S = SEV[k];
                    return (
                      <button
                        key={k}
                        onClick={() => setFilter(filter === k ? 'all' : k)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${S.bg} ${S.border} ${S.tone} ${
                          filter === k ? 'ring-2 ring-offset-1 ring-current' : ''
                        }`}
                      >
                        <S.icon size={14} /> {S.label} {n}건
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 검사 항목 — 통과한 것도 보여준다 */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">검사 항목</h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {rep.checks.map((c) => (
                  <li key={c.rule} className="flex items-start gap-2 text-sm">
                    {c.checked === 0 ? (
                      <span className="mt-0.5 text-gray-300">—</span>
                    ) : c.violations === 0 ? (
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-600" />
                    ) : (
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                    )}
                    <span className={c.checked === 0 ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}>
                      {c.label}
                      {c.checked === 0 ? (
                        <span className="block text-xs text-gray-400">
                          {c.note || '해당 없음'}
                        </span>
                      ) : c.violations > 0 ? (
                        <span className="text-amber-600"> — {c.violations}건</span>
                      ) : (
                        <span className="text-xs text-gray-400"> ({c.checked.toLocaleString()}건 확인)</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 발견 목록 */}
            {findings.length > 0 && (
              <ul className="space-y-2">
                {findings.map((f, i) => {
                  const S = SEV[f.severity];
                  return (
                    <li
                      key={`${f.rule}-${i}`}
                      className={`rounded-lg border p-3 ${S.bg} ${S.border}`}
                    >
                      <div className="flex items-start gap-2">
                        <S.icon size={15} className={`mt-0.5 shrink-0 ${S.tone}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {f.title}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                            {f.detail}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {reports && reports.length > 0 && (
        <p className="pb-4 text-center text-xs text-gray-400">
          검사 기준은 <span className="font-medium">배차 설정</span>(운영 정책 + 엔진 튜닝)의 값을 그대로 씁니다.
          회사 규칙과 다르면 설정을 고친 뒤 다시 올려 주세요.
        </p>
      )}
    </div>
  );
}
