#!/bin/bash

echo "🚌 Busync 배차 시스템 초기 설정"
echo "=================================="

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker가 설치되어 있지 않습니다. https://docs.docker.com/get-docker/ 에서 설치하세요."
  exit 1
fi

# Copy .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ .env 파일이 생성되었습니다."
  echo "⚠️  .env 파일에서 ANTHROPIC_API_KEY와 JWT_SECRET을 반드시 설정하세요!"
fi

# Install backend dependencies
echo ""
echo "📦 백엔드 패키지 설치 중..."
cd packages/backend
npm install
cd ../..

# Install admin-web dependencies
echo "📦 어드민 웹 패키지 설치 중..."
cd packages/admin-web
npm install
cd ../..

# Install mobile dependencies
echo "📦 모바일 앱 패키지 설치 중..."
cd packages/mobile
npm install
cd ../..

echo ""
echo "✅ 패키지 설치 완료!"
echo ""
echo "📋 다음 단계:"
echo "  1. .env 파일에서 ANTHROPIC_API_KEY 설정"
echo "  2. docker-compose up -d postgres  (PostgreSQL 실행)"
echo "  3. cd packages/backend && cp .env.example .env  (백엔드 환경변수)"
echo "  4. cd packages/backend && npm run db:migrate  (DB 마이그레이션)"
echo "  5. cd packages/backend && npm run db:seed  (초기 데이터 입력)"
echo "  6. cd packages/backend && npm run dev  (백엔드 실행)"
echo "  7. cd packages/admin-web && npm run dev  (어드민 웹 실행)"
echo "  8. cd packages/mobile && npm run dev  (모바일 앱 실행)"
echo ""
echo "🌐 어드민 웹: http://localhost:3000"
echo "🔧 API 서버: http://localhost:4000"
echo "📱 모바일: Expo Go 앱으로 QR코드 스캔"
echo ""
echo "👤 초기 관리자 계정:"
echo "   이메일: admin@busync.kr"
echo "   비밀번호: admin123!"
