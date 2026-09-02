import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef, LinkingOptions } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/lib/queryClient';
import { InteractionManager } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';

import AppNavigator from './src/navigation/AppNavigator';
import { useAuthStore } from './src/store/authStore';
import { setupNotificationListeners, registerForPushNotifications } from './src/services/notifications';
import './src/i18n';
import ToastHost from './src/components/ToastHost';
import BootSplash from './src/components/BootSplash';

const linking: LinkingOptions<any> = {
  prefixes: [
    Linking.createURL('/'),
    'busync://',
    'https://busync.co.kr',
    'https://busync.kr',
  ],
  config: {
    screens: {
      Login: 'login',
      Main: {
        path: 'app',
        screens: {
          홈: 'home',
          배차표: 'schedule',
          // 대타 기능 숨김 — 탭이 없는 동안 이 딥링크로 들어오면 이동할 곳이 없다.
          // 되살릴 때 AppNavigator 의 같은 주석과 함께 푼다.
          // '긴급/대타': 'emergency',
          휴무신청: 'dayoff',
          내정보: 'profile',
        },
      },
      Notifications: 'notifications',
      NotificationSettings: 'settings/notifications',
    },
  },
};

// QueryClient 는 src/lib/queryClient.ts 로 분리 — authStore 가 로그인/로그아웃 시 캐시를 비운다.

export default function App() {
  const { loadAuth, token } = useAuthStore();
  const isLoaded = useAuthStore(s => s.isLoaded);
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

  // 스플래시 최소 노출 시간 (4초). 실제 인증 로드가 더 빠르더라도 4초는 보장.
  const [minDelayElapsed, setMinDelayElapsed] = useState(false);
  const splashReady = isLoaded && minDelayElapsed;

  useEffect(() => {
    loadAuth();
    const t = setTimeout(() => setMinDelayElapsed(true), 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!token) return;

    // 푸시 권한 다이얼로그(네이티브 모달)를 로그인 → 메인 화면 전환이 완전히
    // 끝난 뒤에 띄운다. 전환 애니메이션·키보드 내려감과 동시에 네이티브 모달이
    // 뜨면 iPad(호환 모드)에서 터치가 먹통이 되는 사례가 있었다 (App Review 2.1(a) 반려).
    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        if (!cancelled) registerForPushNotifications().catch(() => {});
      }, 800);
    });

    const cleanup = setupNotificationListeners(
      (notification) => {
        console.log('Notification received:', notification.request.content.title);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
      },
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        const type = data?.type as string;

        if (navigationRef.current) {
          switch (type) {
            // 대타 기능 숨김 — 탭이 없는 동안 대타 푸시를 탭하면 아래 default 로 떨어져
            // 알림 화면으로 간다. 되살릴 때 AppNavigator 의 같은 주석과 함께 푼다.
            // case 'EMERGENCY_SLOT':
            // case 'EMERGENCY_FILLED':
            //   navigationRef.current.navigate('Main', { screen: '긴급/대타' });
            //   break;
            case 'DAY_OFF_APPROVED':
            case 'DAY_OFF_REJECTED':
              navigationRef.current.navigate('Main', { screen: '휴무신청' });
              break;
            case 'SCHEDULE_PUBLISHED':
              navigationRef.current.navigate('Main', { screen: '배차표' });
              break;
            default:
              navigationRef.current.navigate('Notifications');
              break;
          }
        }
      }
    );

    return () => {
      cancelled = true;
      interaction.cancel();
      cleanup();
    };
  }, [token]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <NavigationContainer ref={navigationRef} linking={linking}>
            <StatusBar style="light" />
            {splashReady ? <AppNavigator /> : <BootSplash />}
            <ToastHost />
          </NavigationContainer>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
