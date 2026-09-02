import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarCheck, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { companyPolicyApi } from '../services/api';

/**
 * "올해 빨간날이 언제인지" 를 해마다 한 번 확인하는 화면.
 *
 * 법정공휴일 목록은 시스템이 계산하지만, 그날 버스를 줄이느냐는 회사가 정한다.
 * 그래서 날짜마다 "왜 빨간날인지" 를 붙여 보여주고 체크로 고르게 한다.
 * 선거일·지역 행사처럼 그 해에만 있는 날은 직접 추가한다.
 */

type HolidayKind = 'FIXED' | 'LUNAR' | 'SUBSTITUTE' | 'PAID_LEAVE';

interface HolidayItem {
  date: string;
  name: string;
  kind: HolidayKind;
  reason: string;
  weekday: string;
  applied: boolean;
  source: 'CATALOG' | 'CUSTOM';
}

interface HolidayReview {
  year: number;
  confirmed: boolean;
  confirmedAt: string | null;
  hasLunarData: boolean;
  items: HolidayItem[];
  appliedCount: number;
}

const KIND_LABEL: Record<HolidayKind, string | null> = {
  FIXED: null,
  LUNAR: '음력',
  // 이름이 이미 "삼일절 대체공휴일" 이라 배지는 짧게 — 길면 카드 안에서 줄바꿈이 난다.
  SUBSTITUTE: '대체',
  PAID_LEAVE: '법정공휴일 아님',
};

const KIND_STYLE: Record<HolidayKind, string> = {
  FIXED: '',
  LUNAR: 'bg-violet-50 text-violet-700',
  SUBSTITUTE: 'bg-amber-50 text-amber-800',
  PAID_LEAVE: 'bg-gray-100 text-gray-600',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function HolidayReviewPanel() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(() => new Date().getFullYear());
  /** 체크된 날짜 — 서버 응답을 불러온 뒤 로컬에서 만진다 */
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<{ date: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addName, setAddName] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['company-holidays', year],
    queryFn: async () => (await companyPolicyApi.getHolidays(year)).data.data as HolidayReview,
  });

  useEffect(() => {
    if (!data) return;
    setApplied(new Set(data.items.filter(i => i.applied).map(i => i.date)));
    setExtra(data.items.filter(i => i.source === 'CUSTOM').map(i => ({ date: i.date, name: i.name })));
    setDirty(false);
  }, [data]);

  /** 서버가 준 카탈로그 + 아직 저장 전인 추가분을 합친 표시용 목록 */
  const items = useMemo<HolidayItem[]>(() => {
    const base = data?.items ?? [];
    const known = new Set(base.map(i => i.date));
    const pending = extra
      .filter(e => !known.has(e.date))
      .map<HolidayItem>(e => ({
        date: e.date,
        name: e.name,
        kind: 'FIXED',
        reason: '회사가 직접 추가한 날',
        weekday: weekdayOf(e.date),
        applied: true,
        source: 'CUSTOM',
      }));
    return [...base, ...pending].sort((a, b) => a.date.localeCompare(b.date));
  }, [data, extra]);

  /** 월별로 묶는다 — 연휴가 한 줄에 붙어 보이도록 */
  const byMonth = useMemo(() => {
    const groups = new Map<number, HolidayItem[]>();
    for (const item of items) {
      const m = Number(item.date.slice(5, 7));
      const list = groups.get(m);
      if (list) list.push(item);
      else groups.set(m, [item]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [items]);

  const allChecked = items.length > 0 && items.every(i => applied.has(i.date));

  const toggle = (date: string) => {
    setApplied(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    setDirty(true);
  };

  const setAll = (on: boolean) => {
    setApplied(on ? new Set(items.map(i => i.date)) : new Set());
    setDirty(true);
  };

  const addCustom = () => {
    const date = addDate.trim();
    if (!ISO_DATE.test(date)) {
      toast.error('날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
      return;
    }
    if (!date.startsWith(`${year}-`)) {
      toast.error(`${year}년 날짜만 추가할 수 있습니다.`);
      return;
    }
    if (items.some(i => i.date === date)) {
      toast.error('이미 목록에 있는 날짜입니다.');
      return;
    }
    setExtra(prev => [...prev, { date, name: addName.trim() || '회사 지정 휴일' }]);
    setApplied(prev => new Set(prev).add(date));
    setAddDate('');
    setAddName('');
    setDirty(true);
  };

  const removeCustom = (date: string) => {
    setExtra(prev => prev.filter(e => e.date !== date));
    setApplied(prev => {
      const next = new Set(prev);
      next.delete(date);
      return next;
    });
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () =>
      companyPolicyApi.saveHolidays(year, { applied: [...applied], extra }),
    onSuccess: res => {
      toast.success(res.data?.message ?? '공휴일을 저장했습니다.');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['company-holidays', year] });
    },
    onError: (err: unknown) =>
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          '저장에 실패했습니다.',
      ),
  });

  const applyAll = () => {
    setApplied(new Set(items.map(i => i.date)));
    setDirty(true);
    // 사용자가 "예, 다 적용" 을 누른 것 자체가 확정 의사다 — 곧바로 저장한다.
    setTimeout(() => saveMutation.mutate(), 0);
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-white p-5"> 
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">공휴일 (감차 적용일)</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            빨간날에는 운행 대수를 휴일 기준으로 줄입니다. 회사에서 정상 운행하는 날은 체크를 풀어주세요.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1">
          <button
            type="button"
            onClick={() => setYear(y => y - 1)}
            aria-label="이전 연도"
            className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[64px] text-center text-sm font-semibold tabular-nums text-gray-900">
            {year}년
          </span>
          <button
            type="button"
            onClick={() => setYear(y => y + 1)}
            aria-label="다음 연도"
            className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {isLoading && <p className="mt-4 text-sm text-gray-500">공휴일을 불러오는 중…</p>}
      {isError && (
        <p className="mt-4 text-sm text-red-600">공휴일을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      )}

      {data && (
        <>
          {/* 확인 요청 — 아직 확정하지 않은 해 */}
          {!data.confirmed && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-900">
                {year}년 빨간날 {items.length}일을 찾았습니다. 다 적용할까요?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-blue-800">
                아래 목록이 {year}년 법정공휴일과 대체공휴일 전부입니다. 그대로 적용하거나, 하나씩 확인하고 확정하세요.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={applyAll}
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  예, 다 적용
                </button>
                <button
                  type="button"
                  onClick={() => setDirty(true)}
                  className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  아니요, 하나씩 고르겠습니다
                </button>
              </div>
            </div>
          )}

          {data.confirmed && !dirty && (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-emerald-700">
              <CalendarCheck size={14} />
              {year}년 공휴일 {applied.size}일 적용 중 · {formatConfirmedAt(data.confirmedAt)} 확인
            </p>
          )}

          {!data.hasLunarData && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {year}년은 설날·추석 날짜 자료가 아직 없습니다. 음력 공휴일은 직접 추가해주세요.
            </p>
          )}

          {/* 전체 선택 */}
          <div className="mt-4 flex items-center justify-between border-b border-gray-200 pb-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={e => setAll(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              전체 선택
            </label>
            <span className="text-xs tabular-nums text-gray-500">
              {applied.size} / {items.length}일 적용
            </span>
          </div>

          {/* 목록 — 월별 가로 배치. 세로로 20줄을 쌓으면 화면을 다 먹고,
              연휴가 며칠짜리인지도 눈에 안 들어온다. */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {byMonth.map(([month, monthItems]) => (
              <div key={month} className="flex gap-3">
                <div className="w-9 shrink-0 pt-2.5 text-xs font-semibold tabular-nums text-gray-400">
                  {month}월
                </div>
                <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {monthItems.map(item => {
                    const label = KIND_LABEL[item.kind];
                    const checked = applied.has(item.date);
                    const inputId = `holiday-${item.date}`;
                    return (
                      <div
                        key={item.date}
                        className={`relative rounded-lg border p-2.5 transition ${
                          checked
                            ? 'border-gray-200 bg-white'
                            : 'border-dashed border-gray-200 bg-gray-50'
                        }`}
                      >
                        <label htmlFor={inputId} className="flex cursor-pointer gap-2">
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(item.date)}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-1.5">
                              <span className="text-sm font-semibold tabular-nums text-gray-900">
                                {item.date.slice(5).replace('-', '/')}
                              </span>
                              <span
                                className={`text-xs ${
                                  item.weekday === '일'
                                    ? 'text-red-500'
                                    : item.weekday === '토'
                                      ? 'text-blue-500'
                                      : 'text-gray-400'
                                }`}
                              >
                                {item.weekday}
                              </span>
                              <span
                                className={`text-sm ${
                                  checked ? 'text-gray-900' : 'text-gray-400 line-through'
                                }`}
                              >
                                {item.name}
                              </span>
                              {label && (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_STYLE[item.kind]}`}
                                >
                                  {label}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-gray-500">
                              {item.reason}
                            </span>
                          </span>
                        </label>
                        {item.source === 'CUSTOM' && (
                          <button
                            type="button"
                            onClick={() => removeCustom(item.date)}
                            aria-label={`${item.name} 삭제`}
                            className="absolute right-1 top-1 rounded p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 직접 추가 — 선거일·지역 행사 등 그 해에만 있는 날 */}
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-700">직접 추가</p>
            <p className="mt-0.5 text-xs text-gray-500">
              선거일이나 지역 행사처럼 그 해에만 감차하는 날을 넣습니다.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor="holiday-add-date" className="sr-only">
                추가할 날짜
              </label>
              <input
                id="holiday-add-date"
                type="date"
                value={addDate}
                onChange={e => setAddDate(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <label htmlFor="holiday-add-name" className="sr-only">
                이름
              </label>
              <input
                id="holiday-add-name"
                type="text"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="이름 (예: 지방선거일)"
                className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={addCustom}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
              >
                <Plus size={14} />
                추가
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            {dirty && <span className="text-xs text-amber-700">저장하지 않은 변경이 있습니다</span>}
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {saveMutation.isPending ? '저장 중…' : data.confirmed ? '변경 저장' : '이대로 확정'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
}

function formatConfirmedAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
