import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../services/api';

interface User {
  id: number;
  companyId: number;
  name: string;
  email: string;
  role: string;
  employeeId: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  setAuth: (user: User, token: string, refreshToken?: string) => void;
  setToken: (token: string) => void;
  /** 서버에 refreshToken 폐기 요청 + 클라이언트 상태 정리 */
  logout: () => Promise<void>;
  /** 동기 로컬 정리만 — 401 인터셉터 등에서 호출 */
  clearLocal: () => void;
  isAuthenticated: () => boolean;
}

/**
 * 단일 진실 공급원: zustand persist (`auth-storage` 키)
 * 절대 `localStorage.setItem('token', ...)` 으로 별도 저장 금지
 *  → api.ts 인터셉터도 이 store 에서 직접 토큰을 읽도록 수정.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,

      setAuth: (user, token, refreshToken) => {
        set({ user, token, refreshToken: refreshToken ?? get().refreshToken });
      },

      setToken: (token) => {
        set({ token });
      },

      logout: async () => {
        // Best-effort 서버 폐기 — 네트워크 오류 시에도 클라이언트는 정리한다.
        const refresh = get().refreshToken;
        try {
          await authApi.logout(refresh);
        } catch {
          /* ignore */
        }
        set({ user: null, token: null, refreshToken: null });
      },

      clearLocal: () => {
        set({ user: null, token: null, refreshToken: null });
      },

      isAuthenticated: () => !!get().token,
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);
