import React, { useEffect, useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AppNavigator from './src/navigation/AppNavigator';
import { useAuthStore } from './src/store/authStore';
import { setupNotificationListeners, registerForPushNotifications } from './src/services/notifications';

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
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

  useEffect(() => {
    loadAuth();
  }, []);

  useEffect(() => {
    if (!token) return;

    // Register push notifications
    registerForPushNotifications();

    // Set up notification listeners
    const cleanup = setupNotificationListeners(
      (notification) => {
        console.log('Notification received:', notification.request.content.title);
        // Invalidate relevant queries on notification
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['emergency-open'] });
      },
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        const type = data?.type as string;

        // 알림 탭 시 해당 화면으로 이동
        if (navigationRef.current) {
          switch (type) {
            case 'EMERGENCY_SLOT':
            case 'EMERGENCY_FILLED':
              navigationRef.current.navigate('Emergency');
              break;
            case 'DAY_OFF_APPROVED':
            case 'DAY_OFF_REJECTED':
              navigationRef.current.navigate('DayOff');
              break;
            case 'SCHEDULE_PUBLISHED':
              navigationRef.current.navigate('Main', { screen: '\uBC30\uCC28\uD45C' });
              break;
            case 'APPROVAL_REQUEST':
            case 'APPROVAL_APPROVED':
            case 'APPROVAL_REJECTED':
              navigationRef.current.navigate('Approvals');
              break;
            case 'DM_NEW':
              navigationRef.current.navigate('Messages');
              break;
            default:
              navigationRef.current.navigate('Main', { screen: '\uC54C\uB9BC' });
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
          <NavigationContainer ref={navigationRef}>
            <StatusBar style="light" />
            <AppNavigator />
          </NavigationContainer>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
