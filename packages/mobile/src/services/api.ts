import axios, { AxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from 'react-native';

import { enqueueRequest, startQueueListener } from './offlineQueue';
import { setCache, getCache } from './offlineCache';

// 개발: __DEV__ 모드일 때 로컬 서버 사용, 프로덕션일 때 app.json의 apiUrl 사용
// 물리 기기에서는 localhost가 아닌 개발 머신의 IP를 사용해야 함
import Constants from 'expo-constants';
import { Platform } from 'react-native';

function getDevApiUrl(): string {
  // expo-constants에 debuggerHost가 있으면 그 IP를 사용 (물리 기기 대응)
  const debuggerHost = Constants.expoConfig?.hostUri ?? Constants.manifest2?.extra?.expoGo?.debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0]; // "192.168.x.x:8081" → "192.168.x.x"
    return `http://${host}:4000/api/v1`;
  }
  // iOS 시뮬레이터는 localhost, Android 에뮬레이터는 10.0.2.2
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:4000/api/v1'
    : 'http://localhost:4000/api/v1';
}

const PRODUCTION_API_URL = (Constants.expoConfig?.extra?.apiUrl as string) || 'https://api.busync.kr/api/v1';

const API_BASE_URL = __DEV__
  ? getDevApiUrl()
  : PRODUCTION_API_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

// Start listening for connectivity to auto-process queued requests
startQueueListener();

// Track whether we've already shown the offline alert this session
let offlineAlertShown = false;
let lastOnlineState = true;

// Listen for connectivity changes to reset the alert flag
NetInfo.addEventListener((state) => {
  if (state.isConnected && !lastOnlineState) {
    offlineAlertShown = false; // Reset so we can show again next time
  }
  lastOnlineState = !!state.isConnected;
});

function showOfflineAlert(): void {
  if (!offlineAlertShown) {
    offlineAlertShown = true;
    Alert.alert(
      '오프라인 모드',
      '인터넷에 연결되어 있지 않습니다. 일부 기능이 제한될 수 있습니다.',
    );
  }
}

/** Check if the device is currently online */
async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!state.isConnected;
}

/** Determine if a request method is a read operation */
function isReadMethod(method?: string): boolean {
  return !method || method.toLowerCase() === 'get';
}

/** Build a cache key from the request config */
function buildCacheEndpoint(config: AxiosRequestConfig): string {
  const base = config.url || '';
  // Include query params in cache key for GET requests
  if (config.params) {
    const qs = new URLSearchParams(config.params).toString();
    return qs ? `${base}?${qs}` : base;
  }
  return base;
}

// ─────────────────────────────────────────
// Request interceptor: auth token + offline handling
// ─────────────────────────────────────────
api.interceptors.request.use(async (config) => {
  try {
    const token = await AsyncStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {}
  return config;
});

// ─────────────────────────────────────────
// Response interceptor: cache successful GET responses
// ─────────────────────────────────────────
api.interceptors.response.use(
  async (res) => {
    // Cache successful GET responses
    if (isReadMethod(res.config.method)) {
      const endpoint = buildCacheEndpoint(res.config);
      await setCache(endpoint, res.data);
    }
    return res;
  },
  async (err) => {
    const config = err.config as AxiosRequestConfig & { _retry?: boolean };
    const isNetworkError =
      !err.response && (err.code === 'ERR_NETWORK' || err.message === 'Network Error');

    if (isNetworkError || !(await isOnline())) {
      showOfflineAlert();

      if (isReadMethod(config?.method)) {
        // For reads, try to return cached data
        const endpoint = buildCacheEndpoint(config);
        const cached = await getCache(endpoint);
        if (cached) {
          return { data: cached, status: 200, statusText: 'OK (cached)', headers: {}, config };
        }
      } else if (config) {
        // For writes, queue the request for later
        const fullUrl = config.baseURL
          ? `${config.baseURL}${config.url || ''}`
          : config.url || '';
        await enqueueRequest(
          (config.method || 'post') as 'post' | 'put' | 'delete' | 'patch',
          fullUrl,
          config.data ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data) : undefined,
          config.headers as Record<string, string> | undefined,
        );
        // Return a synthetic response so the UI doesn't crash
        return {
          data: { queued: true, message: '요청이 저장되었습니다. 인터넷 연결 시 자동으로 처리됩니다.' },
          status: 202,
          statusText: 'Queued',
          headers: {},
          config,
        };
      }
    }

    // ─────────────────────────────────────────
    // 토큰 자동 갱신 (Silent Refresh) + 토큰 회전
    // ─────────────────────────────────────────
    const originalRequest = err.config as typeof err.config & { _retry?: boolean };

    // refresh 엔드포인트 자체가 401이면 → 로그아웃
    if (err.response?.status === 401 && originalRequest?.url?.includes('/auth/refresh')) {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('refreshToken');
      await AsyncStorage.removeItem('user');
      return Promise.reject(err);
    }

    // 401이고 아직 재시도 안 한 요청이면 → 토큰 갱신 시도
    if (err.response?.status === 401 && !originalRequest?._retry) {
      const refreshToken = await AsyncStorage.getItem('refreshToken');

      if (!refreshToken) {
        await AsyncStorage.removeItem('token');
        await AsyncStorage.removeItem('refreshToken');
        await AsyncStorage.removeItem('user');
        return Promise.reject(err);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        const newToken = data.data.accessToken || data.data.token;
        const newRefreshToken = data.data.refreshToken;

        await AsyncStorage.setItem('token', newToken);
        if (newRefreshToken) {
          await AsyncStorage.setItem('refreshToken', newRefreshToken);
        }

        processQueue(null, newToken);

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await AsyncStorage.removeItem('token');
        await AsyncStorage.removeItem('refreshToken');
        await AsyncStorage.removeItem('user');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  },
);

// ─────────────────────────────────────────
// Token refresh queue (unchanged logic)
// ─────────────────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
}

export default api;

export const authApi = {
  login: (companyCode: string, email: string, password: string) =>
    api.post('/auth/login', { companyCode, email, password }),
  kakaoLoginWithCode: (code: string, redirectUri: string) =>
    api.post('/auth/kakao', { code, redirectUri }),
  sendPhoneOtp: (phone: string) =>
    api.post('/auth/phone/send-otp', { phone }),
  verifyPhoneOtp: (phone: string, otp: string) =>
    api.post('/auth/phone/verify', { phone, otp }),
  getMe: () => api.get('/auth/me'),
  updatePushToken: (expoPushToken: string) =>
    api.put('/auth/push-token', { expoPushToken }),
};

export const schedulesApi = {
  getMySchedule: (year: number, month: number) =>
    api.get(`/schedules/${year}/${month}`),
  list: () => api.get('/schedules'),
};

export const dayOffApi = {
  list: () => api.get('/dayoff'),
  create: (date: string, reason?: string) =>
    api.post('/dayoff', { date, reason }),
  cancel: (id: number) => api.delete(`/dayoff/${id}`),
};

export const emergencyApi = {
  list: () => api.get('/emergency', { params: { status: 'OPEN' } }),
  accept: (id: number) => api.put(`/emergency/${id}/accept`),
  create: (slotId: number, reason: string) =>
    api.post('/emergency', { slotId, reason }),
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  markRead: (id: number) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
};

export const approvalsApi = {
  list: (params?: Record<string, string>) => api.get('/approvals', { params }),
  get: (id: number) => api.get(`/approvals/${id}`),
  create: (payload: { type: string; title: string; content: string; data?: Record<string, unknown> }) =>
    api.post('/approvals', payload),
  process: (id: number, action: 'approve' | 'reject', comment?: string) =>
    api.put(`/approvals/${id}/process`, { action, comment }),
  cancel: (id: number) => api.delete(`/approvals/${id}`),
  stats: () => api.get('/approvals/stats'),
};

export const attendanceApi = {
  todayStatus: () => api.get('/attendance/today'),
  checkIn: (latitude: number, longitude: number) =>
    api.post('/attendance/check-in', { latitude, longitude }),
  checkOut: (latitude: number, longitude: number) =>
    api.post('/attendance/check-out', { latitude, longitude }),
};

export const postsApi = {
  list: (params?: Record<string, string | number>) => api.get('/posts', { params }),
  get: (id: number) => api.get(`/posts/${id}`),
  create: (data: { boardType: string; title: string; content: string; isAnonymous?: boolean }) =>
    api.post('/posts', data),
};

export const routesApi = {
  list: () => api.get('/routes'),
};

export const driverPreferencesApi = {
  list: () => api.get('/driver-preferences'),
  update: (preferences: { routeId: number; priority: number }[]) =>
    api.put('/driver-preferences', { routes: preferences }),
};

export const goldenTicketsApi = {
  list: () => api.get('/golden-tickets'),
};

export const dmApi = {
  conversations: () => api.get('/dm/conversations'),
  messages: (partnerId: number) => api.get(`/dm/${partnerId}`),
  send: (receiverId: number, content: string) =>
    api.post('/dm', { receiverId, content }),
  unreadCount: () => api.get('/dm/unread-count'),
  users: () => api.get('/dm/users'),
};
