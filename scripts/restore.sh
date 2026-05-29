#!/usr/bin/env bash
# ─────────────────────────────────────────
# Busync DB 복구 스크립트
# 사용: ./scripts/restore.sh backups/busync_db_20250101_030000.sql.gz
# ─────────────────────────────────────────
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "사용법: $0 <백업파일.sql.gz>"
  echo "예시:  $0 backups/busync_db_20250101_030000.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "오류: 백업 파일을 찾을 수 없습니다: $BACKUP_FILE"
  exit 1
fi

# .env 로드
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

DB_USER="${POSTGRES_USER:-busync}"
DB_PASSWORD="${POSTGRES_PASSWORD:-busync_dev_password}"
DB_NAME="${POSTGRES_DB:-busync_db}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

# ─── 경고 ───
echo "⚠️  경고: 현재 DB '$DB_NAME'의 데이터를 백업 파일로 덮어씁니다."
echo "파일: $BACKUP_FILE"
read -p "계속하시겠습니까? (yes 입력): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "복구 취소됨."
  exit 0
fi

echo "[$(date)] 복구 시작..."

gunzip -c "$BACKUP_FILE" | PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password

echo "[$(date)] 복구 완료!"
