import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Map, Bus, Users, Plus, Trash2, Loader2, FileSpreadsheet,
  Upload, AlertTriangle, CheckCircle2, Pencil, X, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { onboardingApi } from '../services/api';

/**
 * 엑셀 업로드 모달 — 온보딩 페이지의 "엑셀 파일 올리기" 흐름을 그대로 재사용한다.
 *   업로드 → AI 분석 → 미리보기/수정 → 등록. (수동 입력·건너뛰기 등 온보딩 전용 단계는 제외)
 * onboardingApi 를 그대로 사용하므로 기능은 온보딩 페이지와 동일하다.
 * 등록 성공 시 기초 데이터 목록(users/buses/routes)을 무효화해 표를 즉시 갱신한다.
 */

interface RouteForm { routeNumber: string; name: string; startPoint: string; endPoint: string; }
interface BusForm { busNumber: string; plateNumber: string; model: string; }
interface DriverForm { name: string; phone: string; employeeId: string; driverType: 'MAIN' | 'SPARE'; }
interface ImportedData {
  summary: string;
  drivers: DriverForm[];
  routes: RouteForm[];
  buses: BusForm[];
  warnings: string[];
}

function emptyRoute(): RouteForm { return { routeNumber: '', name: '', startPoint: '', endPoint: '' }; }
function emptyBus(): BusForm { return { busNumber: '', plateNumber: '', model: '' }; }
function emptyDriver(): DriverForm { return { name: '', phone: '', employeeId: '', driverType: 'MAIN' }; }

type Step = 'choose' | 'uploading' | 'preview' | 'done';

export default function ExcelUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('choose');
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [imported, setImported] = useState<ImportedData | null>(null);
  const [editSection, setEditSection] = useState<'drivers' | 'routes' | 'buses' | null>(null);
  const [importedCounts, setImportedCounts] = useState({ drivers: 0, routes: 0, buses: 0 });

  if (!open) return null;

  const reset = () => {
    setStep('choose'); setImported(null); setEditSection(null); setSaving(false); setDragOver(false);
  };
  const close = () => { reset(); onClose(); };

  const refreshTables = () => {
    qc.invalidateQueries({ queryKey: ['users', 'DRIVER'] });
    qc.invalidateQueries({ queryKey: ['buses'] });
    qc.invalidateQueries({ queryKey: ['routes'] });
  };

  const handleFile = async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }
    setStep('uploading');
    try {
      const res = await onboardingApi.analyzeExcel(file);
      setImported(res.data.data);
      setStep('preview');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '파일 분석 중 오류가 발생했습니다.';
      toast.error(msg);
      setStep('choose');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const confirmImport = async () => {
    if (!imported) return;
    setSaving(true);
    try {
      const res = await onboardingApi.confirmImport({
        drivers: imported.drivers,
        routes: imported.routes,
        buses: imported.buses,
      });
      toast.success(res.data.message);
      setImportedCounts({
        drivers: imported.drivers.length,
        routes: imported.routes.length,
        buses: imported.buses.length,
      });
      refreshTables();
      setStep('done');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '저장 중 오류가 발생했습니다.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await onboardingApi.downloadTemplate();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Busync_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('템플릿 다운로드에 실패했습니다.'); }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 animate-fade-in-scale">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto admin-scope">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">데이터 업로드</h2>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {/* ── 파일 선택 ── */}
          {step === 'choose' && (
            <>
              <div
                className={`rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center
                  ${dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' : 'border-gray-300 dark:border-white/15 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <div className="w-16 h-16 bg-green-100 dark:bg-green-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FileSpreadsheet size={32} className="text-green-600 dark:text-green-400" />
                </div>
                <p className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">엑셀 파일 올리기</p>
                <div className="flex justify-center mb-4">
                  <div className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 rounded-xl px-4 py-2.5">
                    <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-base font-bold text-amber-800 dark:text-amber-300">
                      아래 ‘양식 템플릿’으로 작성한 파일만 정확히 인식됩니다.
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold text-sm transition-colors">
                  <Upload size={16} /> 파일 선택하기
                </span>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
                  .xlsx, .xls 파일 · 최대 10MB<br />
                  형식이 다른 파일(자체 배차표 등)은 누락·오류가 발생할 수 있습니다
                </p>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
              </div>

              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium py-3 mt-2 transition-colors"
              >
                <Download size={15} /> 양식 템플릿 다운로드 (기사·노선·버스 예시 포함)
              </button>
            </>
          )}

          {/* ── AI 분석 중 ── */}
          {step === 'uploading' && (
            <div className="py-10 text-center animate-fade-in-scale">
              <div className="w-20 h-20 bg-blue-100 dark:bg-blue-500/15 rounded-full flex items-center justify-center mx-auto mb-6">
                <Loader2 size={36} className="text-blue-600 dark:text-blue-400 animate-spin" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">AI가 파일을 읽고 있어요</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                기사, 노선, 버스 정보를 자동으로 찾고 있습니다.<br />
                보통 10~30초 정도 걸립니다. 잠깐만 기다려 주세요.
              </p>
            </div>
          )}

          {/* ── 분석 결과 확인 ── */}
          {step === 'preview' && imported && (
            <div className="animate-fade-in-up">
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={28} className="text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">AI가 이렇게 이해했습니다</h3>
                {imported.summary && <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{imported.summary}</p>}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">내용을 확인하시고 틀린 부분은 수정 버튼을 눌러 바꿔 주세요</p>
              </div>

              <div className="space-y-4">
                <PreviewCard
                  icon={<Users size={20} className="text-green-600" />} color="green"
                  title="기사" count={imported.drivers.length} unit="명"
                  items={imported.drivers.map(d => d.name || '(이름 없음)')}
                  isEditing={editSection === 'drivers'}
                  onEdit={() => setEditSection(editSection === 'drivers' ? null : 'drivers')}
                >
                  {editSection === 'drivers' && (
                    <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
                      {imported.drivers.map((d, i) => (
                        <div key={i} className="bg-white rounded-lg p-3 border border-gray-200 grid grid-cols-2 gap-2">
                          <EditInput value={d.name} placeholder="홍길동"
                            onChange={v => setImported(p => p ? { ...p, drivers: p.drivers.map((x, idx) => idx === i ? { ...x, name: v } : x) } : p)} />
                          <div className="flex gap-2">
                            <EditInput value={d.phone} placeholder="010-1234-5678"
                              onChange={v => setImported(p => p ? { ...p, drivers: p.drivers.map((x, idx) => idx === i ? { ...x, phone: v } : x) } : p)} />
                            <button onClick={() => setImported(p => p ? { ...p, drivers: p.drivers.filter((_, idx) => idx !== i) } : p)}
                              className="text-red-400 hover:text-red-600 flex-shrink-0"><Trash2 size={14} /></button>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setImported(p => p ? { ...p, drivers: [...p.drivers, emptyDriver()] } : p)}
                        className="flex items-center gap-1 text-green-600 text-sm font-medium mt-1">
                        <Plus size={14} /> 기사 추가
                      </button>
                    </div>
                  )}
                </PreviewCard>

                <PreviewCard
                  icon={<Map size={20} className="text-blue-600" />} color="blue"
                  title="노선" count={imported.routes.length} unit="개"
                  items={imported.routes.map(r => {
                    const num = r.routeNumber ? `${r.routeNumber}번` : '';
                    const name = (r.name || '').trim();
                    if (!num) return name;
                    if (!name || name === num || name === r.routeNumber) return num;
                    return `${num} ${name}`;
                  })}
                  isEditing={editSection === 'routes'}
                  onEdit={() => setEditSection(editSection === 'routes' ? null : 'routes')}
                >
                  {editSection === 'routes' && (
                    <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
                      {imported.routes.map((r, i) => (
                        <div key={i} className="bg-white rounded-lg p-3 border border-gray-200 grid grid-cols-2 gap-2">
                          <EditInput value={r.routeNumber} placeholder="노선 번호 (예: 100)"
                            onChange={v => setImported(p => p ? { ...p, routes: p.routes.map((x, idx) => idx === i ? { ...x, routeNumber: v } : x) } : p)} />
                          <EditInput value={r.name} placeholder="노선명"
                            onChange={v => setImported(p => p ? { ...p, routes: p.routes.map((x, idx) => idx === i ? { ...x, name: v } : x) } : p)} />
                          <EditInput value={r.startPoint} placeholder="출발지"
                            onChange={v => setImported(p => p ? { ...p, routes: p.routes.map((x, idx) => idx === i ? { ...x, startPoint: v } : x) } : p)} />
                          <EditInput value={r.endPoint} placeholder="도착지"
                            onChange={v => setImported(p => p ? { ...p, routes: p.routes.map((x, idx) => idx === i ? { ...x, endPoint: v } : x) } : p)} />
                        </div>
                      ))}
                      <button onClick={() => setImported(p => p ? { ...p, routes: [...p.routes, emptyRoute()] } : p)}
                        className="flex items-center gap-1 text-blue-600 text-sm font-medium mt-1">
                        <Plus size={14} /> 노선 추가
                      </button>
                    </div>
                  )}
                </PreviewCard>

                <PreviewCard
                  icon={<Bus size={20} className="text-purple-600" />} color="purple"
                  title="버스" count={imported.buses.length} unit="대"
                  items={imported.buses.map(b => b.plateNumber || b.busNumber)}
                  isEditing={editSection === 'buses'}
                  onEdit={() => setEditSection(editSection === 'buses' ? null : 'buses')}
                >
                  {editSection === 'buses' && (
                    <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
                      {imported.buses.map((b, i) => (
                        <div key={i} className="bg-white rounded-lg p-3 border border-gray-200 grid grid-cols-2 gap-2">
                          <EditInput value={b.busNumber} placeholder="버스 번호"
                            onChange={v => setImported(p => p ? { ...p, buses: p.buses.map((x, idx) => idx === i ? { ...x, busNumber: v } : x) } : p)} />
                          <EditInput value={b.plateNumber} placeholder="차량번호 (번호판)"
                            onChange={v => setImported(p => p ? { ...p, buses: p.buses.map((x, idx) => idx === i ? { ...x, plateNumber: v } : x) } : p)} />
                        </div>
                      ))}
                      <button onClick={() => setImported(p => p ? { ...p, buses: [...p.buses, emptyBus()] } : p)}
                        className="flex items-center gap-1 text-purple-600 text-sm font-medium mt-1">
                        <Plus size={14} /> 버스 추가
                      </button>
                    </div>
                  )}
                </PreviewCard>

                {imported.warnings.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
                      <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">AI가 확실하지 않은 부분</span>
                    </div>
                    <ul className="space-y-0.5">
                      {imported.warnings.map((w, i) => (
                        <li key={i} className="text-sm text-amber-700 dark:text-amber-300/90">• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={() => { setImported(null); setEditSection(null); setStep('choose'); }}
                  className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-gray-200 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 text-sm font-medium transition-colors">
                  <X size={14} /> 다시 올리기
                </button>
                <button onClick={confirmImport} disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2">
                  {saving
                    ? <><Loader2 size={18} className="animate-spin" /> 등록 중...</>
                    : <><CheckCircle2 size={18} /> 맞습니다, 등록해 주세요</>}
                </button>
              </div>
            </div>
          )}

          {/* ── 완료 ── */}
          {step === 'done' && (
            <div className="py-8 text-center animate-fade-in-scale">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={32} className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">등록 완료!</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                기사 {importedCounts.drivers}명 · 노선 {importedCounts.routes}개 · 버스 {importedCounts.buses}대가 등록되었습니다.
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={reset}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 text-sm font-medium transition-colors">
                  파일 더 올리기
                </button>
                <button onClick={close}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
                  완료
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 보조 컴포넌트 (온보딩 페이지와 동일한 미리보기 UI) ──
function EditInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-400" />
  );
}

function PreviewCard({ icon, color, title, count, unit, items, isEditing, onEdit, children }: {
  icon: React.ReactNode; color: 'green' | 'blue' | 'purple';
  title: string; count: number; unit: string; items: string[];
  isEditing: boolean; onEdit: () => void; children?: React.ReactNode;
}) {
  const bg = { green: 'bg-green-50 border-green-200', blue: 'bg-blue-50 border-blue-200', purple: 'bg-purple-50 border-purple-200' }[color];
  const badge = { green: 'bg-green-100 text-green-700', blue: 'bg-blue-100 text-blue-700', purple: 'bg-purple-100 text-purple-700' }[color];

  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center shadow-sm">{icon}</div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800">{title}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge}`}>{count}{unit}</span>
          </div>
        </div>
        <button onClick={onEdit}
          className={`flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors
            ${isEditing ? 'bg-gray-200 text-gray-700' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
          <Pencil size={11} /> {isEditing ? '닫기' : '수정'}
        </button>
      </div>

      {!isEditing && count > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {items.slice(0, 8).map((item, i) => (
            <span key={i} className="bg-white text-gray-700 text-xs px-2 py-1 rounded-lg border border-gray-100 shadow-sm">{item}</span>
          ))}
          {items.length > 8 && <span className="text-xs text-gray-500 px-2 py-1 self-center">+{items.length - 8}개 더</span>}
        </div>
      )}
      {children}
    </div>
  );
}
