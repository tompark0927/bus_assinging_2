import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Trash2, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { safetyApi, usersApi } from '../services/api';
import PageHeader from '../components/PageHeader';
import { laborHelp } from '../help/helpContent';

/**
 * 노무 관리 — 회사가 쓰던 장부를 그대로 옮긴 표.
 *
 * 담당자는 이미 엑셀로 '가해현황/피해현황'과 기사별 '근태현황'을 관리해 왔다.
 * 그래서 이 화면은 새 워크플로를 가르치지 않는다 — 칸만 나눠 놓고 그 자리에
 * 그대로 적게 한다. 폼 모달을 띄우지 않는 이유도 같다: 장부는 한 줄씩 채우는
 * 물건이지 한 건씩 등록하는 물건이 아니다.
 *
 * 셀에서 포커스가 빠질 때 그 칸만 저장한다(부분 수정). 저장 버튼을 따로 두면
 * 담당자가 누르는 것을 잊고, 잊은 줄은 사라진 것처럼 보인다.
 */

type Tab = 'AT_FAULT' | 'VICTIM' | 'NOTE';

const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'AT_FAULT', label: '가해 사고', desc: '우리 차가 가해자인 사고' },
  { key: 'VICTIM', label: '피해 사고', desc: '우리 차가 피해자인 사고' },
  { key: 'NOTE', label: '지적사항·민원', desc: '과태료·민원 등 사고 외 기록' },
];

interface Driver { id: number; name: string; employeeId: string; isActive: boolean }

interface Incident {
  id: number;
  driverId: number;
  driver?: { id: number; name: string; employeeId: string };
  date: string;
  type: string;
  description: string;
  notes: string | null;
  penalty: number | null;
  faultType: 'AT_FAULT' | 'VICTIM' | null;
  caseNumber: string | null;
  vehicleNumber: string | null;
  location: string | null;
  propertySelf: number | null;
  propertyOther: number | null;
  injurySelf: number | null;
  injuryOther: number | null;
  insurer: string | null;
  insuranceNote: string | null;
  discipline: string | null;
  compensation: number | null;
}

/** 표의 한 칸 정의 — 장부의 칸 이름을 그대로 쓴다 */
interface Col {
  key: keyof Incident | 'driverId';
  label: string;
  width: string;
  kind?: 'date' | 'number' | 'money' | 'driver';
  /** 두 줄 헤더의 묶음 이름 (사고 구분) */
  group?: string;
}

const ACCIDENT_COLS: Col[] = [
  { key: 'date', label: '날짜', width: 'min-w-[7.5rem]', kind: 'date' },
  { key: 'caseNumber', label: '사건번호', width: 'min-w-[11rem]' },
  { key: 'vehicleNumber', label: '차량번호', width: 'min-w-[5.5rem]' },
  { key: 'driverId', label: '운전자', width: 'min-w-[7rem]', kind: 'driver' },
  { key: 'location', label: '장소', width: 'min-w-[13rem]' },
  { key: 'description', label: '내용', width: 'min-w-[24rem]' },
  { key: 'propertySelf', label: '자차', width: 'min-w-[3.5rem]', kind: 'number', group: '대물' },
  { key: 'propertyOther', label: '타차', width: 'min-w-[3.5rem]', kind: 'number', group: '대물' },
  { key: 'injurySelf', label: '자차', width: 'min-w-[3.5rem]', kind: 'number', group: '대인' },
  { key: 'injuryOther', label: '타차', width: 'min-w-[3.5rem]', kind: 'number', group: '대인' },
  { key: 'insuranceNote', label: '보험접수', width: 'min-w-[10rem]' },
  { key: 'discipline', label: '징계여부', width: 'min-w-[8rem]' },
  { key: 'insurer', label: '보험사', width: 'min-w-[8rem]' },
  { key: 'compensation', label: '보상금액', width: 'min-w-[8rem]', kind: 'money' },
  { key: 'notes', label: '비고', width: 'min-w-[8rem]' },
];

const NOTE_COLS: Col[] = [
  { key: 'date', label: '년월일', width: 'min-w-[7.5rem]', kind: 'date' },
  { key: 'vehicleNumber', label: '차량번호', width: 'min-w-[5.5rem]' },
  { key: 'driverId', label: '운전자', width: 'min-w-[7rem]', kind: 'driver' },
  { key: 'description', label: '지적사항', width: 'min-w-[26rem]' },
  { key: 'penalty', label: '과태료', width: 'min-w-[8rem]', kind: 'money' },
  { key: 'notes', label: '비고', width: 'min-w-[10rem]' },
];

const won = (n: number | null) => (n == null ? '' : n.toLocaleString('ko-KR'));

export default function LaborPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('AT_FAULT');
  const [year, setYear] = useState(new Date().getFullYear());
  const [q, setQ] = useState('');

  const cols = tab === 'NOTE' ? NOTE_COLS : ACCIDENT_COLS;

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ['users', 'DRIVER', 'labor'],
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

  const listKey = ['incidents', tab, year] as const;
  const { data: rows = [], isLoading } = useQuery<Incident[]>({
    queryKey: listKey,
    queryFn: async () => {
      const r = await safetyApi.getIncidents({
        faultType: tab === 'NOTE' ? 'NONE' : tab,
        year: String(year),
        limit: '500',
      });
      return r.data.data as Incident[];
    },
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      (r.driver?.name || '').toLowerCase().includes(t) ||
      (r.vehicleNumber || '').includes(t) ||
      (r.caseNumber || '').toLowerCase().includes(t) ||
      (r.location || '').toLowerCase().includes(t) ||
      (r.description || '').toLowerCase().includes(t),
    );
  }, [rows, q]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['incidents'] });

  const addRow = useMutation({
    mutationFn: () => {
      if (drivers.length === 0) throw new Error('먼저 기초 데이터에서 기사를 등록해주세요.');
      return safetyApi.createIncident({
        driverId: drivers[0].id,
        // 새 행은 오늘 날짜로 시작 — 담당자가 바로 고쳐 쓴다
        date: new Date().toISOString().slice(0, 10),
        type: tab === 'NOTE' ? 'TRAFFIC_VIOLATION' : 'ACCIDENT',
        description: '',
        ...(tab === 'NOTE' ? {} : { faultType: tab }),
      });
    },
    onSuccess: () => { invalidate(); },
    onError: (e) => toast.error(extractError(e)),
  });

  const saveCell = useMutation({
    mutationFn: ({ id, field, value }: { id: number; field: string; value: string }) =>
      safetyApi.updateIncident(id, { [field]: value }),
    onSuccess: () => { invalidate(); },
    onError: (e) => toast.error(extractError(e)),
  });

  const removeRow = useMutation({
    mutationFn: (id: number) => safetyApi.deleteIncident(id),
    onSuccess: () => { invalidate(); toast.success('삭제되었습니다.'); },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardList}
        title="노무 관리"
        help={laborHelp}
        description="사고·지적사항 장부. 칸에 바로 입력하면 저장됩니다."
        actions={
          <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <button onClick={() => setYear((y) => y - 1)} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-l-xl" aria-label="이전 해">
              <ChevronLeft size={20} />
            </button>
            <span className="px-5 py-3 text-lg font-semibold text-gray-800 dark:text-gray-200 min-w-[110px] text-center">{year}년</span>
            <button onClick={() => setYear((y) => y + 1)} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-r-xl" aria-label="다음 해">
              <ChevronRight size={20} />
            </button>
          </div>
        }
      />

      {/* 장부 구분 — 회사가 쓰던 파일 단위와 같게 */}
      <div className="border-b border-gray-200 dark:border-white/10">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.desc}
              className={`px-4 py-3 border-b-2 text-[15px] font-medium transition ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="기사·차량번호·사건번호·장소 검색"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <span className="text-[14px] text-gray-500 dark:text-gray-400">{filtered.length}건</span>
        <button
          onClick={() => addRow.mutate()}
          disabled={addRow.isPending}
          className="ml-auto px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-2 text-[15px] font-medium disabled:opacity-60"
        >
          {addRow.isPending ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />}
          행 추가
        </button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
          <table className="text-[14px] border-collapse">
            <thead className="bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-300">
              <HeaderRows cols={cols} />
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 1} className="py-14 text-center text-gray-400">
                    {year}년 기록이 없습니다. ‘행 추가’로 시작하세요.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 dark:border-white/10 hover:bg-blue-50/30 dark:hover:bg-white/[0.03]">
                    {cols.map((c) => (
                      <Cell
                        key={String(c.key)}
                        col={c}
                        row={row}
                        drivers={drivers}
                        onSave={(field, value) => saveCell.mutate({ id: row.id, field, value })}
                      />
                    ))}
                    <td className="px-2 border border-gray-200 dark:border-white/10 text-center">
                      <button
                        title="행 삭제"
                        onClick={() => { if (confirm('이 줄을 삭제하시겠어요?')) removeRow.mutate(row.id); }}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[13px] text-gray-500 dark:text-gray-400">
        칸을 클릭해 입력한 뒤 다른 곳을 누르면 저장됩니다. 기사 이름은 기초 데이터에 등록된
        기사에서 고르며, <b className="text-gray-700 dark:text-gray-200">기초 데이터 &gt; 기사</b>에서
        이름을 누르면 그 기사의 사고·민원 이력을 볼 수 있습니다.
      </p>
    </div>
  );
}

/** 사고 표는 '사고 구분(대물/대인)'이 두 줄 헤더라 별도로 그린다 */
function HeaderRows({ cols }: { cols: Col[] }) {
  const grouped = cols.some((c) => c.group);
  if (!grouped) {
    return (
      <tr>
        {cols.map((c) => <Th key={String(c.key)} className={c.width}>{c.label}</Th>)}
        <Th className="min-w-[3rem]">　</Th>
      </tr>
    );
  }
  // 묶음(대물/대인)은 위 칸에서 합쳐 표시
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (!c.group) {
      cells.push(<Th key={String(c.key)} className={c.width} rowSpan={2}>{c.label}</Th>);
      continue;
    }
    const span = cols.filter((x) => x.group === c.group).length;
    if (cols.findIndex((x) => x.group === c.group) === i) {
      cells.push(<Th key={`g-${c.group}`} colSpan={span}>{c.group}</Th>);
    }
  }
  return (
    <>
      <tr>
        {cells}
        <Th className="min-w-[3rem]" rowSpan={2}>　</Th>
      </tr>
      <tr>
        {cols.filter((c) => c.group).map((c) => (
          <Th key={`s-${String(c.key)}`} className={c.width}>{c.label}</Th>
        ))}
      </tr>
    </>
  );
}

function Th({ children, className, colSpan, rowSpan }: {
  children: React.ReactNode; className?: string; colSpan?: number; rowSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={`px-2 py-2 text-[13px] font-semibold border border-gray-200 dark:border-white/10 whitespace-nowrap ${className || ''}`}
    >
      {children}
    </th>
  );
}

/**
 * 한 칸. 표시할 때는 텍스트, 클릭하면 입력칸.
 * 값이 안 바뀌었으면 저장 요청을 보내지 않는다 — 표를 훑기만 해도 저장이
 * 줄줄이 나가면 감사 로그가 쓰레기로 찬다.
 */
function Cell({ col, row, drivers, onSave }: {
  col: Col;
  row: Incident;
  drivers: Driver[];
  onSave: (field: string, value: string) => void;
}) {
  const raw = col.key === 'driverId' ? String(row.driverId) : (row[col.key as keyof Incident] ?? '');
  const initial = col.kind === 'date' ? String(raw).slice(0, 10) : String(raw ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);

  const commit = () => {
    setEditing(false);
    if (draft === initial) return;
    onSave(String(col.key), draft);
  };

  const display = () => {
    if (col.kind === 'driver') return row.driver?.name ?? '-';
    if (col.kind === 'money') return won(raw === '' ? null : Number(raw));
    if (col.kind === 'date') return initial;
    return String(raw ?? '');
  };

  const cls = `px-2 py-1.5 border border-gray-200 dark:border-white/10 align-top ${col.width}`;

  if (!editing) {
    return (
      <td className={cls} onClick={() => { setDraft(initial); setEditing(true); }}>
        <div className={`min-h-[24px] cursor-text ${col.kind === 'number' || col.kind === 'money' ? 'text-right' : ''} ${
          col.key === 'description' || col.key === 'location' ? 'whitespace-pre-wrap break-words' : 'truncate'
        }`}>
          {display() || <span className="text-gray-300 dark:text-gray-600">-</span>}
        </div>
      </td>
    );
  }

  return (
    <td className={cls}>
      {col.kind === 'driver' ? (
        <select
          autoFocus
          className="w-full bg-white dark:bg-gray-800 border border-blue-400 rounded px-1 py-0.5"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        >
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.name} ({d.employeeId})</option>
          ))}
        </select>
      ) : (
        <input
          autoFocus
          type={col.kind === 'date' ? 'date' : 'text'}
          inputMode={col.kind === 'number' || col.kind === 'money' ? 'numeric' : undefined}
          className={`w-full bg-white dark:bg-gray-800 border border-blue-400 rounded px-1 py-0.5 ${
            col.kind === 'number' || col.kind === 'money' ? 'text-right' : ''
          }`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // 한글 입력 중의 Enter 는 IME 조합을 확정하는 키다. 이걸 저장으로
            // 받으면 "정식징계" 까지만 치고 Enter 를 누른 순간 칸이 닫혀,
            // 담당자는 글자가 잘린 채 저장된 걸 나중에야 발견한다.
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            // Esc 는 되돌리고 나간다 — 잘못 눌러 덮어쓰는 사고를 막는다
            if (e.key === 'Escape') { setDraft(initial); setEditing(false); }
          }}
        />
      )}
    </td>
  );
}

function extractError(e: unknown): string {
  const r = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return r || (e as Error)?.message || '오류가 발생했습니다.';
}
