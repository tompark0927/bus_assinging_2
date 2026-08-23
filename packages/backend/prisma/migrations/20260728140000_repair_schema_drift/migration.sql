-- 스키마 드리프트 일괄 수리 (2026-07-28)
-- 몇 달간 prisma db push로만 반영되어 마이그레이션 이력에 없던 객체 전부.
-- 모든 구문이 멱등(IF NOT EXISTS / DO 블록) — 프로덕션(이미 존재)에선 no-op,
-- 새 DB에선 스키마를 현행과 일치시킨다. migrate diff로 생성 후 변환.

DO $$ BEGIN
    CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "IncidentType" AS ENUM ('ACCIDENT', 'TRAFFIC_VIOLATION', 'COMPLAINT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "InspectionStatus" AS ENUM ('PASSED', 'FAILED', 'PENDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ApprovalType" AS ENUM ('DAY_OFF', 'SHIFT_CHANGE', 'EXPENSE', 'MAINTENANCE', 'INCIDENT', 'PURCHASE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "BoardType" AS ENUM ('NOTICE', 'SAFETY', 'FREE', 'ROUTE', 'SUGGESTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'INSPECTION_FAILED';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'APPROVAL_REQUESTED';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NEW_POST';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'URGENT_POST';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NEW_MESSAGE';

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER';

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DIRECTOR';

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DISPATCH';

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HR';

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTING';

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SAFETY_MGR';

DROP INDEX IF EXISTS "Bus_busNumber_key";

DROP INDEX IF EXISTS "Bus_plateNumber_key";

DROP INDEX IF EXISTS "Route_routeNumber_key";

DROP INDEX IF EXISTS "User_employeeId_key";

DROP INDEX IF EXISTS "User_phone_key";

ALTER TABLE "Bus" ADD COLUMN IF NOT EXISTS     "groupType" TEXT,
ADD COLUMN IF NOT EXISTS     "orderInGroup" INTEGER;

ALTER TABLE "EmergencyDrop" ADD COLUMN IF NOT EXISTS     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS     "lastEscalatedAt" TIMESTAMP(3);

ALTER TABLE "OtpVerification" ADD COLUMN IF NOT EXISTS     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS     "email" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS     "fatigueReason" TEXT,
ADD COLUMN IF NOT EXISTS     "fatigueScore" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS     "shiftOffset" INTEGER;

ALTER TABLE "ScheduleSlot" ADD COLUMN IF NOT EXISTS     "fairnessNote" TEXT,
ADD COLUMN IF NOT EXISTS     "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS     "overrideBy" INTEGER,
ADD COLUMN IF NOT EXISTS     "overrideReason" TEXT;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS     "assignedBusNumber" TEXT,
ADD COLUMN IF NOT EXISTS     "hoboong" INTEGER,
ADD COLUMN IF NOT EXISTS     "licenseExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS     "qualificationExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "shiftGroup" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "DriverPreference" (
    "id" SERIAL NOT NULL,
    "driverId" INTEGER NOT NULL,
    "routeId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriverTag" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,
    "isHardRule" BOOLEAN NOT NULL DEFAULT false,
    "targetDriverId" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GoldenTicket" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "earnedFrom" INTEGER,
    "usedForDate" DATE,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoldenTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContactRequest" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "topic" TEXT,
    "buses" INTEGER,
    "employees" INTEGER,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Approval" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "data" JSONB,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "requesterId" INTEGER NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL DEFAULT 1,
    "rejectedBy" INTEGER,
    "rejectReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ApprovalStep" (
    "id" SERIAL NOT NULL,
    "approvalId" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "approverId" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Post" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "boardType" "BoardType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "routeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostRead" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostRead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "checkInMethod" TEXT,
    "checkOutMethod" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollSetting" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "baseSalary" INTEGER NOT NULL DEFAULT 3000000,
    "overtimeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "nightShiftBonus" INTEGER NOT NULL DEFAULT 50000,
    "holidayRate" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "nationalPensionRate" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
    "healthInsuranceRate" DOUBLE PRECISION NOT NULL DEFAULT 3.545,
    "employmentInsRate" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollRecord" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "baseSalary" INTEGER NOT NULL,
    "workDays" INTEGER NOT NULL,
    "overtimePay" INTEGER NOT NULL DEFAULT 0,
    "nightShiftPay" INTEGER NOT NULL DEFAULT 0,
    "holidayPay" INTEGER NOT NULL DEFAULT 0,
    "hoboong" INTEGER,
    "grossPay" INTEGER NOT NULL,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "unionDues" INTEGER NOT NULL DEFAULT 0,
    "netPay" INTEGER NOT NULL,
    "note" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DailyInspection" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "busId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "items" JSONB NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IncidentRecord" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "type" "IncidentType" NOT NULL,
    "description" TEXT NOT NULL,
    "penalty" INTEGER,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrainingRecord" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "institution" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HoboongTable" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "baseSalary" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HoboongTable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UnionDue" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FIXED',
    "amount" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnionDue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DirectMessage" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "receiverId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DriverPreference_driverId_idx" ON "DriverPreference"("driverId");

CREATE INDEX IF NOT EXISTS "DriverPreference_routeId_idx" ON "DriverPreference"("routeId");

CREATE UNIQUE INDEX IF NOT EXISTS "DriverPreference_driverId_routeId_key" ON "DriverPreference"("driverId", "routeId");

CREATE UNIQUE INDEX IF NOT EXISTS "DriverPreference_driverId_priority_key" ON "DriverPreference"("driverId", "priority");

CREATE INDEX IF NOT EXISTS "DriverTag_companyId_idx" ON "DriverTag"("companyId");

CREATE INDEX IF NOT EXISTS "DriverTag_driverId_idx" ON "DriverTag"("driverId");

CREATE INDEX IF NOT EXISTS "DriverTag_companyId_driverId_idx" ON "DriverTag"("companyId", "driverId");

CREATE INDEX IF NOT EXISTS "GoldenTicket_companyId_idx" ON "GoldenTicket"("companyId");

CREATE INDEX IF NOT EXISTS "GoldenTicket_driverId_idx" ON "GoldenTicket"("driverId");

CREATE INDEX IF NOT EXISTS "GoldenTicket_driverId_isUsed_idx" ON "GoldenTicket"("driverId", "isUsed");

CREATE INDEX IF NOT EXISTS "ContactRequest_status_idx" ON "ContactRequest"("status");

CREATE INDEX IF NOT EXISTS "ContactRequest_topic_idx" ON "ContactRequest"("topic");

CREATE INDEX IF NOT EXISTS "Approval_companyId_status_idx" ON "Approval"("companyId", "status");

CREATE INDEX IF NOT EXISTS "Approval_requesterId_idx" ON "Approval"("requesterId");

CREATE INDEX IF NOT EXISTS "ApprovalStep_approverId_status_idx" ON "ApprovalStep"("approverId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalStep_approvalId_step_key" ON "ApprovalStep"("approvalId", "step");

CREATE INDEX IF NOT EXISTS "Post_companyId_boardType_idx" ON "Post"("companyId", "boardType");

CREATE INDEX IF NOT EXISTS "Post_authorId_idx" ON "Post"("authorId");

CREATE INDEX IF NOT EXISTS "Post_companyId_createdAt_idx" ON "Post"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "Post_routeId_idx" ON "Post"("routeId");

CREATE UNIQUE INDEX IF NOT EXISTS "PostRead_postId_userId_key" ON "PostRead"("postId", "userId");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_companyId_idx" ON "AttendanceRecord"("companyId");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_driverId_idx" ON "AttendanceRecord"("driverId");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_status_idx" ON "AttendanceRecord"("status");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_companyId_date_idx" ON "AttendanceRecord"("companyId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_driverId_date_key" ON "AttendanceRecord"("driverId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollSetting_companyId_key" ON "PayrollSetting"("companyId");

CREATE INDEX IF NOT EXISTS "PayrollRecord_companyId_idx" ON "PayrollRecord"("companyId");

CREATE INDEX IF NOT EXISTS "PayrollRecord_driverId_idx" ON "PayrollRecord"("driverId");

CREATE INDEX IF NOT EXISTS "PayrollRecord_companyId_year_month_idx" ON "PayrollRecord"("companyId", "year", "month");

CREATE INDEX IF NOT EXISTS "PayrollRecord_isConfirmed_idx" ON "PayrollRecord"("isConfirmed");

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRecord_companyId_driverId_year_month_key" ON "PayrollRecord"("companyId", "driverId", "year", "month");

CREATE INDEX IF NOT EXISTS "DailyInspection_companyId_idx" ON "DailyInspection"("companyId");

CREATE INDEX IF NOT EXISTS "DailyInspection_driverId_idx" ON "DailyInspection"("driverId");

CREATE INDEX IF NOT EXISTS "DailyInspection_date_idx" ON "DailyInspection"("date");

CREATE INDEX IF NOT EXISTS "DailyInspection_status_idx" ON "DailyInspection"("status");

CREATE INDEX IF NOT EXISTS "DailyInspection_companyId_date_idx" ON "DailyInspection"("companyId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "DailyInspection_busId_date_key" ON "DailyInspection"("busId", "date");

CREATE INDEX IF NOT EXISTS "IncidentRecord_companyId_idx" ON "IncidentRecord"("companyId");

CREATE INDEX IF NOT EXISTS "IncidentRecord_driverId_idx" ON "IncidentRecord"("driverId");

CREATE INDEX IF NOT EXISTS "IncidentRecord_date_idx" ON "IncidentRecord"("date");

CREATE INDEX IF NOT EXISTS "IncidentRecord_type_idx" ON "IncidentRecord"("type");

CREATE INDEX IF NOT EXISTS "IncidentRecord_companyId_driverId_idx" ON "IncidentRecord"("companyId", "driverId");

CREATE INDEX IF NOT EXISTS "IncidentRecord_isResolved_idx" ON "IncidentRecord"("isResolved");

CREATE INDEX IF NOT EXISTS "TrainingRecord_companyId_idx" ON "TrainingRecord"("companyId");

CREATE INDEX IF NOT EXISTS "TrainingRecord_driverId_idx" ON "TrainingRecord"("driverId");

CREATE INDEX IF NOT EXISTS "TrainingRecord_expiresAt_idx" ON "TrainingRecord"("expiresAt");

CREATE INDEX IF NOT EXISTS "TrainingRecord_companyId_driverId_idx" ON "TrainingRecord"("companyId", "driverId");

CREATE INDEX IF NOT EXISTS "HoboongTable_companyId_idx" ON "HoboongTable"("companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "HoboongTable_companyId_level_key" ON "HoboongTable"("companyId", "level");

CREATE INDEX IF NOT EXISTS "UnionDue_companyId_idx" ON "UnionDue"("companyId");

CREATE INDEX IF NOT EXISTS "UnionDue_companyId_isActive_idx" ON "UnionDue"("companyId", "isActive");

CREATE INDEX IF NOT EXISTS "DirectMessage_companyId_idx" ON "DirectMessage"("companyId");

CREATE INDEX IF NOT EXISTS "DirectMessage_senderId_receiverId_idx" ON "DirectMessage"("senderId", "receiverId");

CREATE INDEX IF NOT EXISTS "DirectMessage_receiverId_isRead_idx" ON "DirectMessage"("receiverId", "isRead");

CREATE INDEX IF NOT EXISTS "DirectMessage_createdAt_idx" ON "DirectMessage"("createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_companyId_idx" ON "AuditLog"("companyId");

CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_companyId_entityType_idx" ON "AuditLog"("companyId", "entityType");

CREATE INDEX IF NOT EXISTS "Bus_companyId_idx" ON "Bus"("companyId");

CREATE INDEX IF NOT EXISTS "Bus_routeId_idx" ON "Bus"("routeId");

CREATE INDEX IF NOT EXISTS "Bus_companyId_isActive_idx" ON "Bus"("companyId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "Bus_companyId_busNumber_key" ON "Bus"("companyId", "busNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "Bus_companyId_plateNumber_key" ON "Bus"("companyId", "plateNumber");

CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");

CREATE INDEX IF NOT EXISTS "ChatSession_companyId_idx" ON "ChatSession"("companyId");

CREATE INDEX IF NOT EXISTS "ChatSession_userId_idx" ON "ChatSession"("userId");

CREATE INDEX IF NOT EXISTS "CompanyRule_companyId_idx" ON "CompanyRule"("companyId");

CREATE INDEX IF NOT EXISTS "CompanyRule_companyId_category_idx" ON "CompanyRule"("companyId", "category");

CREATE INDEX IF NOT EXISTS "CompanyRule_companyId_isActive_idx" ON "CompanyRule"("companyId", "isActive");

CREATE INDEX IF NOT EXISTS "DayOffRequest_companyId_idx" ON "DayOffRequest"("companyId");

CREATE INDEX IF NOT EXISTS "DayOffRequest_driverId_idx" ON "DayOffRequest"("driverId");

CREATE INDEX IF NOT EXISTS "DayOffRequest_status_idx" ON "DayOffRequest"("status");

CREATE INDEX IF NOT EXISTS "DayOffRequest_date_idx" ON "DayOffRequest"("date");

CREATE INDEX IF NOT EXISTS "DayOffRequest_companyId_status_idx" ON "DayOffRequest"("companyId", "status");

CREATE INDEX IF NOT EXISTS "DayOffRequest_companyId_driverId_idx" ON "DayOffRequest"("companyId", "driverId");

CREATE INDEX IF NOT EXISTS "EmergencyDrop_driverId_idx" ON "EmergencyDrop"("driverId");

CREATE INDEX IF NOT EXISTS "EmergencyDrop_status_idx" ON "EmergencyDrop"("status");

CREATE INDEX IF NOT EXISTS "EmergencyDrop_filledBy_idx" ON "EmergencyDrop"("filledBy");

CREATE INDEX IF NOT EXISTS "EmergencyDrop_escalationLevel_status_idx" ON "EmergencyDrop"("escalationLevel", "status");

CREATE INDEX IF NOT EXISTS "MaintenanceRecord_companyId_idx" ON "MaintenanceRecord"("companyId");

CREATE INDEX IF NOT EXISTS "MaintenanceRecord_busId_idx" ON "MaintenanceRecord"("busId");

CREATE INDEX IF NOT EXISTS "MaintenanceRecord_status_idx" ON "MaintenanceRecord"("status");

CREATE INDEX IF NOT EXISTS "MaintenanceRecord_scheduledAt_idx" ON "MaintenanceRecord"("scheduledAt");

CREATE INDEX IF NOT EXISTS "MaintenanceRecord_companyId_status_idx" ON "MaintenanceRecord"("companyId", "status");

CREATE INDEX IF NOT EXISTS "Notification_companyId_idx" ON "Notification"("companyId");

CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");

CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

CREATE INDEX IF NOT EXISTS "Notification_companyId_userId_idx" ON "Notification"("companyId", "userId");

CREATE INDEX IF NOT EXISTS "Notification_type_idx" ON "Notification"("type");

CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

CREATE INDEX IF NOT EXISTS "OtpVerification_email_idx" ON "OtpVerification"("email");

CREATE INDEX IF NOT EXISTS "Route_companyId_idx" ON "Route"("companyId");

CREATE INDEX IF NOT EXISTS "Route_companyId_isActive_idx" ON "Route"("companyId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "Route_companyId_routeNumber_key" ON "Route"("companyId", "routeNumber");

CREATE INDEX IF NOT EXISTS "RouteAssignment_driverId_idx" ON "RouteAssignment"("driverId");

CREATE INDEX IF NOT EXISTS "RouteAssignment_routeId_idx" ON "RouteAssignment"("routeId");

CREATE INDEX IF NOT EXISTS "RouteAssignment_driverId_isActive_idx" ON "RouteAssignment"("driverId", "isActive");

CREATE INDEX IF NOT EXISTS "Schedule_companyId_idx" ON "Schedule"("companyId");

CREATE INDEX IF NOT EXISTS "Schedule_status_idx" ON "Schedule"("status");

CREATE INDEX IF NOT EXISTS "Schedule_companyId_status_idx" ON "Schedule"("companyId", "status");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_scheduleId_idx" ON "ScheduleSlot"("scheduleId");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_driverId_idx" ON "ScheduleSlot"("driverId");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_routeId_idx" ON "ScheduleSlot"("routeId");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_busId_idx" ON "ScheduleSlot"("busId");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_date_idx" ON "ScheduleSlot"("date");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_status_idx" ON "ScheduleSlot"("status");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_scheduleId_date_idx" ON "ScheduleSlot"("scheduleId", "date");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_driverId_date_idx" ON "ScheduleSlot"("driverId", "date");

CREATE INDEX IF NOT EXISTS "ScheduleSlot_scheduleId_driverId_idx" ON "ScheduleSlot"("scheduleId", "driverId");

CREATE INDEX IF NOT EXISTS "User_companyId_idx" ON "User"("companyId");

CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");

CREATE INDEX IF NOT EXISTS "User_companyId_role_idx" ON "User"("companyId", "role");

CREATE INDEX IF NOT EXISTS "User_companyId_isActive_idx" ON "User"("companyId", "isActive");

CREATE INDEX IF NOT EXISTS "User_driverType_idx" ON "User"("driverType");

CREATE INDEX IF NOT EXISTS "User_licenseExpiresAt_idx" ON "User"("licenseExpiresAt");

CREATE INDEX IF NOT EXISTS "User_qualificationExpiresAt_idx" ON "User"("qualificationExpiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "User_companyId_employeeId_key" ON "User"("companyId", "employeeId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverPreference_driverId_fkey') THEN
        ALTER TABLE "DriverPreference" ADD CONSTRAINT "DriverPreference_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverPreference_routeId_fkey') THEN
        ALTER TABLE "DriverPreference" ADD CONSTRAINT "DriverPreference_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverTag_companyId_fkey') THEN
        ALTER TABLE "DriverTag" ADD CONSTRAINT "DriverTag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverTag_driverId_fkey') THEN
        ALTER TABLE "DriverTag" ADD CONSTRAINT "DriverTag_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverTag_targetDriverId_fkey') THEN
        ALTER TABLE "DriverTag" ADD CONSTRAINT "DriverTag_targetDriverId_fkey" FOREIGN KEY ("targetDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoldenTicket_companyId_fkey') THEN
        ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoldenTicket_driverId_fkey') THEN
        ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Approval_companyId_fkey') THEN
        ALTER TABLE "Approval" ADD CONSTRAINT "Approval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Approval_requesterId_fkey') THEN
        ALTER TABLE "Approval" ADD CONSTRAINT "Approval_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApprovalStep_approvalId_fkey') THEN
        ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApprovalStep_approverId_fkey') THEN
        ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Post_companyId_fkey') THEN
        ALTER TABLE "Post" ADD CONSTRAINT "Post_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Post_authorId_fkey') THEN
        ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Post_routeId_fkey') THEN
        ALTER TABLE "Post" ADD CONSTRAINT "Post_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostRead_postId_fkey') THEN
        ALTER TABLE "PostRead" ADD CONSTRAINT "PostRead_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostRead_userId_fkey') THEN
        ALTER TABLE "PostRead" ADD CONSTRAINT "PostRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceRecord_companyId_fkey') THEN
        ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceRecord_driverId_fkey') THEN
        ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollSetting_companyId_fkey') THEN
        ALTER TABLE "PayrollSetting" ADD CONSTRAINT "PayrollSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollRecord_companyId_fkey') THEN
        ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollRecord_driverId_fkey') THEN
        ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyInspection_companyId_fkey') THEN
        ALTER TABLE "DailyInspection" ADD CONSTRAINT "DailyInspection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyInspection_busId_fkey') THEN
        ALTER TABLE "DailyInspection" ADD CONSTRAINT "DailyInspection_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyInspection_driverId_fkey') THEN
        ALTER TABLE "DailyInspection" ADD CONSTRAINT "DailyInspection_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IncidentRecord_companyId_fkey') THEN
        ALTER TABLE "IncidentRecord" ADD CONSTRAINT "IncidentRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IncidentRecord_driverId_fkey') THEN
        ALTER TABLE "IncidentRecord" ADD CONSTRAINT "IncidentRecord_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrainingRecord_companyId_fkey') THEN
        ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrainingRecord_driverId_fkey') THEN
        ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoboongTable_companyId_fkey') THEN
        ALTER TABLE "HoboongTable" ADD CONSTRAINT "HoboongTable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UnionDue_companyId_fkey') THEN
        ALTER TABLE "UnionDue" ADD CONSTRAINT "UnionDue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_companyId_fkey') THEN
        ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_senderId_fkey') THEN
        ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_receiverId_fkey') THEN
        ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_companyId_fkey') THEN
        ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_userId_fkey') THEN
        ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
