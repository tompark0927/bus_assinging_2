import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

interface Props {
  visible: boolean;
  nextMonthLabel: string; // e.g. "6월"
  onConfirm: () => void;
  onClose: () => void;
}

export default function NextMonthDayoffModal({
  visible,
  nextMonthLabel,
  onConfirm,
  onClose,
}: Props) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="calendar-outline" size={28} color={colors.primary} />
          </View>

          <Text style={styles.title}>
            {t('dayoffReminder.title', { month: nextMonthLabel })}
          </Text>
          <Text style={styles.body}>
            {t('dayoffReminder.body', { month: nextMonthLabel })}
          </Text>

          <Pressable
            style={styles.primaryBtn}
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={t('dayoffReminder.confirm', { month: nextMonthLabel })}
          >
            <Text style={styles.primaryBtnText}>
              {t('dayoffReminder.confirm', { month: nextMonthLabel })}
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('dayoffReminder.later')}
          >
            <Text style={styles.secondaryBtnText}>{t('dayoffReminder.later')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: radius['2xl'],
    padding: spacing['2xl'],
    alignItems: 'center',
    ...shadow.lg,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryGhost,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.xl,
    fontWeight: weight.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: typography.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing['2xl'],
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  primaryBtnText: {
    color: colors.white,
    fontSize: typography.lg,
    fontWeight: weight.bold,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    width: '100%',
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: colors.textMuted,
    fontSize: typography.md,
    fontWeight: weight.semibold,
  },
});
