-- 스키마에는 있으나 마이그레이션이 누락됐던 User.vacationDays 컬럼 추가.
-- 이 컬럼이 DB에 없으면 User 를 조회하는 모든 경로(예: 이메일 인증 send-otp 의 중복 검사)가
-- Prisma P2022 로 실패해 "인증번호 발송에 실패했습니다" 500 을 낸다.
-- IF NOT EXISTS: 프로덕션이 이미 db push 등으로 컬럼을 가진 경우에도 배포가 실패하지 않도록 멱등 처리.
-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "vacationDays" INTEGER NOT NULL DEFAULT 15;
