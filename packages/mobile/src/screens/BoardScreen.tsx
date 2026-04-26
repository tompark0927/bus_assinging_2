import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, TextInput, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

interface Post {
  id: number;
  boardType: string;
  title: string;
  content: string;
  authorId: number;
  isAnonymous: boolean;
  isPinned: boolean;
  isUrgent: boolean;
  isRead?: boolean;
  createdAt: string;
  author?: { id: number; name: string };
}

const BOARD_TABS: { type: string; label: string; icon: string }[] = [
  { type: 'NOTICE', label: '\uACF5\uC9C0', icon: 'megaphone' },
  { type: 'SAFETY', label: '\uC548\uC804', icon: 'shield-checkmark' },
  { type: 'FREE', label: '\uC790\uC720', icon: 'chatbubbles' },
  { type: 'ROUTE', label: '\uB178\uC120', icon: 'bus' },
  { type: 'SUGGESTION', label: '\uAC74\uC758', icon: 'mail' },
];

export default function BoardScreen() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [boardType, setBoardType] = useState('NOTICE');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const isAdmin =
    user?.role === 'ADMIN' || user?.role === 'OWNER' || user?.role === 'MANAGER';

  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['posts', boardType],
    queryFn: () => postsApi.list({ boardType }).then(r => r.data),
  });

  const posts: Post[] = data?.data || [];

  const { data: postDetail } = useQuery({
    queryKey: ['post-detail', selectedPost?.id],
    queryFn: () => postsApi.get(selectedPost!.id).then(r => r.data.data),
    enabled: !!selectedPost,
  });

  const canCreate = boardType === 'FREE' || boardType === 'SUGGESTION' || isAdmin;

  return (
    <View style={styles.container}>
      {/* Board type tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabContainer}
      >
        {BOARD_TABS.map(tab => (
          <TouchableOpacity
            key={tab.type}
            style={[styles.tab, boardType === tab.type && styles.tabActive]}
            onPress={() => setBoardType(tab.type)}
          >
            <Ionicons
              name={tab.icon as any}
              size={22}
              color={boardType === tab.type ? '#1565C0' : '#9CA3AF'}
            />
            <Text
              style={[
                styles.tabLabel,
                boardType === tab.type && styles.tabLabelActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Post list */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
        >
          {posts.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons
                name="document-text-outline"
                size={64}
                color="#D1D5DB"
              />
              <Text style={styles.emptyText}>
                {'\uAC8C\uC2DC\uAE00\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
              </Text>
            </View>
          ) : (
            posts.map(post => (
              <TouchableOpacity
                key={post.id}
                style={[styles.card, !post.isRead && styles.cardUnread]}
                onPress={() => setSelectedPost(post)}
                activeOpacity={0.7}
              >
                <View style={styles.cardTop}>
                  {post.isPinned && (
                    <View style={styles.pinBadge}>
                      <Ionicons name="pin" size={14} color="#D97706" />
                      <Text style={styles.pinText}>{'\uACE0\uC815'}</Text>
                    </View>
                  )}
                  {post.isUrgent && (
                    <View style={styles.urgentBadge}>
                      <Ionicons name="warning" size={14} color="#DC2626" />
                      <Text style={styles.urgentText}>{'\uAE34\uAE09'}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  {!post.isRead && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {post.title}
                </Text>
                <Text style={styles.cardContent} numberOfLines={2}>
                  {post.content}
                </Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardAuthor}>
                    {post.isAnonymous
                      ? '\uC775\uBA85'
                      : post.author?.name || '\uC54C \uC218 \uC5C6\uC74C'}
                  </Text>
                  <Text style={styles.cardDate}>
                    {format(new Date(post.createdAt), 'MM.dd HH:mm', {
                      locale: ko,
                    })}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* FAB */}
      {canCreate && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowCreate(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="create" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Post Detail Modal */}
      {selectedPost && (
        <Modal visible animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{'\uAC8C\uC2DC\uAE00'}</Text>
                <TouchableOpacity
                  onPress={() => setSelectedPost(null)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={28} color="#6B7280" />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.modalBody}>
                {(postDetail ?? selectedPost).isUrgent && (
                  <View
                    style={[
                      styles.urgentBadge,
                      { alignSelf: 'flex-start', marginBottom: 14 },
                    ]}
                  >
                    <Ionicons name="warning" size={16} color="#DC2626" />
                    <Text style={styles.urgentText}>{'\uAE34\uAE09'}</Text>
                  </View>
                )}
                <Text style={styles.detailTitle}>
                  {(postDetail ?? selectedPost).title}
                </Text>
                <View style={styles.detailMeta}>
                  <Text style={styles.detailAuthor}>
                    {(postDetail ?? selectedPost).isAnonymous
                      ? '\uC775\uBA85'
                      : (postDetail ?? selectedPost).author?.name ||
                        '\uC54C \uC218 \uC5C6\uC74C'}
                  </Text>
                  <Text style={styles.detailDate}>
                    {format(
                      new Date((postDetail ?? selectedPost).createdAt),
                      'yyyy.MM.dd HH:mm',
                      { locale: ko },
                    )}
                  </Text>
                </View>
                <View style={styles.divider} />
                <Text style={styles.detailContent}>
                  {(postDetail ?? selectedPost).content}
                </Text>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Create Post Modal */}
      <CreatePostModal
        visible={showCreate}
        boardType={boardType}
        isAdmin={isAdmin}
        onClose={() => setShowCreate(false)}
        onSuccess={() => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: ['posts'] });
        }}
      />
    </View>
  );
}

/* ========== Create Post Modal ========== */
function CreatePostModal({
  visible,
  boardType,
  isAdmin,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  boardType: string;
  isAdmin: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data: {
      boardType: string;
      title: string;
      content: string;
      isAnonymous?: boolean;
    }) => postsApi.create(data),
    onSuccess: () => {
      setTitle('');
      setContent('');
      setIsAnonymous(false);
      onSuccess();
      Alert.alert('\uC644\uB8CC', '\uAC8C\uC2DC\uAE00\uC774 \uC791\uC131\uB418\uC5C8\uC2B5\uB2C8\uB2E4.');
    },
    onError: () =>
      Alert.alert('\uC624\uB958', '\uAC8C\uC2DC\uAE00 \uC791\uC131\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.'),
  });

  const boardLabel =
    BOARD_TABS.find(t => t.type === boardType)?.label || '';

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {boardLabel} {'\uAC8C\uC2DC\uAE00 \uC791\uC131'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={28} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={styles.inputLabel}>{'\uC81C\uBAA9'}</Text>
            <TextInput
              style={styles.input}
              placeholder={'\uC81C\uBAA9\uC744 \uC785\uB825\uD558\uC138\uC694'}
              value={title}
              onChangeText={setTitle}
              placeholderTextColor="#9CA3AF"
            />

            <Text style={[styles.inputLabel, { marginTop: 20 }]}>
              {'\uB0B4\uC6A9'}
            </Text>
            <TextInput
              style={[styles.input, { height: 180, textAlignVertical: 'top' }]}
              placeholder={'\uB0B4\uC6A9\uC744 \uC785\uB825\uD558\uC138\uC694'}
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={8}
              placeholderTextColor="#9CA3AF"
            />

            {boardType === 'SUGGESTION' && (
              <TouchableOpacity
                style={styles.anonToggle}
                onPress={() => setIsAnonymous(!isAnonymous)}
              >
                <Ionicons
                  name={isAnonymous ? 'checkbox' : 'square-outline'}
                  size={28}
                  color={isAnonymous ? '#1565C0' : '#D1D5DB'}
                />
                <Text style={styles.anonText}>
                  {'\uC775\uBA85\uC73C\uB85C \uC791\uC131'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!title.trim() || !content.trim()) && styles.submitBtnDisabled,
              ]}
              disabled={
                !title.trim() || !content.trim() || createMutation.isPending
              }
              onPress={() =>
                createMutation.mutate({
                  boardType,
                  title: title.trim(),
                  content: content.trim(),
                  isAnonymous:
                    boardType === 'SUGGESTION' ? isAnonymous : false,
                })
              }
            >
              <Text style={styles.submitBtnText}>
                {createMutation.isPending
                  ? '\uC791\uC131\uC911...'
                  : '\uAC8C\uC2DC\uAE00 \uC791\uC131'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Tabs
  tabScroll: {
    backgroundColor: '#fff',
    maxHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tabContainer: { paddingHorizontal: 12, alignItems: 'center', gap: 6 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    marginVertical: 6,
  },
  tabActive: { backgroundColor: '#EFF6FF' },
  tabLabel: { fontSize: 18, fontWeight: '700', color: '#9CA3AF' },
  tabLabelActive: { color: '#1565C0' },

  // List
  list: { flex: 1, padding: 16 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 20, color: '#9CA3AF', marginTop: 16 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardUnread: { borderLeftWidth: 4, borderLeftColor: '#1565C0' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pinText: { fontSize: 14, fontWeight: '700', color: '#D97706' },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  urgentText: { fontSize: 14, fontWeight: '800', color: '#DC2626' },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1565C0',
  },
  cardTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 8 },
  cardContent: { fontSize: 18, color: '#6B7280', lineHeight: 26, marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  cardAuthor: { fontSize: 16, color: '#9CA3AF', fontWeight: '600' },
  cardDate: { fontSize: 16, color: '#9CA3AF' },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },

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
    maxHeight: '90%',
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
  modalBody: { padding: 24 },

  // Detail
  detailTitle: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 10 },
  detailMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailAuthor: { fontSize: 18, color: '#6B7280', fontWeight: '600' },
  detailDate: { fontSize: 16, color: '#9CA3AF' },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 20 },
  detailContent: { fontSize: 20, color: '#374151', lineHeight: 32 },

  // Create
  inputLabel: { fontSize: 20, fontWeight: '800', color: '#374151', marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    padding: 16,
    fontSize: 18,
    backgroundColor: '#fff',
  },
  anonToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    paddingVertical: 8,
  },
  anonText: { fontSize: 18, color: '#374151', fontWeight: '600' },
  submitBtn: {
    marginTop: 28,
    marginBottom: 40,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: '#1565C0',
    alignItems: 'center',
  },
  submitBtnDisabled: { backgroundColor: '#93C5FD' },
  submitBtnText: { fontSize: 20, fontWeight: '800', color: '#fff' },
});
