import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';
import CapsLockHint from '../components/CapsLockHint';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 회원가입 페이지와 동일한 입력 필드 스타일
  const inputCls =
    'w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 focus:border-blue-500 rounded-xl px-4 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-base';

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.login(companyCode, email, password);
      const { token, user, refreshToken: rt } = res.data.data;
      setAuth(user, token, rt);
      toast.success(`안녕하세요, ${(user as { name: string }).name}님!`);
      navigate('/dashboard');
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          '로그인에 실패했습니다.',
      );
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
                placeholder="admin@your-company.co.kr"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
                required
              />
              <CapsLockHint />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-4 rounded-xl font-semibold text-base transition-colors"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
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
          <p className="text-xs text-gray-400 mt-3">
            © 2026 Busync ·{' '}
            <Link to="/support" className="hover:underline">
              고객 지원
            </Link>{' '}
            ·{' '}
            <Link to="/pricing" className="hover:underline">
              요금제
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
