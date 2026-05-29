/**
 * AsyncStorage 호환 래퍼 (expo-secure-store 기반)
 * @react-native-async-storage/async-storage 네이티브 모듈 문제 우회
 */
import * as SecureStore from 'expo-secure-store';

// SecureStore는 키당 2048바이트 제한이 있으므로
// 큰 데이터는 청크로 나눠 저장
const CHUNK_SIZE = 2000;

function chunkKey(key: string, i: number) {
  return `${key}__chunk_${i}`;
}

const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value === '__chunked__') {
        // 청크된 데이터 재조립
        let result = '';
        let i = 0;
        while (true) {
          const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
          if (chunk === null) break;
          result += chunk;
          i++;
        }
        return result || null;
      }
      return value;
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
      } else {
        // 청크로 나눠 저장
        await SecureStore.setItemAsync(key, '__chunked__');
        for (let i = 0; i * CHUNK_SIZE < value.length; i++) {
          const chunk = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          await SecureStore.setItemAsync(chunkKey(key, i), chunk);
        }
      }
    } catch {
      // 저장 실패 무시
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value === '__chunked__') {
        let i = 0;
        while (true) {
          const ck = chunkKey(key, i);
          const chunk = await SecureStore.getItemAsync(ck);
          if (chunk === null) break;
          await SecureStore.deleteItemAsync(ck);
          i++;
        }
      }
      await SecureStore.deleteItemAsync(key);
    } catch {
      // 삭제 실패 무시
    }
  },

  async getAllKeys(): Promise<string[]> {
    // SecureStore doesn't support getAllKeys — return empty
    return [];
  },
};

export default storage;
