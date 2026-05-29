import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, weight } from '../theme';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  title: string;
  subtitle?: string;
  /** Spacing density: compact for inline use inside cards, full for full screen */
  variant?: 'compact' | 'full';
}

/**
 * Standardised empty state used across screens.
 * Uses an Ionicon inside a soft circle, then title + optional subtitle.
 */
export default function EmptyState({
  icon = 'document-text-outline',
  iconColor = colors.textDisabled,
  iconBg = colors.bgAlt,
  title,
  subtitle,
  variant = 'full',
}: EmptyStateProps) {
  const isFull = variant === 'full';
  return (
    <View
      style={[styles.wrap, isFull ? styles.full : styles.compact]}
      accessibilityRole="text"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: iconBg, width: isFull ? 64 : 48, height: isFull ? 64 : 48, borderRadius: isFull ? 32 : 24 },
        ]}
      >
        <Ionicons name={icon} size={isFull ? 28 : 22} color={iconColor} />
      </View>
      <Text style={[styles.title, !isFull && styles.titleCompact]}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  full: {
    paddingVertical: spacing['3xl'],
  },
  compact: {
    paddingVertical: spacing.xl,
  },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.md,
    color: colors.textBody,
    fontWeight: weight.semibold,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: typography.base,
    color: colors.textSubtle,
    fontWeight: weight.medium,
  },
  subtitle: {
    fontSize: typography.base,
    color: colors.textSubtle,
    textAlign: 'center',
  },
});
