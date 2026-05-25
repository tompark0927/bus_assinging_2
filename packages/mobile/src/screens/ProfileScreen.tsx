import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Modal, ActivityIndicator, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import api, { schedulesApi } from '../services/api';
import Skeleton from '../components/Skeleton';
import { toast } from '../components/ToastHost';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const now = new Date();
  const summaryYear = now.getFullYear();
  const summaryMonth = now.getMonth() + 1;
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['my-monthly-summary', summaryYear, summaryMonth],
    queryFn: () =>
      schedulesApi.getMonthlySummary(summaryYear, summaryMonth).then(r => r.data.data),
  });

  const handleLogout = () => {
    Alert.alert(
      t('auth.logout'),
      t('profile.logoutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('auth.logout'),
          style: 'destructive',
          onPress: async () => { await logout(); },
        },
      ],
    );
  };

  const formatPhone = (phone?: string | null) => {
    if (!phone) return '-';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    return phone;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing['3xl'] }}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View pointerEvents="none" style={styles.headerBlob} />
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0)}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{formatPhone(user?.phone)}</Text>
      </View>

      {/* Activity Summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('profile.monthlyActivity')}</Text>
        {summaryLoading ? (
          <View style={styles.statsRow}>
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
            <Skeleton height={64} borderRadius={radius.lg} style={{ flex: 1 }} />
          </View>
        ) : (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{summary?.workDays ?? 0}</Text>
              <Text style={styles.statLabel}>{t('schedule.workDays')}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{summary?.restDays ?? 0}</Text>
              <Text style={styles.statLabel}>{t('schedule.restDays')}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{summary?.acceptedSubstitutes ?? 0}</Text>
              <Text style={styles.statLabel}>{t('profile.acceptedSubstitutes')}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Menu Items */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('profile.settings')}</Text>

        <MenuItem
          icon="lock-closed-outline"
          iconColor={colors.primary}
          iconBg={colors.primaryGhost}
          label={t('profile.changePassword')}
          onPress={() => setShowPasswordModal(true)}
        />

        <MenuItem
          icon="notifications-outline"
          iconColor={colors.warningDeep}
          iconBg={colors.warningSoft}
          label={t('profile.notificationSettings')}
          onPress={() => {
            try {
              navigation.navigate('NotificationSettings');
            } catch {/* ignore */}
          }}
          last
        />
      </View>

      {/* Logout Button */}
      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('auth.logout')}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.dangerDeep} />
        <Text style={styles.logoutText}>{t('auth.logout')}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>{t('profile.version')}</Text>

      <PasswordChangeModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </ScrollView>
  );
}

function MenuItem({ icon, iconColor, iconBg, label, onPress, last }: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.menuLeft}>
        <View style={[styles.menuIconBox, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <Text style={styles.menuText}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
    </TouchableOpacity>
  );
}

function PasswordChangeModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      toast.error(t('common.error'));
      return;
    }
    if (newPw.length < 6) {
      toast.error(t('profile.passwordTooShort'));
      return;
    }
    if (newPw !== confirmPw) {
      toast.error(t('profile.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      await api.put('/auth/password', {
        currentPassword: currentPw,
        newPassword: newPw,
      });
      toast.success(t('profile.passwordChanged'));
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('profile.passwordChangeFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={pwStyles.overlay} onPress={onClose} accessibilityLabel={t('common.close')}>
        <Pressable style={pwStyles.content} onPress={() => { /* swallow */ }}>
          <View style={pwStyles.handle} />
          <View style={pwStyles.header}>
            <Text style={pwStyles.title}>{t('profile.changePassword')}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={pwStyles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={20} color={colors.textBody} />
            </TouchableOpacity>
          </View>

          <View style={pwStyles.body}>
            <Text style={pwStyles.label}>{t('profile.passwordCurrent')}</Text>
            <TextInput
              style={pwStyles.input}
              value={currentPw}
              onChangeText={setCurrentPw}
              secureTextEntry
              placeholder={t('profile.passwordCurrent')}
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t('profile.passwordCurrent')}
            />

            <Text style={pwStyles.label}>{t('profile.passwordNew')}</Text>
            <TextInput
              style={pwStyles.input}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              placeholder={t('profile.passwordNew')}
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t('profile.passwordNew')}
            />

            <Text style={pwStyles.label}>{t('profile.passwordConfirm')}</Text>
            <TextInput
              style={pwStyles.input}
              value={confirmPw}
              onChangeText={setConfirmPw}
              secureTextEntry
              placeholder={t('profile.passwordConfirm')}
              placeholderTextColor={colors.textSubtle}
              accessibilityLabel={t('profile.passwordConfirm')}
            />

            <TouchableOpacity
              style={[pwStyles.submitBtn, loading && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={pwStyles.submitBtnText}>{t('profile.changePassword')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  profileHeader: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
    alignItems: 'center',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
  },
  headerBlob: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.primaryLight,
    opacity: 0.4,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  avatarText: { fontSize: 28, fontWeight: weight.extrabold, color: colors.white },
  name: {
    fontSize: typography['2xl'],
    fontWeight: weight.bold,
    color: colors.white,
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  email: { fontSize: typography.base, color: 'rgba(255,255,255,0.8)' },

  card: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardTitle: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },

  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.bgAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  statNum: { fontSize: typography['3xl'], fontWeight: weight.extrabold, letterSpacing: -0.5, color: colors.primary },
  statLabel: { fontSize: typography.base, color: colors.textMuted, marginTop: 2, fontWeight: weight.semibold },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuIconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: { fontSize: typography.md, fontWeight: weight.semibold, color: colors.text },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  logoutText: { color: colors.dangerDeep, fontSize: typography.md, fontWeight: weight.bold, letterSpacing: 0.2 },

  version: {
    textAlign: 'center',
    color: colors.textSubtle,
    fontSize: typography.sm,
    marginTop: spacing.lg,
    fontWeight: weight.medium,
  },
});

const pwStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius['3xl'],
    borderTopRightRadius: radius['3xl'],
    paddingBottom: spacing['2xl'],
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.text, letterSpacing: -0.3 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  label: {
    fontSize: typography.base,
    fontWeight: weight.semibold,
    color: colors.textBody,
    marginBottom: 6,
    marginTop: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: typography.md,
    color: colors.text,
    backgroundColor: colors.white,
  },
  submitBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnText: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.white, letterSpacing: 0.2 },
});
