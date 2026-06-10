import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

// 백엔드 검증 에러({ message, errors:[{message}] })에서 사람이 읽을 메시지 추출
function extractMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; errors?: { message: string }[] } } })?.response?.data;
  return data?.errors?.[0]?.message || data?.message || fallback;
}

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [companyCode, setCompanyCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [emailHint, setEmailHint] = useState('');

  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const inputCls =
    'w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 focus:border-blue-500 rounded-xl px-4 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-base';

  // ── 1단계: 본인확인 → OTP 발송 ──
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.forgotPasswordSendOtp(companyCode.trim(), identifier.trim());
      setEmailHint(res.data?.data?.emailHint || '');
      toast.success('인증번호를 발송했습니다.');
      setStep(2);
    } catch (err) {
      const msg = extractMessage(err, '인증번호 발송에 실패했습니다.');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── 2단계: OTP 검증 + 새 비밀번호 설정 → 자동 로그인 ──
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.forgotPasswordReset(companyCode.trim(), identifier.trim(), otp.trim(), newPassword);
      const { token, user, refreshToken: rt } = res.data.data;
      setAuth(user, token, rt);
      toast.success('비밀번호가 변경되었습니다. 로그인되었습니다.');
      navigate('/dashboard');
    } catch (err) {
      const msg = extractMessage(err, '비밀번호 재설정에 실패했습니다.');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center" aria-label="Busync 홈">
            <img
              src="/busync-lockup.png"
              alt="Busync"
              className="h-[52px] w-auto object-contain dark:bg-white dark:rounded-lg dark:px-2 dark:py-1"
            />
          </Link>
          <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">비밀번호 재설정</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl shadow-black/5 dark:shadow-black/30">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            <StepDot active={step >= 1} done={step > 1} label="본인 확인" n={1} />
            <div className={`flex-1 h-0.5 rounded ${step > 1 ? 'bg-blue-600' : 'bg-gray-200 dark:bg-white/10'}`} />
            <StepDot active={step >= 2} done={false} label="비밀번호 변경" n={2} />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 mb-5">
              <AlertCircle size={18} className="text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300 leading-snug">{error}</p>
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                회사 코드와 아이디(이메일 또는 사원번호)를 입력하시면, 가입 시 등록한 이메일로 인증번호를 보내드립니다.
              </p>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">회사 코드</label>
                <input type="text" value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} className={inputCls} placeholder="회사 코드" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">아이디 (이메일 / 사원번호)</label>
                <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={inputCls} placeholder="name@company.com 또는 사원번호" required />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-4 rounded-xl font-semibold text-base transition-colors">
                {loading ? '발송 중...' : '인증번호 받기'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-5">
              <div className="flex items-start gap-2.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl px-4 py-3">
                <ShieldCheck size={18} className="text-blue-500 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-700 dark:text-blue-300 leading-snug">
                  {emailHint ? <><span className="font-semibold">{emailHint}</span> (으)로 인증번호를 보냈습니다.</> : '등록된 이메일로 인증번호를 보냈습니다.'}
                  <br />메일이 오지 않으면 스팸함도 확인해 주세요.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">인증번호 (6자리)</label>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className={`${inputCls} tracking-[0.4em] text-center font-semibold`} placeholder="••••••" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">새 비밀번호</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={`${inputCls} pr-12`}
                    placeholder="새 비밀번호"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'} tabIndex={-1}>
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">영문·숫자·특수문자를 포함해 8자 이상</p>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-4 rounded-xl font-semibold text-base transition-colors inline-flex items-center justify-center gap-2">
                {loading ? '변경 중...' : <><CheckCircle2 size={18} /> 비밀번호 변경하기</>}
              </button>
              <button type="button" onClick={() => { setStep(1); setOtp(''); setNewPassword(''); setError(''); }} className="w-full text-center text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                회사 코드 / 아이디 다시 입력
              </button>
            </form>
          )}
        </div>

        {/* Footer links */}
        <div className="mt-6 text-center space-y-2">
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <ArrowLeft size={14} /> 로그인으로 돌아가기
          </Link>
          <p className="text-sm text-gray-400">
            회사 코드를 잊으셨나요?{' '}
            <Link to="/find-company-code" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">회사 코드 찾기</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function StepDot({ active, done, label, n }: { active: boolean; done: boolean; label: string; n: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-white/10 text-gray-400'}`}>
        {done ? <CheckCircle2 size={16} /> : n}
      </div>
      <span className={`text-xs font-medium ${active ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>{label}</span>
    </div>
  );
}
