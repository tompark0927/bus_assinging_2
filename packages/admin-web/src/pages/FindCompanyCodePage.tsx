import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, MessageSquare, Building2 } from 'lucide-react';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

function extractMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; errors?: { message: string }[] } } })?.response?.data;
  return data?.errors?.[0]?.message || data?.message || fallback;
}

export default function FindCompanyCodePage() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const inputCls =
    'w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 focus:border-blue-500 rounded-xl px-4 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-base';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.findCompanyCode(phone.trim());
      toast.success(res.data?.message || '문자를 발송했습니다.');
      setSent(true);
    } catch (err) {
      const msg = extractMessage(err, '요청 처리에 실패했습니다.');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center" aria-label="Busync 홈">
            <img
              src="/busync-lockup.png"
              alt="Busync"
              className="h-[52px] w-auto object-contain dark:bg-white dark:rounded-lg dark:px-2 dark:py-1"
            />
          </Link>
          <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">회사 코드 찾기</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl shadow-black/5 dark:shadow-black/30">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-500/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <MessageSquare size={30} className="text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">문자를 확인해주세요</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                입력하신 번호로 가입된 회사 코드가 있다면 문자로 발송했습니다.<br />
                잠시 후 휴대폰 문자를 확인해주세요.
              </p>
              <button
                onClick={() => { setSent(false); setPhone(''); }}
                className="mt-6 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                다른 번호로 다시 찾기
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-start gap-2.5 text-gray-500 dark:text-gray-400">
                <Building2 size={18} className="mt-0.5 flex-shrink-0" />
                <p className="text-sm leading-relaxed">
                  가입 시 등록한 휴대폰 번호를 입력하시면, 해당 번호로 가입된 회사 코드를 문자로 보내드립니다.
                </p>
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3">
                  <AlertCircle size={18} className="text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300 leading-snug">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">휴대폰 번호</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputCls}
                  placeholder="010-1234-5678"
                  required
                />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-4 rounded-xl font-semibold text-base transition-colors">
                {loading ? '발송 중...' : '회사 코드 문자로 받기'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-6 text-center space-y-2">
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <ArrowLeft size={14} /> 로그인으로 돌아가기
          </Link>
          <p className="text-sm text-gray-400">
            비밀번호를 잊으셨나요?{' '}
            <Link to="/forgot-password" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">비밀번호 재설정</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
