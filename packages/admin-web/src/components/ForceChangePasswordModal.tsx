import { useState } from 'react';
import { Loader2, Lock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

/**
 * 최초 로그인(자동 발급 비밀번호) 계정에 대한 강제 비밀번호 변경 화면.
 * user.mustChangePassword 가 true 인 동안 대시보드를 가리고, 변경 완료 전까지 벗어날 수 없다.
 * 이 세션은 이미 인증된 상태라 현재 비밀번호 없이 새 비밀번호만 설정한다(백엔드가 허용).
 */
export default function ForceChangePasswordModal({ onLogout }: { onLogout: () => void }) {
  const clearFlag = useAuthStore((s) => s.clearMustChangePassword);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (pw.length < 6) { toast.error('새 비밀번호는 6자 이상이어야 합니다.'); return; }
    if (pw !== confirm) { toast.error('비밀번호가 일치하지 않습니다.'); return; }
    setSaving(true);
    try {
      await authApi.changePassword({ newPassword: pw });
      clearFlag();
      toast.success('비밀번호가 변경되었습니다.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '비밀번호 변경에 실패했습니다.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl shadow-xl p-8">
        <div className="w-14 h-14 bg-blue-100 dark:bg-blue-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Lock size={26} className="text-blue-600 dark:text-blue-400" />
        </div>
        <h1 className="text-[22px] font-bold text-center text-gray-900 dark:text-gray-100">비밀번호 변경이 필요합니다</h1>
        <p className="text-[14px] text-center text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
          초기 비밀번호로 로그인하셨습니다.<br />보안을 위해 새 비밀번호를 설정해주세요.
        </p>

        <div className="mt-6 space-y-3">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="새 비밀번호 (6자 이상)"
              className="w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-3 py-2.5 pr-10 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <input
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="새 비밀번호 확인"
            className="w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {confirm && pw !== confirm && (
            <p className="text-[13px] text-red-500">비밀번호가 일치하지 않습니다.</p>
          )}
        </div>

        <button
          onClick={submit}
          disabled={saving}
          className="w-full mt-5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={18} className="animate-spin" />}
          변경하고 시작하기
        </button>
        <button
          onClick={onLogout}
          className="w-full mt-2 text-[14px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 py-2"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
