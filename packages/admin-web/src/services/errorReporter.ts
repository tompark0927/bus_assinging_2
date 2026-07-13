import { useAuthStore } from '../store/authStore';

interface ErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  userId: number | null;
  timestamp: string;
}

function getUserId(): number | null {
  try {
    return useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

async function reportError(errorData: Partial<ErrorReport>) {
  try {
    // 상대경로 기본값: 프로덕션에선 Vercel rewrite 가 /api 를 Railway 백엔드로 프록시.
    // (localhost 하드코딩 시 배포 환경에서 에러 리포트가 유실됨)
    const apiBase = import.meta.env.VITE_API_URL || '';
    await fetch(`${apiBase}/api/v1/error-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...errorData,
        userAgent: navigator.userAgent,
        userId: getUserId(),
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Silently fail — error reporting should never break the app
  }
}

export function reportComponentError(error: Error, componentStack?: string) {
  reportError({
    message: error.message,
    stack: error.stack,
    componentStack,
    url: window.location.href,
  });
}

export function initErrorReporter() {
  // Global unhandled error
  window.addEventListener('error', (event) => {
    reportError({
      message: event.message,
      stack: event.error?.stack,
      url: window.location.href,
    });
  });

  // Unhandled promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    reportError({
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack,
      url: window.location.href,
    });
  });
}
