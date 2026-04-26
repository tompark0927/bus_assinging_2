import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  Users, Bus, AlertTriangle, Calendar, CalendarOff,
  Bell, CheckCircle, Clock, XCircle, FileText, ShieldAlert,
  DollarSign, Megaphone, ArrowRight, Wrench, GraduationCap,
  CreditCard, UserCheck, ClipboardCheck,
  AlertCircle, RefreshCw,
} from 'lucide-react';
import {
  usersApi, busesApi, routesApi, emergencyApi, schedulesApi,
  dayOffApi, notificationsApi, attendanceApi, payrollApi,
  safetyApi, inspectionApi, approvalsApi, postsApi,
} from '../services/api';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import React from 'react';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
const FULL_ACCESS_ROLES = ['OWNER', 'DIRECTOR', 'ADMIN'];

type Role = 'OWNER' | 'DIRECTOR' | 'ADMIN' | 'DISPATCH' | 'HR' | 'ACCOUNTING' | 'SAFETY_MGR' | 'DRIVER';

const ROLE_DASHBOARD_LABELS: Record<string, string> = {
  OWNER: '전체 대시보드',
  DIRECTOR: '전체 대시보드',
  ADMIN: '전체 대시보드',
  DISPATCH: '배차 대시보드',
  HR: '인사 대시보드',
  ACCOUNTING: '경리 대시보드',
  SAFETY_MGR: '안전 대시보드',
  DRIVER: '대시보드',
};

// ─────────────────────────────────────────
// Shared components
// ─────────────────────────────────────────

function SectionHeader({ icon: Icon, title, linkTo, linkLabel }: {
  icon: React.ElementType;
  title: string;
  linkTo?: string;
  linkLabel?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Icon size={22} className="text-blue-600" />
        {title}
      </h2>
      {linkTo && (
        <button
          onClick={() => navigate(linkTo)}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800
                     font-medium px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors
                     min-h-[48px]"
        >
          {linkLabel || '더보기'}
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, sub, onClick }: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  sub?: string;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex items-center gap-4
                  min-h-[96px] w-full text-left transition-all
                  ${onClick ? 'hover:shadow-md hover:border-blue-200 dark:hover:border-blue-700 cursor-pointer active:scale-[0.98]' : ''}`}
    >
      <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={26} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{value}</p>
        <p className="text-base text-gray-500 dark:text-gray-400 mt-0.5">{title}</p>
        {sub && <p className="text-sm text-gray-400 dark:text-gray-500">{sub}</p>}
      </div>
    </Wrapper>
  );
}

function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
      <RefreshCw size={20} className="animate-spin mr-2" />
      <span className="text-base">불러오는 중...</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8">
      <p className="text-base text-gray-400 dark:text-gray-500">{message}</p>
    </div>
  );
}

function AlertBanner({ icon: Icon, color, children }: {
  icon: React.ElementType;
  color: 'red' | 'yellow' | 'blue';
  children: React.ReactNode;
}) {
  const styles = {
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  const iconColors = { red: 'text-red-600', yellow: 'text-yellow-600', blue: 'text-blue-600' };
  return (
    <div className={`border rounded-xl p-4 flex items-center gap-3 min-h-[56px] ${styles[color]}`}>
      <Icon size={22} className={`flex-shrink-0 ${iconColors[color]}`} />
      <p className="font-medium text-base">{children}</p>
    </div>
  );
}

// ─────────────────────────────────────────
// Data hooks
// ─────────────────────────────────────────

function useDashboardData(role: Role) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const todayStr = format(now, 'yyyy-MM-dd');
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);

  // Common: notifications
  const notifications = useQuery({
    queryKey: ['dashboard-notifications'],
    queryFn: () => notificationsApi.list().then(r => r.data.data),
    staleTime: 30_000,
  });

  // Drivers (full, dispatch, hr, safety)
  const needsDrivers = isFullAccess || ['DISPATCH', 'HR', 'SAFETY_MGR'].includes(role);
  const drivers = useQuery({
    queryKey: ['dashboard-drivers'],
    queryFn: () => usersApi.list({ role: 'DRIVER', limit: '500' }).then(r => r.data.data),
    enabled: needsDrivers,
    staleTime: 60_000,
  });

  // Buses (full, dispatch)
  const needsBuses = isFullAccess || role === 'DISPATCH';
  const buses = useQuery({
    queryKey: ['dashboard-buses'],
    queryFn: () => busesApi.list().then(r => r.data.data),
    enabled: needsBuses,
    staleTime: 60_000,
  });

  // Routes (full, dispatch)
  const routes = useQuery({
    queryKey: ['dashboard-routes'],
    queryFn: () => routesApi.list().then(r => r.data.data),
    enabled: needsBuses,
    staleTime: 60_000,
  });

  // Schedule (full, dispatch)
  const needsSchedule = isFullAccess || role === 'DISPATCH';
  const schedule = useQuery({
    queryKey: ['dashboard-schedule', year, month],
    queryFn: () => schedulesApi.get(year, month).then(r => r.data.data),
    enabled: needsSchedule,
    staleTime: 60_000,
  });

  // Emergency drops (full, dispatch)
  const needsEmergency = isFullAccess || role === 'DISPATCH';
  const emergency = useQuery({
    queryKey: ['dashboard-emergency'],
    queryFn: () => emergencyApi.list({ status: 'OPEN' }).then(r => r.data.data),
    enabled: needsEmergency,
    staleTime: 30_000,
  });

  // Day off requests (full, dispatch, hr)
  const needsDayOff = isFullAccess || ['DISPATCH', 'HR'].includes(role);
  const dayoffs = useQuery({
    queryKey: ['dashboard-dayoff-pending'],
    queryFn: () => dayOffApi.list({ status: 'PENDING' }).then(r => r.data.data),
    enabled: needsDayOff,
    staleTime: 30_000,
  });

  // Attendance (full, hr, dispatch)
  const needsAttendance = isFullAccess || ['HR', 'DISPATCH'].includes(role);
  const attendance = useQuery({
    queryKey: ['dashboard-attendance', year, month],
    queryFn: () => attendanceApi.list(year, month).then(r => r.data.data),
    enabled: needsAttendance,
    staleTime: 60_000,
  });

  // Payroll (full, accounting)
  const needsPayroll = isFullAccess || role === 'ACCOUNTING';
  const payroll = useQuery({
    queryKey: ['dashboard-payroll', year, month],
    queryFn: () => payrollApi.getRecords(year, month).then(r => r.data.data),
    enabled: needsPayroll,
    staleTime: 60_000,
  });

  // Approvals (full, all roles)
  const approvalStats = useQuery({
    queryKey: ['dashboard-approval-stats'],
    queryFn: () => approvalsApi.stats().then(r => r.data.data),
    staleTime: 30_000,
  });

  // Safety stats (full, safety)
  const needsSafety = isFullAccess || role === 'SAFETY_MGR';
  const safetyStats = useQuery({
    queryKey: ['dashboard-safety-stats'],
    queryFn: () => safetyApi.getStats().then(r => r.data.data),
    enabled: needsSafety,
    staleTime: 60_000,
  });

  // Inspection stats (full, safety)
  const inspectionStats = useQuery({
    queryKey: ['dashboard-inspection', year, month],
    queryFn: () => inspectionApi.stats(year, month).then(r => r.data.data),
    enabled: needsSafety,
    staleTime: 60_000,
  });

  // License alerts (hr, safety, full)
  const needsLicense = isFullAccess || ['HR', 'SAFETY_MGR'].includes(role);
  const licenseAlerts = useQuery({
    queryKey: ['dashboard-license-alerts'],
    queryFn: () => safetyApi.getLicenseAlerts().then(r => r.data.data),
    enabled: needsLicense,
    staleTime: 60_000,
  });

  // Recent posts (full)
  const recentPosts = useQuery({
    queryKey: ['dashboard-posts'],
    queryFn: () => postsApi.list({ limit: 5 }).then(r => r.data.data),
    enabled: isFullAccess,
    staleTime: 60_000,
  });

  // Computed: today's slots
  const todaySlots = schedule.data?.slots?.filter(
    (s: { date: string; isRestDay: boolean }) => s.date?.startsWith(todayStr) && !s.isRestDay
  ) || [];
  const todayRestSlots = schedule.data?.slots?.filter(
    (s: { date: string; isRestDay: boolean }) => s.date?.startsWith(todayStr) && s.isRestDay
  ) || [];

  // Computed: today's attendance
  const todayAttendance = (attendance.data || []).filter(
    (a: { date: string }) => a.date?.startsWith(todayStr)
  );
  const presentCount = todayAttendance.filter((a: { status: string }) => a.status === 'PRESENT').length;
  const lateCount = todayAttendance.filter((a: { status: string }) => a.status === 'LATE').length;
  const absentCount = todayAttendance.filter((a: { status: string }) => a.status === 'ABSENT').length;

  // Computed: active drivers
  const activeDrivers = (drivers.data || []).filter((d: { isActive: boolean }) => d.isActive);
  const mainDrivers = activeDrivers.filter((d: { driverType: string }) => d.driverType === 'MAIN');
  const spareDrivers = activeDrivers.filter((d: { driverType: string }) => d.driverType === 'SPARE');

  // Computed: buses
  const activeBuses = (buses.data || []).filter((b: { isActive: boolean }) => b.isActive);
  const activeRoutes = (routes.data || []).filter((r: { isActive: boolean }) => r.isActive);

  // Computed: payroll
  const payrollRecords = payroll.data || [];
  const confirmedPayroll = payrollRecords.filter((p: { status: string }) => p.status === 'CONFIRMED');
  const pendingPayroll = payrollRecords.filter((p: { status: string }) => p.status !== 'CONFIRMED');

  return {
    now, year, month, todayStr,
    notifications, drivers, buses, routes, schedule, emergency,
    dayoffs, attendance, payroll, approvalStats, safetyStats,
    inspectionStats, licenseAlerts, recentPosts,
    // computed
    todaySlots, todayRestSlots,
    presentCount, lateCount, absentCount, todayAttendance,
    activeDrivers, mainDrivers, spareDrivers,
    activeBuses, activeRoutes,
    payrollRecords, confirmedPayroll, pendingPayroll,
  };
}

// ─────────────────────────────────────────
// Section: Alert banners
// ─────────────────────────────────────────
function AlertBanners({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const emergencyCount = data.emergency.data?.length || 0;
  const dayoffCount = data.dayoffs.data?.length || 0;
  const pendingApprovals = data.approvalStats.data?.pending || 0;

  if (emergencyCount === 0 && dayoffCount === 0 && pendingApprovals === 0) return null;

  return (
    <div className="space-y-2">
      {emergencyCount > 0 && (
        <AlertBanner icon={AlertTriangle} color="red">
          긴급 슬롯 {emergencyCount}건 -- 대체 기사 배정이 필요합니다!
        </AlertBanner>
      )}
      {dayoffCount > 0 && (
        <AlertBanner icon={CalendarOff} color="yellow">
          대기 중인 휴무 요청 {dayoffCount}건 -- 검토가 필요합니다.
        </AlertBanner>
      )}
      {pendingApprovals > 0 && (
        <AlertBanner icon={FileText} color="blue">
          미결재 문서 {pendingApprovals}건이 있습니다.
        </AlertBanner>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Notifications
// ─────────────────────────────────────────
function RecentNotifications({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const notifs = data.notifications.data;
  const items = (notifs?.notifications || notifs?.items || []).slice(0, 5);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={Bell} title="최근 알림" />
      {data.notifications.isLoading ? <SectionLoading /> : items.length === 0 ? (
        <EmptyState message="새로운 알림이 없습니다." />
      ) : (
        <div className="space-y-2">
          {items.map((n: { id: number; title: string; body?: string; message?: string; createdAt: string; isRead: boolean }) => (
            <div key={n.id} className={`p-3 rounded-xl text-base flex items-start gap-3 ${n.isRead ? 'bg-gray-50 dark:bg-gray-700' : 'bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800'}`}>
              <Bell size={18} className={`mt-0.5 flex-shrink-0 ${n.isRead ? 'text-gray-400' : 'text-blue-500'}`} />
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${n.isRead ? 'text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-gray-100'}`}>{n.title}</p>
                {(n.body || n.message) && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">{n.body || n.message}</p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {format(new Date(n.createdAt), 'MM/dd HH:mm')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Today's schedule overview
// ─────────────────────────────────────────
function TodayScheduleSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={Calendar} title="오늘 운행 현황" linkTo="/dashboard/schedule" linkLabel="배차표 보기" />
      {data.schedule.isLoading ? <SectionLoading /> : data.todaySlots.length === 0 ? (
        <EmptyState message={data.schedule.data ? '오늘 배차 데이터가 없습니다.' : '이번 달 배차표가 없습니다.'} />
      ) : (
        <>
          {/* Summary bar */}
          <div className="flex gap-3 mb-4">
            <div className="flex-1 bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{data.todaySlots.length}</p>
              <p className="text-sm text-blue-600">운행</p>
            </div>
            <div className="flex-1 bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-600 dark:text-gray-300">{data.todayRestSlots.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">휴무</p>
            </div>
            <div className="flex-1 bg-red-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-red-600">
                {data.todaySlots.filter((s: { status: string }) => s.status === 'DROPPED').length}
              </p>
              <p className="text-sm text-red-500">드랍</p>
            </div>
          </div>
          {/* Slot list */}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {data.todaySlots.slice(0, 10).map((slot: {
              id: number;
              driver: { name: string; driverType: string };
              route: { routeNumber: string };
              status: string;
            }) => (
              <div key={slot.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-xl min-h-[48px]">
                <div>
                  <span className="font-medium text-base">{slot.driver?.name}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-sm ml-2">
                    {slot.driver?.driverType === 'MAIN' ? '메인' : '스페어'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-medium bg-blue-100 text-blue-700">
                    {slot.route?.routeNumber}번
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-medium ${
                    slot.status === 'DROPPED' ? 'bg-red-100 text-red-700' :
                    slot.status === 'FILLED' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {slot.status === 'DROPPED' ? '드랍' : slot.status === 'FILLED' ? '대체' : '정상'}
                  </span>
                </div>
              </div>
            ))}
            {data.todaySlots.length > 10 && (
              <button
                onClick={() => navigate('/dashboard/schedule')}
                className="w-full text-center text-sm text-blue-600 py-2 hover:underline min-h-[48px]"
              >
                외 {data.todaySlots.length - 10}건 더보기
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Emergency drops
// ─────────────────────────────────────────
function EmergencySection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const items = data.emergency.data || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={AlertTriangle} title="긴급 슬롯 현황" linkTo="/dashboard/emergency" linkLabel="전체보기" />
      {data.emergency.isLoading ? <SectionLoading /> : items.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle size={40} className="mx-auto text-green-400 mb-2" />
          <p className="text-base text-gray-500 dark:text-gray-400">미처리 긴급 슬롯이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((e: {
            id: number;
            reason: string;
            slot?: { date: string; driver?: { name: string }; route?: { routeNumber: string } };
            createdAt: string;
          }) => (
            <div key={e.id} className="p-3 bg-red-50 rounded-xl border border-red-100 min-h-[48px]">
              <div className="flex items-center justify-between">
                <span className="font-medium text-base text-red-800">
                  {e.slot?.driver?.name || '기사'} - {e.slot?.route?.routeNumber || ''}번
                </span>
                <span className="text-sm text-red-500">
                  {e.slot?.date ? format(new Date(e.slot.date), 'MM/dd') : ''}
                </span>
              </div>
              <p className="text-sm text-red-600 mt-1">{e.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Day-off requests
// ─────────────────────────────────────────
function DayOffSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const items = data.dayoffs.data || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={CalendarOff} title="대기 중 휴무 요청" linkTo="/dashboard/dayoff" linkLabel="전체보기" />
      {data.dayoffs.isLoading ? <SectionLoading /> : items.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle size={40} className="mx-auto text-green-400 mb-2" />
          <p className="text-base text-gray-500 dark:text-gray-400">대기 중인 휴무 요청이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((d: {
            id: number;
            date: string;
            reason?: string;
            user?: { name: string };
          }) => (
            <div key={d.id} className="p-3 bg-yellow-50 rounded-xl border border-yellow-100 flex items-center justify-between min-h-[48px]">
              <div>
                <span className="font-medium text-base text-yellow-900">{d.user?.name || '기사'}</span>
                <span className="text-sm text-yellow-700 ml-2">
                  {d.date ? format(new Date(d.date), 'MM월 dd일') : ''}
                </span>
              </div>
              {d.reason && <span className="text-sm text-yellow-600 truncate max-w-[120px]">{d.reason}</span>}
            </div>
          ))}
          {items.length > 5 && (
            <p className="text-sm text-center text-yellow-600 pt-1">외 {items.length - 5}건</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Attendance overview
// ─────────────────────────────────────────
function AttendanceSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={Clock} title="오늘 근태 현황" linkTo="/dashboard/attendance" linkLabel="상세보기" />
      {data.attendance.isLoading ? <SectionLoading /> : (
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => navigate('/dashboard/attendance')}
            className="bg-green-50 rounded-xl p-4 text-center hover:bg-green-100 transition-colors min-h-[80px]"
          >
            <UserCheck size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-700">{data.presentCount}</p>
            <p className="text-sm text-green-600">출근</p>
          </button>
          <button
            onClick={() => navigate('/dashboard/attendance')}
            className="bg-yellow-50 rounded-xl p-4 text-center hover:bg-yellow-100 transition-colors min-h-[80px]"
          >
            <Clock size={24} className="mx-auto text-yellow-600 mb-1" />
            <p className="text-2xl font-bold text-yellow-700">{data.lateCount}</p>
            <p className="text-sm text-yellow-600">지각</p>
          </button>
          <button
            onClick={() => navigate('/dashboard/attendance')}
            className="bg-red-50 rounded-xl p-4 text-center hover:bg-red-100 transition-colors min-h-[80px]"
          >
            <XCircle size={24} className="mx-auto text-red-600 mb-1" />
            <p className="text-2xl font-bold text-red-700">{data.absentCount}</p>
            <p className="text-sm text-red-600">결근</p>
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Approvals
// ─────────────────────────────────────────
function ApprovalsSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();
  const stats = data.approvalStats.data;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={FileText} title="결재 현황" linkTo="/dashboard/approvals" linkLabel="결재함" />
      {data.approvalStats.isLoading ? <SectionLoading /> : !stats ? (
        <EmptyState message="결재 데이터를 불러올 수 없습니다." />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => navigate('/dashboard/approvals')}
            className="bg-orange-50 rounded-xl p-4 text-center hover:bg-orange-100 transition-colors min-h-[80px]"
          >
            <p className="text-2xl font-bold text-orange-700">{stats.pending || 0}</p>
            <p className="text-sm text-orange-600">대기중</p>
          </button>
          <button
            onClick={() => navigate('/dashboard/approvals')}
            className="bg-green-50 rounded-xl p-4 text-center hover:bg-green-100 transition-colors min-h-[80px]"
          >
            <p className="text-2xl font-bold text-green-700">{stats.approved || 0}</p>
            <p className="text-sm text-green-600">승인</p>
          </button>
          <button
            onClick={() => navigate('/dashboard/approvals')}
            className="bg-red-50 rounded-xl p-4 text-center hover:bg-red-100 transition-colors min-h-[80px]"
          >
            <p className="text-2xl font-bold text-red-700">{stats.rejected || 0}</p>
            <p className="text-sm text-red-600">반려</p>
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Recent posts
// ─────────────────────────────────────────
function RecentPostsSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();
  const posts = data.recentPosts.data?.posts || data.recentPosts.data || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={Megaphone} title="최근 게시글" linkTo="/dashboard/board" linkLabel="게시판" />
      {data.recentPosts.isLoading ? <SectionLoading /> : posts.length === 0 ? (
        <EmptyState message="게시글이 없습니다." />
      ) : (
        <div className="space-y-2">
          {posts.slice(0, 5).map((p: {
            id: number;
            title: string;
            boardType: string;
            isUrgent?: boolean;
            isPinned?: boolean;
            createdAt: string;
            author?: { name: string };
          }) => (
            <button
              key={p.id}
              onClick={() => navigate('/dashboard/board')}
              className="w-full text-left p-3 bg-gray-50 dark:bg-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center justify-between min-h-[48px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                {p.isUrgent && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">긴급</span>
                )}
                {p.isPinned && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700">공지</span>
                )}
                <span className="text-base text-gray-800 dark:text-gray-200 truncate">{p.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <span className="text-sm text-gray-400 dark:text-gray-500">{p.author?.name}</span>
                <span className="text-sm text-gray-400 dark:text-gray-500">
                  {format(new Date(p.createdAt), 'MM/dd')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Bus status (dispatch)
// ─────────────────────────────────────────
function BusStatusSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();
  const allBuses = data.buses.data || [];
  const active = allBuses.filter((b: { isActive: boolean }) => b.isActive).length;
  const inactive = allBuses.length - active;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={Bus} title="버스 현황" linkTo="/dashboard/buses" linkLabel="관리" />
      {data.buses.isLoading ? <SectionLoading /> : (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/dashboard/buses')}
            className="bg-green-50 rounded-xl p-4 text-center hover:bg-green-100 transition-colors min-h-[80px]"
          >
            <Bus size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-700">{active}</p>
            <p className="text-sm text-green-600">운행 가능</p>
          </button>
          <button
            onClick={() => navigate('/dashboard/buses')}
            className="bg-orange-50 rounded-xl p-4 text-center hover:bg-orange-100 transition-colors min-h-[80px]"
          >
            <Wrench size={24} className="mx-auto text-orange-600 mb-1" />
            <p className="text-2xl font-bold text-orange-700">{inactive}</p>
            <p className="text-sm text-orange-600">비운행/정비</p>
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Payroll (accounting)
// ─────────────────────────────────────────
function PayrollSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={DollarSign} title={`${data.month}월 급여 현황`} linkTo="/dashboard/payroll" linkLabel="급여관리" />
      {data.payroll.isLoading ? <SectionLoading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate('/dashboard/payroll')}
              className="bg-green-50 rounded-xl p-4 text-center hover:bg-green-100 transition-colors min-h-[80px]"
            >
              <CheckCircle size={24} className="mx-auto text-green-600 mb-1" />
              <p className="text-2xl font-bold text-green-700">{data.confirmedPayroll.length}</p>
              <p className="text-sm text-green-600">확정 완료</p>
            </button>
            <button
              onClick={() => navigate('/dashboard/payroll')}
              className="bg-yellow-50 rounded-xl p-4 text-center hover:bg-yellow-100 transition-colors min-h-[80px]"
            >
              <CreditCard size={24} className="mx-auto text-yellow-600 mb-1" />
              <p className="text-2xl font-bold text-yellow-700">{data.pendingPayroll.length}</p>
              <p className="text-sm text-yellow-600">미확정</p>
            </button>
          </div>
          {data.payrollRecords.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-base text-gray-600 dark:text-gray-300">총 급여 대상</span>
                <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{data.payrollRecords.length}명</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-base text-gray-600 dark:text-gray-300">총 지급 예정</span>
                <span className="text-lg font-bold text-blue-700">
                  {data.payrollRecords.reduce((sum: number, r: { netPay?: number }) => sum + (r.netPay || 0), 0).toLocaleString()}원
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Safety & Inspection (safety_mgr)
// ─────────────────────────────────────────
function SafetySection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();
  const stats = data.safetyStats.data;
  const inspStats = data.inspectionStats.data;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={ShieldAlert} title="안전 관리 현황" linkTo="/dashboard/safety" linkLabel="안전관리" />
      {data.safetyStats.isLoading ? <SectionLoading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate('/dashboard/safety')}
              className="bg-red-50 rounded-xl p-4 text-center hover:bg-red-100 transition-colors min-h-[80px]"
            >
              <AlertCircle size={24} className="mx-auto text-red-600 mb-1" />
              <p className="text-2xl font-bold text-red-700">{stats?.unresolvedIncidents || 0}</p>
              <p className="text-sm text-red-600">미해결 사고</p>
            </button>
            <button
              onClick={() => navigate('/dashboard/safety')}
              className="bg-orange-50 rounded-xl p-4 text-center hover:bg-orange-100 transition-colors min-h-[80px]"
            >
              <GraduationCap size={24} className="mx-auto text-orange-600 mb-1" />
              <p className="text-2xl font-bold text-orange-700">{stats?.trainingExpiringSoon || 0}</p>
              <p className="text-sm text-orange-600">교육 만료 예정</p>
            </button>
          </div>

          {/* Inspection */}
          {inspStats && (
            <div className="bg-blue-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <ClipboardCheck size={20} className="text-blue-600" />
                <span className="font-medium text-base text-blue-800">이번달 점검 현황</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-blue-700">완료율</span>
                <span className="text-lg font-bold text-blue-700">
                  {inspStats.completionRate != null
                    ? `${Math.round(inspStats.completionRate)}%`
                    : `${inspStats.completed || 0} / ${inspStats.total || 0}`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: License alerts (hr / safety)
// ─────────────────────────────────────────
function LicenseAlertSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const alerts = data.licenseAlerts.data || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={AlertCircle} title="면허 만료 경고" linkTo="/dashboard/safety" linkLabel="상세보기" />
      {data.licenseAlerts.isLoading ? <SectionLoading /> : alerts.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle size={40} className="mx-auto text-green-400 mb-2" />
          <p className="text-base text-gray-500 dark:text-gray-400">면허 만료 예정 기사가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.slice(0, 5).map((a: {
            id?: number;
            driverId?: number;
            name?: string;
            driverName?: string;
            licenseExpiry?: string;
            expiryDate?: string;
            daysUntilExpiry?: number;
          }, i: number) => {
            const expiry = a.licenseExpiry || a.expiryDate;
            const name = a.name || a.driverName || `기사 #${a.driverId || a.id}`;
            const isUrgent = a.daysUntilExpiry != null ? a.daysUntilExpiry <= 30 : false;
            return (
              <div key={a.id || a.driverId || i}
                className={`p-3 rounded-xl border min-h-[48px] flex items-center justify-between ${
                  isUrgent ? 'bg-red-50 border-red-100' : 'bg-yellow-50 border-yellow-100'
                }`}>
                <span className={`font-medium text-base ${isUrgent ? 'text-red-800' : 'text-yellow-800'}`}>
                  {name}
                </span>
                <span className={`text-sm ${isUrgent ? 'text-red-600' : 'text-yellow-600'}`}>
                  {expiry ? format(new Date(expiry), 'yyyy.MM.dd') : ''}
                  {a.daysUntilExpiry != null && ` (${a.daysUntilExpiry}일)`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Driver counts (HR)
// ─────────────────────────────────────────
function DriverCountSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={Users} title="기사 현황" linkTo="/dashboard/drivers" linkLabel="기사관리" />
      {data.drivers.isLoading ? <SectionLoading /> : (
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => navigate('/dashboard/drivers')}
            className="bg-blue-50 rounded-xl p-4 text-center hover:bg-blue-100 transition-colors min-h-[80px]"
          >
            <p className="text-2xl font-bold text-blue-700">{data.activeDrivers.length}</p>
            <p className="text-sm text-blue-600">전체 활성</p>
          </button>
          <button
            onClick={() => navigate('/dashboard/drivers')}
            className="bg-indigo-50 rounded-xl p-4 text-center hover:bg-indigo-100 transition-colors min-h-[80px]"
          >
            <p className="text-2xl font-bold text-indigo-700">{data.mainDrivers.length}</p>
            <p className="text-sm text-indigo-600">메인 기사</p>
          </button>
          <button
            onClick={() => navigate('/dashboard/drivers')}
            className="bg-teal-50 rounded-xl p-4 text-center hover:bg-teal-100 transition-colors min-h-[80px]"
          >
            <p className="text-2xl font-bold text-teal-700">{data.spareDrivers.length}</p>
            <p className="text-sm text-teal-600">스페어 기사</p>
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section: Schedule status card
// ─────────────────────────────────────────
function ScheduleStatusSection({ data }: { data: ReturnType<typeof useDashboardData> }) {
  const navigate = useNavigate();
  const sched = data.schedule.data;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
      <SectionHeader icon={Calendar} title={`${data.month}월 배차표 현황`} linkTo="/dashboard/schedule" />
      {data.schedule.isLoading ? <SectionLoading /> : sched ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-xl min-h-[48px]">
            <span className="text-base text-gray-600 dark:text-gray-300">상태</span>
            <span className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium ${
              sched.status === 'PUBLISHED' ? 'bg-green-100 text-green-700' :
              sched.status === 'DRAFT' ? 'bg-yellow-100 text-yellow-700' :
              'bg-gray-100 text-gray-700'
            }`}>
              {sched.status === 'PUBLISHED' ? '발행됨' :
               sched.status === 'DRAFT' ? '초안' : '보관됨'}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-xl min-h-[48px]">
            <span className="text-base text-gray-600 dark:text-gray-300">총 슬롯 수</span>
            <span className="text-lg font-bold">{sched.slots?.length || 0}개</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-xl min-h-[48px]">
            <span className="text-base text-gray-600 dark:text-gray-300">오늘 운행</span>
            <span className="text-lg font-bold text-blue-600">{data.todaySlots.length}명</span>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-base text-gray-400 dark:text-gray-500 mb-4">{data.month}월 배차표가 없습니다.</p>
          <button
            onClick={() => navigate('/dashboard/schedule')}
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl
                       hover:bg-blue-700 transition-colors text-base font-medium min-h-[48px]"
          >
            배차표 생성하기
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuthStore();
  const role = (user?.role || 'DRIVER') as Role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  const navigate = useNavigate();
  const now = new Date();
  const today = format(now, 'yyyy년 MM월 dd일 (EEEE)', { locale: ko });

  const data = useDashboardData(role);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <p className="text-base text-gray-500 dark:text-gray-400">{today}</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {user?.name || '관리자'}님, 안녕하세요
          </h1>
          <p className="text-base text-blue-600 font-medium mt-0.5">
            {ROLE_DASHBOARD_LABELS[role] || '대시보드'}
          </p>
        </div>
      </div>

      {/* ── Alert banners (all roles that have relevant data) ── */}
      {(isFullAccess || role === 'DISPATCH' || role === 'HR') && (
        <AlertBanners data={data} />
      )}

      {/* ─────────────────────────────────── */}
      {/* OWNER / DIRECTOR / ADMIN Dashboard */}
      {/* ─────────────────────────────────── */}
      {isFullAccess && (
        <>
          {/* Quick stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="활성 기사"
              value={data.activeDrivers.length}
              icon={Users}
              color="bg-blue-500"
              sub={`메인 ${data.mainDrivers.length} / 스페어 ${data.spareDrivers.length}`}
              onClick={() => navigate('/dashboard/drivers')}
            />
            <StatCard
              title="오늘 운행"
              value={data.todaySlots.length}
              icon={Calendar}
              color="bg-green-500"
              sub={`휴무 ${data.todayRestSlots.length}명`}
              onClick={() => navigate('/dashboard/schedule')}
            />
            <StatCard
              title="긴급 슬롯"
              value={data.emergency.data?.length || 0}
              icon={AlertTriangle}
              color={data.emergency.data?.length > 0 ? 'bg-red-500' : 'bg-gray-400'}
              sub="미처리"
              onClick={() => navigate('/dashboard/emergency')}
            />
            <StatCard
              title="미결재"
              value={data.approvalStats.data?.pending || 0}
              icon={FileText}
              color={data.approvalStats.data?.pending > 0 ? 'bg-orange-500' : 'bg-gray-400'}
              sub="대기중"
              onClick={() => navigate('/dashboard/approvals')}
            />
          </div>

          {/* Row 1: Today schedule + Emergency */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TodayScheduleSection data={data} />
            <EmergencySection data={data} />
          </div>

          {/* Row 2: Attendance + Approvals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AttendanceSection data={data} />
            <ApprovalsSection data={data} />
          </div>

          {/* Row 3: Day off + Schedule status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DayOffSection data={data} />
            <ScheduleStatusSection data={data} />
          </div>

          {/* Row 4: Recent posts + Notifications */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentPostsSection data={data} />
            <RecentNotifications data={data} />
          </div>
        </>
      )}

      {/* ─────────────────────────────────── */}
      {/* DISPATCH Dashboard                   */}
      {/* ─────────────────────────────────── */}
      {role === 'DISPATCH' && (
        <>
          {/* Quick stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="오늘 운행"
              value={data.todaySlots.length}
              icon={Calendar}
              color="bg-blue-500"
              sub={`휴무 ${data.todayRestSlots.length}명`}
              onClick={() => navigate('/dashboard/schedule')}
            />
            <StatCard
              title="긴급 슬롯"
              value={data.emergency.data?.length || 0}
              icon={AlertTriangle}
              color={data.emergency.data?.length > 0 ? 'bg-red-500' : 'bg-gray-400'}
              sub="미처리"
              onClick={() => navigate('/dashboard/emergency')}
            />
            <StatCard
              title="운행 버스"
              value={data.activeBuses.length}
              icon={Bus}
              color="bg-green-500"
              sub={`전체 ${data.buses.data?.length || 0}대`}
              onClick={() => navigate('/dashboard/buses')}
            />
            <StatCard
              title="휴무 요청"
              value={data.dayoffs.data?.length || 0}
              icon={CalendarOff}
              color={data.dayoffs.data?.length > 0 ? 'bg-yellow-500' : 'bg-gray-400'}
              sub="대기중"
              onClick={() => navigate('/dashboard/dayoff')}
            />
          </div>

          {/* Main sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TodayScheduleSection data={data} />
            <EmergencySection data={data} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BusStatusSection data={data} />
            <DayOffSection data={data} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ScheduleStatusSection data={data} />
            <RecentNotifications data={data} />
          </div>
        </>
      )}

      {/* ─────────────────────────────────── */}
      {/* HR Dashboard                         */}
      {/* ─────────────────────────────────── */}
      {role === 'HR' && (
        <>
          {/* Quick stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="활성 기사"
              value={data.activeDrivers.length}
              icon={Users}
              color="bg-blue-500"
              sub={`메인 ${data.mainDrivers.length} / 스페어 ${data.spareDrivers.length}`}
              onClick={() => navigate('/dashboard/drivers')}
            />
            <StatCard
              title="출근"
              value={data.presentCount}
              icon={UserCheck}
              color="bg-green-500"
              onClick={() => navigate('/dashboard/attendance')}
            />
            <StatCard
              title="지각/결근"
              value={`${data.lateCount}/${data.absentCount}`}
              icon={Clock}
              color={data.lateCount + data.absentCount > 0 ? 'bg-yellow-500' : 'bg-gray-400'}
              onClick={() => navigate('/dashboard/attendance')}
            />
            <StatCard
              title="휴무 요청"
              value={data.dayoffs.data?.length || 0}
              icon={CalendarOff}
              color={data.dayoffs.data?.length > 0 ? 'bg-yellow-500' : 'bg-gray-400'}
              sub="대기중"
              onClick={() => navigate('/dashboard/dayoff')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AttendanceSection data={data} />
            <DriverCountSection data={data} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DayOffSection data={data} />
            <LicenseAlertSection data={data} />
          </div>

          <RecentNotifications data={data} />
        </>
      )}

      {/* ─────────────────────────────────── */}
      {/* ACCOUNTING Dashboard                 */}
      {/* ─────────────────────────────────── */}
      {role === 'ACCOUNTING' && (
        <>
          {/* Quick stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="급여 대상"
              value={data.payrollRecords.length}
              icon={Users}
              color="bg-blue-500"
              sub="명"
              onClick={() => navigate('/dashboard/payroll')}
            />
            <StatCard
              title="확정 완료"
              value={data.confirmedPayroll.length}
              icon={CheckCircle}
              color="bg-green-500"
              sub="명"
              onClick={() => navigate('/dashboard/payroll')}
            />
            <StatCard
              title="미확정"
              value={data.pendingPayroll.length}
              icon={CreditCard}
              color={data.pendingPayroll.length > 0 ? 'bg-yellow-500' : 'bg-gray-400'}
              sub="명"
              onClick={() => navigate('/dashboard/payroll')}
            />
            <StatCard
              title="미결재"
              value={data.approvalStats.data?.pending || 0}
              icon={FileText}
              color={data.approvalStats.data?.pending > 0 ? 'bg-orange-500' : 'bg-gray-400'}
              sub="대기중"
              onClick={() => navigate('/dashboard/approvals')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PayrollSection data={data} />
            <ApprovalsSection data={data} />
          </div>

          <RecentNotifications data={data} />
        </>
      )}

      {/* ─────────────────────────────────── */}
      {/* SAFETY_MGR Dashboard                 */}
      {/* ─────────────────────────────────── */}
      {role === 'SAFETY_MGR' && (
        <>
          {/* Quick stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="미해결 사고"
              value={data.safetyStats.data?.unresolvedIncidents || 0}
              icon={AlertCircle}
              color={data.safetyStats.data?.unresolvedIncidents > 0 ? 'bg-red-500' : 'bg-gray-400'}
              onClick={() => navigate('/dashboard/safety')}
            />
            <StatCard
              title="교육 만료 예정"
              value={data.safetyStats.data?.trainingExpiringSoon || 0}
              icon={GraduationCap}
              color={data.safetyStats.data?.trainingExpiringSoon > 0 ? 'bg-orange-500' : 'bg-gray-400'}
              onClick={() => navigate('/dashboard/safety')}
            />
            <StatCard
              title="면허 만료 경고"
              value={(data.licenseAlerts.data || []).length}
              icon={AlertTriangle}
              color={(data.licenseAlerts.data || []).length > 0 ? 'bg-yellow-500' : 'bg-gray-400'}
              onClick={() => navigate('/dashboard/safety')}
            />
            <StatCard
              title="활성 기사"
              value={data.activeDrivers.length}
              icon={Users}
              color="bg-blue-500"
              onClick={() => navigate('/dashboard/drivers')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SafetySection data={data} />
            <LicenseAlertSection data={data} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DriverCountSection data={data} />
            <RecentNotifications data={data} />
          </div>
        </>
      )}

      {/* ─────────────────────────────────── */}
      {/* DRIVER fallback (shouldn't normally  */}
      {/* reach admin dashboard)               */}
      {/* ─────────────────────────────────── */}
      {role === 'DRIVER' && (
        <>
          <div className="grid grid-cols-1 gap-6">
            <RecentNotifications data={data} />
          </div>
        </>
      )}
    </div>
  );
}
