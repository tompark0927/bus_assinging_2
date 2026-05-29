import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastPayload {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
}

type Listener = (payload: ToastPayload) => void;
const listeners = new Set<Listener>();
let counter = 1;

/** Public API — call from anywhere */
export function showToast(
  message: string,
  variant: ToastVariant = 'info',
  duration = 2400,
): void {
  const payload: ToastPayload = { id: counter++, message, variant, duration };
  listeners.forEach((l) => l(payload));
}

export const toast = {
  success: (msg: string, duration?: number) => showToast(msg, 'success', duration),
  error: (msg: string, duration?: number) => showToast(msg, 'error', duration),
  info: (msg: string, duration?: number) => showToast(msg, 'info', duration),
  warning: (msg: string, duration?: number) => showToast(msg, 'warning', duration),
};

const VARIANT_META: Record<ToastVariant, { bg: string; border: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string }> = {
  success: { bg: colors.successSoft, border: '#a7f3d0', icon: 'checkmark-circle', iconColor: colors.successDeep },
  error:   { bg: colors.dangerSoft,  border: '#fca5a5', icon: 'alert-circle',     iconColor: colors.dangerDeep  },
  info:    { bg: colors.primaryGhost, border: '#bfdbfe', icon: 'information-circle', iconColor: colors.primary },
  warning: { bg: colors.warningSoft, border: '#fde68a', icon: 'warning',          iconColor: colors.warningDeep },
};

/**
 * Mount once at the app root (above NavigationContainer).
 * Renders queued toasts at the top of the screen, below the status bar.
 */
export default function ToastHost() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ToastPayload | null>(null);
  const queueRef = useRef<ToastPayload[]>([]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // subscribe to toast events
  useEffect(() => {
    const onPayload: Listener = (p) => {
      queueRef.current.push(p);
      pump();
    };
    listeners.add(onPayload);
    return () => {
      listeners.delete(onPayload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pump() {
    if (current) return; // already showing
    const next = queueRef.current.shift();
    if (!next) return;
    setCurrent(next);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();

    dismissTimer.current = setTimeout(() => dismiss(), next.duration);
  }

  function dismiss() {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -12, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setCurrent(null);
      // peek next on next tick so re-render commits cleanly
      setTimeout(pump, 50);
    });
  }

  if (!current) return null;
  const meta = VARIANT_META[current.variant];

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + 8 }]}
    >
      <Animated.View
        style={[
          styles.toast,
          { backgroundColor: meta.bg, borderColor: meta.border, opacity, transform: [{ translateY }] },
        ]}
      >
        <Pressable
          onPress={dismiss}
          accessibilityRole="alert"
          accessibilityLabel={current.message}
          style={styles.row}
          hitSlop={6}
        >
          <Ionicons name={meta.icon} size={18} color={meta.iconColor} />
          <Text style={[styles.text, { color: meta.iconColor }]} numberOfLines={3}>
            {current.message}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    maxWidth: 480,
    width: '100%',
    ...shadow.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  text: {
    flex: 1,
    fontSize: typography.base,
    fontWeight: weight.semibold,
    lineHeight: 20,
  },
});
