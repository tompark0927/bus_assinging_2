-- AI 배차 엔진 튜닝 정책을 DB 로 이관.
-- 예전에는 엔진 컨테이너의 파일(ENGINE_DATA_DIR/policies/*.json)이 주인이라
-- 볼륨이 없으면 재배포마다 설정이 초기화됐다. 이제 여기가 단일 소스다.
-- nullable — 값이 없으면 엔진 카탈로그 기본값을 쓴다(기존 동작 유지).
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "enginePolicy" JSONB;
