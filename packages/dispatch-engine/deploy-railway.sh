#!/usr/bin/env bash
# BuSync 배차 엔진 — Railway 서비스 생성·배포 자동화.
#
# 전제: `railway login` 완료 + 백엔드가 있는 프로젝트에 링크됨
#       (링크 안 됐으면 스크립트가 프로젝트 선택을 안내한다)
#
# 하는 일:
#   1) 엔진 서비스 생성 (GitHub 리포 연결 → push 시 자동 재배포)
#   2) PORT / RAILWAY_DOCKERFILE_PATH 설정 (Root Directory 대시보드 조작 불필요)
#   3) /data 볼륨 생성·연결 (정책·초안 영속화)
#   4) 백엔드 서비스에 ENGINE_URL 주입 (private networking)
#
# 공개 도메인은 만들지 않는다 — 엔진은 인증이 없어 프록시 뒤에만 있어야 한다.
set -euo pipefail

SERVICE="${ENGINE_SERVICE_NAME:-dispatch-engine}"
BACKEND_SERVICE="${BACKEND_SERVICE_NAME:-}"
REPO="${ENGINE_REPO:-tompark0927/bus_assinging_2}"
PORT_VAL=8100

cd "$(dirname "$0")/../.."   # 리포 루트

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

step "인증 확인"
railway whoami

step "프로젝트 링크 확인"
if ! railway status >/dev/null 2>&1; then
  echo "프로젝트가 링크되지 않았습니다. 먼저 실행하세요:  railway link"
  exit 1
fi
railway status | head -5

step "엔진 서비스 생성 ($SERVICE)"
if railway service "$SERVICE" >/dev/null 2>&1; then
  echo "이미 존재 — 생성 건너뜀"
else
  railway add --service "$SERVICE" --repo "$REPO" \
    --variables "PORT=$PORT_VAL" \
    --variables "RAILWAY_DOCKERFILE_PATH=packages/dispatch-engine/Dockerfile"
fi

step "변수 확인/보정"
railway variables --service "$SERVICE" --skip-deploys \
  --set "PORT=$PORT_VAL" \
  --set "RAILWAY_DOCKERFILE_PATH=packages/dispatch-engine/Dockerfile"

step "볼륨 생성 (/data — 정책·초안 영속화)"
# volume 명령은 링크된 서비스에 붙는다 → 먼저 엔진 서비스를 링크
railway service link "$SERVICE" >/dev/null 2>&1 || railway service "$SERVICE" >/dev/null 2>&1 || true
if railway volume list 2>/dev/null | grep -q "/data"; then
  echo "이미 존재 — 건너뜀"
else
  railway volume add --mount-path /data \
    || echo "볼륨 생성 실패 — 대시보드에서 /data 마운트를 추가하세요 (없어도 동작하나 재배포 시 정책 유실)"
fi

step "배포"
railway up --service "$SERVICE" --ci --detach || railway redeploy --service "$SERVICE" --yes

step "백엔드에 ENGINE_URL 주입"
if [ -z "$BACKEND_SERVICE" ]; then
  echo "BACKEND_SERVICE_NAME 미지정 — 아래 명령을 백엔드 서비스명으로 직접 실행하세요:"
  echo "  railway variables --service <백엔드서비스명> --set \"ENGINE_URL=http://$SERVICE.railway.internal:$PORT_VAL\""
else
  railway variables --service "$BACKEND_SERVICE" \
    --set "ENGINE_URL=http://$SERVICE.railway.internal:$PORT_VAL"
fi

step "완료"
cat <<MSG
엔진 서비스: $SERVICE (공개 도메인 없음 — 의도된 것)
확인:
  railway logs --service $SERVICE
  # 백엔드 재배포 후 관리자 화면 /dashboard/engine 접속 시 배너가 사라지면 성공
MSG
