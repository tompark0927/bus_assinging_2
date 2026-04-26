#!/bin/bash
# Blue-Green Deployment Script
# Usage: ./scripts/deploy.sh
#
# Zero-downtime deployment for Busync backend.
# Switches traffic between blue and green instances via nginx upstream config.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml"
NGINX_CONF="nginx/conf.d/default.conf"
COLOR_FILE=".current-color"

CURRENT=$(cat "$COLOR_FILE" 2>/dev/null || echo "blue")
NEXT=$([[ "$CURRENT" == "blue" ]] && echo "green" || echo "blue")

echo "============================================"
echo "  Busync Blue-Green 배포"
echo "  현재 활성: $CURRENT -> 새 배포: $NEXT"
echo "============================================"
echo ""

# 1. Build and start new version
echo "[1/5] $NEXT 인스턴스 빌드 및 시작..."
$COMPOSE build "backend-$NEXT"
$COMPOSE up -d "backend-$NEXT"

# 2. Wait for health check
echo "[2/5] 헬스체크 대기 (최대 60초)..."
HEALTH_OK=false
for i in $(seq 1 30); do
    if $COMPOSE exec "backend-$NEXT" wget --no-verbose --tries=1 --spider http://localhost:4000/health > /dev/null 2>&1; then
        echo "  $NEXT 인스턴스 정상 (${i}번째 시도)"
        HEALTH_OK=true
        break
    fi
    echo "  헬스체크 대기 중... ($i/30)"
    sleep 2
done

if [ "$HEALTH_OK" = false ]; then
    echo "  ERROR: $NEXT 인스턴스 헬스체크 실패!"
    echo "  롤백: $NEXT 인스턴스를 중지합니다."
    $COMPOSE stop "backend-$NEXT"
    exit 1
fi

# 3. Switch nginx upstream
echo "[3/5] 트래픽 전환: $CURRENT -> $NEXT"

# Update the upstream to point to the new backend
if [[ "$(uname)" == "Darwin" ]]; then
    # macOS sed requires empty string for -i
    sed -i '' "s/server backend-$CURRENT:4000/server backend-$NEXT:4000/g" "$NGINX_CONF"
else
    sed -i "s/server backend-$CURRENT:4000/server backend-$NEXT:4000/g" "$NGINX_CONF"
fi

# Reload nginx config
$COMPOSE exec nginx nginx -s reload
echo "  Nginx 설정 리로드 완료"

# 4. Save current color
echo "[4/5] 활성 인스턴스 기록..."
echo "$NEXT" > "$COLOR_FILE"

# 5. Stop old version after grace period
GRACE_PERIOD=${GRACE_PERIOD:-30}
echo "[5/5] 이전 인스턴스($CURRENT) ${GRACE_PERIOD}초 후 중지..."
sleep "$GRACE_PERIOD"
$COMPOSE stop "backend-$CURRENT"

echo ""
echo "============================================"
echo "  배포 완료!"
echo "  활성 인스턴스: $NEXT"
echo "============================================"
