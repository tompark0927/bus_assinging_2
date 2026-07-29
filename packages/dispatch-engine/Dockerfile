# BuSync 배차 엔진 (FastAPI + OR-Tools CP-SAT)
#
# 빌드 컨텍스트는 **리포지토리 루트**다 (모노레포이므로 Railway가 GitHub 연동
# 시 기본으로 루트를 컨텍스트로 잡는다). 덕분에 대시보드에서 Root Directory를
# 손으로 지정할 필요 없이 env `RAILWAY_DOCKERFILE_PATH`만 지정하면 된다.
#
#   로컬 빌드 (리포 루트에서):
#     docker build -f packages/dispatch-engine/Dockerfile -t busync-engine .
#
# 정책·초안 영속화는 /data 볼륨 (ENGINE_DATA_DIR 기본값).
FROM python:3.12-slim

WORKDIR /app

# 의존성 레이어 캐시 — 소스보다 먼저 복사해야 코드 변경 시 재설치를 피한다
COPY packages/dispatch-engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/dispatch-engine/busync_engine/ busync_engine/
COPY packages/dispatch-engine/service.py packages/dispatch-engine/cli.py ./

# 정책(data/policies)·초안(data/drafts) 저장 위치 — Railway Volume 마운트 지점
ENV ENGINE_DATA_DIR=/data

EXPOSE 8100

# Railway가 PORT를 주입한다. 로컬 실행 시 8100.
CMD ["sh", "-c", "uvicorn service:app --host 0.0.0.0 --port ${PORT:-8100}"]
