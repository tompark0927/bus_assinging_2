/**
 * API base URL helper, decoupled from api.ts so that authStore can import this
 * without dragging in the axios instance (which itself imports authStore → cycle).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

function getDevApiUrl(): string {
  const debuggerHost =
    Constants.expoConfig?.hostUri ?? Constants.manifest2?.extra?.expoGo?.debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0];
    return `http://${host}:4000/api/v1`;
  }
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:4000/api/v1'
    : 'http://localhost:4000/api/v1';
}

const PRODUCTION_API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string) || 'https://api.busync.kr/api/v1';

export const API_BASE_URL = __DEV__ ? getDevApiUrl() : PRODUCTION_API_URL;
