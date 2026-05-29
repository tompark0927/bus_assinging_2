import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { routesApi, driverPreferencesApi } from '../services/api';
import { toast } from './ToastHost';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

interface Route {
  id: number;
  routeNumber: string;
  name: string;
  startPoint?: string | null;
  endPoint?: string | null;
}

interface Preference {
  routeId: number;
  priority: number;
}

interface RoutePreferenceModalProps {
  visible: boolean;
  onClose: () => void;
}

const PRIORITY_BADGE_COLORS: Record<number, { bg: string; color: string }> = {
  1: { bg: '#fef3c7', color: '#92400e' },
  2: { bg: '#e0e7ff', color: '#3730a3' },
  3: { bg: '#f3e8ff', color: '#6b21a8' },
};

export default function RoutePreferenceModal({
  visible,
  onClose,
}: RoutePreferenceModalProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [selectedRoutes, setSelectedRoutes] = useState<number[]>([]);

  const priorityLabel = (n: number) => t(`preferences.priority${n}`);

  const { data: routesData, isLoading: routesLoading } = useQuery({
    queryKey: ['routes'],
    queryFn: () => routesApi.list(),
    enabled: visible,
  });

  const { data: prefsData, isLoading: prefsLoading } = useQuery({
    queryKey: ['driverPreferences'],
    queryFn: () => driverPreferencesApi.list(),
    enabled: visible,
  });

  const routes: Route[] = routesData?.data?.data ?? [];
  const existingPrefs: Preference[] = prefsData?.data?.data ?? [];

  useEffect(() => {
    if (existingPrefs.length > 0) {
      const sorted = [...existingPrefs].sort((a, b) => a.priority - b.priority);
      setSelectedRoutes(sorted.map((p) => p.routeId));
    }
  }, [existingPrefs]);

  const saveMutation = useMutation({
    mutationFn: (preferences: { routeId: number; priority: number }[]) =>
      driverPreferencesApi.update(preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driverPreferences'] });
      toast.success(t('preferences.saveDone'));
      onClose();
    },
    onError: () => {
      toast.error(t('preferences.saveFailed'));
    },
  });

  const handleToggleRoute = useCallback((routeId: number) => {
    setSelectedRoutes((prev) => {
      const idx = prev.indexOf(routeId);
      if (idx !== -1) return prev.filter((id) => id !== routeId);
      if (prev.length >= 3) return prev;
      return [...prev, routeId];
    });
  }, []);

  const handleSave = useCallback(() => {
    if (selectedRoutes.length === 0) {
      toast.warning(t('preferences.minOne'));
      return;
    }
    const preferences = selectedRoutes.map((routeId, idx) => ({
      routeId,
      priority: idx + 1,
    }));
    saveMutation.mutate(preferences);
  }, [selectedRoutes, saveMutation, t]);

  const isLoading = routesLoading || prefsLoading;

  const renderItem = useCallback(
    ({ item }: { item: Route }) => {
      const selectionIndex = selectedRoutes.indexOf(item.id);
      const isSelected = selectionIndex !== -1;
      const badge = isSelected ? PRIORITY_BADGE_COLORS[selectionIndex + 1] : null;
      const badgeLabel = isSelected ? priorityLabel(selectionIndex + 1) : null;

      return (
        <Pressable
          style={[styles.routeItem, isSelected && styles.routeItemSelected]}
          onPress={() => handleToggleRoute(item.id)}
          android_ripple={{ color: colors.borderSoft }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={`${item.routeNumber} ${item.name}`}
        >
          <View style={[styles.routeNumberBox, isSelected && styles.routeNumberBoxSelected]}>
            <Text style={[styles.routeNumber, isSelected && styles.routeNumberSelected]}>
              {item.routeNumber}
            </Text>
          </View>
          <View style={styles.routeInfo}>
            <Text style={styles.routeName} numberOfLines={1}>{item.name}</Text>
            {(item.startPoint || item.endPoint) && (
              <Text style={styles.routeMeta} numberOfLines={1}>
                {[item.startPoint, item.endPoint].filter(Boolean).join(' → ')}
              </Text>
            )}
          </View>
          {badge && badgeLabel && (
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeText, { color: badge.color }]}>{badgeLabel}</Text>
            </View>
          )}
        </Pressable>
      );
    },
    [selectedRoutes, handleToggleRoute, priorityLabel],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('preferences.title')}</Text>
            <Text style={styles.subtitle}>{t('preferences.subtitle')}</Text>
          </View>
          <Pressable
            style={styles.closeButton}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={20} color={colors.textBody} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{t('preferences.loading')}</Text>
          </View>
        ) : (
          <FlatList
            data={routes}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}

        <View style={styles.footer}>
          <Text style={styles.selectionCount}>{t('preferences.selectedCount', { n: selectedRoutes.length })}</Text>
          <Pressable
            style={[
              styles.saveButton,
              (saveMutation.isPending || selectedRoutes.length === 0) && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={saveMutation.isPending || selectedRoutes.length === 0}
            accessibilityRole="button"
            accessibilityLabel={t('common.save')}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.saveButtonText}>{t('common.save')}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: typography.xl,
    fontWeight: weight.bold,
    color: colors.text,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: typography.base,
    color: colors.textMuted,
    lineHeight: 20,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: typography.md,
    color: colors.textMuted,
  },
  listContent: {
    padding: spacing.lg,
  },
  routeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.xs,
  },
  routeItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryGhost,
  },
  routeNumberBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeNumberBoxSelected: {
    backgroundColor: colors.primary,
  },
  routeNumber: {
    fontSize: typography.md,
    fontWeight: weight.extrabold,
    color: colors.textBody,
    letterSpacing: -0.3,
  },
  routeNumberSelected: {
    color: colors.white,
  },
  routeInfo: {
    flex: 1,
    gap: 4,
  },
  routeName: {
    fontSize: typography.md,
    color: colors.text,
    fontWeight: weight.semibold,
  },
  routeMeta: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: weight.medium,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  badgeText: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
  },
  footer: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  selectionCount: {
    fontSize: typography.base,
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: weight.semibold,
  },
  saveButton: {
    backgroundColor: colors.primary,
    height: 48,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: typography.lg,
    fontWeight: weight.bold,
    letterSpacing: 0.2,
  },
});
