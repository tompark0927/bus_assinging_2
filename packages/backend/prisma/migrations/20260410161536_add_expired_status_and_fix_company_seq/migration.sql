-- escalationService.ts가 출발시간 경과 시 EmergencyDrop을 'EXPIRED' 상태로 표시하지만
-- 초기 마이그레이션에서 enum에 EXPIRED 값이 누락되어 있어 22P02 에러가 발생.
ALTER TYPE "EmergencyStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- prisma/seed.ts가 Company를 id=1로 명시 INSERT 했기 때문에 Postgres serial 시퀀스가
-- 1에서 멈춰 있어 신규 등록 시 P2002(unique on id) 충돌이 발생함.
-- 시드는 별도 패치에서 명시 id를 제거했지만, 이미 잘못된 시퀀스를 가진 환경을 위해 보정.
SELECT setval(
  pg_get_serial_sequence('"Company"', 'id'),
  COALESCE((SELECT MAX(id) FROM "Company"), 0) + 1,
  false
);
