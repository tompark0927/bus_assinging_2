import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 메인 번들이 너무 커지지 않도록 무거운 라이브러리를 별도 chunk 로 분리.
    // 첫 진입 LCP 개선 + 라이브러리 코드는 거의 안 바뀌므로 캐시 효율 ↑
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', 'axios'],
          'vendor-icons': ['lucide-react'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
    // 청크 크기 경고 임계값. 페이지 청크가 평균적으로 < 70 KB 이므로 여유롭게.
    chunkSizeWarningLimit: 600,
  },
});
