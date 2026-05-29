import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../services/serverUrl';

// Inlined to avoid circular import (authStore → notifications → api → authStore)
const PUSH_KEYS = ['push:pendingToken', 'push:registeredToken'];

/**
 * Best-effort 서버 logout — refreshToken 폐기 알림.
 * api.ts 의 axios 인스턴스 (인터셉터 → authStore) 를 거치지 않기 위해 raw fetch 사용 →
 * 순환 의존성 회피. 실패해도 클라이언트 정리는 진행한다.
 */
async function notifyServerLogout(token: string | null, refreshToken: string | null): Promise<void> {
  if (!token) return;
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
  } catch {
    // 오프라인이거나 토큰 만료 → 무시. 클라이언트 정리만 진행.
  }
}

interface User {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  employeeId: string;
  driverType?: string | null;
  mustChangePassword?: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoaded: boolean;
  setAuth: (user: User, token: string, refreshToken?: string) => Promise<void>;
  updateUser: (patch: Partial<User>) => Promise<void>;
  loadAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoaded: false,

  setAuth: async (user, token, refreshToken?) => {
    await AsyncStorage.setItem('token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    if (refreshToken) {
      await AsyncStorage.setItem('refreshToken', refreshToken);
    }
    set({ user, token });
  },

  updateUser: async (patch) => {
    const cur = useAuthStore.getState().user;
    if (!cur) return;
    const next = { ...cur, ...patch };
    await AsyncStorage.setItem('user', JSON.stringify(next));
    set({ user: next });
  },

  loadAuth: async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const userStr = await AsyncStorage.getItem('user');
      if (token && userStr) {
        set({ user: JSON.parse(userStr), token, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  logout: async () => {
    // 서버 폐기 먼저 (refreshToken 이 살아있는 동안) — best-effort
    try {
      const token = await AsyncStorage.getItem('token');
      const refreshToken = await AsyncStorage.getItem('refreshToken');
      await notifyServerLogout(token, refreshToken);
    } catch {
      /* ignore */
    }
    // 로컬 정리는 항상 수행
    await AsyncStorage.multiRemove([
      'token',
      'refreshToken',
      'user',
      ...PUSH_KEYS,
    ]);
    set({ user: null, token: null });
  },
}));
