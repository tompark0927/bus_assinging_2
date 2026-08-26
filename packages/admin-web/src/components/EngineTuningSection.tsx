import { useEffect, useMemo, useRef, useState } from 'react';
import HolidayReviewPanel from './HolidayReviewPanel';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BrainCircuit,
  Check,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { companyPolicyApi, engineApi } from '../services/api';

/* ────────────────────────────────────────────
   엔진 튜닝 섹션 — [배차 설정] 페이지의 두 번째 탭.

   화면은 엔진의 설정 카탈로그(GET /engine/catalog)를 읽어 자동 렌더링된다.
   → 엔진에 설정이 추가되면 프론트 코드 수정 없이 화면에 나타난다.

   값의 저장소는 **DB(Company.enginePolicy)** 다. 엔진은 요청마다 policy_json
   을 받는 stateless 계산기라, 엔진이 꺼져 있어도 저장은 된다(카탈로그를 읽지
   못해 화면을 그리지 못할 뿐).

   온보딩: 기존 배차표 엑셀 업로드 → 엔진이 규칙을 감지하고 설정별
   추천값 + 신뢰도 + 근거 문장을 제시 → 담당자가 [추천 수락] 원탭 확정.
   ──────────────────────────────────────────── */

/**
 * [운영 정책] 탭이 주인인 키 — 백엔드 engine 프록시가 생성·검산 요청마다
 * 이 키들을 운영 정책 값으로 덮어쓴다(services/enginePolicyMapper.ts).
 * 여기서 따로 저장해봐야 무시되므로 편집을 막고 운영 정책 탭으로 보낸다.
 */
const KEYS_OWNED_BY_DISPATCH_SETTINGS = new Set([
  'max_consecutive_enabled',
  'max_consecutive_days',
  'monthly_band_enabled',
  'monthly_work_days',
  'forbid_pm_to_am',
]);

interface SettingSpec {
  key: string;
  label: string;
  description: string;
  type: 'toggle' | 'number' | 'slider' | 'choice' | 'range';
  default: unknown;
  category: string;
  choices: [string, string][] | null;
  min: number | null;
  max: number | null;
  advanced: boolean;
}

interface Recommendation {
  key: string;
  value: unknown;
  confidence: number;
  evidence: string;
}

interface GroupRule {
  group: string;
  size: number;
  rotation_step: number | null;
  rotation_support: number;
  reduction_mode: string;
  display_mode: string;
}

type PolicyValues = Record<string, unknown>;

/* 개별 설정 입력 컨트롤 — 타입별 렌더링 */
function SettingControl({
  spec, value, onChange,
}: {
  spec: SettingSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (spec.type) {
    case 'toggle':
      return (
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            value ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              value ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      );
    case 'number':
      return (
        <input
          type="number"
          value={Number(value ?? spec.default)}
          min={spec.min ?? undefined}
          max={spec.max ?? undefined}
          onChange={e => onChange(Number(e.target.value))}
          className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-right focus:border-blue-500 focus:outline-none"
        />
      );
    case 'slider': {
      const v = Number(value ?? spec.default);
      return (
        <div className="flex items-center gap-3 w-48">
          <input
            type="range"
            value={v}
            min={spec.min ?? 0}
            max={spec.max ?? 10}
            onChange={e => onChange(Number(e.target.value))}
            className="flex-1 accent-blue-600"
          />
          <span className="w-6 text-sm font-semibold text-gray-700 text-right">{v}</span>
        </div>
      );
    }
    case 'choice':
      return (
        <select
          value={String(value ?? spec.default)}
          onChange={e => onChange(e.target.value)}
          className="max-w-[280px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          {(spec.choices ?? []).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      );
    case 'range': {
      const [lo, hi] = Array.isArray(value) ? (value as number[]) : (spec.default as number[]);
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={lo}
            min={spec.min ?? undefined}
            max={hi}
            onChange={e => onChange([Number(e.target.value), hi])}
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-right focus:border-blue-500 focus:outline-none"
          />
          <span className="text-gray-400">~</span>
          <input
            type="number"
            value={hi}
            min={lo}
            max={spec.max ?? undefined}
            onChange={e => onChange([lo, Number(e.target.value)])}
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-right focus:border-blue-500 focus:outline-none"
          />
          <span className="text-sm text-gray-500">일</span>
        </div>
      );
    }
    default:
      return null;
  }
}

function confidenceBadge(c: number) {
  const pct = Math.round(c * 100);
  const color =
    c >= 0.85 ? 'bg-green-100 text-green-700'
    : c >= 0.6 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>신뢰도 {pct}%</span>;
}

export default function EngineTuningSection({
  onGoToPolicy,
  onSaveStateChange,
}: {
  onGoToPolicy: () => void;
  /** 저장 상태·핸들러를 부모(배차 설정 페이지)에 올려 헤더 저장 버튼을 그리게 한다.
   *  운영 정책 탭과 저장 위치를 통일하기 위함. */
  onSaveStateChange?: (state: { dirty: boolean; saving: boolean; save: () => void }) => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<PolicyValues>({});
  const [dirty, setDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [groupRules, setGroupRules] = useState<GroupRule[]>([]);
  const [analyzeSummary, setAnalyzeSummary] = useState<string>('');

  const { data: catalogData, isLoading: catalogLoading, isError: catalogError } = useQuery({
    queryKey: ['engine-catalog'],
    queryFn: async () => (await engineApi.catalog()).data as { settings: SettingSpec[] },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const { data: policyData, isLoading: policyLoading } = useQuery({
    queryKey: ['engine-policy'],
    queryFn: async () => (await companyPolicyApi.getEngine()).data.data,
    retry: 1,
  });

  // 저장된 정책 → 로컬 상태
  useEffect(() => {
    if (policyData?.policy) {
      setValues({ ...(policyData.policy.values ?? {}) });
      setDirty(false);
    }
  }, [policyData]);

  const catalog = catalogData?.settings ?? [];
  const categories = useMemo(() => {
    const out: { name: string; items: SettingSpec[] }[] = [];
    for (const s of catalog) {
      let cat = out.find(c => c.name === s.category);
      if (!cat) {
        cat = { name: s.category, items: [] };
        out.push(cat);
      }
      cat.items.push(s);
    }
    return out;
  }, [catalog]);

  const effectiveValue = (spec: SettingSpec) =>
    spec.key in values ? values[spec.key] : spec.default;

  const setValue = (key: string, v: unknown) => {
    setValues(prev => ({ ...prev, [key]: v }));
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // 공휴일은 HolidayReviewPanel 이 별도 엔드포인트로 저장한다.
      // 여기서는 이미 저장된 값을 그대로 실어 보내 덮어쓰지 않게만 한다.
      return companyPolicyApi.updateEngine({
        values,
        holidays: policyData?.policy?.holidays ?? [],
        special_reductions: policyData?.policy?.special_reductions ?? [],
      });
    },
    onSuccess: () => {
      toast.success('엔진 정책이 저장되었습니다.');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['engine-policy'] });
    },
    onError: (err: unknown) =>
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          '저장에 실패했습니다.',
      ),
  });

  // 저장 버튼은 부모(배차 설정 헤더)에서 그린다 — 운영 정책 탭과 위치를 통일.
  // dirty·저장중 상태가 바뀔 때마다 최신 save 핸들러와 함께 부모에 보고한다.
  useEffect(() => {
    onSaveStateChange?.({
      dirty,
      saving: saveMutation.isPending,
      save: () => saveMutation.mutate(),
    });
  }, [dirty, saveMutation.isPending, onSaveStateChange]);

  const analyzeMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (await engineApi.analyze(form)).data;
    },
    onSuccess: data => {
      setRecommendations(data.recommendations ?? []);
      setGroupRules(data.group_rules ?? []);
      setAnalyzeSummary(
        `${data.sheets_analyzed?.length ?? 0}개월 분석 — 기사 ${data.drivers}명 ` +
        `(고정 ${data.fixed_drivers} / 예비 ${data.spare_drivers}), ` +
        `그룹 ${data.group_rules?.length ?? 0}개 규칙 감지`
      );
      toast.success('분석 완료 — 아래 추천을 확인하세요.');
    },
    onError: () => toast.error('분석에 실패했습니다. 파일 형식을 확인해 주세요.'),
  });

  const applyRecommendation = (rec: Recommendation) => {
    setValue(rec.key, rec.value);
    setRecommendations(prev => prev.filter(r => r.key !== rec.key));
  };

  // 엔진 소관 추천만 여기서 적용한다. 배차 설정이 주인인 키는 저장해도
  // 생성 때 덮어써지므로, 적용 버튼 대신 배차 설정으로 안내한다.
  const engineRecommendations = recommendations.filter(r => !KEYS_OWNED_BY_DISPATCH_SETTINGS.has(r.key));
  const dispatchRecommendations = recommendations.filter(r => KEYS_OWNED_BY_DISPATCH_SETTINGS.has(r.key));

  const applyAll = () => {
    setValues(prev => {
      const next = { ...prev };
      for (const r of engineRecommendations) next[r.key] = r.value;
      return next;
    });
    setDirty(true);
    setRecommendations(dispatchRecommendations);
    toast.success('엔진 설정 추천을 모두 적용했습니다. 저장을 눌러 확정하세요.');
  };

  const specByKey = useMemo(() => {
    const m: Record<string, SettingSpec> = {};
    for (const s of catalog) m[s.key] = s;
    return m;
  }, [catalog]);

  const formatValue = (rec: Recommendation) => {
    const spec = specByKey[rec.key];
    if (!spec) return String(rec.value);
    if (spec.type === 'toggle') return rec.value ? '켜기' : '끄기';
    if (spec.type === 'choice') {
      const found = (spec.choices ?? []).find(([v]) => v === rec.value);
      return found ? found[1] : String(rec.value);
    }
    if (spec.type === 'range' && Array.isArray(rec.value)) {
      return `${rec.value[0]} ~ ${rec.value[1]}일`;
    }
    return String(rec.value);
  };

  if (catalogLoading || policyLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <Loader2 className="mr-2 animate-spin" size={20} /> 엔진 설정을 불러오는 중…
      </div>
    );
  }

  if (catalogError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        배차 엔진에 연결할 수 없습니다. 서버에 <code className="rounded bg-amber-100 px-1">ENGINE_URL</code>이
        설정되어 있고 엔진 서비스가 실행 중인지 확인해 주세요.
        <br />
        (저장된 엔진 설정은 DB 에 있으므로 유실되지 않습니다 — 엔진이 복구되면 그대로 보입니다.)
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <BrainCircuit className="mt-0.5 text-blue-600 dark:text-blue-400" size={22} />
        <p className="max-w-3xl text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">
          순번 로테이션·감차·짝궁 교대·예비 운영·공정성 등 <b>엔진 고유 규칙</b>을 관리합니다.
          근무일수·연속근무·최소 휴식은 <b>운영 정책</b> 탭이 주인이며, 배차표를 생성할 때 그 값이 적용됩니다.
          변경 후 우측 상단 <b>저장</b> 버튼으로 확정하세요.
        </p>
      </div>

      {/* ── 온보딩: 엑셀 분석 + 추천 ── */}
      <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Sparkles className="text-blue-600" size={22} />
            <div>
              <h3 className="font-semibold text-gray-900">기존 배차표로 자동 설정</h3>
              <p className="text-sm text-gray-500">
                지금 쓰시는 배차표 엑셀을 올리면 로테이션·감차·교대 규칙을 분석해 설정을 추천합니다.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) analyzeMutation.mutate(f);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={analyzeMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:opacity-50"
            >
              {analyzeMutation.isPending
                ? <Loader2 size={16} className="animate-spin" />
                : <Upload size={16} />}
              엑셀 업로드
            </button>
            {engineRecommendations.length > 0 && (
              <button
                onClick={applyAll}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                <Check size={16} /> 전체 추천 수락 ({engineRecommendations.length})
              </button>
            )}
          </div>
        </div>

        {analyzeSummary && (
          <p className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <FileSpreadsheet size={15} className="text-gray-400" /> {analyzeSummary}
          </p>
        )}

        {groupRules.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {groupRules.map(g => (
              <span
                key={g.group}
                className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs text-gray-700"
                title={`감차 ${g.reduction_mode} · 표시 ${g.display_mode}`}
              >
                {g.group} {g.size}대 · 로테이션{' '}
                {g.rotation_step !== null ? `${g.rotation_step > 0 ? '+' : ''}${g.rotation_step}` : '커스텀 순열'}
                {' '}({Math.round(g.rotation_support * 100)}% 일치)
              </span>
            ))}
          </div>
        )}

        {dispatchRecommendations.length > 0 && (
          <ul className="mt-4 space-y-2">
            {dispatchRecommendations.map(rec => {
              const spec = specByKey[rec.key];
              return (
                <li
                  key={rec.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 bg-white/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-700">{spec?.label ?? rec.key}</span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                        분석값: {formatValue(rec)}
                      </span>
                      {confidenceBadge(rec.confidence)}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {rec.evidence} — 이 항목은 [운영 정책] 탭이 주인이라 여기서 적용하지 않습니다.
                    </p>
                  </div>
                  <button
                    onClick={onGoToPolicy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    운영 정책 탭에서 반영 →
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {engineRecommendations.length > 0 && (
          <ul className="mt-4 space-y-2">
            {engineRecommendations.map(rec => {
              const spec = specByKey[rec.key];
              return (
                <li
                  key={rec.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{spec?.label ?? rec.key}</span>
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        추천: {formatValue(rec)}
                      </span>
                      {confidenceBadge(rec.confidence)}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{rec.evidence}</p>
                  </div>
                  <button
                    onClick={() => applyRecommendation(rec)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                  >
                    <Check size={14} /> 적용
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 설정 카탈로그 (카테고리별 자동 렌더링) ── */}
      {categories.map(cat => {
        const visible = cat.items.filter(s => showAdvanced || !s.advanced);
        if (visible.length === 0) return null;
        return (
          <section key={cat.name} className="rounded-xl border border-gray-200 bg-white">
            <h3 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">
              {cat.name}
            </h3>
            <ul className="divide-y divide-gray-50">
              {visible.map(spec => {
                const owned = KEYS_OWNED_BY_DISPATCH_SETTINGS.has(spec.key);
                return (
                <li key={spec.key} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0 max-w-xl flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${owned ? 'text-gray-500' : 'text-gray-900'}`}>
                        {spec.label}
                      </span>
                      {spec.advanced && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">고급</span>
                      )}
                      {owned && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                          운영 정책 탭에서 관리
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{spec.description}</p>
                  </div>
                  {owned ? (
                    <button
                      type="button"
                      onClick={onGoToPolicy}
                      className="shrink-0 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                    >
                      운영 정책 탭에서 변경 →
                    </button>
                  ) : (
                    <SettingControl
                      spec={spec}
                      value={effectiveValue(spec)}
                      onChange={v => setValue(spec.key, v)}
                    />
                  )}
                </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <HolidayReviewPanel />

      <button
        onClick={() => setShowAdvanced(v => !v)}
        className="inline-flex items-center gap-1 text-sm text-gray-500 transition hover:text-gray-800"
      >
        <ChevronDown size={15} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        {showAdvanced ? '고급 설정 숨기기' : '고급 설정 보기'}
      </button>
    </div>
  );
}
