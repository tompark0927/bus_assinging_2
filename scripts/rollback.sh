#!/bin/bash
# Rollback Script - Switch back to previous instance
# Usage: ./scripts/rollback.sh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml"
NGINX_CONF="nginx/conf.d/default.conf"
COLOR_FILE=".current-color"

CURRENT=$(cat "$COLOR_FILE" 2>/dev/null || echo "blue")
PREVIOUS=$([[ "$CURRENT" == "blue" ]] && echo "green" || echo "blue")

echo "============================================"
echo "  Busync 롤백"
echo "  현재: $CURRENT -> 복원: $PREVIOUS"
echo "============================================"
echo ""

# 1. Start previous instance
echo "[1/3] $PREVIOUS 인스턴스 시작..."
$COMPOSE up -d "backend-$PREVIOUS"

# 2. Wait for health
echo "[2/3] 헬스체크 대기..."
for i in $(seq 1 15); do
    if $COMPOSE exec "backend-$PREVIOUS" wget --no-verbose --tries=1 --spider http://localhost:4000/health > /dev/null 2>&1; then
        echo "  $PREVIOUS 인스턴스 정상"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo "  ERROR: $PREVIOUS 인스턴스 헬스체크 실패! 롤백 중단."
        exit 1
    fi
    sleep 2
done

# 3. Switch traffic
echo "[3/3] 트래픽 전환..."
if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/server backend-$CURRENT:4000/server backend-$PREVIOUS:4000/g" "$NGINX_CONF"
else
    sed -i "s/server backend-$CURRENT:4000/server backend-$PREVIOUS:4000/g" "$NGINX_CONF"
fi

$COMPOSE exec nginx nginx -s reload
echo "$PREVIOUS" > "$COLOR_FILE"

$COMPOSE stop "backend-$CURRENT"

echo ""
echo "  롤백 완료! 활성 인스턴스: $PREVIOUS"
echo "============================================"
