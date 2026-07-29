#!/usr/bin/env bash
# BuSync 배차 엔진 — Railway 서비스 생성·배포 자동화.
#
# 전제: `railway login` + `railway link`(백엔드가 있는 프로젝트) 완료
#
# 하는 일:
#   1) 엔진 서비스 생성 (GitHub 리포 연결 → push 시 자동 재배포)
#   2) PORT / RAILWAY_DOCKERFILE_PATH 설정 (대시보드 Root Directory 조작 불필요)
#   3) /data 볼륨 생성 (정책·초안 영속화)
#   4) 배포
#   5) 백엔드 서비스에 ENGINE_URL 주입 (private networking)
#
# 공개 도메인은 만들지 않는다 — 엔진은 인증이 없어 프록시 뒤에만 있어야 한다.
#
# 실행 예:
#   BACKEND_SERVICE_NAME=busyncbackend ./packages/dispatch-engine/deploy-railway.sh
#
# 모든 railway 호출은 stdin을 닫아 실행한다 — 대화형 프롬프트가 뜨면
# 무한 대기 대신 즉시 실패하게 해서 원인을 알 수 있게 하기 위함.
set -uo pipefail

SERVICE="${ENGINE_SERVICE_NAME:-dispatch-engine}"
BACKEND_SERVICE="${BACKEND_SERVICE_NAME:-}"
REPO="${ENGINE_REPO:-tompark0927/bus_assinging_2}"
DOCKERFILE_PATH="packages/dispatch-engine/Dockerfile"
PORT_VAL=8100

cd "$(dirname "$0")/../.."   # 리포 루트

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$1"; }
die()  { printf '\n\033[0;31m✗ %s\033[0m\n' "$1"; exit 1; }

# railway를 stdin 없이 실행 (프롬프트 시 즉시 실패)
rw() { railway "$@" </dev/null; }

step "1/6 인증 확인"
rw whoami || die "로그인이 필요합니다:  railway login"

step "2/6 프로젝트 링크 확인"
rw status >/dev/null 2>&1 || die "프로젝트가 링크되지 않았습니다:  railway link"
rw status 2>/dev/null | head -6

step "3/6 엔진 서비스 준비 ($SERVICE)"
if rw variables --service "$SERVICE" >/dev/null 2>&1; then
  ok "서비스가 이미 존재합니다 — 생성 건너뜀"
else
  echo "  GitHub 리포($REPO)를 연결해 서비스를 만듭니다…"
  if rw add --service "$SERVICE" --repo "$REPO" \
       --variables "PORT=$PORT_VAL" \
       --variables "RAILWAY_DOCKERFILE_PATH=$DOCKERFILE_PATH"; then
    ok "서비스 생성 완료"
  else
    warn "GitHub 연결 방식 실패 (Railway 계정에 GitHub 미연동일 수 있음)"
    echo "  → 리포 연결 없이 빈 서비스로 생성 후 로컬 소스를 올립니다"
    rw add --service "$SERVICE" \
      --variables "PORT=$PORT_VAL" \
      --variables "RAILWAY_DOCKERFILE_PATH=$DOCKERFILE_PATH" \
      || die "서비스 생성 실패 — 대시보드에서 빈 서비스를 만든 뒤 이 스크립트를 다시 실행하세요"
  fi
fi

step "4/6 변수 보정 + /data 볼륨"
rw variables --service "$SERVICE" --skip-deploys \
  --set "PORT=$PORT_VAL" \
  --set "RAILWAY_DOCKERFILE_PATH=$DOCKERFILE_PATH" >/dev/null \
  && ok "PORT=$PORT_VAL, RAILWAY_DOCKERFILE_PATH=$DOCKERFILE_PATH"

if rw volume list 2>/dev/null | grep -q "/data"; then
  ok "볼륨 이미 존재"
else
  rw service link "$SERVICE" >/dev/null 2>&1 || true
  if rw volume add --mount-path /data >/dev/null 2>&1; then
    ok "볼륨 생성 (/data)"
  else
    warn "볼륨 생성 실패 — 대시보드에서 $SERVICE 에 /data 볼륨을 추가하세요."
    warn "  (없어도 동작하지만 재배포 시 저장된 정책·초안이 사라집니다)"
  fi
fi

step "5/6 배포"
if rw up --service "$SERVICE" --ci --detach; then
  ok "배포 시작됨"
else
  warn "railway up 실패 — 기존 배포 재실행을 시도합니다"
  rw redeploy --service "$SERVICE" --yes || warn "재배포도 실패. 로그 확인: railway logs --service $SERVICE"
fi

step "6/6 백엔드에 ENGINE_URL 주입"
ENGINE_URL="http://$SERVICE.railway.internal:$PORT_VAL"
if [ -z "$BACKEND_SERVICE" ]; then
  warn "BACKEND_SERVICE_NAME 미지정 — 아래를 백엔드 서비스명으로 직접 실행하세요:"
  echo "    railway variables --service <백엔드서비스명> --set \"ENGINE_URL=$ENGINE_URL\""
else
  if rw variables --service "$BACKEND_SERVICE" --set "ENGINE_URL=$ENGINE_URL" >/dev/null; then
    ok "$BACKEND_SERVICE 에 ENGINE_URL 설정 (자동 재배포됨)"
  else
    warn "백엔드 변수 설정 실패 — 서비스명을 확인하세요 (railway status)"
  fi
fi

step "완료"
cat <<MSG
엔진 서비스: $SERVICE  (공개 도메인 없음 — 의도된 설정)
내부 주소  : $ENGINE_URL

확인 방법:
  railway logs --service $SERVICE        # "Application startup complete" 나오면 정상
  # 백엔드 재배포가 끝나면 관리자 웹에서 하드 리프레시 후
  # /dashboard/engine 접속 → "연결할 수 없습니다" 배너가 사라지면 성공
MSG
