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
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DriversPage = lazy(() => import('./pages/DriversPage'));
const BusesPage = lazy(() => import('./pages/BusesPage'));
const RoutesPage = lazy(() => import('./pages/RoutesPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const DayOffPage = lazy(() => import('./pages/DayOffPage'));
const EmergencyPage = lazy(() => import('./pages/EmergencyPage'));
const RulesPage = lazy(() => import('./pages/RulesPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const PayrollPage = lazy(() => import('./pages/PayrollPage'));
const SafetyPage = lazy(() => import('./pages/SafetyPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const ChatBotPage = lazy(() => import('./pages/ChatBotPage'));
const InspectionPage = lazy(() => import('./pages/InspectionPage'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const AgentDecisionsPage = lazy(() => import('./pages/AgentDecisionsPage'));
const DailyReportsPage = lazy(() => import('./pages/DailyReportsPage'));
const MyDataPage = lazy(() => import('./pages/MyDataPage'));
const DataManagementPage = lazy(() => import('./pages/DataManagementPage'));
const DispatchSettingsPage = lazy(() => import('./pages/DispatchSettingsPage'));

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
            <Route path="/register" element={<RegisterPage />} />
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
              <Route path="drivers" element={<Suspense fallback={<PageLoadingFallback />}><DriversPage /></Suspense>} />
              <Route path="buses" element={<Suspense fallback={<PageLoadingFallback />}><BusesPage /></Suspense>} />
              <Route path="routes" element={<Suspense fallback={<PageLoadingFallback />}><RoutesPage /></Suspense>} />
              <Route path="schedule" element={<Suspense fallback={<PageLoadingFallback />}><SchedulePage /></Suspense>} />
              <Route path="dayoff" element={<Suspense fallback={<PageLoadingFallback />}><DayOffPage /></Suspense>} />
              <Route path="emergency" element={<Suspense fallback={<PageLoadingFallback />}><EmergencyPage /></Suspense>} />
              <Route path="attendance" element={<Suspense fallback={<PageLoadingFallback />}><AttendancePage /></Suspense>} />
              <Route path="payroll" element={<Suspense fallback={<PageLoadingFallback />}><PayrollPage /></Suspense>} />
              <Route path="safety" element={<Suspense fallback={<PageLoadingFallback />}><SafetyPage /></Suspense>} />
              <Route path="inspection" element={<Suspense fallback={<PageLoadingFallback />}><InspectionPage /></Suspense>} />
              <Route path="maintenance" element={<Suspense fallback={<PageLoadingFallback />}><MaintenancePage /></Suspense>} />
              <Route path="rules" element={<Suspense fallback={<PageLoadingFallback />}><RulesPage /></Suspense>} />
              <Route path="approvals" element={<Suspense fallback={<PageLoadingFallback />}><ApprovalsPage /></Suspense>} />
              <Route path="board" element={<Suspense fallback={<PageLoadingFallback />}><BoardPage /></Suspense>} />
              <Route path="messages" element={<Suspense fallback={<PageLoadingFallback />}><MessagesPage /></Suspense>} />
              <Route path="chatbot" element={<Suspense fallback={<PageLoadingFallback />}><ChatBotPage /></Suspense>} />
              <Route path="audit" element={<Suspense fallback={<PageLoadingFallback />}><AuditLogPage /></Suspense>} />
              <Route path="agent-decisions" element={<Suspense fallback={<PageLoadingFallback />}><AgentDecisionsPage /></Suspense>} />
              <Route path="daily-reports" element={<Suspense fallback={<PageLoadingFallback />}><DailyReportsPage /></Suspense>} />
              <Route path="my-data" element={<Suspense fallback={<PageLoadingFallback />}><MyDataPage /></Suspense>} />
              <Route path="data" element={<Suspense fallback={<PageLoadingFallback />}><DataManagementPage /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={<PageLoadingFallback />}><DispatchSettingsPage /></Suspense>} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
