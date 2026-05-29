-- Stage 4: Company.policy JSON 컬럼 추가
-- monthly-grid-solver 의 CompanyPolicy 를 회사별 영속화.
-- null = DEFAULT_POLICY (CITY_2SHIFT) 사용.
-- solverDispatchService.loadCompanyPolicy 가 우선 읽고, 없으면 코드 prefix 매핑으로 fallback.

ALTER TABLE "Company" ADD COLUMN "policy" JSONB;
