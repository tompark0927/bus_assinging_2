import { useState } from 'react';
import { Printer, X } from 'lucide-react';

export interface PrintOptions {
  orientation: 'landscape' | 'portrait';
  paperSize: 'A4' | 'A3' | 'letter';
  showLegend: boolean;
  pageBreakRows: number; // 0 = no forced break
}

const DEFAULTS: PrintOptions = {
  orientation: 'landscape',
  paperSize: 'A4',
  showLegend: true,
  pageBreakRows: 0,
};

const STORAGE_KEY = 'busync:print-options';

function loadDefaults(): PrintOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PrintOptions>) };
  } catch {
    return DEFAULTS;
  }
}

/** Apply options to the document via inline @page rule + body classes, then call window.print(). */
function applyAndPrint(opts: PrintOptions, title: string) {
  const styleEl = document.createElement('style');
  styleEl.id = 'busync-print-rules';
  styleEl.textContent = `
    @page { size: ${opts.paperSize} ${opts.orientation}; margin: 10mm; }
    body.busync-print-hide-legend [data-print-section="legend"] { display: none !important; }
    ${
      opts.pageBreakRows > 0
        ? `@media print {
             tbody tr:nth-child(${opts.pageBreakRows}n) { page-break-after: always; }
           }`
        : ''
    }
  `;
  document.getElementById('busync-print-rules')?.remove();
  document.head.appendChild(styleEl);

  const cls = document.body.classList;
  cls.toggle('busync-print-hide-legend', !opts.showLegend);

  const prevTitle = document.title;
  document.title = title;

  // Defer one tick so styles apply
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
      cls.remove('busync-print-hide-legend');
    }, 200);
  }, 50);
}

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
}

export default function PrintOptionsModal({ open, onClose, title = 'busync-schedule' }: Props) {
  const [opts, setOpts] = useState<PrintOptions>(() => loadDefaults());

  if (!open) return null;

  const update = <K extends keyof PrintOptions>(key: K, value: PrintOptions[K]) => {
    const next = { ...opts, [key]: value };
    setOpts(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {/* ignore */}
  };

  const handlePrint = () => {
    applyAndPrint(opts, title);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h3 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Printer size={18} className="text-blue-500" />
            인쇄 옵션
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 방향 */}
          <Field label="용지 방향">
            <div className="flex gap-2">
              {(['landscape', 'portrait'] as const).map((o) => (
                <Choice
                  key={o}
                  active={opts.orientation === o}
                  onClick={() => update('orientation', o)}
                  label={o === 'landscape' ? '가로' : '세로'}
                />
              ))}
            </div>
          </Field>

          {/* 용지 크기 */}
          <Field label="용지 크기">
            <div className="flex gap-2">
              {(['A4', 'A3', 'letter'] as const).map((p) => (
                <Choice
                  key={p}
                  active={opts.paperSize === p}
                  onClick={() => update('paperSize', p)}
                  label={p}
                />
              ))}
            </div>
          </Field>

          {/* 페이지당 행 (페이지 나눔) */}
          <Field
            label="페이지당 기사 수"
            help="0 입력 시 자동 (페이지 나눔 강제 안함)"
          >
            <input
              type="number"
              min={0}
              max={60}
              value={opts.pageBreakRows}
              onChange={(e) => update('pageBreakRows', Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
              className="w-28 px-3 py-2 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </Field>

          {/* 표시 항목 */}
          <Field label="포함 항목" help="배차표(와 선택 시 범례)만 인쇄됩니다. 사이드바·요약·버튼은 인쇄되지 않습니다.">
            <Toggle
              checked={opts.showLegend}
              onChange={(v) => update('showLegend', v)}
              label="범례 (근무/휴무/대타 색상 안내) 포함"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-[14px]"
          >
            취소
          </button>
          <button
            onClick={handlePrint}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-2 text-[14px] font-medium"
          >
            <Printer size={15} />
            인쇄
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Helpers ---------- */

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200 mb-1.5">{label}</div>
      {children}
      {help && <p className="text-[12px] text-gray-400 mt-1">{help}</p>}
    </div>
  );
}

function Choice({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border text-[13px] font-medium transition-colors ${
        active
          ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/40 dark:text-blue-300'
          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-white/5 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-[14px] text-gray-700 dark:text-gray-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4"
      />
      <span>{label}</span>
    </label>
  );
}
