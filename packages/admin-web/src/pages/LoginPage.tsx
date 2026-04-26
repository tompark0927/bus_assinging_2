import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bus, Mail, Phone, MessageCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

type Tab = 'email' | 'kakao' | 'phone';

// 카카오 SDK 타입 선언
declare global {
  interface Window {
    Kakao: {
      init: (key: string) => void;
      isInitialized: () => boolean;
      Auth: {
        login: (options: {
          success: (authObj: { access_token: string }) => void;
          fail: (err: unknown) => void;
        }) => void;
      };
    };
  }
}

function useKakaoSdk() {
  useEffect(() => {
    const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;
    if (!KAKAO_JS_KEY) return;

    const script = document.createElement('script');
    script.src = 'https://developers.kakao.com/sdk/js/kakao.min.js';
    script.async = true;
    script.onload = () => {
      if (window.Kakao && !window.Kakao.isInitialized()) {
        window.Kakao.init(KAKAO_JS_KEY);
      }
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [tab, setTab] = useState<Tab>('email');
  const [loading, setLoading] = useState(false);

  // 이메일 탭
  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 전화번호 탭
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);

  useKakaoSdk();

  // OTP 타이머
  useEffect(() => {
    if (otpTimer <= 0) return;
    const id = setInterval(() => setOtpTimer(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [otpTimer]);

  const handleSuccess = (token: string, user: unknown, refreshToken?: string) => {
    setAuth(user as Parameters<typeof setAuth>[0], token, refreshToken);
    toast.success(`안녕하세요, ${(user as { name: string }).name}님!`);
    navigate('/dashboard');
  };

  // ── 이메일 로그인
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.login(companyCode, email, password);
      const { token, user, refreshToken: rt } = res.data.data;
      handleSuccess(token, user, rt);
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '로그인에 실패했습니다.'
      );
    } finally {
      setLoading(false);
    }
  };

  // ── 카카오 로그인
  const handleKakaoLogin = () => {
    if (!window.Kakao?.Auth) {
      toast.error('카카오 SDK가 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    setLoading(true);
    window.Kakao.Auth.login({
      success: async ({ access_token }) => {
        try {
          const res = await authApi.kakaoLogin(access_token);
          const { token, user, refreshToken: rt } = res.data.data;
          handleSuccess(token, user, rt);
        } catch (err: unknown) {
          toast.error(
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            '카카오 로그인에 실패했습니다.'
          );
        } finally {
          setLoading(false);
        }
      },
      fail: () => {
        setLoading(false);
        toast.error('카카오 로그인이 취소되었습니다.');
      },
    });
  };

  // ── 전화번호: OTP 발송
  const handleSendOtp = async () => {
    if (!phone) { toast.error('전화번호를 입력해주세요.'); return; }
    setLoading(true);
    try {
      await authApi.sendPhoneOtp(phone);
      setOtpSent(true);
      setOtpTimer(60);
      toast.success('인증번호가 발송되었습니다.');
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '발송 실패'
      );
    } finally {
      setLoading(false);
    }
  };

  // ── 전화번호: OTP 검증
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) { toast.error('인증번호를 입력해주세요.'); return; }
    setLoading(true);
    try {
      const res = await authApi.verifyPhoneOtp(phone, otp);
      const { token, user, refreshToken: rt } = res.data.data;
      handleSuccess(token, user, rt);
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '인증 실패'
      );
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { key: 'email' as Tab, label: '이메일', icon: Mail },
    { key: 'kakao' as Tab, label: '카카오', icon: MessageCircle },
    { key: 'phone' as Tab, label: '전화번호', icon: Phone },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">

        {/* Logo */}
        <div className="flex flex-col items-center mb-7">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
            <span className="font-bold text-white text-3xl">B</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Busync</h1>
          <p className="text-gray-500 mt-1">통합 배차 관리 시스템</p>
        </div>

        {/* Tab selector */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-white shadow text-blue-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* ── 이메일 탭 */}
        {tab === 'email' && (
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">회사 코드</label>
              <input
                type="text"
                value={companyCode}
                onChange={e => setCompanyCode(e.target.value)}
                className="input"
                placeholder="smbus"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">아이디 (이메일)</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
                placeholder="admin@busync.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        )}

        {/* ── 카카오 탭 */}
        {tab === 'kakao' && (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
              카카오 계정의 전화번호 또는 이메일이 시스템에 등록되어 있어야 합니다.
            </div>
            <button
              onClick={handleKakaoLogin}
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-bold text-base flex items-center justify-center gap-3 transition-colors disabled:opacity-60"
              style={{ backgroundColor: '#FEE500', color: '#191919' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919">
                <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.708 1.636 5.093 4.118 6.522L4.9 21l4.645-2.43A11.25 11.25 0 0012 18.6c5.523 0 10-3.477 10-7.8S17.523 3 12 3z"/>
              </svg>
              {loading ? '로그인 중...' : '카카오로 로그인'}
            </button>
            <p className="text-center text-xs text-gray-400">
              VITE_KAKAO_JS_KEY 환경 변수 설정 필요
            </p>
          </div>
        )}

        {/* ── 전화번호 탭 */}
        {tab === 'phone' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">전화번호</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="input flex-1"
                  placeholder="010-1234-5678"
                  disabled={otpSent}
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={loading || (otpTimer > 0)}
                  className="btn-secondary whitespace-nowrap px-3 text-sm"
                >
                  {otpTimer > 0 ? `${otpTimer}초` : otpSent ? '재발송' : '인증번호'}
                </button>
              </div>
            </div>

            {otpSent && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">인증번호</label>
                <input
                  type="text"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  className="input"
                  placeholder="6자리 입력"
                  maxLength={6}
                  autoFocus
                />
              </div>
            )}

            {otpSent && (
              <button type="submit" disabled={loading || !otp} className="btn-primary w-full py-3 text-base">
                {loading ? '확인 중...' : '로그인'}
              </button>
            )}

            {!otpSent && (
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={loading || !phone}
                className="btn-primary w-full py-3 text-base"
              >
                {loading ? '발송 중...' : '인증번호 받기'}
              </button>
            )}
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          © 2024 Busync 배차 관리 시스템
        </p>
      </div>
    </div>
  );
}
