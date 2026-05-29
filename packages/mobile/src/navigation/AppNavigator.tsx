import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import DayOffScreen from '../screens/DayOffScreen';
import EmergencyScreen from '../screens/EmergencyScreen';
import ForceChangePasswordScreen from '../screens/ForceChangePasswordScreen';
import OfflineBanner from '../components/OfflineBanner';

import { useAuthStore } from '../store/authStore';
import { addNotificationHapticListener } from '../services/notificationService';
import { colors, typography, weight } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, { focused: string; default: string }> = {
  '홈':         { focused: 'home',             default: 'home-outline' },
  '배차표':      { focused: 'calendar',         default: 'calendar-outline' },
  '긴급/대타':   { focused: 'alert-circle',     default: 'alert-circle-outline' },
  '휴무신청':    { focused: 'document-text',    default: 'document-text-outline' },
  '내정보':      { focused: 'person',           default: 'person-outline' },
};

const stackHeaderOptions = {
  headerShown: true,
  headerStyle: {
    backgroundColor: colors.white,
  },
  headerTintColor: colors.text,
  headerTitleStyle: {
    fontSize: typography.lg,
    fontWeight: weight.bold,
    letterSpacing: -0.2,
    color: colors.text,
  },
  headerShadowVisible: false,
  headerBackTitle: '홈',
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => {
          const icons = TAB_ICONS[route.name];
          const iconName = focused ? icons?.focused : icons?.default;
          return (
            <Ionicons
              name={(iconName || 'ellipse-outline') as any}
              size={28}
              color={color}
            />
          );
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'ios' ? 28 : 14,
          paddingTop: 10,
          height: Platform.OS === 'ios' ? 100 : 80,
        },
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: weight.bold,
          marginTop: 4,
          letterSpacing: -0.1,
        },
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: weight.bold,
          fontSize: typography.lg,
          color: colors.text,
          letterSpacing: -0.2,
        },
        headerShadowVisible: false,
      })}
    >
      <Tab.Screen
        name="홈"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="배차표"
        component={ScheduleScreen}
        options={{ title: '내 배차' }}
      />
      <Tab.Screen
        name="긴급/대타"
        component={EmergencyScreen}
        options={{ title: '긴급 / 대타' }}
      />
      <Tab.Screen
        name="휴무신청"
        component={DayOffScreen}
        options={{ title: '휴무 신청' }}
      />
      <Tab.Screen
        name="내정보"
        component={ProfileScreen}
        options={{ title: '내 정보' }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { token, user } = useAuthStore();

  useEffect(() => {
    const subscription = addNotificationHapticListener();
    return () => subscription.remove();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <OfflineBanner />
      <View style={{ flex: 1 }}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!token ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : user?.mustChangePassword ? (
            // 최초 로그인 — 비밀번호 변경 완료 전까지 다른 화면 진입 불가
            <Stack.Screen name="ForceChangePassword" component={ForceChangePasswordScreen} />
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} options={{ title: '홈' }} />
              <Stack.Screen
                name="Notifications"
                component={NotificationsScreen}
                options={{
                  ...stackHeaderOptions,
                  title: '알림',
                }}
              />
              <Stack.Screen
                name="NotificationSettings"
                component={NotificationSettingsScreen}
                options={{
                  ...stackHeaderOptions,
                  title: '알림 설정',
                }}
              />
            </>
          )}
        </Stack.Navigator>
      </View>
    </View>
  );
}
