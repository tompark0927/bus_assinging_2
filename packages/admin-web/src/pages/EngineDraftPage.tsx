import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  Save,
  CalendarRange,
  Check,
  Download,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserX,
  Wand2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { engineApi, schedulesApi } from '../services/api';
import PageHeader from '../components/PageHeader';

/* ────────────────────────────────────────────
   AI 배차 초안 생성 (Python dispatch-engine)

   기존 배차표 엑셀(최근 1~2개월) 업로드 → 다음 달 초안 생성.
   - 주간 그리드로 미리보기 (게시 양식과 같은 순번|오전|오후)
   - 셀 클릭 → "왜 이 기사가 이 슬롯인가" 설명 + 결원 처리
   - 결원 신고 → 대체 후보 3명 추천 → 원탭 확정 (변경 셀 빨간 표시)
   - 확정본은 게시 양식 xlsx로 다운로드
   ──────────────────────────────────────────── */

interface DraftCell {
  slot: string | null;
  am: string;
  pm: string;
}

interface DraftGroup {
  name: string;
  vehicles: string[];
}

interface DraftResult {
  draft_id: string;
  year: number;
  month: number;
  groups: DraftGroup[];
  solver_status: string;
  warnings: string[];
  audit: { ok: boolean; violations: { rule: string; message: string }[] };
  unfilled: [string, string, string][];
  fairness: {
    slot_balance_stdev: number;
    weekend_off_stdev: number;
    substitute_stdev: number;
  };
  cells: Record<string, Record<string, DraftCell>>;
}

interface ExplainReason {
  code: string;
  text: string;
  weight: number;
}

interface RepairCandidate {
  driver: string;
  score: number;
  reasons: string[];
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDay(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_KO[d.getDay()]})`;
}

export default function EngineDraftPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const now = new Date();
  const defaultTarget = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [year, setYear] = useState(defaultTarget.getFullYear());
  const [month, setMonth] = useState(defaultTarget.getMonth() + 1);
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [weekIdx, setWeekIdx] = useState(0);
  // 수리로 변경된 셀: "date|vehicle|shift" -> 새 기사명
  const [repaired, setRepaired] = useState<Record<string, string>>({});
  // 셀 상세 패널
  const [selected, setSelected] = useState<{
    date: string; vehicle: string; shift: 'A' | 'P'; driver: string;
  } | null>(null);
  const [explain, setExplain] = useState<{ summary: string; reasons: ExplainReason[] } | null>(null);
  const [candidates, setCandidates] = useState<RepairCandidate[] | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('no file');
      const form = new FormData();
      form.append('file', file);
      form.append('year', String(year));
      form.append('month', String(month));
      return (await engineApi.generate(form)).data as DraftResult;
    },
    onSuccess: data => {
      setDraft(data);
      setRepaired({});
      setWeekIdx(0);
      setSelected(null);
      toast.success(
        data.audit.ok
          ? '초안 생성 완료 — 제약 위반 0건'
          : `초안 생성 — 제약 위반 ${data.audit.violations.length}건, 확인 필요`
      );
    },
    onError: () => toast.error('생성에 실패했습니다. 파일과 엔진 연결을 확인해 주세요.'),
  });

  const explainMutation = useMutation({
    mutationFn: async (p: { date: string; vehicle: string; shift: string }) =>
      (await engineApi.explainCell(draft!.draft_id, p.date, p.vehicle, p.shift)).data,
    onSuccess: data => setExplain(data),
  });

  const absenceMutation = useMutation({
    mutationFn: async (p: { date: string; vehicle: string; shift: string }) => {
      const form = new FormData();
      form.append('date', p.date);
      form.append('vehicle', p.vehicle);
      form.append('shift', p.shift);
      return (await engineApi.reportAbsence(draft!.draft_id, form)).data;
    },
    onSuccess: data => {
      setCandidates(data.top_candidates ?? []);
      if (!data.top_candidates?.length) {
        toast.error('가용한 대체 기사가 없습니다 — 결행 후보로 남습니다.');
      }
    },
    onError: () => toast.error('결원 처리에 실패했습니다.'),
  });

  const repairMutation = useMutation({
    mutationFn: async (driver: string) => {
      const form = new FormData();
      form.append('date', selected!.date);
      form.append('vehicle', selected!.vehicle);
      form.append('shift', selected!.shift);
      form.append('driver', driver);
      form.append('reason', '결원 대체');
      return (await engineApi.applyRepair(draft!.draft_id, form)).data;
    },
    onSuccess: data => {
      const c = data.changed;
      setRepaired(prev => ({ ...prev, [`${c.date}|${c.vehicle}|${c.shift}`]: c.added }));
      toast.success(`${c.removed ?? '(미충원)'} → ${c.added} 확정`);
      setSelected(null);
      setCandidates(null);
      setExplain(null);
    },
    onError: () => toast.error('확정에 실패했습니다.'),
  });

  // 초안을 실제 배차표(DB)로 저장 — 저장하면 배차표 관리에서 게시 양식으로 보인다
  const [savedId, setSavedId] = useState<number | null>(null);
  const [unmatched, setUnmatched] = useState<{ vehicles: string[]; drivers: string[] } | null>(null);
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('no draft');
      return (await schedulesApi.saveFromEngine({
        year: draft.year,
        month: draft.month,
        name: `AI 엔진 초안 (${draft.month}월)`,
        cells: draft.cells as unknown as Record<string, Record<string, unknown>>,
      })).data.data;
    },
    onSuccess: (data: { scheduleId: number; slotCount: number; unmatched: { vehicles: string[]; drivers: string[] } }) => {
      setSavedId(data.scheduleId);
      setUnmatched(data.unmatched);
      toast.success(`배차표로 저장되었습니다 (배정 ${data.slotCount}건)`);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast.error(err?.response?.data?.message ?? '저장에 실패했습니다.');
    },
  });

  const downloadXlsx = async () => {
    if (!draft) return;
    try {
      const res = await engineApi.draftXlsx(draft.draft_id);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `배차표_${draft.year}-${String(draft.month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('다운로드에 실패했습니다.');
    }
  };

  /* 일요일 시작 주간 분할 (게시 양식과 동일) */
  const weeks = useMemo(() => {
    if (!draft) return [] as string[][];
    const dates = Object.keys(draft.cells).sort();
    const out: string[][] = [];
    let cur: string[] = [];
    for (const iso of dates) {
      const dow = new Date(iso + 'T00:00:00').getDay();
      if (dow === 0 && cur.length) {
        out.push(cur);
        cur = [];
      }
      cur.push(iso);
    }
    if (cur.length) out.push(cur);
    return out;
  }, [draft]);

  const cellDriver = (date: string, vehicle: string, shift: 'A' | 'P') => {
    const key = `${date}|${vehicle}|${shift}`;
    if (key in repaired) return repaired[key];
    const c = draft?.cells[date]?.[vehicle];
    return shift === 'A' ? c?.am ?? '' : c?.pm ?? '';
  };

  const openCell = (date: string, vehicle: string, shift: 'A' | 'P') => {
    const driver = cellDriver(date, vehicle, shift);
    setSelected({ date, vehicle, shift, driver });
    setExplain(null);
    setCandidates(null);
    explainMutation.mutate({ date, vehicle, shift });
  };

  const week = weeks[weekIdx] ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wand2}
        title="AI 배차 초안 생성"
        description="기존 배차표 엑셀을 올리면 다음 달 초안을 만듭니다. 로테이션·감차·짝궁 교대 규칙은 자동으로 이어지고, 저장된 엔진 정책이 적용됩니다. 확정권은 항상 담당자에게 있습니다."
      />

      {/* ── 생성 폼 ── */}
      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">과거 배차표 (최근 1~2개월 포함 엑셀)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <Upload size={15} />
            {file ? file.name : '엑셀 선택'}
          </button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">대상 월</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-sm text-right focus:border-blue-500 focus:outline-none"
            />
            <span className="text-sm text-gray-500">년</span>
            <input
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-sm text-right focus:border-blue-500 focus:outline-none"
            />
            <span className="text-sm text-gray-500">월</span>
          </div>
        </div>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={!file || generateMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {generateMutation.isPending
            ? <><Loader2 size={16} className="animate-spin" /> 생성 중… (최대 3분)</>
            : <><Sparkles size={16} /> 초안 생성</>}
        </button>
      </section>

      {draft && (
        <>
          {/* ── 상태 요약 ── */}
          <section className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
              draft.audit.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              <ShieldCheck size={15} />
              제약 감사 {draft.audit.ok ? '통과 (위반 0건)' : `위반 ${draft.audit.violations.length}건`}
            </span>
            {draft.unfilled.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-700">
                <AlertTriangle size={15} /> 결행 후보 {draft.unfilled.length}건
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
              공정성 σ — 순번 {draft.fairness.slot_balance_stdev} · 주말휴무 {draft.fairness.weekend_off_stdev} · 대타 {draft.fairness.substitute_stdev}
            </span>
            <div className="ml-auto">
              <button
                onClick={downloadXlsx}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <Download size={15} /> 게시용 엑셀 다운로드
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="ml-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saveMutation.isPending
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Save size={15} />}
                배차표로 저장
              </button>
            </div>
          </section>

          {savedId && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <p className="font-semibold">
                배차표로 저장되었습니다.{' '}
                <Link to="/dashboard/schedule" className="underline">배차표 관리에서 열기 →</Link>
              </p>
              {unmatched && (unmatched.vehicles.length > 0 || unmatched.drivers.length > 0) && (
                <p className="mt-1 text-xs text-amber-700">
                  ⚠ 기초 데이터에 없어 저장되지 않은 항목이 있습니다 —
                  {unmatched.vehicles.length > 0 && ` 차량 ${unmatched.vehicles.length}대(${unmatched.vehicles.slice(0, 5).join(', ')}${unmatched.vehicles.length > 5 ? '…' : ''})`}
                  {unmatched.drivers.length > 0 && ` 기사 ${unmatched.drivers.length}명(${unmatched.drivers.slice(0, 5).join(', ')}${unmatched.drivers.length > 5 ? '…' : ''})`}
                  . 기초 데이터에 등록하면 다음 저장 때 반영됩니다.
                </p>
              )}
            </div>
          )}

          {draft.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {draft.warnings.map((w, i) => <p key={i}>· {w}</p>)}
            </div>
          )}

          {/* ── 주 선택 탭 ── */}
          <div className="flex items-center gap-2">
            <CalendarRange size={16} className="text-gray-400" />
            {weeks.map((w, i) => (
              <button
                key={i}
                onClick={() => setWeekIdx(i)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  i === weekIdx
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {i + 1}주차 ({fmtDay(w[0])}~)
              </button>
            ))}
          </div>

          {/* ── 주간 그리드 (게시 양식: 차량 × 날짜(순번|오전|오후)) ── */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-left font-semibold text-gray-700">
                    차량
                  </th>
                  {week.map(iso => (
                    <th key={iso} colSpan={3} className="border-b border-r border-gray-200 px-1 py-2 text-center font-semibold text-gray-700">
                      {fmtDay(iso)}
                    </th>
                  ))}
                </tr>
                <tr className="bg-gray-50/60">
                  <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-2 py-1" />
                  {week.map(iso => (
                    ['순번', '오전', '오후'].map(h => (
                      <th key={`${iso}-${h}`} className="border-b border-r border-gray-100 px-1 py-1 text-center font-medium text-gray-400">
                        {h}
                      </th>
                    ))
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.groups.map(group => (
                  [
                    <tr key={`g-${group.name}`}>
                      <td
                        colSpan={1 + week.length * 3}
                        className="border-b border-gray-100 bg-blue-50/40 px-2 py-1 text-[11px] font-semibold text-blue-700"
                      >
                        {group.name}
                      </td>
                    </tr>,
                    ...group.vehicles.map(vehicle => (
                      <tr key={vehicle} className="hover:bg-gray-50/50">
                        <td className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-2 py-1 font-semibold text-gray-800">
                          {vehicle}
                        </td>
                        {week.map(iso => {
                          const cell = draft.cells[iso]?.[vehicle];
                          const isRest = !!cell && !cell.am && !cell.pm && cell.slot === null;
                          return (
                            <SlotCells
                              key={`${iso}-${vehicle}`}
                              slot={cell?.slot ?? (isRest ? '○' : '')}
                              am={cellDriver(iso, vehicle, 'A')}
                              pm={cellDriver(iso, vehicle, 'P')}
                              amChanged={`${iso}|${vehicle}|A` in repaired}
                              pmChanged={`${iso}|${vehicle}|P` in repaired}
                              onClickAm={() => openCell(iso, vehicle, 'A')}
                              onClickPm={() => openCell(iso, vehicle, 'P')}
                            />
                          );
                        })}
                      </tr>
                    )),
                  ]
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── 셀 상세 패널 (설명 + 결원 처리) ── */}
      {selected && draft && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {fmtDay(selected.date)} · {selected.vehicle} · {selected.shift === 'A' ? '오전' : '오후'}
                </h3>
                <p className="text-sm text-gray-500">{selected.driver ? `배정: ${selected.driver}` : '미배정 (결행 후보)'}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            {/* 배정 근거 */}
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">왜 이 배정인가</h4>
              {explainMutation.isPending && (
                <p className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> 분석 중…
                </p>
              )}
              {explain && (
                <ul className="mt-2 space-y-1.5">
                  {explain.reasons.map((r, i) => (
                    <li key={i} className="text-sm leading-relaxed text-gray-700">· {r.text}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* 결원 처리 */}
            <div className="mt-5 border-t border-gray-100 pt-4">
              {!candidates ? (
                <button
                  onClick={() => absenceMutation.mutate(selected)}
                  disabled={absenceMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {absenceMutation.isPending
                    ? <Loader2 size={15} className="animate-spin" />
                    : <UserX size={15} />}
                  결원 신고 (병가·사고) → 대체 추천 받기
                </button>
              ) : (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">대체 기사 추천 (부담이 적은 순)</h4>
                  <ul className="mt-2 space-y-2">
                    {candidates.map((c, i) => (
                      <li key={c.driver} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-2.5">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-semibold text-gray-900">{i + 1}. {c.driver}</span>
                          <p className="mt-0.5 text-xs text-gray-500">{c.reasons.join(' · ')}</p>
                        </div>
                        <button
                          onClick={() => repairMutation.mutate(c.driver)}
                          disabled={repairMutation.isPending}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Check size={13} /> 확정
                        </button>
                      </li>
                    ))}
                    {candidates.length === 0 && (
                      <li className="text-sm text-gray-500">가용한 대체 기사가 없습니다 — 결행 후보로 유지됩니다.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 하루치 3칸 (순번|오전|오후). 변경된 셀은 빨간색 — 실물 게시 규칙과 동일 */
function SlotCells({
  slot, am, pm, amChanged, pmChanged, onClickAm, onClickPm,
}: {
  slot: string;
  am: string;
  pm: string;
  amChanged: boolean;
  pmChanged: boolean;
  onClickAm: () => void;
  onClickPm: () => void;
}) {
  const cellCls = 'border-b border-r border-gray-100 px-1 py-1 text-center whitespace-nowrap';
  const btnCls = 'w-full cursor-pointer rounded px-0.5 hover:bg-blue-50';
  return (
    <>
      <td className={`${cellCls} text-gray-500`}>{slot}</td>
      <td className={cellCls}>
        <button onClick={onClickAm} className={`${btnCls} ${amChanged ? 'font-bold text-red-600' : 'text-gray-800'}`}>
          {am || (slot && slot !== '○' ? '—' : '')}
        </button>
      </td>
      <td className={cellCls}>
        <button onClick={onClickPm} className={`${btnCls} ${pmChanged ? 'font-bold text-red-600' : 'text-gray-800'}`}>
          {pm || (slot && slot !== '○' ? '—' : '')}
        </button>
      </td>
    </>
  );
}
