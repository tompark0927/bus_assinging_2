#!/usr/bin/env bash
# 배차 엔진 로컬 개발 환경 준비 — venv 생성 + 의존성 설치 + 테스트
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
if [ ! -d .venv ]; then
  echo "▸ venv 생성 (.venv)"
  "$PY" -m venv .venv
fi
echo "▸ 의존성 설치"
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements-dev.txt

echo "▸ 테스트"
./.venv/bin/python -m pytest tests/ -q

cat <<'MSG'

준비 완료.
  엔진 서비스 실행:  ./.venv/bin/uvicorn service:app --port 8100
  백테스트:          ./.venv/bin/python cli.py backtest --help
MSG
