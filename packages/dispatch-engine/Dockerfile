# BuSync 배차 엔진 (FastAPI + OR-Tools CP-SAT)
# Railway: 서비스 Root Directory를 packages/dispatch-engine 으로 지정하면
# 이 Dockerfile로 빌드된다. 정책·초안 영속화가 필요하면 /data에 볼륨을
# 마운트하라 (ENGINE_DATA_DIR 기본값).
FROM python:3.12-slim

WORKDIR /app

# 의존성 레이어 캐시
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY busync_engine/ busync_engine/
COPY service.py cli.py ./

# 정책(data/policies)·초안(data/drafts) 저장 위치 — Railway Volume 마운트 지점
ENV ENGINE_DATA_DIR=/data

EXPOSE 8100

# Railway가 PORT를 주입한다. 로컬 실행 시 8100.
CMD ["sh", "-c", "uvicorn service:app --host 0.0.0.0 --port ${PORT:-8100}"]
