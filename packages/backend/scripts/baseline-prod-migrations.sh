#!/usr/bin/env bash
# 프로덕션 마이그레이션 이력 정상화 + SchedulePattern 테이블 생성.
#
# 배경: 프로덕션 DB는 그동안 `prisma db push` 로만 스키마를 반영해왔다.
#       그래서 _prisma_migrations 이력이 비어 있고, 그냥 `migrate deploy` 를
#       돌리면 이미 존재하는 테이블을 다시 만들려다 실패한다.
#
# 하는 일:
#   1) 이미 DB에 반영되어 있는 13개 마이그레이션을 "적용됨"으로 **기록만** 한다
#      (스키마를 건드리지 않는다 — _prisma_migrations 에 행을 넣을 뿐)
#   2) 남은 1개(20260729082024_add_schedule_pattern)만 실제로 적용한다
#      → SchedulePattern 테이블 + 인덱스 3 + FK 2 (전부 추가, 파괴적 변경 없음)
#
# 사전 확인 완료: `migrate diff` 결과 프로덕션에 부족한 것은 SchedulePattern
# 하나뿐이며 DROP/ALTER COLUMN 같은 파괴적 구문은 없다.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ 프로덕션 DB 주소 조회 (Railway)"
DB=$(railway variables --service Postgres --kv </dev/null 2>/dev/null | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
if [ -z "$DB" ]; then
  echo "✗ DATABASE_PUBLIC_URL 을 가져오지 못했습니다. railway login / railway link 를 확인하세요."
  exit 1
fi
export DATABASE_URL="$DB"

echo "▸ 현재 상태"
npx prisma@5 migrate status 2>&1 | tail -5 || true

echo
echo "▸ 1/2 기존 13개를 '적용됨'으로 기록 (스키마 변경 없음)"
for M in \
  20260310174158_init \
  20260310195002_phase3_maintenance_gps \
  20260310200046_init_multi_tenancy \
  20260314000000_add_refresh_token_family \
  20260410161536_add_expired_status_and_fix_company_seq \
  20260410164742_add_agent_decision \
  20260410212744_add_daily_report \
  20260428000000_add_company_policy_json \
  20260704120000_add_general_notification_type \
  20260704130000_drop_bus_capacity \
  20260705180000_multi_draft_schedules \
  20260713000000_add_user_vacation_days \
  20260728140000_repair_schema_drift
do
  if npx prisma@5 migrate resolve --applied "$M" >/dev/null 2>&1; then
    echo "   ✓ $M"
  else
    echo "   - $M (이미 기록되어 있거나 건너뜀)"
  fi
done

echo
echo "▸ 2/2 남은 마이그레이션 적용 (SchedulePattern 생성)"
npx prisma@5 migrate deploy

echo
echo "▸ 검증 — 스키마 차이가 없어야 정상"
npx prisma@5 migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script 2>&1 | head -3

cat <<'MSG'

완료. 이제 백엔드를 한 번 재배포하면(또는 그대로 두어도) 배차표 생성이 동작합니다.
확인: https://www.busync.kr/api/v1/engine/_diagnose  → {"ok":true}
MSG
