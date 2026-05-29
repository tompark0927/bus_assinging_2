import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

/** TTL presets in milliseconds */
export const CacheTTL = {
  SCHEDULE: 60 * 60 * 1000,        // 1 hour
  PROFILE: 4 * 60 * 60 * 1000,     // 4 hours
  NOTIFICATIONS: 30 * 60 * 1000,   // 30 minutes
  DEFAULT: 60 * 60 * 1000,         // 1 hour
} as const;

/** Map endpoint patterns to TTLs */
function getTtlForEndpoint(endpoint: string): number {
  if (endpoint.includes('/schedules')) return CacheTTL.SCHEDULE;
  if (endpoint.includes('/auth/me')) return CacheTTL.PROFILE;
  if (endpoint.includes('/notifications')) return CacheTTL.NOTIFICATIONS;
  if (endpoint.includes('/attendance/today')) return CacheTTL.SCHEDULE;
  return CacheTTL.DEFAULT;
}

function cacheKey(endpoint: string): string {
  return `cache:${endpoint}`;
}

/** Save data to cache */
export async function setCache<T>(endpoint: string, data: T, ttl?: number): Promise<void> {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttl: ttl ?? getTtlForEndpoint(endpoint),
  };
  try {
    await AsyncStorage.setItem(cacheKey(endpoint), JSON.stringify(entry));
  } catch {
    // Storage full or other error — silently ignore
  }
}

/** Read cached data, returning null if expired or missing */
export async function getCache<T>(endpoint: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(endpoint));
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    const age = Date.now() - entry.timestamp;

    if (age > entry.ttl) {
      // Expired — remove it
      await AsyncStorage.removeItem(cacheKey(endpoint));
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

/** Remove a specific cache entry */
export async function removeCache(endpoint: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(endpoint));
  } catch {
    // ignore
  }
}

/** Get cache age in minutes (null if no cache) */
export async function getCacheAge(endpoint: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(endpoint));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    return Math.floor((Date.now() - entry.timestamp) / 60000);
  } catch {
    return null;
  }
}

/** Clear all cache entries (entries starting with 'cache:') */
export async function clearAllCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith('cache:'));
    await Promise.all(cacheKeys.map((k) => AsyncStorage.removeItem(k)));
  } catch {
    // ignore
  }
}
