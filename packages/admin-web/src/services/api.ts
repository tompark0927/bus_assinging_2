import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
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
  res => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // refresh 엔드포인트 자체가 401이면 → 로그아웃
    if (error.response?.status === 401 && originalRequest.url?.includes('/auth/refresh')) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // 401이고 아직 재시도 안 한 요청이면 → 토큰 갱신 시도
    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = localStorage.getItem('refreshToken');

      if (!refreshToken) {
        localStorage.removeItem('token');
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

        localStorage.setItem('token', newToken);
        // 토큰 회전: 서버가 새 refreshToken을 발급하면 저장
        if (newRefreshToken) {
          localStorage.setItem('refreshToken', newRefreshToken);
        }

        // Zustand store도 동기화 (lazy import 방지를 위해 직접 localStorage만 업데이트)
        try {
          const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
          if (stored.state) {
            stored.state.token = newToken;
            if (newRefreshToken) stored.state.refreshToken = newRefreshToken;
            localStorage.setItem('auth-storage', JSON.stringify(stored));
          }
        } catch { /* ignore */ }

        processQueue(null, newToken);

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// Auth
export const authApi = {
  kakaoLogin: (accessToken: string) =>
    api.post('/auth/kakao', { accessToken }),
  sendPhoneOtp: (phone: string) =>
    api.post('/auth/phone/send-otp', { phone }),
  verifyPhoneOtp: (phone: string, otp: string) =>
    api.post('/auth/phone/verify', { phone, otp }),
  login: (companyCode: string, email: string, password: string) =>
    api.post('/auth/login', { companyCode, email, password }),
  getMe: () => api.get('/auth/me'),
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
  list: () => api.get('/buses'),
  get: (id: number) => api.get(`/buses/${id}`),
  create: (data: Record<string, unknown>) => api.post('/buses', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/buses/${id}`, data),
  delete: (id: number) => api.delete(`/buses/${id}`),
};

// Routes
export const routesApi = {
  list: () => api.get('/routes'),
  get: (id: number) => api.get(`/routes/${id}`),
  create: (data: Record<string, unknown>) => api.post('/routes', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/routes/${id}`, data),
  updateFatigue: (id: number, data: { fatigueScore: number; fatigueReason?: string }) => api.put(`/routes/${id}/fatigue`, data),
  assignDriver: (routeId: number, driverId: number, startDate: string) =>
    api.post(`/routes/${routeId}/assign`, { driverId, startDate }),
  removeDriver: (routeId: number, driverId: number) =>
    api.delete(`/routes/${routeId}/assign/${driverId}`),
};

// Schedules
export const schedulesApi = {
  list: () => api.get('/schedules'),
  get: (year: number, month: number) => api.get(`/schedules/${year}/${month}`),
  generate: (data: { year: number; month: number; workDays?: number; restDays?: number }) =>
    api.post('/schedules/generate', data),
  updateSlot: (slotId: number, data: Record<string, unknown>) =>
    api.put(`/schedules/slots/${slotId}`, data),
  overrideSlot: (slotId: number, data: Record<string, unknown>) =>
    api.put(`/schedules/slots/${slotId}/override`, data),
  publish: (year: number, month: number) =>
    api.put(`/schedules/${year}/${month}/publish`),
  delete: (year: number, month: number) =>
    api.delete(`/schedules/${year}/${month}`),
  exportExcel: (year: number, month: number) =>
    api.get(`/schedules/${year}/${month}/export`, { responseType: 'blob' }),
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
export const contactApi = {
  submit: (data: { name: string; phone: string; buses?: number; employees?: number; message?: string }) =>
    api.post('/contacts', data),
};

// Companies (public - no auth needed)
export const companyApi = {
  register: (data: {
    companyName: string;
    companyCode: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    adminPhone: string;
  }) => api.post('/companies/register', data),
  checkCode: (code: string) => api.get(`/companies/check-code/${code}`),
};

// Attendance (근태)
export const attendanceApi = {
  list: (year: number, month: number, driverId?: number) =>
    api.get('/attendance', { params: { year, month, ...(driverId ? { driverId } : {}) } }),
  upsert: (data: Record<string, unknown>) => api.post('/attendance', data),
  weeklyHours: (year: number, month: number) =>
    api.get('/attendance/weekly-hours', { params: { year, month } }),
};

// Payroll (급여)
export const payrollApi = {
  getSettings: () => api.get('/payroll/settings'),
  saveSettings: (data: Record<string, unknown>) => api.put('/payroll/settings', data),
  getRecords: (year: number, month: number) =>
    api.get('/payroll', { params: { year, month } }),
  calculate: (year: number, month: number) =>
    api.post('/payroll/calculate', { year, month }),
  confirm: (year: number, month: number) =>
    api.post('/payroll/confirm', { year, month }),
  getHoboong: () => api.get('/payroll/hoboong'),
  saveHoboong: (rows: { level: number; baseSalary: number }[]) =>
    api.put('/payroll/hoboong', { rows }),
  getUnionDues: () => api.get('/payroll/union-dues'),
  saveUnionDues: (dues: { name: string; type: string; amount: number; isActive: boolean }[]) =>
    api.put('/payroll/union-dues', { dues }),
  updateRecord: (id: number, data: Record<string, unknown>) => api.patch(`/payroll/${id}`, data),
  analyzeExcel: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/payroll/analyze-excel', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  confirmRules: (data: Record<string, unknown>) =>
    api.post('/payroll/confirm-rules', data),
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

// Approvals (전자결재)
export const approvalsApi = {
  list: (params?: Record<string, string>) => api.get('/approvals', { params }),
  get: (id: number) => api.get(`/approvals/${id}`),
  create: (data: { type: string; title: string; content: string; data?: Record<string, unknown>; approverIds?: number[] }) =>
    api.post('/approvals', data),
  process: (id: number, action: 'approve' | 'reject', comment?: string) =>
    api.put(`/approvals/${id}/process`, { action, comment }),
  cancel: (id: number) => api.delete(`/approvals/${id}`),
  stats: () => api.get('/approvals/stats'),
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

// AI 에이전트 결정 추적
export const agentDecisionsApi = {
  list: (params?: Record<string, string | number | boolean>) =>
    api.get('/agents/decisions', { params }),
  detail: (id: number) => api.get(`/agents/decisions/${id}`),
  override: (id: number, reason: string) => api.post(`/agents/decisions/${id}/override`, { reason }),
  stats: (params?: { agentName?: string; days?: number }) =>
    api.get('/agents/decisions/stats', { params }),
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

// Golden Tickets (황금 티켓)
export const goldenTicketsApi = {
  list: () => api.get('/golden-tickets'),
  use: (id: number, date: string) => api.post(`/golden-tickets/${id}/use`, { date }),
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
    });
  },
  confirmImport: (data: {
    drivers: { name: string; employeeId: string; phone: string; driverType: string }[];
    routes: { routeNumber: string; name: string; startPoint: string; endPoint: string }[];
    buses: { busNumber: string; plateNumber: string; model: string }[];
  }) => api.post('/onboarding/confirm-import', data),
  downloadTemplate: () => api.get('/onboarding/template', { responseType: 'blob' }),
};
