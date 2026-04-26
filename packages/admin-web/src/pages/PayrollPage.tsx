import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Calculator, CheckCircle, Download,
  Loader2, Upload, Sparkles, Plus, Trash2, Save, X, Settings,
  FileText, ListOrdered, Users, AlertCircle, Search,
  ToggleLeft, ToggleRight, DollarSign,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { payrollApi } from '../services/api';

// ─────────────────────────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────────────────────────

/** 원화 포맷: 1234567 → "₩1,234,567" */
const formatWon = (n: number | null | undefined): string => {
  if (n == null) return '-';
  return '₩' + n.toLocaleString('ko-KR');
};

/** 숫자+원 포맷: 1234567 → "1,234,567원" */
const formatKrw = (n: number | null | undefined): string => {
  if (n == null) return '-';
  return n.toLocaleString('ko-KR') + '원';
};

/** 퍼센트 포맷: 3.545 → "3.545%" */
const formatPct = (n: number): string => `${n}%`;

/** input 숫자값을 안전하게 파싱 */
const safeNum = (v: string): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

// ─────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────

type TabKey = 'records' | 'settings' | 'hoboong' | 'union';

interface PayrollRow {
  id: number;
  workDays: number;
  hoboong: number | null;
  baseSalary: number;
  overtimePay: number;
  nightShiftPay: number;
  holidayPay: number;
  grossPay: number;
  deductions: number;
  unionDues: number;
  netPay: number;
  isConfirmed: boolean;
  note: string | null;
  driver: {
    name: string;
    employeeId: string;
    driverType: string;
    hoboong: number | null;
  };
}

interface PayrollTotal {
  grossPay: number;
  deductions: number;
  unionDues: number;
  netPay: number;
}

interface PayrollSettings {
  baseSalary: number;
  overtimeRate: number;
  nightShiftBonus: number;
  holidayRate: number;
  nationalPensionRate: number;
  healthInsuranceRate: number;
  employmentInsRate: number;
}

interface HoboongRow {
  level: number;
  baseSalary: number;
}

interface UnionDueRow {
  id?: number;
  name: string;
  type: string;
  amount: number;
  isActive: boolean;
}

const TAB_CONFIG: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: 'records', label: '급여 명세서', icon: FileText },
  { key: 'settings', label: '급여 설정', icon: Settings },
  { key: 'hoboong', label: '호봉표', icon: ListOrdered },
  { key: 'union', label: '조합비', icon: Users },
];

// ─────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<TabKey>('records');

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* 페이지 헤더 */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-gray-900">급여 관리</h1>
          <p className="text-gray-500 text-base mt-1">
            호봉 기반 급여 계산, 4대보험 공제, 조합비 관리
          </p>
        </div>

        {/* 월 네비게이션 (급여 명세서 탭에서만) */}
        {tab === 'records' && (
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-2 py-1.5 shadow-sm">
            <button
              onClick={prevMonth}
              className="p-2.5 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="이전 월"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-base font-semibold px-4 min-w-[140px] text-center text-gray-800">
              {year}년 {month}월
            </span>
            <button
              onClick={nextMonth}
              className="p-2.5 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="다음 월"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex bg-gray-100 rounded-xl p-1.5 gap-1">
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-5 py-3 rounded-lg text-base font-medium transition-all flex-1 justify-center ${
              tab === key
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {tab === 'records' && (
        <RecordsTab year={year} month={month} />
      )}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'hoboong' && <HoboongTab />}
      {tab === 'union' && <UnionDuesTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 급여 명세서 탭
// ─────────────────────────────────────────────────────────────────

function RecordsTab({ year, month }: { year: number; month: number }) {
  const qc = useQueryClient();
  const [editRow, setEditRow] = useState<PayrollRow | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // 급여 데이터 조회
  const { data: recordData, isLoading, isError } = useQuery({
    queryKey: ['payroll-records', year, month],
    queryFn: () => payrollApi.getRecords(year, month).then(r => r.data.data),
  });

  const typed = recordData as { records: PayrollRow[]; total: PayrollTotal } | undefined;
  const allRecords = typed?.records ?? [];
  const total: PayrollTotal = typed?.total ?? { grossPay: 0, deductions: 0, unionDues: 0, netPay: 0 };
  const allConfirmed = allRecords.length > 0 && allRecords.every(r => r.isConfirmed);

  // 검색 필터
  const filteredRecords = allRecords.filter(r => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.driver.name.toLowerCase().includes(term) ||
      r.driver.employeeId.toLowerCase().includes(term)
    );
  });

  // 급여 계산 뮤테이션
  const calculateMut = useMutation({
    mutationFn: () => payrollApi.calculate(year, month),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-records'] });
      toast.success(`${year}년 ${month}월 급여 계산이 완료되었습니다.`);
    },
    onError: () => toast.error('급여 계산 중 오류가 발생했습니다.'),
  });

  // 급여 확정 뮤테이션
  const confirmMut = useMutation({
    mutationFn: () => payrollApi.confirm(year, month),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-records'] });
      toast.success('급여가 확정되었습니다. 기사들에게 알림이 발송됩니다.');
    },
    onError: () => toast.error('급여 확정 중 오류가 발생했습니다.'),
  });

  // 엑셀 내보내기
  const handleExport = async () => {
    try {
      toast.loading('급여대장을 생성하고 있습니다...', { id: 'payroll-export' });
      const res = await payrollApi.getRecords(year, month);
      // 간단한 CSV 다운로드 (백엔드 엑셀 엔드포인트가 있으면 교체)
      const records = (res.data.data as { records: PayrollRow[] }).records;
      const BOM = '\uFEFF';
      const header = '이름,사번,호봉,근무일수,기본급,연장수당,야간수당,휴일수당,총지급액,4대보험공제,조합비공제,실수령액,상태\n';
      const rows = records.map(r =>
        [
          r.driver.name, r.driver.employeeId, r.hoboong ?? '-', r.workDays,
          r.baseSalary, r.overtimePay, r.nightShiftPay, r.holidayPay ?? 0,
          r.baseSalary + r.overtimePay + r.nightShiftPay + (r.holidayPay ?? 0),
          r.deductions, r.unionDues, r.netPay,
          r.isConfirmed ? '확정' : '미확정',
        ].join(',')
      ).join('\n');
      const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `급여대장_${year}년${month}월.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('급여대장이 다운로드되었습니다.', { id: 'payroll-export' });
    } catch {
      toast.error('내보내기 중 오류가 발생했습니다.', { id: 'payroll-export' });
    }
  };

  return (
    <div className="space-y-5">
      {/* 요약 카드 */}
      {allRecords.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={<DollarSign size={20} className="text-gray-500" />}
            label="총 지급액"
            value={formatWon(total.grossPay)}
            sub={`${allRecords.length}명`}
          />
          <SummaryCard
            icon={<AlertCircle size={20} className="text-red-500" />}
            label="4대보험 공제"
            value={formatWon(total.deductions)}
            color="text-red-600"
          />
          <SummaryCard
            icon={<Users size={20} className="text-orange-500" />}
            label="조합비 공제"
            value={formatWon(total.unionDues)}
            color="text-orange-600"
          />
          <SummaryCard
            icon={<CheckCircle size={20} className="text-blue-500" />}
            label="실지급 총액"
            value={formatWon(total.netPay)}
            color="text-blue-700"
          />
        </div>
      )}

      {/* 액션 영역 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => calculateMut.mutate()}
          disabled={calculateMut.isPending}
          className="flex items-center gap-2.5 px-6 h-12 bg-blue-600 hover:bg-blue-700
                     disabled:opacity-60 text-white rounded-xl font-medium text-base transition-colors shadow-sm"
        >
          {calculateMut.isPending
            ? <Loader2 size={20} className="animate-spin" />
            : <Calculator size={20} />}
          급여 계산
        </button>

        {allRecords.length > 0 && !allConfirmed && (
          <button
            onClick={() => {
              if (confirm(`${year}년 ${month}월 급여를 확정하시겠습니까?\n확정 후 기사에게 알림이 발송됩니다.`)) {
                confirmMut.mutate();
              }
            }}
            disabled={confirmMut.isPending}
            className="flex items-center gap-2.5 px-6 h-12 bg-green-600 hover:bg-green-700
                       disabled:opacity-60 text-white rounded-xl font-medium text-base transition-colors shadow-sm"
          >
            {confirmMut.isPending
              ? <Loader2 size={20} className="animate-spin" />
              : <CheckCircle size={20} />}
            급여 확정 및 알림 발송
          </button>
        )}

        {allConfirmed && (
          <span className="flex items-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-xl text-base font-medium">
            <CheckCircle size={18} />
            {month}월 급여 확정 완료
          </span>
        )}

        {allRecords.length > 0 && (
          <button
            onClick={handleExport}
            className="flex items-center gap-2.5 px-6 h-12 border border-gray-200 text-gray-700
                       hover:bg-gray-50 rounded-xl font-medium text-base transition-colors ml-auto"
          >
            <Download size={20} />
            급여대장 내보내기
          </button>
        )}
      </div>

      {/* 검색 */}
      {allRecords.length > 0 && (
        <div className="relative max-w-sm">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="이름 또는 사번으로 검색..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-base
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      )}

      {/* 급여 테이블 */}
      {isLoading ? (
        <LoadingState message="급여 데이터를 불러오는 중입니다..." />
      ) : isError ? (
        <ErrorState message="급여 데이터를 불러오지 못했습니다. 다시 시도해주세요." />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-4 text-sm font-semibold text-gray-600">기사 정보</th>
                  <th className="text-center px-4 py-4 text-sm font-semibold text-gray-600">사번</th>
                  <th className="text-center px-4 py-4 text-sm font-semibold text-gray-600">호봉</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600">기본급</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600">수당 합계</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600">건강보험</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600">국민연금</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600">고용보험</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600">4대보험 합계</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600">조합비</th>
                  <th className="text-right px-4 py-4 text-sm font-semibold text-gray-600 font-bold">실수령액</th>
                  <th className="text-center px-4 py-4 text-sm font-semibold text-gray-600">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecords.length === 0 && allRecords.length === 0 && (
                  <tr>
                    <td colSpan={12} className="text-center py-20">
                      <Calculator size={48} className="mx-auto mb-4 text-gray-300" />
                      <p className="text-lg text-gray-500 font-medium">급여 데이터가 없습니다</p>
                      <p className="text-base text-gray-400 mt-2">
                        위의 "급여 계산" 버튼을 클릭하여 {month}월 급여를 계산하세요.
                      </p>
                      <p className="text-sm text-gray-400 mt-1">
                        급여 설정, 호봉표, 조합비를 먼저 설정해야 합니다.
                      </p>
                    </td>
                  </tr>
                )}
                {filteredRecords.length === 0 && allRecords.length > 0 && (
                  <tr>
                    <td colSpan={12} className="text-center py-16">
                      <Search size={40} className="mx-auto mb-3 text-gray-300" />
                      <p className="text-base text-gray-500">검색 결과가 없습니다</p>
                    </td>
                  </tr>
                )}
                {filteredRecords.map(r => {
                  const overtimeTotal = r.overtimePay + r.nightShiftPay + (r.holidayPay ?? 0);
                  // 4대보험 개별 항목은 서버에서 합산해서 오므로 비율 기반 추정 표시
                  // (실제로는 서버에서 개별 값을 내려주는 것이 이상적)
                  const gross = r.baseSalary + overtimeTotal;
                  const healthIns = Math.round(gross * 0.03545);
                  const nationalPension = Math.round(gross * 0.045);
                  const employmentIns = Math.round(gross * 0.009);
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                      onClick={() => setEditRow(r)}
                      title="클릭하여 급여 상세 편집"
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-gray-900 text-base">{r.driver.name}</p>
                        <p className="text-sm text-gray-400 mt-0.5">
                          {r.driver.driverType === 'MAIN' ? '정규기사' : '예비기사'} · 근무 {r.workDays}일
                        </p>
                      </td>
                      <td className="px-4 py-4 text-center text-gray-600">{r.driver.employeeId}</td>
                      <td className="px-4 py-4 text-center">
                        {r.hoboong ? (
                          <span className="inline-block px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
                            {r.hoboong}호봉
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right text-gray-800 font-medium">{formatKrw(r.baseSalary)}</td>
                      <td className="px-4 py-4 text-right text-gray-600">
                        {overtimeTotal > 0 ? formatKrw(overtimeTotal) : '-'}
                      </td>
                      <td className="px-4 py-4 text-right text-red-500 text-sm">
                        {r.deductions > 0 ? `-${formatKrw(healthIns)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right text-red-500 text-sm">
                        {r.deductions > 0 ? `-${formatKrw(nationalPension)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right text-red-500 text-sm">
                        {r.deductions > 0 ? `-${formatKrw(employmentIns)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right text-red-600 font-medium">
                        {r.deductions > 0 ? `-${formatKrw(r.deductions)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right text-orange-600 text-sm">
                        {r.unionDues > 0 ? `-${formatKrw(r.unionDues)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-gray-900 text-base">
                        {formatKrw(r.netPay)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {r.isConfirmed ? (
                          <span className="inline-block px-3 py-1.5 text-sm text-green-700 bg-green-50 rounded-full font-medium">
                            확정
                          </span>
                        ) : (
                          <span className="inline-block px-3 py-1.5 text-sm text-yellow-700 bg-yellow-50 rounded-full font-medium">
                            미확정
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 편집 모달 */}
      {editRow && (
        <RecordEditModal
          record={editRow}
          onClose={() => setEditRow(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 급여 편집 모달
// ─────────────────────────────────────────────────────────────────

function RecordEditModal({
  record,
  onClose,
}: {
  record: PayrollRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    hoboong: record.hoboong != null ? String(record.hoboong) : '',
    baseSalary: String(record.baseSalary),
    overtimePay: String(record.overtimePay),
    nightShiftPay: String(record.nightShiftPay),
    holidayPay: String(record.holidayPay ?? 0),
    deductions: String(record.deductions),
    unionDues: String(record.unionDues),
    note: record.note ?? '',
  });

  const updateField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const updateMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => payrollApi.updateRecord(record.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-records'] });
      toast.success('급여가 수정되었습니다.');
      onClose();
    },
    onError: () => toast.error('급여 수정 중 오류가 발생했습니다.'),
  });

  const handleSave = () => {
    updateMut.mutate({
      hoboong: form.hoboong ? Number(form.hoboong) : null,
      baseSalary: safeNum(form.baseSalary),
      overtimePay: safeNum(form.overtimePay),
      nightShiftPay: safeNum(form.nightShiftPay),
      holidayPay: safeNum(form.holidayPay),
      deductions: safeNum(form.deductions),
      unionDues: safeNum(form.unionDues),
      note: form.note || undefined,
    });
  };

  // 미리보기
  const previewGross = safeNum(form.baseSalary) + safeNum(form.overtimePay) +
    safeNum(form.nightShiftPay) + safeNum(form.holidayPay);
  const previewDeductions = safeNum(form.deductions);
  const previewUnion = safeNum(form.unionDues);
  const previewNet = previewGross - previewDeductions - previewUnion;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="bg-gray-50 px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">급여 수동 편집</h3>
            <p className="text-base text-gray-500 mt-1">
              {record.driver.name} ({record.driver.employeeId})
              {' '} · {record.driver.driverType === 'MAIN' ? '정규기사' : '예비기사'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 hover:bg-gray-200 rounded-xl transition-colors"
            aria-label="닫기"
          >
            <X size={22} />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* 호봉 + 기본급 */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="호봉" suffix="">
              <input
                type="number"
                placeholder="예: 5"
                className="form-input"
                value={form.hoboong}
                onChange={updateField('hoboong')}
              />
            </FormField>
            <FormField label="기본급" suffix="원">
              <input
                type="number"
                className="form-input"
                value={form.baseSalary}
                onChange={updateField('baseSalary')}
              />
            </FormField>
          </div>

          {/* 수당 */}
          <div>
            <p className="text-sm font-semibold text-gray-500 mb-3">수당 항목</p>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="연장수당" suffix="원">
                <input
                  type="number"
                  className="form-input"
                  value={form.overtimePay}
                  onChange={updateField('overtimePay')}
                />
              </FormField>
              <FormField label="야간수당" suffix="원">
                <input
                  type="number"
                  className="form-input"
                  value={form.nightShiftPay}
                  onChange={updateField('nightShiftPay')}
                />
              </FormField>
              <FormField label="휴일수당" suffix="원">
                <input
                  type="number"
                  className="form-input"
                  value={form.holidayPay}
                  onChange={updateField('holidayPay')}
                />
              </FormField>
            </div>
          </div>

          {/* 공제 */}
          <div>
            <p className="text-sm font-semibold text-gray-500 mb-3">공제 항목</p>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="4대보험 합계" suffix="원">
                <input
                  type="number"
                  className="form-input"
                  value={form.deductions}
                  onChange={updateField('deductions')}
                />
              </FormField>
              <FormField label="조합비 합계" suffix="원">
                <input
                  type="number"
                  className="form-input"
                  value={form.unionDues}
                  onChange={updateField('unionDues')}
                />
              </FormField>
            </div>
          </div>

          {/* 메모 */}
          <FormField label="메모 (선택사항)" suffix="">
            <input
              type="text"
              placeholder="수정 사유를 입력하세요"
              className="form-input"
              value={form.note}
              onChange={updateField('note')}
            />
          </FormField>

          {/* 미리보기 */}
          <div className="bg-gray-50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-500 mb-3">미리보기</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">총 지급액</p>
                <p className="text-lg font-bold text-gray-900">{formatKrw(previewGross)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">공제 합계</p>
                <p className="text-lg font-bold text-red-600">
                  -{formatKrw(previewDeductions + previewUnion)}
                </p>
              </div>
              <div className="col-span-2 border-t border-gray-200 pt-3">
                <p className="text-sm text-gray-500">실수령액</p>
                <p className="text-2xl font-bold text-blue-700">{formatKrw(previewNet)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 푸터 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-12 border border-gray-300 text-gray-700 rounded-xl text-base font-medium
                       hover:bg-gray-100 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={updateMut.isPending}
            className="flex-1 flex items-center justify-center gap-2 h-12 bg-blue-600 hover:bg-blue-700
                       disabled:opacity-60 text-white rounded-xl text-base font-medium transition-colors"
          >
            {updateMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 급여 설정 탭
// ─────────────────────────────────────────────────────────────────

function SettingsTab() {
  const qc = useQueryClient();

  const { data: settings, isLoading, isError } = useQuery({
    queryKey: ['payroll-settings'],
    queryFn: () => payrollApi.getSettings().then(r => r.data.data as PayrollSettings),
  });

  const [form, setForm] = useState<PayrollSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings && !form) {
      setForm(settings);
    }
  }, [settings, form]);

  const saveMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => payrollApi.saveSettings(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-settings'] });
      toast.success('급여 설정이 저장되었습니다.');
      setDirty(false);
    },
    onError: () => toast.error('설정 저장 중 오류가 발생했습니다.'),
  });

  const updateField = (key: keyof PayrollSettings, value: string) => {
    if (!form) return;
    setForm({ ...form, [key]: safeNum(value) });
    setDirty(true);
  };

  if (isLoading) return <LoadingState message="급여 설정을 불러오는 중입니다..." />;
  if (isError) return <ErrorState message="급여 설정을 불러오지 못했습니다." />;
  if (!form) return null;

  return (
    <div className="space-y-6">
      {/* 기본 급여 설정 */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <DollarSign size={20} className="text-blue-600" />
            기본 급여 설정
          </h3>
          <p className="text-sm text-gray-500 mt-1">월 기본급, 연장/야간/휴일 근로 배율 설정</p>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField label="월 기본급 (호봉표 미적용 시)" suffix="원">
            <input
              type="number"
              className="form-input"
              value={form.baseSalary}
              onChange={e => updateField('baseSalary', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">호봉이 미설정된 기사에게 적용됩니다</p>
          </FormField>
          <FormField label="야간근무 수당" suffix="원/회">
            <input
              type="number"
              className="form-input"
              value={form.nightShiftBonus}
              onChange={e => updateField('nightShiftBonus', e.target.value)}
            />
          </FormField>
          <FormField label="연장근로 배율" suffix="배">
            <input
              type="number"
              step="0.1"
              className="form-input"
              value={form.overtimeRate}
              onChange={e => updateField('overtimeRate', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">법정 기준: 1.5배</p>
          </FormField>
          <FormField label="휴일근로 배율" suffix="배">
            <input
              type="number"
              step="0.1"
              className="form-input"
              value={form.holidayRate}
              onChange={e => updateField('holidayRate', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">법정 기준: 2.0배</p>
          </FormField>
        </div>
      </div>

      {/* 4대보험 요율 설정 */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <AlertCircle size={20} className="text-red-500" />
            4대보험 요율 설정
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            근로자 부담분 비율을 설정합니다 (급여 대비 %)
          </p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-blue-50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-blue-500 rounded-full" />
                <p className="text-base font-semibold text-gray-800">건강보험</p>
              </div>
              <FormField label="근로자 부담률" suffix="%">
                <input
                  type="number"
                  step="0.001"
                  className="form-input"
                  value={form.healthInsuranceRate}
                  onChange={e => updateField('healthInsuranceRate', e.target.value)}
                />
              </FormField>
              <p className="text-xs text-gray-500 mt-2">2024년 기준: 3.545%</p>
            </div>

            <div className="bg-green-50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <p className="text-base font-semibold text-gray-800">국민연금</p>
              </div>
              <FormField label="근로자 부담률" suffix="%">
                <input
                  type="number"
                  step="0.1"
                  className="form-input"
                  value={form.nationalPensionRate}
                  onChange={e => updateField('nationalPensionRate', e.target.value)}
                />
              </FormField>
              <p className="text-xs text-gray-500 mt-2">2024년 기준: 4.5%</p>
            </div>

            <div className="bg-orange-50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-orange-500 rounded-full" />
                <p className="text-base font-semibold text-gray-800">고용보험</p>
              </div>
              <FormField label="근로자 부담률" suffix="%">
                <input
                  type="number"
                  step="0.1"
                  className="form-input"
                  value={form.employmentInsRate}
                  onChange={e => updateField('employmentInsRate', e.target.value)}
                />
              </FormField>
              <p className="text-xs text-gray-500 mt-2">2024년 기준: 0.9%</p>
            </div>
          </div>

          <div className="mt-6 bg-yellow-50 rounded-xl p-4 border border-yellow-200">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-yellow-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-800">산재보험 안내</p>
                <p className="text-sm text-yellow-700 mt-1">
                  산재보험료는 전액 사업주 부담이므로 근로자 급여에서 공제하지 않습니다.
                  산재보험 요율은 업종별로 상이하며, 별도 관리가 필요합니다.
                </p>
              </div>
            </div>
          </div>

          {/* 요율 합산 미리보기 */}
          <div className="mt-6 bg-gray-50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-600 mb-3">공제율 합계 미리보기</p>
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <p className="text-sm text-gray-500">건강보험</p>
                <p className="text-base font-bold text-blue-600">{formatPct(form.healthInsuranceRate)}</p>
              </div>
              <span className="text-gray-300 text-lg">+</span>
              <div>
                <p className="text-sm text-gray-500">국민연금</p>
                <p className="text-base font-bold text-green-600">{formatPct(form.nationalPensionRate)}</p>
              </div>
              <span className="text-gray-300 text-lg">+</span>
              <div>
                <p className="text-sm text-gray-500">고용보험</p>
                <p className="text-base font-bold text-orange-600">{formatPct(form.employmentInsRate)}</p>
              </div>
              <span className="text-gray-300 text-lg">=</span>
              <div>
                <p className="text-sm text-gray-500">합계</p>
                <p className="text-lg font-bold text-red-600">
                  {formatPct(
                    Math.round((form.healthInsuranceRate + form.nationalPensionRate + form.employmentInsRate) * 1000) / 1000
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 저장 버튼 */}
      <div className="flex justify-end">
        <button
          onClick={() => saveMut.mutate(form as unknown as Record<string, unknown>)}
          disabled={saveMut.isPending || !dirty}
          className={`flex items-center gap-2.5 px-8 h-12 rounded-xl text-base font-medium transition-colors shadow-sm ${
            dirty
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saveMut.isPending ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
          급여 설정 저장
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 호봉표 탭
// ─────────────────────────────────────────────────────────────────

function HoboongTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: serverRows = [], isLoading, isError } = useQuery<HoboongRow[]>({
    queryKey: ['hoboong'],
    queryFn: () => payrollApi.getHoboong().then(r => r.data.data),
  });

  const [localRows, setLocalRows] = useState<HoboongRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // 서버 데이터 → 로컬 초기화
  useEffect(() => {
    if (serverRows.length > 0 && !dirty) {
      setLocalRows(serverRows);
    }
  }, [serverRows, dirty]);

  const displayRows = dirty ? localRows : serverRows;

  const saveMut = useMutation({
    mutationFn: () => payrollApi.saveHoboong(localRows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hoboong'] });
      toast.success('호봉 테이블이 저장되었습니다.');
      setDirty(false);
    },
    onError: () => toast.error('호봉 테이블 저장에 실패했습니다.'),
  });

  const addRow = () => {
    const maxLevel = displayRows.length > 0 ? Math.max(...displayRows.map(r => r.level)) : 0;
    const lastSalary = displayRows.length > 0 ? displayRows[displayRows.length - 1].baseSalary : 3000000;
    const next = [...displayRows, { level: maxLevel + 1, baseSalary: lastSalary + 50000 }];
    setLocalRows(next);
    setDirty(true);
  };

  const updateRow = (index: number, field: keyof HoboongRow, value: number) => {
    const next = [...displayRows];
    next[index] = { ...next[index], [field]: value };
    setLocalRows(next);
    setDirty(true);
  };

  const deleteRow = (index: number) => {
    const next = displayRows.filter((_, i) => i !== index);
    setLocalRows(next);
    setDirty(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    try {
      const res = await payrollApi.analyzeExcel(file);
      const result = res.data.data as { hoboongTable?: HoboongRow[] };
      if (result.hoboongTable && result.hoboongTable.length > 0) {
        setLocalRows(result.hoboongTable);
        setDirty(true);
        toast.success(`AI가 ${result.hoboongTable.length}개 호봉을 추출했습니다. 확인 후 저장하세요.`);
      } else {
        toast.error('파일에서 호봉 데이터를 찾지 못했습니다.');
      }
    } catch {
      toast.error('파일 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (isLoading) return <LoadingState message="호봉 테이블을 불러오는 중입니다..." />;
  if (isError) return <ErrorState message="호봉 테이블을 불러오지 못했습니다." />;

  return (
    <div className="space-y-6">
      {/* AI 업로드 섹션 */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-white rounded-xl border border-purple-100 shadow-sm shrink-0">
            <Sparkles size={24} className="text-purple-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 mb-1">AI 호봉표 자동 추출</h3>
            <p className="text-base text-gray-600 mb-4">
              기존 급여 엑셀 파일을 업로드하면 AI가 호봉 테이블을 자동으로 분석합니다.
            </p>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={analyzing}
                className="flex items-center gap-2 px-5 h-12 bg-purple-600 hover:bg-purple-700
                           disabled:opacity-60 text-white rounded-xl text-base font-medium transition-colors"
              >
                {analyzing
                  ? <Loader2 size={18} className="animate-spin" />
                  : <Upload size={18} />}
                {analyzing ? 'AI 분석 중...' : '엑셀 파일에서 호봉 추출'}
              </button>
              <span className="text-sm text-gray-400">.xlsx, .xls 지원</span>
            </div>
          </div>
        </div>
      </div>

      {/* 호봉 테이블 */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <ListOrdered size={20} className="text-blue-600" />
              호봉 테이블
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              근속 연수(호봉)에 따른 기본급 테이블입니다. 총 {displayRows.length}개 호봉
            </p>
          </div>
          <button
            onClick={addRow}
            className="flex items-center gap-2 px-5 h-12 text-blue-600 hover:bg-blue-50
                       rounded-xl text-base font-medium transition-colors border border-blue-200"
          >
            <Plus size={18} /> 호봉 추가
          </button>
        </div>

        <div className="p-6">
          {displayRows.length === 0 ? (
            <EmptyState
              icon={<ListOrdered size={48} className="text-gray-300" />}
              title="등록된 호봉이 없습니다"
              description="호봉을 추가하거나, 엑셀 파일을 업로드하여 자동 추출하세요."
            />
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
              {/* 테이블 헤더 */}
              <div className="flex items-center gap-4 px-4 py-2 text-sm font-semibold text-gray-500">
                <span className="w-20">호봉</span>
                <span className="flex-1">기본급</span>
                <span className="w-32 text-right">포맷</span>
                <span className="w-12" />
              </div>
              {displayRows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <span className="w-20 text-base font-semibold text-blue-700">
                    {row.level}호봉
                  </span>
                  <input
                    type="number"
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-base text-right
                               focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    value={row.baseSalary}
                    onChange={e => updateRow(i, 'baseSalary', safeNum(e.target.value))}
                  />
                  <span className="w-32 text-right text-base text-gray-500 font-medium">
                    {formatKrw(row.baseSalary)}
                  </span>
                  <button
                    onClick={() => deleteRow(i)}
                    className="w-12 h-12 flex items-center justify-center text-gray-400
                               hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                    title="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 저장 버튼 */}
        {dirty && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
            <button
              onClick={() => { setLocalRows(serverRows); setDirty(false); }}
              className="px-6 h-12 border border-gray-300 text-gray-600 rounded-xl text-base font-medium
                         hover:bg-gray-100 transition-colors"
            >
              변경 취소
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="flex items-center gap-2 px-8 h-12 bg-blue-600 hover:bg-blue-700
                         disabled:opacity-60 text-white rounded-xl text-base font-medium transition-colors"
            >
              {saveMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              호봉 테이블 저장
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 조합비 탭
// ─────────────────────────────────────────────────────────────────

function UnionDuesTab() {
  const qc = useQueryClient();

  const { data: serverRows = [], isLoading, isError } = useQuery<UnionDueRow[]>({
    queryKey: ['union-dues'],
    queryFn: () => payrollApi.getUnionDues().then(r => r.data.data),
  });

  const [localRows, setLocalRows] = useState<UnionDueRow[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (serverRows.length > 0 && !dirty) {
      setLocalRows(serverRows);
    }
  }, [serverRows, dirty]);

  const displayRows = dirty ? localRows : serverRows;

  const saveMut = useMutation({
    mutationFn: () => payrollApi.saveUnionDues(localRows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['union-dues'] });
      toast.success('조합비 설정이 저장되었습니다.');
      setDirty(false);
    },
    onError: () => toast.error('조합비 저장에 실패했습니다.'),
  });

  const addRow = () => {
    const next = [...displayRows, { name: '', type: 'FIXED', amount: 0, isActive: true }];
    setLocalRows(next);
    setDirty(true);
  };

  const updateRow = (index: number, field: keyof UnionDueRow, value: unknown) => {
    const next = [...displayRows];
    next[index] = { ...next[index], [field]: value };
    setLocalRows(next);
    setDirty(true);
  };

  const deleteRow = (index: number) => {
    if (!confirm('이 조합비 항목을 삭제하시겠습니까?')) return;
    const next = displayRows.filter((_, i) => i !== index);
    setLocalRows(next);
    setDirty(true);
  };

  const toggleActive = (index: number) => {
    const next = [...displayRows];
    next[index] = { ...next[index], isActive: !next[index].isActive };
    setLocalRows(next);
    setDirty(true);
  };

  if (isLoading) return <LoadingState message="조합비 설정을 불러오는 중입니다..." />;
  if (isError) return <ErrorState message="조합비 설정을 불러오지 못했습니다." />;

  // 활성 항목의 고정 금액 합계
  const activeFixedTotal = displayRows
    .filter(r => r.isActive && r.type === 'FIXED')
    .reduce((sum, r) => sum + r.amount, 0);
  const activePercentItems = displayRows.filter(r => r.isActive && r.type === 'PERCENTAGE');

  return (
    <div className="space-y-6">
      {/* 요약 */}
      {displayRows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">전체 항목</p>
            <p className="text-2xl font-bold text-gray-900">{displayRows.length}개</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">활성 고정 공제 합계</p>
            <p className="text-2xl font-bold text-orange-600">{formatKrw(activeFixedTotal)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">활성 비율 공제</p>
            <p className="text-2xl font-bold text-orange-600">
              {activePercentItems.length > 0
                ? activePercentItems.map(r => `${r.amount}%`).join(' + ')
                : '-'}
            </p>
          </div>
        </div>
      )}

      {/* 조합비 목록 */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Users size={20} className="text-orange-600" />
              조합비 / 공제 항목
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              노동조합비, 상조회비, 공제회비 등을 설정합니다
            </p>
          </div>
          <button
            onClick={addRow}
            className="flex items-center gap-2 px-5 h-12 text-orange-600 hover:bg-orange-50
                       rounded-xl text-base font-medium transition-colors border border-orange-200"
          >
            <Plus size={18} /> 항목 추가
          </button>
        </div>

        <div className="p-6">
          {displayRows.length === 0 ? (
            <EmptyState
              icon={<Users size={48} className="text-gray-300" />}
              title="등록된 조합비 항목이 없습니다"
              description="'항목 추가' 버튼을 클릭하여 조합비 항목을 등록하세요."
            />
          ) : (
            <div className="space-y-3">
              {/* 헤더 */}
              <div className="flex items-center gap-4 px-4 py-2 text-sm font-semibold text-gray-500">
                <span className="w-14 text-center">상태</span>
                <span className="flex-1 min-w-[160px]">항목명</span>
                <span className="w-28">유형</span>
                <span className="w-36">금액/비율</span>
                <span className="w-28 text-right">적용 금액</span>
                <span className="w-12" />
              </div>

              {displayRows.map((due, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-colors ${
                    due.isActive
                      ? 'bg-gray-50 hover:bg-gray-100'
                      : 'bg-gray-50/50 opacity-60'
                  }`}
                >
                  {/* 활성/비활성 토글 */}
                  <button
                    onClick={() => toggleActive(i)}
                    className="w-14 flex justify-center"
                    title={due.isActive ? '비활성화' : '활성화'}
                  >
                    {due.isActive
                      ? <ToggleRight size={28} className="text-green-500" />
                      : <ToggleLeft size={28} className="text-gray-400" />}
                  </button>

                  {/* 항목명 */}
                  <input
                    type="text"
                    placeholder="항목명 (예: 노동조합비)"
                    className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-4 py-2.5 text-base
                               focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white"
                    value={due.name}
                    onChange={e => updateRow(i, 'name', e.target.value)}
                  />

                  {/* 유형 선택 */}
                  <select
                    className="w-28 border border-gray-200 rounded-xl px-3 py-2.5 text-base bg-white
                               focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    value={due.type}
                    onChange={e => updateRow(i, 'type', e.target.value)}
                  >
                    <option value="FIXED">고정 금액</option>
                    <option value="PERCENTAGE">급여 %</option>
                  </select>

                  {/* 금액/비율 */}
                  <div className="w-36 flex items-center gap-1">
                    <input
                      type="number"
                      step={due.type === 'PERCENTAGE' ? '0.1' : '1000'}
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-base text-right bg-white
                                 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      value={due.amount}
                      onChange={e => updateRow(i, 'amount', safeNum(e.target.value))}
                    />
                    <span className="text-sm text-gray-500 w-6 text-center">
                      {due.type === 'PERCENTAGE' ? '%' : '원'}
                    </span>
                  </div>

                  {/* 적용 금액 표시 */}
                  <span className="w-28 text-right text-base font-medium text-orange-600">
                    {due.type === 'FIXED'
                      ? formatKrw(due.amount)
                      : `${due.amount}%`}
                  </span>

                  {/* 삭제 */}
                  <button
                    onClick={() => deleteRow(i)}
                    className="w-12 h-12 flex items-center justify-center text-gray-400
                               hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                    title="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 저장 버튼 */}
        {dirty && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
            <button
              onClick={() => { setLocalRows(serverRows); setDirty(false); }}
              className="px-6 h-12 border border-gray-300 text-gray-600 rounded-xl text-base font-medium
                         hover:bg-gray-100 transition-colors"
            >
              변경 취소
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="flex items-center gap-2 px-8 h-12 bg-orange-600 hover:bg-orange-700
                         disabled:opacity-60 text-white rounded-xl text-base font-medium transition-colors"
            >
              {saveMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              조합비 저장
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 공통 컴포넌트
// ─────────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  sub,
  color = 'text-gray-900',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <p className="text-sm font-medium text-gray-500">{label}</p>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-sm text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function FormField({
  label,
  suffix,
  children,
}: {
  label: string;
  suffix: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-600 mb-1.5">
        {label}
        {suffix && <span className="text-gray-400 ml-1">({suffix})</span>}
      </label>
      {children}
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <Loader2 size={36} className="animate-spin text-blue-500 mb-4" />
      <p className="text-base text-gray-500">{message}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <AlertCircle size={36} className="text-red-400 mb-4" />
      <p className="text-base text-red-600 font-medium">{message}</p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      {icon}
      <p className="text-lg text-gray-600 font-medium mt-4">{title}</p>
      <p className="text-base text-gray-400 mt-2">{description}</p>
    </div>
  );
}
