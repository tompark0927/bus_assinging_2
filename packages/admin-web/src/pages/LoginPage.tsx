import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';
import CapsLockHint from '../components/CapsLockHint';

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  // 회원가입 페이지와 동일한 입력 필드 스타일
  const inputCls =
    'w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 focus:border-blue-500 rounded-xl px-4 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-base';

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(companyCode, email, password);
      const { token, user, refreshToken: rt } = res.data.data;
      // 이전 세션(다른 회사)의 캐시가 남아 보이지 않도록 로그인 시 캐시 초기화
      queryClient.clear();
      setAuth(user, token, rt);
      toast.success(`안녕하세요, ${(user as { name: string }).name}님!`);
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '로그인에 실패했습니다. 잠시 후 다시 시도해주세요.';
      // 사라지는 toast 와 별개로, 폼 안에 사라지지 않는 인라인 메시지도 표시
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
          <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">관리자 로그인</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl shadow-black/5 dark:shadow-black/30">
          <form onSubmit={handleEmailLogin} className="space-y-5">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3"
              >
                <AlertCircle size={18} className="text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-300 leading-snug">{error}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">회사 코드</label>
              <input
                type="text"
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
                className={inputCls}
                placeholder="회사 코드"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">아이디 (이메일)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="name@company.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">비밀번호</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pr-12`}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <CapsLockHint />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-4 rounded-xl font-semibold text-base transition-colors"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>

            {/* 비밀번호 / 회사 코드 도움말 링크 */}
            <div className="flex items-center justify-center gap-3 text-sm pt-1">
              <Link to="/forgot-password" className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                비밀번호 찾기
              </Link>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <Link to="/find-company-code" className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                회사 코드 찾기
              </Link>
            </div>
          </form>
        </div>

        {/* Sign-up link below card */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            아직 계정이 없으신가요?{' '}
            <Link
              to="/register"
              className="text-blue-600 dark:text-blue-400 font-semibold hover:underline inline-flex items-center gap-0.5"
            >
              회사 가입하기 <ArrowRight size={14} />
            </Link>
          </p>
          <p className="text-xs text-gray-400 mt-3">© 2026 Busync</p>
        </div>
      </div>
    </div>
  );
}
