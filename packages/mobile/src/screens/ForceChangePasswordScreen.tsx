import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import { toast } from '../components/ToastHost';
import { colors, radius, spacing, typography, weight, shadow } from '../theme';

export default function ForceChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const { updateUser, logout } = useAuthStore();
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!newPw || !confirmPw) {
      toast.error('새 비밀번호를 입력해주세요.');
      return;
    }
    if (newPw.length < 6) {
      toast.error('새 비밀번호는 6자리 이상이어야 합니다.');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    setLoading(true);
    try {
      await api.put('/auth/password', { newPassword: newPw });
      await updateUser({ mustChangePassword: false });
      toast.success('비밀번호가 변경되었습니다. 이제 앱을 이용하실 수 있습니다.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        || '비밀번호 변경에 실패했습니다.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing['2xl'] }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iconCircle}>
          <Ionicons name="lock-closed" size={30} color={colors.primary} />
        </View>

        <Text style={styles.title}>비밀번호를 변경해주세요</Text>
        <Text style={styles.subtitle}>
          보안을 위해 최초 로그인 시 비밀번호를 반드시 변경해야 합니다.
        </Text>

        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>새 비밀번호</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.inputField}
                value={newPw}
                onChangeText={setNewPw}
                placeholder="6자리 이상"
                secureTextEntry={!showNew}
                autoCapitalize="none"
                placeholderTextColor={colors.textSubtle}
                accessibilityLabel="새 비밀번호"
              />
              <TouchableOpacity
                onPress={() => setShowNew(v => !v)}
                style={styles.eyeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={showNew ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>새 비밀번호 확인</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.inputField}
                value={confirmPw}
                onChangeText={setConfirmPw}
                placeholder="새 비밀번호 재입력"
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
                placeholderTextColor={colors.textSubtle}
                accessibilityLabel="새 비밀번호 확인"
              />
              <TouchableOpacity
                onPress={() => setShowConfirm(v => !v)}
                style={styles.eyeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={showConfirm ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.btnPrimary, loading && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="비밀번호 변경"
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.btnPrimaryText}>변경하고 시작하기</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={logout}
          accessibilityRole="button"
          accessibilityLabel="로그아웃"
        >
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: spacing['2xl'] },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryGhost,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography['2xl'],
    fontWeight: weight.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: typography.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing['2xl'],
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius['2xl'],
    padding: spacing['2xl'],
    ...shadow.lg,
  },
  inputGroup: { marginBottom: spacing.lg },
  label: {
    fontSize: typography.base,
    fontWeight: weight.semibold,
    color: colors.textBody,
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  inputField: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 11,
    fontSize: typography.md,
    color: colors.text,
  },
  eyeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  btnPrimaryText: {
    color: colors.white,
    fontSize: typography.lg,
    fontWeight: weight.bold,
    letterSpacing: 0.2,
  },
  btnDisabled: { opacity: 0.55 },
  logoutBtn: {
    marginTop: spacing.xl,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  logoutText: {
    color: colors.textMuted,
    fontSize: typography.md,
    fontWeight: weight.semibold,
  },
});
