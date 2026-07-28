// 시각 QA 전용 — /api/v1/engine/* 을 로컬 엔진(8100)에 직결 (백엔드 생략)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    proxy: {
      '/api/v1/engine': {
        target: 'http://localhost:8100',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/api\/v1\/engine/, ''),
      },
    },
  },
});
