import { AsyncLocalStorage } from 'async_hooks';

/**
 * 요청 컨텍스트를 스레드(async) 범위로 전파.
 * authenticate 미들웨어에서 companyId를 세팅하면
 * 같은 요청 흐름 내 어디서든 getCurrentCompanyId()로 접근 가능.
 */
interface RequestContext {
  companyId: number;
  userId?: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithCompany<T>(companyId: number, fn: () => T, userId?: number): T {
  return storage.run({ companyId, userId }, fn);
}

export function getCurrentCompanyId(): number | undefined {
  return storage.getStore()?.companyId;
}

export function getCurrentUserId(): number | undefined {
  return storage.getStore()?.userId;
}

/**
 * 멀티테넌시 모델 목록 — companyId 필터 없이 조회하면 안 되는 테이블.
 * companyId 컬럼이 직접 있는 모델만 포함. 부모 관계로 격리되는 모델
 * (ScheduleSlot → Schedule, EmergencyDrop → ScheduleSlot)은 제외.
 */
export const TENANT_MODELS = new Set([
  'User', 'Bus', 'Route', 'Schedule',
  'DayOffRequest', 'Notification', 'CompanyRule',
  'MaintenanceRecord', 'Contact', 'AttendanceRecord', 'PayrollRecord',
  'PayrollSetting', 'DailyInspection', 'IncidentRecord', 'TrainingRecord',
  'AuditLog',
  // Phase 1.2: 누락된 companyId 보유 모델 추가
  'DriverTag', 'GoldenTicket', 'ChatSession', 'Approval',
  'Post', 'HoboongTable', 'UnionDue', 'DirectMessage',
  // Phase 1.3: AI 에이전트 결정 추적
  'AgentDecision',
  // Phase 3: 일일 운영 보고서
  'DailyReport',
]);
