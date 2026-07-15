import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { toast } from '../components/ToastHost';

// 모던 라이트 + 액센트 팔레트 (slate / indigo)
const C = {
  bg: '#F8FAFC',          // 아이보리 배경
  inputBg: '#F1F5F9',     // slate-100
  text: '#0F172A',         // slate-900
  textMuted: '#64748B',    // slate-500
  textSubtle: '#94A3B8',   // slate-400
  label: '#475569',        // slate-600
  primary: '#4F46E5',      // indigo-600
  primaryHover: '#4338CA', // indigo-700
  white: '#FFFFFF',
};

export default function LoginScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const [companyCode, setCompanyCode] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const handleEmailLogin = async () => {
    if (!companyCode || !phone || !password) {
      toast.error(t('auth.loginFailed'));
      return;
    }
    setLoading(true);
    try {
      // 전화번호는 하이픈/공백 유무와 무관하게 인식 (숫자만 전송)
      const phoneNormalized = phone.replace(/\D/g, '');
      const res = await authApi.login(companyCode, phoneNormalized, password);
      const { token, refreshToken, user } = res.data.data;
      // 기사 앱은 기사(DRIVER) 계정만 사용 가능. 관리자 등 비기사 계정은 차단.
      if (user?.role !== 'DRIVER') {
        toast.error(t('auth.driverOnly'));
        return;
      }
      // 키보드를 먼저 내려 화면 전환 애니메이션과 겹치지 않게 한다.
      // (전환 중 네이티브 UI가 겹치면 iPad에서 앱이 멈추는 사례 — App Review 2.1 반려)
      Keyboard.dismiss();
      await setAuth(user, token, refreshToken);
      // 푸시 등록(권한 다이얼로그 포함)은 App.tsx 의 token effect 가 전환 완료 후
      // 단 한 번 수행한다. 여기서 중복 호출하지 않는다.
    } catch (err: unknown) {
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      const errMsg = err instanceof Error ? err.message : String(err);
      toast.error(axiosMsg || errMsg || t('auth.loginFailed'));
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
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Heading */}
        <Text style={styles.title}>로그인</Text>
        <Text style={styles.subtitle}>계속하려면 정보를 입력해주세요</Text>

        <View style={{ height: 36 }} />

        {/* Company code */}
        <Text style={styles.label}>{t('auth.companyCode')}</Text>
        <View style={styles.fieldWrap}>
          <TextInput
            style={styles.input}
            value={companyCode}
            onChangeText={setCompanyCode}
            placeholder={t('auth.companyCodePlaceholder')}
            autoCapitalize="none"
            placeholderTextColor={C.textSubtle}
            accessibilityLabel={t('auth.companyCode')}
          />
        </View>

        {/* Phone */}
        <Text style={styles.label}>{t('auth.phone')}</Text>
        <View style={styles.fieldWrap}>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('auth.phonePlaceholder')}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoCapitalize="none"
            placeholderTextColor={C.textSubtle}
            accessibilityLabel={t('auth.phone')}
          />
        </View>

        {/* Password */}
        <Text style={styles.label}>{t('auth.password')}</Text>
        <View style={styles.fieldWrap}>
          <TextInput
            style={[styles.input, { paddingRight: 44 }]}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry={!showPw}
            textContentType="password"
            autoCapitalize="none"
            placeholderTextColor={C.textSubtle}
            accessibilityLabel={t('auth.password')}
          />
          <TouchableOpacity
            onPress={() => setShowPw(v => !v)}
            style={styles.eyeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={showPw ? '비밀번호 숨기기' : '비밀번호 표시'}
          >
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 24 }} />

        {/* Submit */}
        <TouchableOpacity
          style={[styles.btnPrimary, loading && styles.btnDisabled]}
          onPress={handleEmailLogin}
          disabled={loading}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={t('auth.login')}
        >
          {loading ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={styles.btnPrimaryText}>{t('auth.login')}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footerHint}>회사 코드와 초기 비밀번호는 관리자에게 문의하세요.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },

  title: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 15,
    color: C.textMuted,
    lineHeight: 22,
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    color: C.label,
    marginBottom: 8,
    marginTop: 18,
    letterSpacing: 0.1,
  },
  fieldWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: C.inputBg,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 16 : 13,
    fontSize: 16,
    color: C.text,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  btnPrimary: {
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  btnPrimaryText: {
    color: C.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  btnDisabled: { opacity: 0.55 },

  footerHint: {
    marginTop: 24,
    textAlign: 'center',
    color: C.textSubtle,
    fontSize: 13,
    lineHeight: 18,
  },
});
