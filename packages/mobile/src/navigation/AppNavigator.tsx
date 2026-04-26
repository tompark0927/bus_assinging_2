import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ApprovalsScreen from '../screens/ApprovalsScreen';
import BoardScreen from '../screens/BoardScreen';
import MessagesScreen from '../screens/MessagesScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import DayOffScreen from '../screens/DayOffScreen';
import EmergencyScreen from '../screens/EmergencyScreen';
import OfflineBanner from '../components/OfflineBanner';

import { useAuthStore } from '../store/authStore';
import { addNotificationHapticListener } from '../services/notificationService';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, { focused: string; default: string }> = {
  '\uD648': { focused: 'home', default: 'home-outline' },
  '\uBC30\uCC28\uD45C': { focused: 'calendar', default: 'calendar-outline' },
  '\uCD9C\uD1F4\uADFC': { focused: 'finger-print', default: 'finger-print-outline' },
  '\uC54C\uB9BC': { focused: 'notifications', default: 'notifications-outline' },
  '\uB0B4\uC815\uBCF4': { focused: 'person', default: 'person-outline' },
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
        tabBarActiveTintColor: '#1565C0',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#E5E7EB',
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'ios' ? 24 : 12,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 92 : 76,
        },
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: '700',
          marginTop: 2,
        },
        headerStyle: {
          backgroundColor: '#1565C0',
        },
        headerTintColor: '#ffffff',
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 20,
        },
      })}
    >
      <Tab.Screen
        name={'\uD648'}
        component={HomeScreen}
        options={{ title: '\uD648' }}
      />
      <Tab.Screen
        name={'\uBC30\uCC28\uD45C'}
        component={ScheduleScreen}
        options={{ title: '\uB0B4 \uBC30\uCC28' }}
      />
      <Tab.Screen
        name={'\uCD9C\uD1F4\uADFC'}
        component={AttendanceScreen}
        options={{ title: 'GPS \uCD9C\uD1F4\uADFC' }}
      />
      <Tab.Screen
        name={'\uC54C\uB9BC'}
        component={NotificationsScreen}
        options={{ title: '\uC54C\uB9BC' }}
      />
      <Tab.Screen
        name={'\uB0B4\uC815\uBCF4'}
        component={ProfileScreen}
        options={{ title: '\uB0B4 \uC815\uBCF4' }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { token } = useAuthStore();

  useEffect(() => {
    const subscription = addNotificationHapticListener();
    return () => subscription.remove();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={{ flex: 1 }}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!token ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen
                name="Approvals"
                component={ApprovalsScreen}
                options={{
                  headerShown: true,
                  title: '\uACB0\uC7AC / \uD734\uBB34',
                  headerStyle: { backgroundColor: '#1565C0' },
                  headerTintColor: '#fff',
                  headerTitleStyle: { fontSize: 20, fontWeight: '700' },
                }}
              />
              <Stack.Screen
                name="Board"
                component={BoardScreen}
                options={{
                  headerShown: true,
                  title: '\uAC8C\uC2DC\uD310',
                  headerStyle: { backgroundColor: '#1565C0' },
                  headerTintColor: '#fff',
                  headerTitleStyle: { fontSize: 20, fontWeight: '700' },
                }}
              />
              <Stack.Screen
                name="Messages"
                component={MessagesScreen}
                options={{
                  headerShown: true,
                  title: '\uBA54\uC2DC\uC9C0',
                  headerStyle: { backgroundColor: '#1565C0' },
                  headerTintColor: '#fff',
                  headerTitleStyle: { fontSize: 20, fontWeight: '700' },
                }}
              />
              <Stack.Screen
                name="NotificationSettings"
                component={NotificationSettingsScreen}
                options={{
                  headerShown: true,
                  title: '\uC54C\uB9BC \uC124\uC815',
                  headerStyle: { backgroundColor: '#1565C0' },
                  headerTintColor: '#fff',
                  headerTitleStyle: { fontSize: 20, fontWeight: '700' },
                }}
              />
              <Stack.Screen
                name="DayOff"
                component={DayOffScreen}
                options={{
                  headerShown: true,
                  title: '\uD734\uBB34 \uC2E0\uCCAD',
                  headerStyle: { backgroundColor: '#1565C0' },
                  headerTintColor: '#fff',
                  headerTitleStyle: { fontSize: 20, fontWeight: '700' },
                }}
              />
              <Stack.Screen
                name="Emergency"
                component={EmergencyScreen}
                options={{
                  headerShown: true,
                  title: '\uAE34\uAE09 / \uB300\uD0C0',
                  headerStyle: { backgroundColor: '#DC2626' },
                  headerTintColor: '#fff',
                  headerTitleStyle: { fontSize: 20, fontWeight: '700' },
                }}
              />
            </>
          )}
        </Stack.Navigator>
      </View>
    </View>
  );
}
