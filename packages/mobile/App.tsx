import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef, LinkingOptions } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
          '긴급/대타': 'emergency',
          휴무신청: 'dayoff',
          내정보: 'profile',
        },
      },
      Notifications: 'notifications',
      NotificationSettings: 'settings/notifications',
    },
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5,
    },
  },
});

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

    registerForPushNotifications();

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
            case 'EMERGENCY_SLOT':
            case 'EMERGENCY_FILLED':
              navigationRef.current.navigate('Main', { screen: '긴급/대타' });
              break;
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

    return cleanup;
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
