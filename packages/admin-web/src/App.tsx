import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import ErrorBoundary, { PageLoadingFallback } from './components/ErrorBoundary';
import Layout from './components/Layout';

// ─────────────────────────────────────────
// Lazy-loaded pages (코드 스플리팅)
// 각 페이지는 별도 청크로 분리되어 필요할 때만 로드
// ─────────────────────────────────────────
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const FindCompanyCodePage = lazy(() => import('./pages/FindCompanyCodePage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
// 요금제 페이지는 기능 준비 중이라 임시 숨김 (추후 복구) — 라우트/링크도 함께 비활성화됨
// const PricingPage = lazy(() => import('./pages/PricingPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const DayOffPage = lazy(() => import('./pages/DayOffPage'));
const EmergencyPage = lazy(() => import('./pages/EmergencyPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const DailyReportsPage = lazy(() => import('./pages/DailyReportsPage'));
const BasicDataPage = lazy(() => import('./pages/BasicDataPage'));
const DispatchSettingsPage = lazy(() => import('./pages/DispatchSettingsPage'));
const TodayOperationPage = lazy(() => import('./pages/TodayOperationPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));
const CompanyInfoPage = lazy(() => import('./pages/CompanyInfoPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated());
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/find-company-code" element={<FindCompanyCodePage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* 요금제 페이지 임시 숨김 — 직접 접근 시 홈으로 리다이렉트. 복구 시 위 import 주석 해제 후 element={<PricingPage />} 로 되돌리기 */}
            <Route path="/pricing" element={<Navigate to="/" replace />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/dashboard/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />

            {/* Protected Admin Routes */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Suspense fallback={<PageLoadingFallback />}><DashboardPage /></Suspense>} />
              <Route path="schedule" element={<Suspense fallback={<PageLoadingFallback />}><SchedulePage /></Suspense>} />
              <Route path="dayoff" element={<Suspense fallback={<PageLoadingFallback />}><DayOffPage /></Suspense>} />
              <Route path="emergency" element={<Suspense fallback={<PageLoadingFallback />}><EmergencyPage /></Suspense>} />
              <Route path="daily-reports" element={<Suspense fallback={<PageLoadingFallback />}><DailyReportsPage /></Suspense>} />
              <Route path="data" element={<Suspense fallback={<PageLoadingFallback />}><BasicDataPage /></Suspense>} />
              <Route path="today" element={<Suspense fallback={<PageLoadingFallback />}><TodayOperationPage /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={<PageLoadingFallback />}><DispatchSettingsPage /></Suspense>} />
              <Route path="accounts" element={<Suspense fallback={<PageLoadingFallback />}><AccountsPage /></Suspense>} />
              <Route path="company" element={<Suspense fallback={<PageLoadingFallback />}><CompanyInfoPage /></Suspense>} />
              {/* OWNER/DIRECTOR 전용 — 사이드바 하단 작은 링크로만 노출 */}
              <Route path="audit" element={<Suspense fallback={<PageLoadingFallback />}><AuditLogPage /></Suspense>} />
            </Route>

            {/* 404 — 일치하는 라우트가 없을 때 */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
