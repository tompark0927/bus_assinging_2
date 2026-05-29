import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import axios from 'axios';

const QUEUE_KEY = 'offline:requestQueue';
const MAX_RETRY = 3;

export interface QueuedRequest {
  id: string;
  method: 'post' | 'put' | 'delete' | 'patch';
  url: string;
  data?: unknown;
  headers?: Record<string, string>;
  timestamp: number;
  retryCount: number;
}

let isProcessing = false;
let unsubscribeNetInfo: (() => void) | null = null;

/** Generate a simple unique ID */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Read the current queue from storage */
async function getQueue(): Promise<QueuedRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save the queue to storage */
async function saveQueue(queue: QueuedRequest[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Add a failed write request to the queue */
export async function enqueueRequest(
  method: QueuedRequest['method'],
  url: string,
  data?: unknown,
  headers?: Record<string, string>,
): Promise<void> {
  const queue = await getQueue();
  const entry: QueuedRequest = {
    id: generateId(),
    method,
    url,
    data,
    headers,
    timestamp: Date.now(),
    retryCount: 0,
  };
  queue.push(entry);
  await saveQueue(queue);
}

/** Process all queued requests in order */
export async function processQueue(): Promise<void> {
  if (isProcessing) return;

  const state = await NetInfo.fetch();
  if (!state.isConnected) return;

  isProcessing = true;

  try {
    const queue = await getQueue();
    if (queue.length === 0) return;

    const remaining: QueuedRequest[] = [];

    for (const req of queue) {
      try {
        // Retrieve current auth token for the retry
        const token = await AsyncStorage.getItem('token');
        const authHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(req.headers || {}),
        };
        if (token) {
          authHeaders.Authorization = `Bearer ${token}`;
        }

        await axios({
          method: req.method,
          url: req.url,
          data: req.data,
          headers: authHeaders,
          timeout: 15000,
        });
        // Success — drop from queue
      } catch {
        req.retryCount += 1;
        if (req.retryCount < MAX_RETRY) {
          remaining.push(req);
        }
        // If max retries exceeded, silently discard
      }
    }

    await saveQueue(remaining);
  } finally {
    isProcessing = false;
  }
}

/** Get the number of pending queued requests */
export async function getQueueSize(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

/** Clear the entire queue */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/** Start listening for connectivity changes and auto-process queue */
export function startQueueListener(): void {
  if (unsubscribeNetInfo) return; // already listening

  unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
    if (state.isConnected) {
      processQueue();
    }
  });
}

/** Stop the connectivity listener */
export function stopQueueListener(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
}
