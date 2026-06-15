import { QueryClient } from '@tanstack/react-query';

// 앱 전역 QueryClient. authStore 가 로그인/로그아웃 시 캐시를 비울 수 있도록 모듈로 분리.
// 계정 전환 시 이전 사용자의 데이터(잔여 휴가, 배차표 등)가 staleTime(5분) 동안
// 그대로 보이는 멀티테넌시 캐시 누수를 막는다. (admin-web 의 동일 버그 수정과 같은 패턴)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5,
    },
  },
});
