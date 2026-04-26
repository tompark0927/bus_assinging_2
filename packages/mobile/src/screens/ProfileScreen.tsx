import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const navigation = useNavigation<any>();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      '\uB85C\uADF8\uC544\uC6C3',
      '\uB85C\uADF8\uC544\uC6C3 \uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?',
      [
        { text: '\uCDE8\uC18C', style: 'cancel' },
        {
          text: '\uB85C\uADF8\uC544\uC6C3',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ],
    );
  };

  const driverTypeLabel = () => {
    switch (user?.driverType) {
      case 'MAIN':
        return '\uBA54\uC778 \uAE30\uC0AC';
      case 'SPARE':
        return '\uC2A4\uD398\uC5B4 \uAE30\uC0AC';
      default:
        return '\uAE30\uC0AC';
    }
  };

  return (
    <ScrollView style={styles.container}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0)}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Ionicons name="bus" size={16} color="#065F46" />
            <Text style={styles.badgeText}>{driverTypeLabel()}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#EDE9FE' }]}>
            <Ionicons name="id-card" size={16} color="#5B21B6" />
            <Text style={[styles.badgeText, { color: '#5B21B6' }]}>
              {user?.employeeId}
            </Text>
          </View>
        </View>
      </View>

      {/* Info Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {'\uACC4\uC815 \uC815\uBCF4'}
        </Text>
        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <Ionicons name="person" size={22} color="#6B7280" />
            <Text style={styles.infoLabel}>{'\uC774\uB984'}</Text>
          </View>
          <Text style={styles.infoValue}>{user?.name}</Text>
        </View>
        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <Ionicons name="card" size={22} color="#6B7280" />
            <Text style={styles.infoLabel}>{'\uC0AC\uC6D0\uBC88\uD638'}</Text>
          </View>
          <Text style={styles.infoValue}>{user?.employeeId}</Text>
        </View>
        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <Ionicons name="mail" size={22} color="#6B7280" />
            <Text style={styles.infoLabel}>{'\uC774\uBA54\uC77C'}</Text>
          </View>
          <Text style={styles.infoValue}>{user?.email}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
          <View style={styles.infoLeft}>
            <Ionicons name="bus" size={22} color="#6B7280" />
            <Text style={styles.infoLabel}>{'\uAE30\uC0AC \uC720\uD615'}</Text>
          </View>
          <Text style={styles.infoValue}>{driverTypeLabel()}</Text>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{'\uC124\uC815'}</Text>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => setShowPasswordModal(true)}
        >
          <View style={styles.menuLeft}>
            <Ionicons name="lock-closed" size={24} color="#1565C0" />
            <Text style={styles.menuText}>
              {'\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#D1D5DB" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => {
            try {
              navigation.navigate('NotificationSettings');
            } catch {
              // Screen might not exist, ignore
            }
          }}
        >
          <View style={styles.menuLeft}>
            <Ionicons name="notifications" size={24} color="#D97706" />
            <Text style={styles.menuText}>
              {'\uC54C\uB9BC \uC124\uC815'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#D1D5DB" />
        </TouchableOpacity>
      </View>

      {/* Help Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{'\uC571 \uC548\uB0B4'}</Text>
        <View style={styles.helpItem}>
          <Ionicons name="calendar" size={22} color="#1565C0" />
          <Text style={styles.helpText}>
            {'\uBC30\uCC28\uD45C \uD0ED\uC5D0\uC11C \uC774\uBC88 \uB2EC \uC77C\uC815\uC744 \uD655\uC778\uD558\uC138\uC694'}
          </Text>
        </View>
        <View style={styles.helpItem}>
          <Ionicons name="finger-print" size={22} color="#059669" />
          <Text style={styles.helpText}>
            {'\uCD9C\uD1F4\uADFC \uD0ED\uC5D0\uC11C GPS \uCD9C\uD1F4\uADFC\uC744 \uD558\uC138\uC694'}
          </Text>
        </View>
        <View style={styles.helpItem}>
          <Ionicons name="notifications" size={22} color="#D97706" />
          <Text style={styles.helpText}>
            {'\uC54C\uB9BC\uC744 \uD5C8\uC6A9\uD558\uBA74 \uC2E4\uC2DC\uAC04 \uAE34\uAE09 \uC2AC\uB86F \uC54C\uB9BC\uC744 \uBC1B\uC544\uC694'}
          </Text>
        </View>
        <View style={styles.helpItem}>
          <Ionicons name="call" size={22} color="#DC2626" />
          <Text style={styles.helpText}>
            {'\uBB38\uC758\uC0AC\uD56D\uC740 \uAD00\uB9AC\uC790\uC5D0\uAC8C \uC5F0\uB77D\uD558\uC138\uC694'}
          </Text>
        </View>
      </View>

      {/* Logout Button */}
      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        activeOpacity={0.7}
      >
        <Ionicons name="log-out" size={24} color="#DC2626" />
        <Text style={styles.logoutText}>{'\uB85C\uADF8\uC544\uC6C3'}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>
{'Busync \uAE30\uC0AC\uC571 v1.0.0'}
      </Text>

      {/* Password Change Modal */}
      <PasswordChangeModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </ScrollView>
  );
}

/* ========== Password Change Modal ========== */
function PasswordChangeModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      Alert.alert('\uC624\uB958', '\uBAA8\uB4E0 \uD56D\uBAA9\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694.');
      return;
    }
    if (newPw.length < 6) {
      Alert.alert('\uC624\uB958', '\uC0C8 \uBE44\uBC00\uBC88\uD638\uB294 6\uC790\uB9AC \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.');
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert('\uC624\uB958', '\uC0C8 \uBE44\uBC00\uBC88\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.');
      return;
    }

    setLoading(true);
    try {
      await api.put('/auth/password', {
        currentPassword: currentPw,
        newPassword: newPw,
      });
      Alert.alert('\uC644\uB8CC', '\uBE44\uBC00\uBC88\uD638\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      onClose();
    } catch (err: any) {
      Alert.alert(
        '\uC624\uB958',
        err.response?.data?.message || '\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={pwStyles.overlay}>
        <View style={pwStyles.content}>
          <View style={pwStyles.header}>
            <Text style={pwStyles.title}>
              {'\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD'}
            </Text>
            <TouchableOpacity onPress={onClose} style={pwStyles.closeBtn}>
              <Ionicons name="close" size={28} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <View style={pwStyles.body}>
            <Text style={pwStyles.label}>
              {'\uD604\uC7AC \uBE44\uBC00\uBC88\uD638'}
            </Text>
            <TextInput
              style={pwStyles.input}
              value={currentPw}
              onChangeText={setCurrentPw}
              secureTextEntry
              placeholder={'\uD604\uC7AC \uBE44\uBC00\uBC88\uD638 \uC785\uB825'}
              placeholderTextColor="#9CA3AF"
            />

            <Text style={pwStyles.label}>
              {'\uC0C8 \uBE44\uBC00\uBC88\uD638'}
            </Text>
            <TextInput
              style={pwStyles.input}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              placeholder={'\uC0C8 \uBE44\uBC00\uBC88\uD638 \uC785\uB825 (6\uC790\uB9AC \uC774\uC0C1)'}
              placeholderTextColor="#9CA3AF"
            />

            <Text style={pwStyles.label}>
              {'\uC0C8 \uBE44\uBC00\uBC88\uD638 \uD655\uC778'}
            </Text>
            <TextInput
              style={pwStyles.input}
              value={confirmPw}
              onChangeText={setConfirmPw}
              secureTextEntry
              placeholder={'\uC0C8 \uBE44\uBC00\uBC88\uD638 \uB2E4\uC2DC \uC785\uB825'}
              placeholderTextColor="#9CA3AF"
            />

            <TouchableOpacity
              style={[
                pwStyles.submitBtn,
                loading && { opacity: 0.6 },
              ]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={pwStyles.submitBtnText}>
                  {'\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },

  // Profile header
  profileHeader: {
    backgroundColor: '#1565C0',
    padding: 28,
    alignItems: 'center',
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: { fontSize: 38, fontWeight: '800', color: '#fff' },
  name: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 4 },
  email: { fontSize: 18, color: 'rgba(255,255,255,0.8)', marginBottom: 14 },
  badgeRow: { flexDirection: 'row', gap: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: { fontSize: 16, fontWeight: '700', color: '#065F46' },

  // Card
  card: {
    backgroundColor: '#fff',
    margin: 16,
    marginBottom: 0,
    borderRadius: 16,
    padding: 20,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 14,
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoLabel: { fontSize: 18, color: '#6B7280', fontWeight: '600' },
  infoValue: { fontSize: 18, fontWeight: '700', color: '#111827' },

  // Menu items
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  menuText: { fontSize: 20, fontWeight: '700', color: '#374151' },

  // Help
  helpItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  helpText: {
    flex: 1,
    fontSize: 18,
    color: '#6B7280',
    lineHeight: 26,
  },

  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    margin: 16,
    backgroundColor: '#FEE2E2',
    borderRadius: 16,
    paddingVertical: 18,
  },
  logoutText: { color: '#DC2626', fontSize: 20, fontWeight: '800' },

  // Version
  version: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 16,
    marginBottom: 40,
  },
});

const pwStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 24 },
  label: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    padding: 16,
    fontSize: 18,
    backgroundColor: '#fff',
  },
  submitBtn: {
    marginTop: 28,
    marginBottom: 32,
    backgroundColor: '#1565C0',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  submitBtnText: { fontSize: 20, fontWeight: '800', color: '#fff' },
});
