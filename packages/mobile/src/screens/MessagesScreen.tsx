import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, FlatList, KeyboardAvoidingView, Platform, RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dmApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

interface Conversation {
  partner: { id: number; name: string; role: string; employeeId: string };
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface Message {
  id: number;
  senderId: number;
  content: string;
  createdAt: string;
  sender: { id: number; name: string };
}

interface CompanyUser {
  id: number;
  name: string;
  role: string;
  employeeId: string;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: '\uB300\uD45C',
  ADMIN: '\uAD00\uB9AC\uC790',
  MANAGER: '\uAD00\uB9AC',
  DRIVER: '\uAE30\uC0AC',
};

export default function MessagesScreen() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedPartner, setSelectedPartner] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [messageText, setMessageText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchText, setSearchText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  // Conversations
  const {
    data: conversations = [],
    refetch,
    isRefetching,
    isLoading,
  } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: () => dmApi.conversations().then(r => r.data.data),
    refetchInterval: 60000, // 60초 (배터리 절약, Socket.IO로 실시간 보완)
  });

  // Messages
  const { data: messages = [] } = useQuery({
    queryKey: ['dm-messages', selectedPartner?.id],
    queryFn: () => dmApi.messages(selectedPartner!.id).then(r => r.data.data),
    enabled: !!selectedPartner,
    refetchInterval: 30000, // 30초 (배터리 절약)
  });

  // Users for new chat
  const { data: companyUsers = [] } = useQuery({
    queryKey: ['dm-users'],
    queryFn: () => dmApi.users().then(r => r.data.data),
    enabled: showNewChat,
  });

  const sendMutation = useMutation({
    mutationFn: ({
      receiverId,
      content,
    }: {
      receiverId: number;
      content: string;
    }) => dmApi.send(receiverId, content),
    onSuccess: () => {
      setMessageText('');
      queryClient.invalidateQueries({
        queryKey: ['dm-messages', selectedPartner?.id],
      });
      queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
    },
  });

  const handleSend = () => {
    if (!messageText.trim() || !selectedPartner) return;
    sendMutation.mutate({
      receiverId: selectedPartner.id,
      content: messageText.trim(),
    });
  };

  const filteredUsers = companyUsers.filter(
    (u: CompanyUser) =>
      u.name.includes(searchText) || u.employeeId.includes(searchText),
  );

  // Chat view
  if (selectedPartner) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Chat Header */}
        <View style={styles.chatHeader}>
          <TouchableOpacity
            onPress={() => setSelectedPartner(null)}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={28} color="#1565C0" />
            <Text style={styles.backBtnText}>{'\uB4A4\uB85C'}</Text>
          </TouchableOpacity>
          <View style={styles.chatHeaderAvatar}>
            <Text style={styles.avatarInitial}>
              {selectedPartner.name.charAt(0)}
            </Text>
          </View>
          <Text style={styles.chatHeaderName}>{selectedPartner.name}</Text>
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item: Message) => String(item.id)}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          renderItem={({ item }: { item: Message }) => {
            const isMine = item.senderId === user?.id;
            return (
              <View style={[styles.msgRow, isMine && styles.msgRowMine]}>
                <View
                  style={[
                    styles.msgBubble,
                    isMine ? styles.msgBubbleMine : styles.msgBubbleOther,
                  ]}
                >
                  <Text
                    style={[styles.msgText, isMine && styles.msgTextMine]}
                  >
                    {item.content}
                  </Text>
                </View>
                <Text style={[styles.msgTime, isMine && styles.msgTimeMine]}>
                  {format(new Date(item.createdAt), 'HH:mm')}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons
                name="chatbubble-outline"
                size={64}
                color="#D1D5DB"
              />
              <Text style={styles.emptyChatText}>
                {'\uBA54\uC2DC\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
              </Text>
              <Text style={styles.emptyChatSub}>
                {'\uCCAB \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBCF4\uC138\uC694!'}
              </Text>
            </View>
          }
        />

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={messageText}
            onChangeText={setMessageText}
            placeholder={'\uBA54\uC2DC\uC9C0\uB97C \uC785\uB825\uD558\uC138\uC694...'}
            placeholderTextColor="#9CA3AF"
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              !messageText.trim() && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!messageText.trim() || sendMutation.isPending}
          >
            <Ionicons name="send" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Conversation list view
  return (
    <View style={styles.container}>
      {/* Header with new message button */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.newChatBtn}
          onPress={() => setShowNewChat(true)}
        >
          <Ionicons name="create-outline" size={24} color="#fff" />
          <Text style={styles.newChatBtnText}>
            {'\uC0C8 \uBA54\uC2DC\uC9C0'}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item: Conversation) => String(item.partner.id)}
          contentContainerStyle={styles.convList}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          renderItem={({ item }: { item: Conversation }) => (
            <TouchableOpacity
              style={styles.convCard}
              onPress={() =>
                setSelectedPartner({
                  id: item.partner.id,
                  name: item.partner.name,
                })
              }
              activeOpacity={0.7}
            >
              <View style={styles.convAvatar}>
                <Text style={styles.avatarInitial}>
                  {item.partner.name.charAt(0)}
                </Text>
              </View>
              <View style={styles.convInfo}>
                <View style={styles.convTop}>
                  <Text style={styles.convName}>{item.partner.name}</Text>
                  <Text style={styles.convDate}>
                    {format(new Date(item.lastMessageAt), 'MM.dd', {
                      locale: ko,
                    })}
                  </Text>
                </View>
                <View style={styles.convBottom}>
                  <Text style={styles.convMsg} numberOfLines={1}>
                    {item.lastMessage}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>
                        {item.unreadCount > 9 ? '9+' : item.unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={22} color="#D1D5DB" />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="chatbubbles-outline"
                size={64}
                color="#D1D5DB"
              />
              <Text style={styles.emptyText}>
                {'\uB300\uD654\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
              </Text>
              <Text style={styles.emptySub}>
                {'\uC0C8 \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBCF4\uC138\uC694!'}
              </Text>
            </View>
          }
        />
      )}

      {/* New Chat Modal */}
      <Modal visible={showNewChat} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {'\uC0C8 \uBA54\uC2DC\uC9C0'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowNewChat(false);
                  setSearchText('');
                }}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={28} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={22} color="#9CA3AF" />
              <TextInput
                style={styles.searchInput}
                value={searchText}
                onChangeText={setSearchText}
                placeholder={'\uC774\uB984 \uB610\uB294 \uC0AC\uBC88 \uAC80\uC0C9'}
                placeholderTextColor="#9CA3AF"
              />
            </View>

            <FlatList
              data={filteredUsers}
              keyExtractor={(item: CompanyUser) => String(item.id)}
              renderItem={({ item }: { item: CompanyUser }) => (
                <TouchableOpacity
                  style={styles.userRow}
                  onPress={() => {
                    setSelectedPartner({ id: item.id, name: item.name });
                    setShowNewChat(false);
                    setSearchText('');
                  }}
                >
                  <View style={styles.userAvatar}>
                    <Text style={styles.avatarInitial}>
                      {item.name.charAt(0)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{item.name}</Text>
                    <Text style={styles.userRole}>
                      {ROLE_LABELS[item.role] || item.role} · {item.employeeId}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={22}
                    color="#D1D5DB"
                  />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.noResults}>
                  {'\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.'}
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Top bar
  topBar: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1565C0',
    paddingVertical: 16,
    borderRadius: 16,
  },
  newChatBtnText: { color: '#fff', fontSize: 20, fontWeight: '800' },

  // Conversation list
  convList: { paddingVertical: 8 },
  convCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 16,
    padding: 18,
  },
  convAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarInitial: { fontSize: 22, fontWeight: '800', color: '#1565C0' },
  convInfo: { flex: 1 },
  convTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  convName: { fontSize: 20, fontWeight: '800', color: '#111827' },
  convDate: { fontSize: 16, color: '#9CA3AF' },
  convBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  convMsg: { fontSize: 18, color: '#6B7280', flex: 1, marginRight: 8 },
  unreadBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 14,
    minWidth: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  unreadText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 20, color: '#9CA3AF', fontWeight: '700', marginTop: 16 },
  emptySub: { fontSize: 18, color: '#D1D5DB', marginTop: 4 },

  // Chat view
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    paddingVertical: 4,
  },
  backBtnText: { color: '#1565C0', fontSize: 18, fontWeight: '700', marginLeft: 4 },
  chatHeaderAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  chatHeaderName: { fontSize: 22, fontWeight: '800', color: '#111827' },

  // Messages
  messagesList: { padding: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 10 },
  msgRowMine: { alignItems: 'flex-end' },
  msgBubble: {
    maxWidth: '75%',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 22,
  },
  msgBubbleMine: { backgroundColor: '#1565C0', borderBottomRightRadius: 6 },
  msgBubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 6 },
  msgText: { fontSize: 18, color: '#111827', lineHeight: 26 },
  msgTextMine: { color: '#fff' },
  msgTime: { fontSize: 16, color: '#9CA3AF', marginTop: 4 },
  msgTimeMine: { textAlign: 'right' },
  emptyChat: { alignItems: 'center', paddingVertical: 40 },
  emptyChatText: { fontSize: 20, color: '#9CA3AF', marginTop: 12 },
  emptyChatSub: { fontSize: 18, color: '#D1D5DB', marginTop: 4 },

  // Input
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 18,
  },
  sendBtn: {
    backgroundColor: '#1565C0',
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#93C5FD' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 24, fontWeight: '800', color: '#111827' },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 18,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  userAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  userName: { fontSize: 20, fontWeight: '700', color: '#111827' },
  userRole: { fontSize: 16, color: '#6B7280', marginTop: 2 },
  noResults: {
    textAlign: 'center',
    paddingVertical: 30,
    color: '#9CA3AF',
    fontSize: 18,
  },
});
