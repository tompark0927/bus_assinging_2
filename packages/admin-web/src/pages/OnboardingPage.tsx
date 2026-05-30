import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
// CSS animations replace framer-motion (see index.css: animate-fade-in-up, animate-fade-in-scale)
import {
  Map, Bus, Users, Check, Plus, Trash2, ArrowRight, ArrowLeft, Loader2,
  ChevronRight, FileSpreadsheet, Upload, AlertTriangle, CheckCircle2,
  Pencil, X, Download, Calendar, MessageSquare, Bell,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { routesApi, busesApi, usersApi, onboardingApi } from '../services/api';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────
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

type Step = 'choose' | 'uploading' | 'preview' | 'manual-1' | 'manual-2' | 'manual-3' | 'done';

function emptyRoute(): RouteForm { return { routeNumber: '', name: '', startPoint: '', endPoint: '' }; }
function emptyBus(): BusForm { return { busNumber: '', plateNumber: '', model: '' }; }
function emptyDriver(): DriverForm { return { name: '', phone: '', employeeId: '', driverType: 'MAIN' }; }

// ────────────────────────────────────────────
// 메인
// ────────────────────────────────────────────
export default function OnboardingPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('choose');
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showUploadWarning, setShowUploadWarning] = useState(false);

  const [imported, setImported] = useState<ImportedData | null>(null);
  const [editSection, setEditSection] = useState<'drivers' | 'routes' | 'buses' | null>(null);

  const [routes, setRoutes] = useState<RouteForm[]>([emptyRoute()]);
  const [buses, setBuses] = useState<BusForm[]>([emptyBus()]);
  const [drivers, setDrivers] = useState<DriverForm[]>([emptyDriver()]);

  // ── 엑셀 업로드 처리 ──────────────────────
  const handleFile = useCallback(async (file: File) => {
    // 파일이 실제로 들어오면 업로드 경고 모달을 확실히 닫는다.
    // (버튼 onClick 에서 setShowUploadWarning(false) 와 input.click() 이 같은 틱에 실행되면
    //  네이티브 파일 다이얼로그 때문에 상태 업데이트가 누락돼 모달이 남는 문제 회피)
    setShowUploadWarning(false);
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
  }, []);

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

  // ── 엑셀 임포트 확인 ─────────────────────
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
      setStep('done');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '저장 중 오류가 발생했습니다.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── 수동 입력 helpers ──────────────────────
  const updateRoute = (i: number, f: keyof RouteForm, v: string) =>
    setRoutes(p => p.map((r, idx) => idx === i ? { ...r, [f]: v } : r));
  const updateBus = (i: number, f: keyof BusForm, v: string) =>
    setBuses(p => p.map((b, idx) => idx === i ? { ...b, [f]: v } : b));
  const updateDriver = (i: number, f: keyof DriverForm, v: string) =>
    setDrivers(p => p.map((d, idx) => idx === i ? { ...d, [f]: v } : d));

  const saveManualStep = async (s: 'manual-1' | 'manual-2' | 'manual-3') => {
    setSaving(true);
    try {
      if (s === 'manual-1') {
        const filled = routes.filter(r => r.routeNumber && r.name && r.startPoint && r.endPoint);
        if (!filled.length) { toast.error('노선을 최소 1개 입력해주세요.'); return; }
        for (const r of filled) await routesApi.create(r as unknown as Record<string, unknown>);
        toast.success(`노선 ${filled.length}개 등록 완료!`);
        setStep('manual-2');
      } else if (s === 'manual-2') {
        const filled = buses.filter(b => b.busNumber && b.plateNumber);
        if (!filled.length) { toast.error('버스를 최소 1대 입력해주세요.'); return; }
        for (const b of filled) await busesApi.create(b as unknown as Record<string, unknown>);
        toast.success(`버스 ${filled.length}대 등록 완료!`);
        setStep('manual-3');
      } else {
        const filled = drivers.filter(d => d.name && d.phone);
        if (!filled.length) { toast.error('기사를 최소 1명 입력해주세요.'); return; }
        for (const d of filled) await usersApi.create({ ...d, role: 'DRIVER' });
        toast.success(`기사 ${filled.length}명 등록 완료!`);
        setStep('done');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '저장 중 오류가 발생했습니다.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 h-20 flex items-center">
        <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
          <Link to="/" className="flex items-center" aria-label="Busync 홈">
            <img
              src="/busync-lockup.png"
              alt="Busync"
              className="h-12 w-auto object-contain"
            />
          </Link>
          <div className="flex items-center gap-3">
            {step !== 'done' && (
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="text-base text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                title="나중에 설정하고 대시보드로 이동"
              >
                나중에 설정
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <>

            {/* ── 방식 선택 ── */}
            {step === 'choose' && (
              <div key="choose" className="animate-fade-in-up">
                <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">반갑습니다!</h1>
                  <p className="text-gray-500 text-base leading-relaxed">
                    지금 엑셀로 관리하시는 파일이 있으신가요?<br />
                    있으시면 파일만 올려 주시면 AI가 자동으로 읽어서 등록해 드립니다.
                  </p>
                </div>

                <div
                  className={`bg-white rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center mb-4
                    ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
                  onClick={() => setShowUploadWarning(true)}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                >
                  <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <FileSpreadsheet size={32} className="text-green-600" />
                  </div>
                  <p className="text-lg font-semibold text-gray-800 mb-2">엑셀 파일 올리기</p>
                  <div className="flex justify-center mb-4">
                    <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-xl px-4 py-2.5">
                      <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                      <p className="text-base font-bold text-amber-800">
                        아래 ‘양식 템플릿’으로 작성한 파일만 정확히 인식됩니다.
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold text-sm transition-colors">
                    <Upload size={16} /> 파일 선택하기
                  </span>
                  <p className="text-xs text-gray-400 mt-4">
                    .xlsx, .xls 파일 · 최대 10MB<br />
                    형식이 다른 파일(자체 배차표 등)은 누락·오류가 발생할 수 있습니다
                  </p>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
                </div>

                <button
                  onClick={async () => {
                    try {
                      const res = await onboardingApi.downloadTemplate();
                      const url = window.URL.createObjectURL(new Blob([res.data]));
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'Busync_template.xlsx';
                      a.click();
                      window.URL.revokeObjectURL(url);
                    } catch { toast.error('템플릿 다운로드에 실패했습니다.'); }
                  }}
                  className="w-full flex items-center justify-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium py-2 transition-colors"
                >
                  <Download size={15} /> 양식 템플릿 다운로드 (기사·노선·버스 예시 포함)
                </button>

                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-sm text-gray-400">또는</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                <button
                  onClick={() => setStep('manual-1')}
                  className="w-full bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-2xl p-5 text-left transition-colors flex items-center gap-4"
                >
                  <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Pencil size={22} className="text-gray-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">직접 입력하기</p>
                    <p className="text-sm text-gray-500 mt-0.5">노선, 버스, 기사를 하나씩 직접 입력합니다</p>
                  </div>
                  <ChevronRight size={18} className="text-gray-400 ml-auto" />
                </button>

                {/* Skip — go straight to dashboard */}
                <button
                  onClick={() => navigate('/dashboard')}
                  className="w-full mt-4 bg-white border-2 border-gray-300 hover:border-blue-500 hover:bg-blue-50 rounded-2xl p-5 transition-colors flex items-center gap-4 text-left group"
                >
                  <div className="w-12 h-12 bg-gray-100 group-hover:bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
                    <ChevronRight size={22} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-800 text-base">지금은 건너뛰기</p>
                    <p className="text-sm text-gray-500 mt-0.5">나중에 대시보드 → 기초 데이터에서 언제든지 추가·수정할 수 있습니다</p>
                  </div>
                </button>

              </div>
            )}

            {/* ── AI 분석 중 ── */}
            {step === 'uploading' && (
              <div key="uploading" className="animate-fade-in-scale">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Loader2 size={36} className="text-blue-600 animate-spin" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">AI가 파일을 읽고 있어요</h2>
                  <p className="text-gray-500 text-sm leading-relaxed">
                    기사, 노선, 버스 정보를 자동으로 찾고 있습니다.<br />
                    보통 10~30초 정도 걸립니다. 잠깐만 기다려 주세요.
                  </p>
                  <div className="mt-8 space-y-2">
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                      <CheckCircle2 size={14} className="text-green-500" /> 파일 업로드 완료
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm text-blue-500">
                      <Loader2 size={14} className="animate-spin" /> AI 분석 중...
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── AI 분석 결과 확인 ── */}
            {step === 'preview' && imported && (
              <div key="preview" className="animate-fade-in-up">
                <div className="text-center mb-6">
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 size={28} className="text-green-600" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">AI가 이렇게 이해했습니다</h2>
                  {imported.summary && <p className="text-gray-500 text-sm mt-1">{imported.summary}</p>}
                  <p className="text-xs text-gray-400 mt-1">내용을 확인하시고 틀린 부분은 수정 버튼을 눌러 바꿔 주세요</p>
                </div>

                <div className="space-y-4">
                  {/* 기사 */}
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

                  {/* 노선 */}
                  <PreviewCard
                    icon={<Map size={20} className="text-blue-600" />} color="blue"
                    title="노선" count={imported.routes.length} unit="개"
                    items={imported.routes.map(r => {
                      const num = r.routeNumber ? `${r.routeNumber}번` : '';
                      const name = (r.name || '').trim();
                      if (!num) return name;
                      // 노선명이 비었거나 번호와 사실상 같으면 번호만 표시 ("16번 16번" 중복 방지)
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

                  {/* 버스 */}
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

                  {/* 경고 */}
                  {imported.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={15} className="text-amber-600" />
                        <span className="text-sm font-semibold text-amber-800">AI가 확실하지 않은 부분</span>
                      </div>
                      <ul className="space-y-0.5">
                        {imported.warnings.map((w, i) => (
                          <li key={i} className="text-sm text-amber-700">• {w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-6">
                  <button onClick={() => { setImported(null); setStep('choose'); }}
                    className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors">
                    <X size={14} /> 다시 올리기
                  </button>
                  <button onClick={confirmImport} disabled={saving}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2">
                    {saving
                      ? <><Loader2 size={18} className="animate-spin" /> 등록 중...</>
                      : <><CheckCircle2 size={18} /> 맞습니다, 등록해 주세요</>}
                  </button>
                </div>
                <button onClick={() => setStep('manual-1')}
                  className="w-full text-center text-gray-400 hover:text-gray-600 text-xs mt-3 transition-colors py-2">
                  직접 입력으로 전환하기
                </button>
              </div>
            )}

            {/* ── 수동 입력: 노선 ── */}
            {step === 'manual-1' && (
              <div key="m1" className="animate-fade-in-up">
                <ProgressBar current={1} total={3} />
                <button onClick={() => setStep('choose')} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 text-sm mb-3 transition-colors">
                  <ArrowLeft size={14} /> 방식 선택으로 돌아가기
                </button>
                <ManualStepHeader icon={<Map size={20} className="text-blue-600" />}
                  title="노선 등록" subtitle="운행 중인 버스 노선을 입력해 주세요." step={1} total={3} />
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <div className="space-y-4">
                    {routes.map((r, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-sm font-semibold text-gray-700">노선 {i + 1}</span>
                          {routes.length > 1 && (
                            <button onClick={() => setRoutes(p => p.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {([['routeNumber', '노선 번호', '100'], ['name', '노선명', '100번 인천행'], ['startPoint', '출발지', '인천터미널'], ['endPoint', '도착지', '부평역']] as [keyof RouteForm, string, string][]).map(([f, label, ph]) => (
                            <div key={f}>
                              <label className="block text-xs font-medium text-gray-500 mb-1">{label} *</label>
                              <input value={r[f]} onChange={e => updateRoute(i, f, e.target.value)} placeholder={`예: ${ph}`}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setRoutes(p => [...p, emptyRoute()])}
                    className="mt-3 flex items-center gap-1 text-blue-600 text-sm font-medium"><Plus size={15} /> 노선 추가</button>
                  <ManualActions saving={saving} isLast={false} onSkip={() => setStep('manual-2')} onNext={() => saveManualStep('manual-1')} />
                </div>
              </div>
            )}

            {/* ── 수동 입력: 버스 ── */}
            {step === 'manual-2' && (
              <div key="m2" className="animate-fade-in-up">
                <ProgressBar current={2} total={3} />
                <button onClick={() => setStep('manual-1')} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 text-sm mb-3 transition-colors">
                  <ArrowLeft size={14} /> 이전 단계
                </button>
                <ManualStepHeader icon={<Bus size={20} className="text-purple-600" />}
                  title="버스 등록" subtitle="보유 중인 버스를 입력해 주세요." step={2} total={3} />
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <div className="space-y-4">
                    {buses.map((b, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-sm font-semibold text-gray-700">버스 {i + 1}</span>
                          {buses.length > 1 && (
                            <button onClick={() => setBuses(p => p.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {([['busNumber', '버스 번호', '0001'], ['plateNumber', '차량번호 (번호판)', '인천 가 1234'], ['model', '차종 (선택)', '현대 유니버스']] as [keyof BusForm, string, string][]).map(([f, label, ph]) => (
                            <div key={f}>
                              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                              <input value={b[f]} onChange={e => updateBus(i, f, e.target.value)} placeholder={`예: ${ph}`}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setBuses(p => [...p, emptyBus()])}
                    className="mt-3 flex items-center gap-1 text-purple-600 text-sm font-medium"><Plus size={15} /> 버스 추가</button>
                  <ManualActions saving={saving} isLast={false} onSkip={() => setStep('manual-3')} onNext={() => saveManualStep('manual-2')} />
                </div>
              </div>
            )}

            {/* ── 수동 입력: 기사 ── */}
            {step === 'manual-3' && (
              <div key="m3" className="animate-fade-in-up">
                <ProgressBar current={3} total={3} />
                <button onClick={() => setStep('manual-2')} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 text-sm mb-3 transition-colors">
                  <ArrowLeft size={14} /> 이전 단계
                </button>
                <ManualStepHeader icon={<Users size={20} className="text-green-600" />}
                  title="기사 등록"
                  subtitle="전화번호는 필수입니다(앱 로그인 ID). 최초 비밀번호는 ‘이름을 영문 키로 친 글자 + 전화번호 뒷 4자리’로 자동 설정되며(예: 최진호·6788 → chlwlsgh6788), 기사님이 첫 로그인 시 직접 변경합니다."
                  step={3} total={3} />
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <div className="space-y-4">
                    {drivers.map((d, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-sm font-semibold text-gray-700">기사 {i + 1}</span>
                          {drivers.length > 1 && (
                            <button onClick={() => setDrivers(p => p.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">이름 *</label>
                            <input value={d.name} onChange={e => updateDriver(i, 'name', e.target.value)} placeholder="홍길동"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">전화번호 *</label>
                            <input value={d.phone} onChange={e => updateDriver(i, 'phone', e.target.value)} placeholder="010-1234-5678"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">기사 유형</label>
                            <select value={d.driverType} onChange={e => updateDriver(i, 'driverType', e.target.value)}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                              <option value="MAIN">정규 기사</option>
                              <option value="SPARE">예비 기사</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setDrivers(p => [...p, emptyDriver()])}
                    className="mt-3 flex items-center gap-1 text-green-600 text-sm font-medium"><Plus size={15} /> 기사 추가</button>
                  <ManualActions saving={saving} isLast={true} onSkip={() => navigate('/dashboard')} onNext={() => saveManualStep('manual-3')} />
                </div>
              </div>
            )}

            {/* ── 완료 + 다음 할 일 가이드 ── */}
            {step === 'done' && (
              <div key="done" className="animate-fade-in-scale">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 text-center mb-6">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
                    <Check size={36} className="text-green-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">기본 설정 완료!</h2>
                  <p className="text-gray-500 leading-relaxed">
                    기사, 노선, 버스가 모두 등록되었습니다.
                  </p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">이제 이렇게 하시면 됩니다</h3>
                  <div className="space-y-4">
                    <NextStepItem
                      step={1}
                      icon={<Calendar size={20} className="text-blue-600" />}
                      title="배차표 자동 생성"
                      desc="배차 관리 → '배차표 생성' 버튼을 누르면 AI가 공정한 배차표를 만들어 줍니다."
                      action="배차 관리로 이동"
                      onClick={() => navigate('/dashboard/schedules')}
                    />
                    <NextStepItem
                      step={2}
                      icon={<Bell size={20} className="text-green-600" />}
                      title="기사님들에게 앱 설치 안내"
                      desc="기사님께 앱 설치 후 전화번호로 로그인하라고 안내해 주세요. 최초 비밀번호는 ‘이름 영문키 + 전화번호 뒷 4자리’이며, 첫 로그인 시 비밀번호 변경이 필수입니다."
                    />
                    <NextStepItem
                      step={3}
                      icon={<MessageSquare size={20} className="text-purple-600" />}
                      title="회사 운영 정책 설정"
                      desc="시프트 형태(2교대 등), 5근 2휴 사이클, 야간 연속 근무 제한 같은 회사 정책을 설정하세요."
                      action="배차 설정 열기"
                      onClick={() => navigate('/dashboard/settings')}
                    />
                  </div>
                </div>

                <button onClick={() => navigate('/dashboard')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-xl font-semibold text-lg transition-colors inline-flex items-center justify-center gap-2">
                  대시보드로 이동 <ArrowRight size={20} />
                </button>
                <p className="text-center text-xs text-gray-400 mt-3">노선, 버스, 기사는 언제든지 대시보드에서 추가·수정할 수 있습니다</p>
              </div>
            )}

          </>
        </div>
      </div>

      {/* 업로드 경고 모달 — 부모의 transform/animation 영향을 받지 않도록 최상위에 배치 */}
      {showUploadWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 animate-fade-in-scale">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900">잠깐만요 — 양식을 꼭 확인해주세요</h3>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  업로드 파일은 반드시 <span className="font-semibold text-amber-700">Busync에서 제공하는 양식 템플릿</span>으로
                  작성되어야 정확히 인식됩니다.
                </p>
              </div>
            </div>
            <ul className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 space-y-1 mb-5">
              <li>• 자체 배차표·급여대장은 누락·오인식 발생 가능</li>
              <li>• 시트명과 컬럼 순서가 다르면 등록되지 않을 수 있음</li>
              <li>• 템플릿을 받지 않았다면 아래 ‘양식 템플릿 다운로드’ 먼저 진행</li>
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => setShowUploadWarning(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  // 모달을 먼저 닫고(상태 커밋), 다음 틱에 파일 다이얼로그를 연다.
                  // 같은 틱에서 input.click() 을 호출하면 상태 업데이트가 누락돼 모달이 남는다.
                  setShowUploadWarning(false);
                  setTimeout(() => fileInputRef.current?.click(), 0);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
              >
                양식 확인했어요 · 파일 선택
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// 보조 컴포넌트들
// ────────────────────────────────────────────
function EditInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
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

function ManualStepHeader({ icon, title, subtitle, step, total }: {
  icon: React.ReactNode; title: string; subtitle: string; step: number; total: number;
}) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div className="w-11 h-11 bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <span className="text-xs text-gray-400 font-medium">{step}/{total}</span>
        </div>
        <p className="text-sm text-gray-500 leading-snug">{subtitle}</p>
      </div>
    </div>
  );
}

function ManualActions({ saving, isLast, onSkip, onNext }: {
  saving: boolean; isLast: boolean; onSkip: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-100">
      <button onClick={onSkip} className="text-gray-400 hover:text-gray-600 text-sm flex items-center gap-1 transition-colors">
        이 단계 건너뛰기 <ChevronRight size={14} />
      </button>
      <button onClick={onNext} disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-7 py-2.5 rounded-xl font-semibold text-sm transition-colors flex items-center gap-2">
        {saving
          ? <><Loader2 size={16} className="animate-spin" /> 저장 중...</>
          : isLast ? <><Check size={16} /> 완료</> : <>다음 단계 <ArrowRight size={16} /></>}
      </button>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-5">
      <div className="flex justify-between text-xs text-gray-400 mb-1.5">
        <span>단계 {current}/{total}</span>
        <span>{Math.round((current / total) * 100)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-500"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function NextStepItem({ step, icon, title, desc, action, onClick }: {
  step: number; icon: React.ReactNode; title: string; desc: string;
  action?: string; onClick?: () => void;
}) {
  return (
    <div className="flex gap-4 items-start">
      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-gray-500">
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="font-semibold text-gray-800">{title}</span>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
        {action && onClick && (
          <button onClick={onClick}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors">
            {action} <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
