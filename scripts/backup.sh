#!/usr/bin/env bash
# ─────────────────────────────────────────
# Busync DB 백업 스크립트
# 사용: ./scripts/backup.sh
# 자동화: crontab -e → 0 3 * * * /절대경로/scripts/backup.sh
# ─────────────────────────────────────────
set -euo pipefail

# .env에서 환경변수 로드 (프로젝트 루트)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

# ─── 설정 ───
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DB_USER="${POSTGRES_USER:-busync}"
DB_PASSWORD="${POSTGRES_PASSWORD:-busync_dev_password}"
DB_NAME="${POSTGRES_DB:-busync_db}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"     # 30일치 보관
SLACK_WEBHOOK="${SLACK_BACKUP_WEBHOOK:-}" # 슬랙 알림 (선택)

# ─── 백업 디렉토리 생성 ───
mkdir -p "$BACKUP_DIR"

# ─── 파일명 (날짜+시각) ───
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${DB_NAME}_${TIMESTAMP}.sql.gz"
FILEPATH="$BACKUP_DIR/$FILENAME"

# ─── 백업 실행 ───
echo "[$(date)] 백업 시작: $FILENAME"

PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password \
  --clean \
  --if-exists \
  | gzip > "$FILEPATH"

SIZE=$(du -sh "$FILEPATH" | cut -f1)
echo "[$(date)] 백업 완료: $FILENAME ($SIZE)"

# ─── 오래된 백업 삭제 ───
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] 오래된 백업 $DELETED 개 삭제 (${KEEP_DAYS}일 초과)"
fi

# ─── 슬랙 알림 (SLACK_BACKUP_WEBHOOK 설정 시) ───
if [ -n "$SLACK_WEBHOOK" ]; then
  curl -s -X POST "$SLACK_WEBHOOK" \
    -H 'Content-type: application/json' \
    -d "{\"text\":\"✅ Busync DB 백업 완료: \`$FILENAME\` ($SIZE)\"}" \
    > /dev/null
fi

echo "[$(date)] 완료"
