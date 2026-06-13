import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import secureStore from '../utils/storage';
import { API_BASE_URL } from '../services/serverUrl';
import { queryClient } from '../lib/queryClient';

// 인증 토큰/세션은 expo-secure-store(Keychain/Keystore)에 저장한다.
// 일반 AsyncStorage 는 평문이라 탈옥/루팅·백업 추출에 노출되므로 토큰류에 사용 금지.
// (푸시 토큰 등 비민감 키는 그대로 AsyncStorage 사용)

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
    // 계정 전환 시 이전 사용자의 캐시(잔여 휴가, 배차표, 알림 등)가 보이지 않도록 전부 비운다.
    queryClient.clear();
    await secureStore.setItem('token', token);
    await secureStore.setItem('user', JSON.stringify(user));
    if (refreshToken) {
      await secureStore.setItem('refreshToken', refreshToken);
    }
    set({ user, token });
  },

  updateUser: async (patch) => {
    const cur = useAuthStore.getState().user;
    if (!cur) return;
    const next = { ...cur, ...patch };
    await secureStore.setItem('user', JSON.stringify(next));
    set({ user: next });
  },

  loadAuth: async () => {
    try {
      let token = await secureStore.getItem('token');
      let userStr = await secureStore.getItem('user');

      // 레거시 마이그레이션: 과거 평문(AsyncStorage)에 저장됐던 토큰을 SecureStore 로
      // 1회 이전하고, 평문 잔여 데이터는 제거한다. (없으면 모두 무해한 no-op)
      if (!token) {
        const [legacyToken, legacyUser, legacyRefresh] = await Promise.all([
          AsyncStorage.getItem('token'),
          AsyncStorage.getItem('user'),
          AsyncStorage.getItem('refreshToken'),
        ]);
        if (legacyToken) {
          await secureStore.setItem('token', legacyToken);
          if (legacyUser) await secureStore.setItem('user', legacyUser);
          if (legacyRefresh) await secureStore.setItem('refreshToken', legacyRefresh);
          token = legacyToken;
          userStr = legacyUser;
        }
        await AsyncStorage.multiRemove(['token', 'refreshToken', 'user']);
      }

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
      const token = await secureStore.getItem('token');
      const refreshToken = await secureStore.getItem('refreshToken');
      await notifyServerLogout(token, refreshToken);
    } catch {
      /* ignore */
    }
    // 로컬 정리는 항상 수행 — 토큰류는 SecureStore, 푸시 토큰 등 비민감 키는 AsyncStorage
    await Promise.all([
      secureStore.removeItem('token'),
      secureStore.removeItem('refreshToken'),
      secureStore.removeItem('user'),
      AsyncStorage.multiRemove(PUSH_KEYS),
    ]);
    queryClient.clear(); // react-query 캐시도 비워 다음 계정에 데이터가 새지 않게
    set({ user: null, token: null });
  },
}));
