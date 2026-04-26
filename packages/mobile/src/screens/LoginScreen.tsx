import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { registerForPushNotifications } from '../services/notifications';

WebBrowser.maybeCompleteAuthSession();

const KAKAO_CLIENT_ID = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY ?? '';

type Tab = 'email' | 'kakao' | 'phone';

export default function LoginScreen() {
  const { setAuth } = useAuthStore();
  const [tab, setTab] = useState<Tab>('email');
  const [loading, setLoading] = useState(false);

  // Email tab
  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Phone tab
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Kakao OAuth
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'busync' });
  const discovery = {
    authorizationEndpoint: 'https://kauth.kakao.com/oauth/authorize',
  };
  const [kakaoRequest, kakaoResponse, promptKakaoAsync] = AuthSession.useAuthRequest(
    {
      clientId: KAKAO_CLIENT_ID,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ['profile_nickname', 'account_email', 'phone_number'],
    },
    discovery
  );

  // Countdown timer for OTP
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Handle Kakao response
  useEffect(() => {
    if (kakaoResponse?.type !== 'success') return;
    const code = kakaoResponse.params.code;
    if (!code) return;

    setLoading(true);
    authApi.kakaoLoginWithCode(code, redirectUri)
      .then(async res => {
        const { token, refreshToken, user } = res.data.data;
        await setAuth(user, token, refreshToken);
        await registerForPushNotifications();
      })
      .catch(err => {
        const msg = err?.response?.data?.message || '카카오 로그인에 실패했습니다.';
        Alert.alert('로그인 실패', msg);
      })
      .finally(() => setLoading(false));
  }, [kakaoResponse]);

  // ── Email login ──────────────────────────────────────────
  const handleEmailLogin = async () => {
    if (!companyCode || !email || !password) {
      Alert.alert('오류', '회사 코드, 이메일, 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.login(companyCode, email, password);
      const { token, refreshToken, user } = res.data.data;
      await setAuth(user, token, refreshToken);
      // 푸시 알림 등록은 실패해도 로그인에 영향 없음
      registerForPushNotifications().catch(() => {});
    } catch (err: unknown) {
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const errMsg = err instanceof Error ? err.message : String(err);
      Alert.alert('로그인 실패', axiosMsg || errMsg || '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  };

  // ── Send OTP ─────────────────────────────────────────────
  const handleSendOtp = async () => {
    const digits = phone.replace(/-/g, '');
    if (!/^010\d{8}$/.test(digits)) {
      Alert.alert('오류', '올바른 휴대폰 번호를 입력해주세요. (예: 010-1234-5678)');
      return;
    }
    setLoading(true);
    try {
      await authApi.sendPhoneOtp(phone);
      setOtpSent(true);
      setCountdown(60);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '인증번호 전송에 실패했습니다.';
      Alert.alert('오류', msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP ───────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      Alert.alert('오류', '6자리 인증번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.verifyPhoneOtp(phone, otp);
      const { token, refreshToken, user } = res.data.data;
      await setAuth(user, token, refreshToken);
      await registerForPushNotifications();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '인증에 실패했습니다.';
      Alert.alert('인증 실패', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🚌</Text>
          </View>
          <Text style={styles.title}>Busync</Text>
          <Text style={styles.subtitle}>{'\uBC84\uC2A4 \uAE30\uC0AC \uC571'}</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          {/* Tabs */}
          <View style={styles.tabBar}>
            {(['email', 'kakao', 'phone'] as Tab[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'email' ? '이메일' : t === 'kakao' ? '카카오' : '전화번호'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Email Tab ── */}
          {tab === 'email' && (
            <View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>회사 코드</Text>
                <TextInput
                  style={styles.input}
                  value={companyCode}
                  onChangeText={setCompanyCode}
                  placeholder="회사 코드를 입력하세요"
                  autoCapitalize="none"
                  placeholderTextColor="#9CA3AF"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>이메일</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="이메일을 입력하세요"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#9CA3AF"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>비밀번호</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="비밀번호를 입력하세요"
                  secureTextEntry
                  placeholderTextColor="#9CA3AF"
                />
              </View>
              <TouchableOpacity
                style={[styles.btnPrimary, loading && styles.btnDisabled]}
                onPress={handleEmailLogin}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>로그인</Text>}
              </TouchableOpacity>
              <Text style={styles.hint}>초기 비밀번호는 사원번호입니다.{'\n'}문의: 관리자에게 연락하세요.</Text>
            </View>
          )}

          {/* ── Kakao Tab ── */}
          {tab === 'kakao' && (
            <View style={styles.kakaoSection}>
              <Text style={styles.kakaoDesc}>카카오 계정으로 간편하게 로그인하세요.</Text>
              <TouchableOpacity
                style={[styles.btnKakao, (loading || !kakaoRequest) && styles.btnDisabled]}
                onPress={() => promptKakaoAsync()}
                disabled={loading || !kakaoRequest}
              >
                {loading ? (
                  <ActivityIndicator color="#3C1E1E" />
                ) : (
                  <>
                    <Text style={styles.btnKakaoIcon}>💬</Text>
                    <Text style={styles.btnKakaoText}>카카오로 로그인</Text>
                  </>
                )}
              </TouchableOpacity>
              {!KAKAO_CLIENT_ID && (
                <Text style={styles.kakaoWarning}>
                  EXPO_PUBLIC_KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.
                </Text>
              )}
            </View>
          )}

          {/* ── Phone Tab ── */}
          {tab === 'phone' && (
            <View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>휴대폰 번호</Text>
                <View style={styles.phoneRow}>
                  <TextInput
                    style={[styles.input, styles.phoneInput]}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="010-0000-0000"
                    keyboardType="phone-pad"
                    placeholderTextColor="#9CA3AF"
                    editable={!otpSent}
                  />
                  <TouchableOpacity
                    style={[styles.btnSendOtp, (loading || countdown > 0) && styles.btnDisabled]}
                    onPress={handleSendOtp}
                    disabled={loading || countdown > 0}
                  >
                    {loading && !otpSent ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.btnSendOtpText}>
                        {countdown > 0 ? `${countdown}초` : otpSent ? '재전송' : '인증번호'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {otpSent && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>인증번호</Text>
                  <TextInput
                    style={styles.input}
                    value={otp}
                    onChangeText={setOtp}
                    placeholder="6자리 인증번호"
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              )}

              {otpSent && (
                <TouchableOpacity
                  style={[styles.btnPrimary, loading && styles.btnDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>확인</Text>}
                </TouchableOpacity>
              )}

              {!otpSent && (
                <Text style={styles.hint}>가입된 휴대폰 번호로 인증번호가 전송됩니다.</Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1565C0' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  logoEmoji: { fontSize: 40 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4 },

  card: {
    backgroundColor: '#fff', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 16, elevation: 8,
  },

  tabBar: {
    flexDirection: 'row', backgroundColor: '#F3F4F6',
    borderRadius: 12, padding: 4, marginBottom: 24,
  },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  tabTextActive: { color: '#1565C0' },

  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827',
  },

  phoneRow: { flexDirection: 'row', gap: 8 },
  phoneInput: { flex: 1 },

  btnPrimary: {
    backgroundColor: '#1565C0', borderRadius: 12, padding: 16,
    alignItems: 'center', marginTop: 4,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },

  btnSendOtp: {
    backgroundColor: '#1565C0', borderRadius: 12,
    paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', minWidth: 72,
  },
  btnSendOtpText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  kakaoSection: { alignItems: 'center', paddingVertical: 8 },
  kakaoDesc: { color: '#6B7280', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  btnKakao: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FEE500', borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 24, width: '100%', gap: 8,
  },
  btnKakaoIcon: { fontSize: 18 },
  btnKakaoText: { fontSize: 16, fontWeight: '700', color: '#3C1E1E' },
  kakaoWarning: { marginTop: 12, fontSize: 11, color: '#EF4444', textAlign: 'center' },

  hint: { marginTop: 16, textAlign: 'center', color: '#9CA3AF', fontSize: 13, lineHeight: 20 },
});
