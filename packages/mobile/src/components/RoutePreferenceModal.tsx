import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { routesApi, driverPreferencesApi } from '../services/api';

interface Route {
  id: number;
  routeNumber: string;
  name: string;
  fatigueScore: number;
}

interface Preference {
  routeId: number;
  priority: number;
}

interface RoutePreferenceModalProps {
  visible: boolean;
  onClose: () => void;
}

const BADGE_COLORS: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: '#F59E0B', text: '#78350F', label: '1순위' },
  2: { bg: '#9CA3AF', text: '#1F2937', label: '2순위' },
  3: { bg: '#CD7F32', text: '#FFFFFF', label: '3순위' },
};

function renderStars(score: number): string {
  const filled = Math.min(Math.max(Math.round(score), 0), 5);
  return '\u2605'.repeat(filled) + '\u2606'.repeat(5 - filled);
}

export default function RoutePreferenceModal({
  visible,
  onClose,
}: RoutePreferenceModalProps) {
  const queryClient = useQueryClient();

  // selectedRoutes: ordered array of routeIds (index 0 = 1순위, etc.)
  const [selectedRoutes, setSelectedRoutes] = useState<number[]>([]);

  const {
    data: routesData,
    isLoading: routesLoading,
  } = useQuery({
    queryKey: ['routes'],
    queryFn: () => routesApi.list(),
    enabled: visible,
  });

  const {
    data: prefsData,
    isLoading: prefsLoading,
  } = useQuery({
    queryKey: ['driverPreferences'],
    queryFn: () => driverPreferencesApi.list(),
    enabled: visible,
  });

  const routes: Route[] = routesData?.data?.data ?? [];
  const existingPrefs: Preference[] = prefsData?.data?.data ?? [];

  // Pre-select existing preferences when data loads
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
      Alert.alert('저장 완료', '선호 노선이 저장되었습니다.');
      onClose();
    },
    onError: () => {
      Alert.alert('오류', '저장에 실패했습니다. 다시 시도해주세요.');
    },
  });

  const handleToggleRoute = useCallback((routeId: number) => {
    setSelectedRoutes((prev) => {
      const idx = prev.indexOf(routeId);
      if (idx !== -1) {
        // Deselect
        return prev.filter((id) => id !== routeId);
      }
      if (prev.length >= 3) {
        // Already 3 selected
        return prev;
      }
      return [...prev, routeId];
    });
  }, []);

  const handleSave = useCallback(() => {
    if (selectedRoutes.length === 0) {
      Alert.alert('알림', '최소 1개 이상의 노선을 선택해주세요.');
      return;
    }
    const preferences = selectedRoutes.map((routeId, idx) => ({
      routeId,
      priority: idx + 1,
    }));
    saveMutation.mutate(preferences);
  }, [selectedRoutes, saveMutation]);

  const isLoading = routesLoading || prefsLoading;

  const renderItem = useCallback(
    ({ item }: { item: Route }) => {
      const selectionIndex = selectedRoutes.indexOf(item.id);
      const isSelected = selectionIndex !== -1;
      const badge = isSelected ? BADGE_COLORS[selectionIndex + 1] : null;

      return (
        <Pressable
          style={[
            styles.routeItem,
            isSelected && styles.routeItemSelected,
          ]}
          onPress={() => handleToggleRoute(item.id)}
          android_ripple={{ color: '#E5E7EB' }}
        >
          <View style={styles.routeInfo}>
            <Text style={styles.routeNumber}>{item.routeNumber}</Text>
            <Text style={styles.routeName}>{item.name}</Text>
            <Text style={styles.fatigueStars}>
              피로도 {renderStars(item.fatigueScore)}
            </Text>
          </View>
          {badge && (
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeText, { color: badge.text }]}>
                {badge.label}
              </Text>
            </View>
          )}
        </Pressable>
      );
    },
    [selectedRoutes, handleToggleRoute],
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
          <Text style={styles.title}>선호 노선 선택</Text>
          <Text style={styles.subtitle}>
            가장 좋아하는 노선 3개를 순서대로 선택해주세요
          </Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>닫기</Text>
          </Pressable>
        </View>

        {/* Route List */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loadingText}>노선 불러오는 중...</Text>
          </View>
        ) : (
          <FlatList
            data={routes}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}

        {/* Save Button */}
        <View style={styles.footer}>
          <Text style={styles.selectionCount}>
            {selectedRoutes.length}/3 선택됨
          </Text>
          <Pressable
            style={[
              styles.saveButton,
              saveMutation.isPending && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>저장</Text>
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
    backgroundColor: '#F9FAFB',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#6B7280',
    lineHeight: 26,
  },
  closeButton: {
    position: 'absolute',
    top: 24,
    right: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  closeButtonText: {
    fontSize: 18,
    color: '#6B7280',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 18,
    color: '#6B7280',
  },
  listContent: {
    padding: 16,
  },
  separator: {
    height: 10,
  },
  routeItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  routeItemSelected: {
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
  },
  routeInfo: {
    flex: 1,
    marginRight: 12,
  },
  routeNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  routeName: {
    fontSize: 18,
    color: '#374151',
    marginBottom: 4,
  },
  fatigueStars: {
    fontSize: 16,
    color: '#F59E0B',
  },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 64,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 10,
  },
  selectionCount: {
    fontSize: 18,
    color: '#6B7280',
    textAlign: 'center',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#3B82F6',
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
});
