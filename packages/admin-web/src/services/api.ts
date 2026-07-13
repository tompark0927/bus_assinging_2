import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

/**
 * 단일 진실 공급원: zustand persist `auth-storage` 키.
 * api.ts 는 authStore 를 import 하지 않고 (순환 import 방지)
 * persist 가 쓴 JSON 블롭을 직접 읽고 쓴다. 포맷이 바뀌면 양쪽 같이 수정해야 함.
 */
const AUTH_KEY = 'auth-storage';

interface AuthBlob {
  state?: { token?: string | null; refreshToken?: string | null };
  version?: number;
}

function readAuth(): { token: string | null; refreshToken: string | null } {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return { token: null, refreshToken: null };
    const parsed = JSON.parse(raw) as AuthBlob;
    return {
      token: parsed.state?.token ?? null,
      refreshToken: parsed.state?.refreshToken ?? null,
    };
  } catch {
    return { token: null, refreshToken: null };
  }
}

function writeAuthTokens(token: string, refreshToken?: string | null) {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    const parsed: AuthBlob = raw ? JSON.parse(raw) : {};
    parsed.state = { ...(parsed.state || {}), token };
    if (refreshToken) parsed.state.refreshToken = refreshToken;
    localStorage.setItem(AUTH_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

function clearAuth() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const { token } = readAuth();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─────────────────────────────────────────
// 토큰 자동 갱신 (Silent Refresh)
// 401 발생 시 refreshToken으로 새 accessToken 발급 후 원래 요청 재시도
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

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // refresh 엔드포인트 자체가 401이면 → 로그아웃
    if (error.response?.status === 401 && originalRequest.url?.includes('/auth/refresh')) {
      clearAuth();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // 로그인·회원가입·OTP·비밀번호 찾기 등 "인증 시도" 요청의 오류는 세션 만료가 아니라
    // 자격 증명 오류다 → 토큰 갱신/리다이렉트(페이지 리로드) 하지 말고 호출자 catch 로 그대로 전달.
    // (리다이렉트하면 페이지가 새로고침되어 로그인 실패 사유 메시지가 즉시 사라지는 문제가 있었음)
    const AUTH_ATTEMPT_URLS = [
      '/auth/login', '/auth/kakao', '/auth/phone/', '/auth/email/',
      '/auth/forgot-password/', '/auth/find-company-code',
      '/companies/register', '/companies/check-',
    ];
    if (AUTH_ATTEMPT_URLS.some((u) => originalRequest.url?.includes(u))) {
      return Promise.reject(error);
    }

    // 401이고 아직 재시도 안 한 요청이면 → 토큰 갱신 시도
    if (error.response?.status === 401 && !originalRequest._retry) {
      const { refreshToken } = readAuth();

      if (!refreshToken) {
        clearAuth();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // 이미 갱신 중이면 대기열에 추가
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
        const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken });
        const newToken = data.data.accessToken || data.data.token;
        const newRefreshToken = data.data.refreshToken;

        writeAuthTokens(newToken, newRefreshToken);

        processQueue(null, newToken);

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearAuth();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;

// Auth
export const authApi = {
  login: (companyCode: string, email: string, password: string) =>
    api.post('/auth/login', { companyCode, email, password }),
  getMe: () => api.get('/auth/me'),
  // 비밀번호 재설정 (휴대폰 OTP 기반)
  forgotPasswordSendOtp: (companyCode: string, identifier: string) =>
    api.post('/auth/forgot-password/send-otp', { companyCode, identifier }),
  forgotPasswordReset: (companyCode: string, identifier: string, otp: string, newPassword: string) =>
    api.post('/auth/forgot-password/reset', { companyCode, identifier, otp, newPassword }),
  // 회사 코드 찾기 (등록된 휴대폰으로 문자 발송)
  findCompanyCode: (phone: string) => api.post('/auth/find-company-code', { phone }),
  // 회원가입 이메일 인증
  sendEmailOtp: (email: string) => api.post('/auth/email/send-otp', { email }),
  verifyEmailOtp: (email: string, otp: string) => api.post('/auth/email/verify-otp', { email, otp }),
  // 비밀번호 변경 (최초 강제 변경 시 currentPassword 생략 가능)
  changePassword: (data: { currentPassword?: string; newPassword: string }) =>
    api.put('/auth/password', data),
  /**
   * 서버에 refreshToken 폐기 요청. 클라이언트 저장소 정리는 호출자가 별도 수행.
   * Best-effort: 네트워크 오류로 실패해도 클라이언트는 여전히 로그아웃됨.
   */
  logout: (refreshToken?: string | null) =>
    api.post('/auth/logout', refreshToken ? { refreshToken } : {}),
};

// Users
export const usersApi = {
  list: (params?: Record<string, string>) => api.get('/users', { params }),
  get: (id: number) => api.get(`/users/${id}`),
  create: (data: Record<string, unknown>) => api.post('/users', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  resetPassword: (id: number, newPassword?: string) =>
    api.post(`/users/${id}/reset-password`, { newPassword }),
  exportMyData: () => api.get('/users/me/export', { responseType: 'blob' }),
  deleteMyData: (password: string) => api.delete('/users/me/data', { data: { password } }),
  getDataCategories: () => api.get('/users/me/data-categories'),
};

// Buses
export const busesApi = {
  list: (params?: Record<string, string>) => api.get('/buses', { params }),
  get: (id: number) => api.get(`/buses/${id}`),
  create: (data: Record<string, unknown>) => api.post('/buses', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/buses/${id}`, data),
  delete: (id: number) => api.delete(`/buses/${id}`),
};

// Routes
export const routesApi = {
  list: (params?: Record<string, string>) => api.get('/routes', { params }),
  get: (id: number) => api.get(`/routes/${id}`),
  create: (data: Record<string, unknown>) => api.post('/routes', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/routes/${id}`, data),
  delete: (id: number) => api.delete(`/routes/${id}`),
  assignDriver: (routeId: number, driverId: number, startDate: string) =>
    api.post(`/routes/${routeId}/assign`, { driverId, startDate }),
  removeDriver: (routeId: number, driverId: number) =>
    api.delete(`/routes/${routeId}/assign/${driverId}`),
};

// Company Policy (v2 솔버 운영 정책)
export const companyPolicyApi = {
  get: () => api.get('/companies/policy'),
  update: (policy: Record<string, unknown>) => api.put('/companies/policy', { policy }),
};

// Company Info (회사 기본 정보)
export const companyInfoApi = {
  get: () => api.get('/companies/me'),
  update: (data: { name: string }) => api.put('/companies/me', data),
};

// Schedules
export const schedulesApi = {
  list: () => api.get('/schedules'),
  get: (year: number, month: number, scheduleId?: number) =>
    api.get(`/schedules/${year}/${month}`, { params: scheduleId ? { scheduleId } : undefined }),
  // 멀티 초안: 해당 월의 모든 배차표(초안 프로필 + 발행본) 목록
  listDrafts: (year: number, month: number) => api.get(`/schedules/${year}/${month}/drafts`),
  // 멀티 초안: 배차표를 새 초안 프로필로 복제
  duplicate: (scheduleId: number) => api.post(`/schedules/by-id/${scheduleId}/duplicate`),
  // 멀티 초안: 프로필 이름 변경
  rename: (scheduleId: number, name: string) => api.put(`/schedules/by-id/${scheduleId}/rename`, { name }),
  generate: (data: { year: number; month: number; workDays?: number; restDays?: number }) =>
    api.post('/schedules/generate', data),
  // v2: 정책 기반 솔버 (PAIR/SOLO + 1/2/3교대 + 헌법룰). 생성할 때마다 새 초안 프로필 추가 (월 최대 5개).
  generateV2: (data: {
    year: number;
    month: number;
    name?: string;
    workDays?: number;
    restDays?: number;
    newHireDriverIds?: number[];
    blockedRoutes?: { routeId: number; driverIds: number[] }[];
  }) => api.post('/schedules/generate-v2', data),
  updateSlot: (slotId: number, data: Record<string, unknown>) =>
    api.put(`/schedules/slots/${slotId}`, data),
  createSlot: (data: Record<string, unknown>) =>
    api.post('/schedules/slots', data),
  overrideSlot: (slotId: number, data: Record<string, unknown>) =>
    api.put(`/schedules/slots/${slotId}/override`, data),
  publish: (year: number, month: number, scheduleId?: number) =>
    api.put(`/schedules/${year}/${month}/publish`, scheduleId ? { scheduleId } : undefined),
  delete: (year: number, month: number, scheduleId?: number) =>
    api.delete(`/schedules/${year}/${month}`, { params: scheduleId ? { scheduleId } : undefined }),
  exportExcel: (year: number, month: number, scheduleId?: number) =>
    api.get(`/schedules/${year}/${month}/export`, { responseType: 'blob', params: scheduleId ? { scheduleId } : undefined }),
  getAIRecommendations: (year: number, month: number, notes: string) =>
    api.post(`/schedules/${year}/${month}/ai-recommendations`, { notes }),
};

// Day Off Requests
export const dayOffApi = {
  list: (params?: Record<string, string>) => api.get('/dayoff', { params }),
  create: (date: string, reason?: string) => api.post('/dayoff', { date, reason }),
  review: (id: number, status: 'APPROVED' | 'REJECTED', reviewNote?: string) =>
    api.put(`/dayoff/${id}/review`, { status, reviewNote }),
  cancel: (id: number) => api.delete(`/dayoff/${id}`),
};

// Emergency
export const emergencyApi = {
  list: (params?: Record<string, string>) => api.get('/emergency', { params }),
  create: (slotId: number, reason: string) => api.post('/emergency', { slotId, reason }),
  accept: (id: number) => api.put(`/emergency/${id}/accept`),
  cancel: (id: number) => api.put(`/emergency/${id}/cancel`),
  manualFill: (id: number, driverId: number) => api.put(`/emergency/${id}/manual-fill`, { driverId }),
  availableDrivers: (id: number) => api.get(`/emergency/${id}/available-drivers`),
  notifiedDrivers: (id: number) => api.get(`/emergency/${id}/notified-drivers`),
};

// Notifications
export const notificationsApi = {
  list: () => api.get('/notifications'),
  markRead: (id: number) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
};

// Chat
export const chatApi = {
  getSessions: () => api.get('/chat/sessions'),
  createSession: (title?: string) => api.post('/chat/sessions', { title }),
  getSession: (id: number) => api.get(`/chat/sessions/${id}`),
  sendMessage: (sessionId: number, message: string, saveAsRule?: boolean) =>
    api.post(`/chat/sessions/${sessionId}/messages`, { message, saveAsRule }),
  deleteSession: (id: number) => api.delete(`/chat/sessions/${id}`),
};

// Rules
export const rulesApi = {
  list: () => api.get('/rules'),
  create: (data: Record<string, unknown>) => api.post('/rules', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/rules/${id}`, data),
  delete: (id: number) => api.delete(`/rules/${id}`),
};

// Contacts
export type ContactTopic = 'general' | 'demo' | 'pricing' | 'bug';

export const contactApi = {
  submit: (data: {
    name: string;
    phone?: string;
    email?: string;
    topic?: ContactTopic;
    buses?: number;
    employees?: number;
    message?: string;
  }) => api.post('/contacts', data),
};

// Companies (public - no auth needed)
export const companyApi = {
  register: (data: {
    companyName: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    adminPhone: string;
    emailVerifyToken: string;
  }) => api.post('/companies/register', data),
  checkCode: (code: string) => api.get(`/companies/check-code/${code}`),
  checkPhone: (phone: string) => api.post<{ available: boolean }>('/companies/check-phone', { phone }),
};

// Attendance (근태)
export const attendanceApi = {
  list: (year: number, month: number, driverId?: number) =>
    api.get('/attendance', { params: { year, month, ...(driverId ? { driverId } : {}) } }),
  upsert: (data: Record<string, unknown>) => api.post('/attendance', data),
  weeklyHours: (year: number, month: number) =>
    api.get('/attendance/weekly-hours', { params: { year, month } }),
};

// Inspection (차량 점검)
export const inspectionApi = {
  getTemplate: () => api.get('/inspection/template'),
  list: (params?: Record<string, string | number>) => api.get('/inspection', { params }),
  submit: (data: Record<string, unknown>) => api.post('/inspection', data),
  stats: (year: number, month: number) =>
    api.get('/inspection/stats', { params: { year, month } }),
};

// Safety (안전관리)
export const safetyApi = {
  getIncidents: (params?: Record<string, string>) => api.get('/safety/incidents', { params }),
  createIncident: (data: Record<string, unknown>) => api.post('/safety/incidents', data),
  resolveIncident: (id: number, notes?: string) => api.put(`/safety/incidents/${id}/resolve`, { notes }),
  deleteIncident: (id: number) => api.delete(`/safety/incidents/${id}`),

  getTrainings: (driverId?: number) =>
    api.get('/safety/trainings', { params: driverId ? { driverId } : {} }),
  createTraining: (data: Record<string, unknown>) => api.post('/safety/trainings', data),

  getLicenseAlerts: () => api.get('/safety/license-alerts'),
  updateLicense: (driverId: number, data: Record<string, unknown>) =>
    api.put(`/safety/license/${driverId}`, data),

  getStats: () => api.get('/safety/stats'),
};

// Posts (게시판/공지)
export const postsApi = {
  list: (params?: Record<string, string | number>) => api.get('/posts', { params }),
  get: (id: number) => api.get(`/posts/${id}`),
  create: (data: { boardType: string; title: string; content: string; isAnonymous?: boolean; isPinned?: boolean; isUrgent?: boolean; routeId?: number }) =>
    api.post('/posts', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/posts/${id}`, data),
  delete: (id: number) => api.delete(`/posts/${id}`),
  reads: (id: number) => api.get(`/posts/${id}/reads`),
};

// Direct Messages (1:1 메시지)
export const dmApi = {
  conversations: () => api.get('/dm/conversations'),
  messages: (partnerId: number, page?: number) =>
    api.get(`/dm/${partnerId}`, { params: page ? { page } : {} }),
  send: (receiverId: number, content: string) =>
    api.post('/dm', { receiverId, content }),
  unreadCount: () => api.get('/dm/unread-count'),
  users: () => api.get('/dm/users'),
};

// Audit Logs (감사 로그)
export const auditApi = {
  list: (params?: Record<string, string | number>) => api.get('/audit-logs', { params }),
};

// 일일 운영 보고서 (DailyReportAgent)
export const dailyReportsApi = {
  list: (params?: Record<string, string | number | boolean>) =>
    api.get('/daily-reports', { params }),
  detail: (id: number) => api.get(`/daily-reports/${id}`),
  markRead: (id: number) => api.post(`/daily-reports/${id}/read`),
  regenerate: () => api.post('/daily-reports/regenerate'),
};

// Search (글로벌 검색)
export const searchApi = {
  search: (q: string) => api.get('/search', { params: { q } }),
};

// Driver Tags (블랙리스트 태그)
export const driverTagsApi = {
  list: () => api.get('/driver-tags'),
  create: (data: Record<string, unknown>) => api.post('/driver-tags', data),
  delete: (id: number) => api.delete(`/driver-tags/${id}`),
};

// Driver Preferences (기사 선호도)
export const driverPreferencesApi = {
  list: () => api.get('/driver-preferences'),
  listAll: () => api.get('/driver-preferences/all'),
  update: (routes: { routeId: number; priority: number }[]) => api.put('/driver-preferences', { routes }),
};

// Onboarding (엑셀 임포트)
export const onboardingApi = {
  analyzeExcel: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/onboarding/analyze-excel', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // 강한 모델로 큰 배차표를 분석하면 30초를 넘을 수 있어 타임아웃을 넉넉히(3분).
      timeout: 180000,
    });
  },
  confirmImport: (data: {
    drivers: { name: string; employeeId: string; phone: string; driverType: string }[];
    routes: { routeNumber: string; name: string; startPoint: string; endPoint: string }[];
    buses: { busNumber: string; plateNumber: string; model: string }[];
  }) => api.post('/onboarding/confirm-import', data),
  downloadTemplate: () => api.get('/onboarding/template', { responseType: 'blob' }),
};
