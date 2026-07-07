import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Sparkles,
  ShieldCheck,
  Lock,
  Settings,
  Info,
  RotateCcw,
} from 'lucide-react';
import { companyPolicyApi } from '../services/api';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader';
import { dispatchSettingsHelp } from '../help/helpContent';
import { useAuthStore } from '../store/authStore';

/* ────────────────────────────────────────────
   Types — backend `agents/_solvers/types.ts` 와 형식 일치
   ──────────────────────────────────────────── */

type PolicyPreset = 'CITY_2SHIFT' | 'VILLAGE_1SHIFT';

interface CompanyPolicy {
  preset?: PolicyPreset;
  workdayBands: {
    hardMin: number;
    hardMax: number;
    sweetMin: number;
    sweetMax: number;
    belowSweetPenalty: number;
    aboveSweetPenalty: number;
  };
  restCycle: {
    workDays: number;
    restDays: number;
    consecutiveRest: boolean;
  };
  shiftSystem: {
    kind: 'ONE_SHIFT' | 'TWO_SHIFT' | 'THREE_SHIFT' | 'ALTERNATING_DAY';
    slots: string[];
    weeklyAlternation?: boolean;
    periodDays?: number;
  };
  crewModel: {
    kind: 'SOLO' | 'PAIR' | 'TRIO';
    size: 1 | 2 | 3;
  };
  constitutional?: {
    noNightStreak?: { enabled: boolean; maxConsecutive: number; nightShifts: string[] };
    weeklyMaxWorkDays?: { enabled: boolean; maxDays: number };
    noSameDayDoubleAssign?: { enabled: boolean };
    minRestBetweenShifts?: { enabled: boolean; minHours: number };
    noAssignOnApprovedOff?: { enabled: boolean };
    noExpiredLicense?: { enabled: boolean };
    noExpiredQualification?: { enabled: boolean };
    guaranteedWeekendOff?: { enabled: boolean; minPerMonth: number };
    noNewHireSolo?: { enabled: boolean; newHirePeriodDays: number };
    noBlockedRoute?: { enabled: boolean };
  };
}

const PRESET_CITY_2SHIFT: CompanyPolicy = {
  preset: 'CITY_2SHIFT',
  workdayBands: { hardMin: 18, hardMax: 23, sweetMin: 19, sweetMax: 22, belowSweetPenalty: 5, aboveSweetPenalty: 8 },
  restCycle: { workDays: 5, restDays: 2, consecutiveRest: true },
  shiftSystem: { kind: 'TWO_SHIFT', slots: ['AM', 'PM'], weeklyAlternation: true },
  crewModel: { kind: 'PAIR', size: 2 },
  constitutional: {
    noNightStreak: { enabled: true, maxConsecutive: 3, nightShifts: ['PM'] },
    weeklyMaxWorkDays: { enabled: true, maxDays: 6 },
    noSameDayDoubleAssign: { enabled: true },
    minRestBetweenShifts: { enabled: false, minHours: 8 },
    noAssignOnApprovedOff: { enabled: true },
    noExpiredLicense: { enabled: true },
    noExpiredQualification: { enabled: true },
    guaranteedWeekendOff: { enabled: true, minPerMonth: 1 },
    noNewHireSolo: { enabled: true, newHirePeriodDays: 7 },
    noBlockedRoute: { enabled: true },
  },
};

const PRESET_VILLAGE_1SHIFT: CompanyPolicy = {
  preset: 'VILLAGE_1SHIFT',
  workdayBands: { hardMin: 22, hardMax: 27, sweetMin: 23, sweetMax: 26, belowSweetPenalty: 3, aboveSweetPenalty: 8 },
  restCycle: { workDays: 6, restDays: 1, consecutiveRest: false },
  shiftSystem: { kind: 'ONE_SHIFT', slots: ['FULL_DAY'] },
  crewModel: { kind: 'SOLO', size: 1 },
  constitutional: {
    noNightStreak: { enabled: false, maxConsecutive: 0, nightShifts: [] },
    weeklyMaxWorkDays: { enabled: true, maxDays: 6 },
    noSameDayDoubleAssign: { enabled: true },
    minRestBetweenShifts: { enabled: false, minHours: 8 },
    noAssignOnApprovedOff: { enabled: true },
    noExpiredLicense: { enabled: true },
    noExpiredQualification: { enabled: true },
    guaranteedWeekendOff: { enabled: true, minPerMonth: 1 },
    noNewHireSolo: { enabled: true, newHirePeriodDays: 7 },
    noBlockedRoute: { enabled: true },
  },
};

/* ────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */

export default function DispatchSettingsPage() {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId);
  const { data, isLoading } = useQuery<{ policy: CompanyPolicy; isDefault: boolean }>({
    queryKey: ['company-policy'],
    queryFn: () => companyPolicyApi.get().then((r) => r.data.data),
  });

  const [policy, setPolicy] = useState<CompanyPolicy | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.policy && !policy) {
      setPolicy(JSON.parse(JSON.stringify(data.policy)));
    }
  }, [data, policy]);

  const updateMutation = useMutation({
    mutationFn: (p: CompanyPolicy) => companyPolicyApi.update(p as unknown as Record<string, unknown>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-policy'] });
      // 정책을 직접 저장했으면 첫 배차 안내(nudge)도 이미 본 것으로 간주 — 계정별 키
      try { localStorage.setItem(`busync.policyNudgeSeen.${companyId ?? 'unknown'}`, '1'); } catch { /* ignore */ }
      toast.success('정책이 저장되었습니다.');
      setDirty(false);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '저장 중 오류가 발생했습니다.';
      toast.error(msg);
    },
  });

  if (isLoading || !policy) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const update = (updater: (p: CompanyPolicy) => CompanyPolicy) => {
    setPolicy((cur) => (cur ? updater(JSON.parse(JSON.stringify(cur))) : cur));
    setDirty(true);
  };

  const applyPreset = (preset: 'CITY_2SHIFT' | 'VILLAGE_1SHIFT') => {
    const p = preset === 'CITY_2SHIFT' ? PRESET_CITY_2SHIFT : PRESET_VILLAGE_1SHIFT;
    setPolicy(JSON.parse(JSON.stringify(p)));
    setDirty(true);
    toast.success(`${preset === 'CITY_2SHIFT' ? '시내버스 2교대' : '마을버스 1교대'} 프리셋 적용`);
  };

  const handleSave = () => {
    if (!policy) return;
    updateMutation.mutate(policy);
  };

  const handleReset = () => {
    if (data?.policy) {
      setPolicy(JSON.parse(JSON.stringify(data.policy)));
      setDirty(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <PageHeader
        help={dispatchSettingsHelp}
        icon={Settings}
        title="배차 설정"
        description="회사 운영 정책. AI 배차표 생성 시 이 설정을 따릅니다."
        actions={
          <>
            {dirty && (
              <button
                onClick={handleReset}
                className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 inline-flex items-center gap-2 text-[15px]"
              >
                <RotateCcw className="w-4 h-4" /> 되돌리기
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || updateMutation.isPending}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white inline-flex items-center gap-2 text-[15px] font-medium"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              저장
            </button>
          </>
        }
      >
        {data?.isDefault && (
          <div className="mt-3 inline-flex items-center gap-2 text-[14px] text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 px-3 py-1.5 rounded-full">
            <Info className="w-4 h-4" />
            아직 정책이 저장되지 않아 기본값을 표시 중입니다. 저장하면 사용자 정의 정책이 됩니다.
          </div>
        )}
      </PageHeader>

      {/* Section: Preset */}
      <Section icon={<Sparkles className="w-5 h-5 text-gray-900 dark:text-white" />} title="빠른 프리셋" desc="회사 유형에 맞는 표준 설정을 한 번에 적용합니다.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PresetCard
            active={policy.preset === 'CITY_2SHIFT'}
            title="시내버스 2교대"
            tags={['PAIR (정·부)', '5근 2휴', 'AM/PM 교대']}
            onClick={() => applyPreset('CITY_2SHIFT')}
          />
          <PresetCard
            active={policy.preset === 'VILLAGE_1SHIFT'}
            title="마을버스 1교대"
            tags={['SOLO (단독)', '6근 1휴', '종일']}
            onClick={() => applyPreset('VILLAGE_1SHIFT')}
          />
        </div>
      </Section>

      {/* Section: 운영 모델 */}
      <Section title="운영 모델" desc="시프트·승무 형태와 휴무 사이클을 정합니다.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="시프트 시스템" hint="1교대 / 2교대 / 3교대 / 격일제">
            <select
              value={policy.shiftSystem.kind}
              onChange={(e) => {
                const kind = e.target.value as CompanyPolicy['shiftSystem']['kind'];
                const slots =
                  kind === 'ONE_SHIFT' ? ['FULL_DAY']
                  : kind === 'TWO_SHIFT' ? ['AM', 'PM']
                  : kind === 'THREE_SHIFT' ? ['MORNING', 'AFTERNOON', 'NIGHT']
                  : ['ON_DUTY'];
                update((p) => ({ ...p, shiftSystem: { ...p.shiftSystem, kind, slots } }));
              }}
              className={selectCls}
            >
              <option value="ONE_SHIFT">1교대 (종일)</option>
              <option value="TWO_SHIFT">2교대 (AM/PM)</option>
              <option value="THREE_SHIFT">3교대 (오전/오후/야간)</option>
              <option value="ALTERNATING_DAY">격일제</option>
            </select>
          </Field>

          <Field label="승무 모델" hint="버스 1대당 운전자 수">
            <select
              value={policy.crewModel.kind}
              onChange={(e) => {
                const kind = e.target.value as 'SOLO' | 'PAIR' | 'TRIO';
                const size: 1 | 2 | 3 = kind === 'SOLO' ? 1 : kind === 'PAIR' ? 2 : 3;
                update((p) => ({ ...p, crewModel: { kind, size } }));
              }}
              className={selectCls}
            >
              <option value="SOLO">SOLO (단독, 1명)</option>
              <option value="PAIR">PAIR (정·부, 2명)</option>
              <option value="TRIO">TRIO (3명)</option>
            </select>
          </Field>

          <Field label="연속 근무일" hint="휴무 사이의 근무일 수">
            <NumberInput
              value={policy.restCycle.workDays}
              min={1}
              max={14}
              onChange={(v) => update((p) => ({ ...p, restCycle: { ...p.restCycle, workDays: v } }))}
            />
          </Field>

          <Field label="연속 휴무일" hint="근무 사이의 휴무일 수">
            <NumberInput
              value={policy.restCycle.restDays}
              min={1}
              max={7}
              onChange={(v) => update((p) => ({ ...p, restCycle: { ...p.restCycle, restDays: v } }))}
            />
          </Field>

          {policy.shiftSystem.kind === 'TWO_SHIFT' && (
            <Field label="주별 AM↔PM 교대" hint="매주 오전·오후 시프트를 교대로 배정">
              <Toggle
                checked={!!policy.shiftSystem.weeklyAlternation}
                onChange={(v) => update((p) => ({ ...p, shiftSystem: { ...p.shiftSystem, weeklyAlternation: v } }))}
              />
            </Field>
          )}
          <Field label="휴무 연속 보장" hint="휴무일을 반드시 연속으로 부여">
            <Toggle
              checked={policy.restCycle.consecutiveRest}
              onChange={(v) => update((p) => ({ ...p, restCycle: { ...p.restCycle, consecutiveRest: v } }))}
            />
          </Field>
        </div>
      </Section>

      {/* Section: workdayBands — 친근한 UX */}
      <Section
        title="한 달 근무일 가이드"
        desc="기사 한 명이 한 달에 며칠 정도 일하는 게 좋을지 정해주세요. AI가 모든 기사를 이 범위 안에서 비슷하게 일하도록 자동으로 균등 배분합니다."
      >
        <WorkdayBandSlider
          idealMin={policy.workdayBands.sweetMin}
          idealMax={policy.workdayBands.sweetMax}
          allowMin={policy.workdayBands.hardMin}
          allowMax={policy.workdayBands.hardMax}
          onChange={(next) =>
            update((p) => ({
              ...p,
              workdayBands: {
                ...p.workdayBands,
                sweetMin: next.idealMin,
                sweetMax: next.idealMax,
                hardMin: next.allowMin,
                hardMax: next.allowMax,
              },
            }))
          }
        />
      </Section>

      {/* Section: 안전·운영 룰 */}
      <Section
        icon={<ShieldCheck className="w-5 h-5 text-gray-900 dark:text-white" />}
        title="안전·운영 룰"
        desc="회사 단협 또는 안전 정책으로 켜고 끌 수 있습니다. 일부는 법적 강제로 잠겨 있습니다."
      >
        <div className="space-y-2">
          <RuleRow
            locked
            title="같은 날 중복 배정 금지"
            desc="한 기사가 같은 날 두 슬롯에 배정되지 않도록 함. 구조적 룰."
            checked={policy.constitutional?.noSameDayDoubleAssign?.enabled ?? true}
            onChange={() => { /* locked */ }}
          />
          <RuleRow
            locked
            title="승인된 휴무일 배정 금지"
            desc="기사가 신청·승인한 휴무일에는 어떤 슬롯도 배정하지 않음."
            checked={policy.constitutional?.noAssignOnApprovedOff?.enabled ?? true}
            onChange={() => { /* locked */ }}
          />
          <RuleRow
            locked
            title="면허 만료 운전자 배정 금지"
            desc="여객자동차 운수사업법 제24조 — 만료된 운전면허로는 운행 불가."
            checked={policy.constitutional?.noExpiredLicense?.enabled ?? true}
            onChange={() => { /* locked */ }}
          />
          <RuleRow
            locked
            title="자격 만료 운전자 배정 금지"
            desc="여객법 제24조의2 — 운전적성정밀검사 미통과·만료자 운행 불가."
            checked={policy.constitutional?.noExpiredQualification?.enabled ?? true}
            onChange={() => { /* locked */ }}
          />

          <RuleRow
            title="야간 시프트 연속 근무 제한"
            desc="동일 기사가 PM(야간) 시프트를 연속 근무하는 일수 상한. 단협 권장 사항이며 법적 강제는 아님."
            checked={policy.constitutional?.noNightStreak?.enabled ?? true}
            onChange={(v) =>
              update((p) => ({
                ...p,
                constitutional: {
                  ...(p.constitutional ?? {}),
                  noNightStreak: {
                    enabled: v,
                    maxConsecutive: p.constitutional?.noNightStreak?.maxConsecutive ?? 3,
                    nightShifts: p.constitutional?.noNightStreak?.nightShifts ?? ['PM'],
                  },
                },
              }))
            }
            extra={
              policy.constitutional?.noNightStreak?.enabled ? (
                <InlineNumber
                  label="최대 연속 일수"
                  value={policy.constitutional.noNightStreak.maxConsecutive ?? 3}
                  min={1}
                  max={7}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      constitutional: {
                        ...(p.constitutional ?? {}),
                        noNightStreak: {
                          ...(p.constitutional?.noNightStreak ?? { enabled: true, maxConsecutive: 3, nightShifts: ['PM'] }),
                          maxConsecutive: v,
                        },
                      },
                    }))
                  }
                />
              ) : null
            }
          />
          <RuleRow
            title="주 최대 근무일"
            desc="근로기준법 제55조 (주 1회 유급휴일) 기반. 보통 6일."
            checked={policy.constitutional?.weeklyMaxWorkDays?.enabled ?? true}
            onChange={(v) =>
              update((p) => ({
                ...p,
                constitutional: {
                  ...(p.constitutional ?? {}),
                  weeklyMaxWorkDays: {
                    enabled: v,
                    maxDays: p.constitutional?.weeklyMaxWorkDays?.maxDays ?? 6,
                  },
                },
              }))
            }
            extra={
              policy.constitutional?.weeklyMaxWorkDays?.enabled ? (
                <InlineNumber
                  label="최대 일수"
                  value={policy.constitutional.weeklyMaxWorkDays.maxDays ?? 6}
                  min={1}
                  max={7}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      constitutional: {
                        ...(p.constitutional ?? {}),
                        weeklyMaxWorkDays: {
                          ...(p.constitutional?.weeklyMaxWorkDays ?? { enabled: true, maxDays: 6 }),
                          maxDays: v,
                        },
                      },
                    }))
                  }
                />
              ) : null
            }
          />
          <RuleRow
            title="월 최소 주말 휴무 보장"
            desc="한 달에 최소 N회 주말(토·일) 휴무 보장."
            checked={policy.constitutional?.guaranteedWeekendOff?.enabled ?? true}
            onChange={(v) =>
              update((p) => ({
                ...p,
                constitutional: {
                  ...(p.constitutional ?? {}),
                  guaranteedWeekendOff: {
                    enabled: v,
                    minPerMonth: p.constitutional?.guaranteedWeekendOff?.minPerMonth ?? 1,
                  },
                },
              }))
            }
            extra={
              policy.constitutional?.guaranteedWeekendOff?.enabled ? (
                <InlineNumber
                  label="월 최소 횟수"
                  value={policy.constitutional.guaranteedWeekendOff.minPerMonth ?? 1}
                  min={0}
                  max={4}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      constitutional: {
                        ...(p.constitutional ?? {}),
                        guaranteedWeekendOff: {
                          ...(p.constitutional?.guaranteedWeekendOff ?? { enabled: true, minPerMonth: 1 }),
                          minPerMonth: v,
                        },
                      },
                    }))
                  }
                />
              ) : null
            }
          />
          <RuleRow
            title="신규 기사 단독 배정 금지"
            desc="입사 후 N일 동안 다른 노선에 단독 투입 금지."
            checked={policy.constitutional?.noNewHireSolo?.enabled ?? true}
            onChange={(v) =>
              update((p) => ({
                ...p,
                constitutional: {
                  ...(p.constitutional ?? {}),
                  noNewHireSolo: {
                    enabled: v,
                    newHirePeriodDays: p.constitutional?.noNewHireSolo?.newHirePeriodDays ?? 7,
                  },
                },
              }))
            }
            extra={
              policy.constitutional?.noNewHireSolo?.enabled ? (
                <InlineNumber
                  label="신규 기간(일)"
                  value={policy.constitutional.noNewHireSolo.newHirePeriodDays ?? 7}
                  min={1}
                  max={90}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      constitutional: {
                        ...(p.constitutional ?? {}),
                        noNewHireSolo: {
                          ...(p.constitutional?.noNewHireSolo ?? { enabled: true, newHirePeriodDays: 7 }),
                          newHirePeriodDays: v,
                        },
                      },
                    }))
                  }
                />
              ) : null
            }
          />
          <RuleRow
            title="운행 후 최소 휴식 시간"
            desc="여객법 시행규칙 제44조의2 — 시외/고속/광역급행 권장 8시간."
            checked={policy.constitutional?.minRestBetweenShifts?.enabled ?? false}
            onChange={(v) =>
              update((p) => ({
                ...p,
                constitutional: {
                  ...(p.constitutional ?? {}),
                  minRestBetweenShifts: {
                    enabled: v,
                    minHours: p.constitutional?.minRestBetweenShifts?.minHours ?? 8,
                  },
                },
              }))
            }
            extra={
              policy.constitutional?.minRestBetweenShifts?.enabled ? (
                <InlineNumber
                  label="최소 시간"
                  value={policy.constitutional.minRestBetweenShifts.minHours ?? 8}
                  min={1}
                  max={24}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      constitutional: {
                        ...(p.constitutional ?? {}),
                        minRestBetweenShifts: {
                          ...(p.constitutional?.minRestBetweenShifts ?? { enabled: false, minHours: 8 }),
                          minHours: v,
                        },
                      },
                    }))
                  }
                />
              ) : null
            }
          />
          <RuleRow
            title="사고 이력 노선 재배치 금지"
            desc="사고가 난 노선에 같은 기사 재투입 금지 (블랙리스트 룰)."
            checked={policy.constitutional?.noBlockedRoute?.enabled ?? true}
            onChange={(v) =>
              update((p) => ({
                ...p,
                constitutional: {
                  ...(p.constitutional ?? {}),
                  noBlockedRoute: { enabled: v },
                },
              }))
            }
          />
        </div>
      </Section>
    </div>
  );
}

/* ────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────── */

const selectCls =
  'w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/**
 * 월 근무일 가이드 — 시각적 띠 + 두 개의 stepper
 *
 * 구조:
 *  - "이상적인 근무일": idealMin~idealMax — AI 가 우선 맞추려 시도
 *  - "최소/최대 근무일": allowMin~allowMax — 절대 벗어나지 않게 보장
 *  - 화면엔 "위반/페널티" 같은 단어를 노출하지 않음
 */
function WorkdayBandSlider({
  idealMin,
  idealMax,
  allowMin,
  allowMax,
  onChange,
}: {
  idealMin: number;
  idealMax: number;
  allowMin: number;
  allowMax: number;
  onChange: (next: { idealMin: number; idealMax: number; allowMin: number; allowMax: number }) => void;
}) {
  const TOTAL = 31; // 시각화는 1~31 일 가정
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - 1) / (TOTAL - 1)) * 100))}%`;

  // 검증 + 정렬: allowMin ≤ idealMin ≤ idealMax ≤ allowMax
  const apply = (next: { idealMin: number; idealMax: number; allowMin: number; allowMax: number }) => {
    const clamp = (v: number) => Math.max(0, Math.min(31, v));
    let { idealMin: iMin, idealMax: iMax, allowMin: aMin, allowMax: aMax } = next;
    iMin = clamp(iMin);
    iMax = clamp(iMax);
    aMin = clamp(aMin);
    aMax = clamp(aMax);
    if (iMin > iMax) iMin = iMax;
    if (aMin > iMin) aMin = iMin;
    if (aMax < iMax) aMax = iMax;
    onChange({ idealMin: iMin, idealMax: iMax, allowMin: aMin, allowMax: aMax });
  };

  return (
    <div className="space-y-6">
      {/* 시각적 띠 */}
      <div className="relative h-14 select-none">
        {/* 회색 배경 = 0~31 일 */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-3 rounded-full bg-gray-100 dark:bg-white/5" />
        {/* 노란 띠 = 최소/최대 범위 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-amber-200 dark:bg-amber-400/30"
          style={{ left: pct(allowMin), width: `calc(${pct(allowMax)} - ${pct(allowMin)})` }}
        />
        {/* 파란 띠 = 이상적 범위 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-blue-500 dark:bg-blue-400"
          style={{ left: pct(idealMin), width: `calc(${pct(idealMax)} - ${pct(idealMin)})` }}
        />
        {/* 라벨들 */}
        <div className="absolute -top-1 text-[12px] font-medium text-gray-500 dark:text-gray-400" style={{ left: pct(allowMin), transform: 'translateX(-50%)' }}>
          {allowMin}일
        </div>
        <div className="absolute -top-1 text-[12px] font-medium text-blue-600 dark:text-blue-400" style={{ left: pct(idealMin), transform: 'translateX(-50%)' }}>
          {idealMin}일
        </div>
        <div className="absolute -top-1 text-[12px] font-medium text-blue-600 dark:text-blue-400" style={{ left: pct(idealMax), transform: 'translateX(-50%)' }}>
          {idealMax}일
        </div>
        <div className="absolute -top-1 text-[12px] font-medium text-gray-500 dark:text-gray-400" style={{ left: pct(allowMax), transform: 'translateX(-50%)' }}>
          {allowMax}일
        </div>
        {/* 0/31 끝점 */}
        <div className="absolute -bottom-1 left-0 text-[11px] text-gray-400">0일</div>
        <div className="absolute -bottom-1 right-0 text-[11px] text-gray-400">31일</div>
      </div>

      {/* 두 줄의 stepper */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BandRow
          color="blue"
          title="이상적인 근무일"
          desc="대부분의 기사가 이 범위 안에서 일하도록 우선 배정합니다."
          minValue={idealMin}
          maxValue={idealMax}
          minLimit={1}
          maxLimit={31}
          onChange={(min, max) => apply({ idealMin: min, idealMax: max, allowMin, allowMax })}
        />
        <BandRow
          color="amber"
          title="최소/최대 근무일"
          desc="이 밖으로는 절대 나가지 않도록 자동으로 조정합니다."
          minValue={allowMin}
          maxValue={allowMax}
          minLimit={0}
          maxLimit={31}
          onChange={(min, max) => apply({ idealMin, idealMax, allowMin: min, allowMax: max })}
        />
      </div>

      {/* 도움말 */}
      <div className="text-[13px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-white/[0.02] rounded-xl p-3 leading-relaxed">
        <span className="text-blue-600 dark:text-blue-400 font-medium">이상적인 근무일</span> 안에 못 들어가도 배차표는 만들어지지만 AI가 "더 균등하게 맞춰볼 수 있나" 한 번 더 시도합니다.
        <br />
        <span className="text-amber-600 dark:text-amber-400 font-medium">최소/최대 근무일</span>은 절대 깨지지 않는 한계입니다 — 이 밖으로 나가는 기사는 자동으로 다른 기사와 자리를 바꿔 조정됩니다.
      </div>
    </div>
  );
}

function BandRow({
  color,
  title,
  desc,
  minValue,
  maxValue,
  minLimit,
  maxLimit,
  onChange,
}: {
  color: 'blue' | 'amber';
  title: string;
  desc: string;
  minValue: number;
  maxValue: number;
  minLimit: number;
  maxLimit: number;
  onChange: (min: number, max: number) => void;
}) {
  const dotCls = color === 'blue' ? 'bg-blue-500' : 'bg-amber-400';
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotCls}`} />
        <span className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">{title}</span>
      </div>
      <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3">{desc}</p>
      <div className="flex items-center gap-2">
        <Stepper value={minValue} min={minLimit} max={maxValue} onChange={(v) => onChange(v, maxValue)} />
        <span className="text-gray-400">~</span>
        <Stepper value={maxValue} min={minValue} max={maxLimit} onChange={(v) => onChange(minValue, v)} />
        <span className="text-[14px] text-gray-500 dark:text-gray-400 ml-1">일</span>
      </div>
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center border border-gray-300 dark:border-white/10 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="px-2.5 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-30"
        disabled={value <= min}
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="w-12 text-center text-[15px] font-semibold bg-transparent text-gray-900 dark:text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="px-2.5 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-30"
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}

function Section({
  title,
  desc,
  children,
  icon,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
      <div className="mb-5">
        <h2 className="text-[18px] font-bold text-gray-900 dark:text-white flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {desc && <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-200 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[13px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className={selectCls}
    />
  );
}

function InlineNumber({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2 ml-auto pl-4">
      <span className="text-[13px] text-gray-500 dark:text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="w-16 text-center bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg px-2 py-1 text-[14px]"
      />
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      aria-checked={checked}
      role="switch"
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function RuleRow({
  title,
  desc,
  checked,
  onChange,
  locked,
  extra,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border ${
      locked
        ? 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02]'
        : 'border-gray-200 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-500/40 bg-white dark:bg-transparent'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-medium text-gray-900 dark:text-gray-100">{title}</span>
          {locked && (
            <span className="inline-flex items-center gap-1 text-[12px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
              <Lock className="w-3 h-3" /> 법적 강제
            </span>
          )}
        </div>
        {desc && <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>}
      </div>
      <div className="flex items-center gap-2 pt-0.5 shrink-0">
        {extra}
        <Toggle checked={checked} onChange={onChange} disabled={locked} />
      </div>
    </div>
  );
}

function PresetCard({ active, title, tags, onClick }: { active: boolean; title: string; tags: string[]; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition ${
        active
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-2 ring-blue-500/20'
          : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[16px] font-semibold ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>{title}</span>
        {active && <span className="text-[12px] bg-blue-600 text-white px-2 py-0.5 rounded-full">선택됨</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="text-[12px] bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded-full">
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}
