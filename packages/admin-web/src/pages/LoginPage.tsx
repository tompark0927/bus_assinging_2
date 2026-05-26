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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative blob — same as Register */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] opacity-20 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-600 blur-[120px] rounded-full" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center" aria-label="Busync 홈">
            <img
              src="/busync-lockup.png"
              alt="Busync"
              className="h-10 w-auto object-contain dark:bg-white dark:rounded-lg dark:px-2 dark:py-1"
            />
          </Link>
          <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">관리자 로그인</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl shadow-black/5 dark:shadow-black/30">
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">회사 코드</label>
              <input
                type="text"
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
                className="input"
                placeholder="회사 코드"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">아이디 (이메일)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="admin@your-company.co.kr"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                required
              />
              <CapsLockHint />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base"
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
