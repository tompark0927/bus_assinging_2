import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowLeft,
  Building2,
  User,
  Check,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  Phone,
  Mail,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { companyApi, authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import CapsLockHint from '../components/CapsLockHint';

type Step = 1 | 2 | 3;

/* ------------------------------------------------------------------ */
/*  Password strength                                                  */
/* ------------------------------------------------------------------ */
function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score: 1, label: '약함', color: 'bg-red-500' };
  if (score <= 2) return { score: 2, label: '보통', color: 'bg-yellow-500' };
  if (score <= 3) return { score: 3, label: '좋음', color: 'bg-blue-500' };
  return { score: 4, label: '강력', color: 'bg-green-500' };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function RegisterPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const [form, setForm] = useState({
    companyName: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    adminPasswordConfirm: '',
    adminPhone: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});

  // 이메일 인증 상태
  const [otpSent, setOtpSent] = useState(false);     // 인증번호 발송됨
  const [emailOtp, setEmailOtp] = useState('');      // 입력한 인증번호
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerifyToken, setEmailVerifyToken] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    // 이메일을 바꾸면 기존 인증은 무효화 (토큰이 옛 이메일용이므로)
    if (field === 'adminEmail') {
      setEmailVerified(false);
      setEmailVerifyToken('');
      setOtpSent(false);
      setEmailOtp('');
    }
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail.trim());

  const handleSendEmailOtp = async () => {
    if (!emailValid) { setErrors((p) => ({ ...p, adminEmail: '올바른 이메일을 입력해주세요.' })); return; }
    setSendingOtp(true);
    try {
      await authApi.sendEmailOtp(form.adminEmail.trim());
      setOtpSent(true);
      toast.success('인증번호를 이메일로 보냈습니다. 메일함을 확인해주세요.');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '인증번호 발송에 실패했습니다.');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    if (!emailOtp.trim()) return;
    setVerifyingOtp(true);
    try {
      const res = await authApi.verifyEmailOtp(form.adminEmail.trim(), emailOtp.trim());
      setEmailVerifyToken(res.data.data.emailVerifyToken);
      setEmailVerified(true);
      toast.success('이메일 인증 완료!');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '인증번호가 올바르지 않습니다.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const strength = useMemo(() => getPasswordStrength(form.adminPassword), [form.adminPassword]);

  /* ---- Step navigation ---- */
  const handleStep1Next = () => {
    const errs: typeof errors = {};
    if (!form.companyName.trim()) errs.companyName = '회사명을 입력해주세요.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setStep(2);
  };

  const handleStep2Next = () => {
    const errs: typeof errors = {};
    if (!form.adminName.trim()) errs.adminName = '이름을 입력해주세요.';
    if (!form.adminEmail.trim()) errs.adminEmail = '이메일을 입력해주세요.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) errs.adminEmail = '올바른 이메일 형식이 아닙니다.';
    else if (!emailVerified) errs.adminEmail = '이메일 인증을 완료해주세요.';
    if (!form.adminPhone.trim()) errs.adminPhone = '전화번호를 입력해주세요.';
    if (form.adminPassword.length < 8) errs.adminPassword = '비밀번호는 8자 이상이어야 합니다.';
    if (form.adminPassword !== form.adminPasswordConfirm) errs.adminPasswordConfirm = '비밀번호가 일치하지 않습니다.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setStep(3);
  };

  /* ---- Submit ---- */
  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await companyApi.register({
        companyName: form.companyName,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
        adminPhone: form.adminPhone,
        emailVerifyToken,
      });
      const { token, user, company } = res.data.data;
      setAuth(user, token);
      const code = (company as { code?: string } | undefined)?.code;
      toast.success(code ? `회사 등록 완료! 회사코드: ${code}` : '회사 등록이 완료되었습니다!');
      navigate('/dashboard/onboarding');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '등록 중 오류가 발생했습니다.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  /* ---- Helpers ---- */
  const STEPS = [
    { num: 1, label: '회사 정보' },
    { num: 2, label: '관리자 계정' },
    { num: 3, label: '확인' },
  ];

  const inputCls = (field: keyof typeof form) =>
    `w-full bg-white dark:bg-white/5 border ${
      errors[field] ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-white/10 focus:border-blue-500'
    } rounded-xl px-4 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-base`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center" aria-label="Busync 홈">
            <img
              src="/busync-lockup.png"
              alt="Busync"
              className="h-[52px] w-auto object-contain dark:bg-white dark:rounded-lg dark:px-2 dark:py-1"
            />
          </Link>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    step > s.num
                      ? 'bg-green-500 text-white'
                      : step === s.num
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                        : 'bg-gray-200 dark:bg-white/10 text-gray-400'
                  }`}
                >
                  {step > s.num ? <Check size={16} /> : s.num}
                </div>
                <span className={`text-xs font-medium ${step >= s.num ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-12 h-0.5 mb-5 transition-all ${step > s.num ? 'bg-green-500' : 'bg-gray-200 dark:bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl shadow-black/5 dark:shadow-black/30">
          {/* ========== STEP 1 ========== */}
          {step === 1 && (
            <div className="animate-in fade-in">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-11 h-11 bg-blue-50 dark:bg-blue-500/10 rounded-xl flex items-center justify-center">
                  <Building2 size={22} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">회사 정보</h2>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">버스 회사 정보를 입력해주세요</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    회사명 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.companyName}
                    onChange={set('companyName')}
                    placeholder="예: OO버스"
                    className={inputCls('companyName')}
                  />
                  {errors.companyName && <p className="text-red-500 text-xs mt-1.5">{errors.companyName}</p>}
                  <p className="text-gray-400 text-xs mt-1.5">회사 코드는 회사명을 바탕으로 자동 생성됩니다. (기사 앱 로그인 시 회사를 식별하는 코드)</p>
                </div>
              </div>

              <button
                onClick={handleStep1Next}
                className="w-full mt-8 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
              >
                다음 단계
                <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* ========== STEP 2 ========== */}
          {step === 2 && (
            <div className="animate-in fade-in">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-11 h-11 bg-purple-50 dark:bg-purple-500/10 rounded-xl flex items-center justify-center">
                  <User size={22} className="text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">관리자 계정</h2>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">관리자 정보를 입력해주세요</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    <User size={14} className="inline mr-1 -mt-0.5" />
                    이름 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.adminName}
                    onChange={set('adminName')}
                    placeholder="홍길동"
                    className={inputCls('adminName')}
                  />
                  {errors.adminName && <p className="text-red-500 text-xs mt-1.5">{errors.adminName}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    <Mail size={14} className="inline mr-1 -mt-0.5" />
                    이메일 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={form.adminEmail}
                      onChange={set('adminEmail')}
                      placeholder="name@company.com"
                      disabled={emailVerified}
                      className={`${inputCls('adminEmail')} flex-1 ${emailVerified ? 'opacity-70' : ''}`}
                    />
                    {emailVerified ? (
                      <span className="shrink-0 inline-flex items-center gap-1.5 px-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-300 dark:border-green-500/30 text-green-700 dark:text-green-300 text-sm font-semibold">
                        <CheckCircle2 size={16} /> 인증됨
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendEmailOtp}
                        disabled={!emailValid || sendingOtp}
                        className="shrink-0 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors whitespace-nowrap"
                      >
                        {sendingOtp ? '발송 중...' : otpSent ? '재전송' : '인증'}
                      </button>
                    )}
                  </div>
                  {errors.adminEmail && <p className="text-red-500 text-xs mt-1.5">{errors.adminEmail}</p>}

                  {/* 인증번호 입력 (발송 후, 미인증 상태에서만) */}
                  {otpSent && !emailVerified && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={emailOtp}
                        onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ''))}
                        placeholder="인증번호 6자리"
                        className="flex-1 bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 focus:border-blue-500 rounded-xl px-4 py-3 text-gray-900 dark:text-white tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyEmailOtp}
                        disabled={emailOtp.length < 4 || verifyingOtp}
                        className="shrink-0 px-5 rounded-xl bg-gray-800 dark:bg-white/10 hover:bg-gray-900 dark:hover:bg-white/20 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                      >
                        {verifyingOtp ? '확인 중...' : '확인'}
                      </button>
                    </div>
                  )}
                  {otpSent && !emailVerified && (
                    <p className="text-xs text-gray-400 mt-1.5">메일로 받은 6자리 인증번호를 입력하세요. (5분 유효, 안 오면 스팸함 확인)</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    <Phone size={14} className="inline mr-1 -mt-0.5" />
                    전화번호 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={form.adminPhone}
                    onChange={set('adminPhone')}
                    placeholder="010-1234-5678"
                    className={inputCls('adminPhone')}
                  />
                  {errors.adminPhone && <p className="text-red-500 text-xs mt-1.5">{errors.adminPhone}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    <Lock size={14} className="inline mr-1 -mt-0.5" />
                    비밀번호 <span className="text-red-500">*</span>
                    <span className="text-gray-400 font-normal ml-1">(8자 이상)</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.adminPassword}
                      onChange={set('adminPassword')}
                      placeholder="••••••••"
                      className={inputCls('adminPassword')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <CapsLockHint />
                  {errors.adminPassword && <p className="text-red-500 text-xs mt-1.5">{errors.adminPassword}</p>}

                  {/* Password strength */}
                  {form.adminPassword && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[1, 2, 3, 4].map((level) => (
                          <div
                            key={level}
                            className={`h-1.5 flex-1 rounded-full transition-all ${
                              level <= strength.score ? strength.color : 'bg-gray-200 dark:bg-white/10'
                            }`}
                          />
                        ))}
                      </div>
                      <p className={`text-xs ${strength.score <= 1 ? 'text-red-500' : strength.score <= 2 ? 'text-yellow-500' : strength.score <= 3 ? 'text-blue-500' : 'text-green-500'}`}>
                        비밀번호 강도: {strength.label}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    <ShieldCheck size={14} className="inline mr-1 -mt-0.5" />
                    비밀번호 확인 <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswordConfirm ? 'text' : 'password'}
                      value={form.adminPasswordConfirm}
                      onChange={set('adminPasswordConfirm')}
                      placeholder="••••••••"
                      className={inputCls('adminPasswordConfirm')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    >
                      {showPasswordConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <CapsLockHint />
                  {errors.adminPasswordConfirm && (
                    <p className="text-red-500 text-xs mt-1.5">{errors.adminPasswordConfirm}</p>
                  )}
                  {form.adminPasswordConfirm && form.adminPassword === form.adminPasswordConfirm && (
                    <p className="text-green-500 text-xs mt-1.5 flex items-center gap-1">
                      <Check size={12} /> 비밀번호가 일치합니다.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setStep(1)}
                  className="px-6 py-4 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-700 dark:text-white rounded-xl font-semibold transition-colors flex items-center gap-2 text-base"
                >
                  <ArrowLeft size={18} />
                  이전
                </button>
                <button
                  onClick={handleStep2Next}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 text-base"
                >
                  다음 단계
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* ========== STEP 3 — Confirmation ========== */}
          {step === 3 && (
            <div className="animate-in fade-in">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-11 h-11 bg-green-50 dark:bg-green-500/10 rounded-xl flex items-center justify-center">
                  <CheckCircle2 size={22} className="text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">입력 정보 확인</h2>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">아래 내용이 맞는지 확인해주세요</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Company info */}
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-5 border border-gray-200 dark:border-white/10">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={16} className="text-blue-600 dark:text-blue-400" />
                    <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300">회사 정보</h3>
                    <button
                      onClick={() => setStep(1)}
                      className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      수정
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-400 text-xs">회사명</span>
                      <p className="font-medium text-gray-900 dark:text-white">{form.companyName}</p>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">회사 코드</span>
                      <p className="font-medium text-gray-900 dark:text-white">가입 완료 시 자동 생성</p>
                    </div>
                  </div>
                </div>

                {/* Admin info */}
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-5 border border-gray-200 dark:border-white/10">
                  <div className="flex items-center gap-2 mb-3">
                    <User size={16} className="text-purple-600 dark:text-purple-400" />
                    <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300">관리자 정보</h3>
                    <button
                      onClick={() => setStep(2)}
                      className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      수정
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-400 text-xs">이름</span>
                      <p className="font-medium text-gray-900 dark:text-white">{form.adminName}</p>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">전화번호</span>
                      <p className="font-medium text-gray-900 dark:text-white">{form.adminPhone}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-400 text-xs">이메일</span>
                      <p className="font-medium text-gray-900 dark:text-white">{form.adminEmail}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setStep(2)}
                  className="px-6 py-4 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-700 dark:text-white rounded-xl font-semibold transition-colors flex items-center gap-2 text-base"
                >
                  <ArrowLeft size={18} />
                  이전
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-4 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 text-base"
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> 등록 중...
                    </>
                  ) : (
                    <>
                      무료로 시작하기 <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-gray-500 text-sm mt-6">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="text-blue-600 dark:text-blue-400 hover:underline font-semibold transition-colors">
            로그인
          </Link>
        </p>
        <p className="text-center text-xs text-gray-400 mt-3">© 2026 Busync</p>
      </div>
    </div>
  );
}
