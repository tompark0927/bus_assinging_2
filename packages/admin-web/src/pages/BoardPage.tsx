import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  MessageSquare,
  Plus,
  AlertTriangle,
  Eye,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Shield,
  Bus,
  Inbox,
  Pin,
  Search,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { postsApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

type BoardType = 'NOTICE' | 'SAFETY' | 'FREE' | 'ROUTE' | 'SUGGESTION';

interface Post {
  id: number;
  boardType: BoardType;
  title: string;
  content: string;
  authorId: number;
  isAnonymous: boolean;
  isPinned: boolean;
  isUrgent: boolean;
  routeId: number | null;
  createdAt: string;
  isRead: boolean;
  readCount: number;
  author: { id: number; name: string; role: string };
  route: { id: number; routeNumber: string; name: string } | null;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const BOARD_TABS: { type: BoardType; label: string; icon: typeof Megaphone; color: string }[] = [
  { type: 'NOTICE', label: '공지사항', icon: Megaphone, color: 'blue' },
  { type: 'SAFETY', label: '안전게시판', icon: Shield, color: 'red' },
  { type: 'FREE', label: '자유게시판', icon: MessageSquare, color: 'green' },
  { type: 'ROUTE', label: '노선게시판', icon: Bus, color: 'purple' },
  { type: 'SUGGESTION', label: '건의사항', icon: Inbox, color: 'amber' },
];

const TAB_COLORS: Record<string, { active: string; inactive: string; badge: string }> = {
  blue: {
    active: 'bg-blue-600 text-white shadow-lg shadow-blue-200',
    inactive: 'bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-600 border border-gray-200',
    badge: 'bg-blue-100 text-blue-700',
  },
  red: {
    active: 'bg-red-600 text-white shadow-lg shadow-red-200',
    inactive: 'bg-white text-gray-600 hover:bg-red-50 hover:text-red-600 border border-gray-200',
    badge: 'bg-red-100 text-red-700',
  },
  green: {
    active: 'bg-green-600 text-white shadow-lg shadow-green-200',
    inactive: 'bg-white text-gray-600 hover:bg-green-50 hover:text-green-600 border border-gray-200',
    badge: 'bg-green-100 text-green-700',
  },
  purple: {
    active: 'bg-purple-600 text-white shadow-lg shadow-purple-200',
    inactive: 'bg-white text-gray-600 hover:bg-purple-50 hover:text-purple-600 border border-gray-200',
    badge: 'bg-purple-100 text-purple-700',
  },
  amber: {
    active: 'bg-amber-600 text-white shadow-lg shadow-amber-200',
    inactive: 'bg-white text-gray-600 hover:bg-amber-50 hover:text-amber-600 border border-gray-200',
    badge: 'bg-amber-100 text-amber-700',
  },
};

const ITEMS_PER_PAGE = 15;

export default function BoardPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER' || user?.role === 'DIRECTOR';

  const [activeBoardType, setActiveBoardType] = useState<BoardType>('NOTICE');
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);

  const activeTab = BOARD_TABS.find(t => t.type === activeBoardType)!;
  const colors = TAB_COLORS[activeTab.color];

  // Fetch posts
  const { data: postsData, isLoading, isError, refetch } = useQuery({
    queryKey: ['posts', activeBoardType, page, searchQuery],
    queryFn: () =>
      postsApi
        .list({
          boardType: activeBoardType,
          page,
          limit: ITEMS_PER_PAGE,
          ...(searchQuery ? { search: searchQuery } : {}),
        })
        .then(r => r.data),
  });

  const posts: Post[] = postsData?.data ?? [];
  const pagination: PaginationInfo = postsData?.pagination ?? {
    page: 1,
    limit: ITEMS_PER_PAGE,
    total: 0,
    totalPages: 1,
  };

  // Fetch single post detail
  const { data: postDetail } = useQuery({
    queryKey: ['post', selectedPost?.id],
    queryFn: () => postsApi.get(selectedPost!.id).then(r => r.data.data),
    enabled: !!selectedPost,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: {
      boardType: string;
      title: string;
      content: string;
      isAnonymous?: boolean;
      isPinned?: boolean;
      isUrgent?: boolean;
      routeId?: number;
    }) => postsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      toast.success('게시글이 작성되었습니다.');
      setShowCreateModal(false);
    },
    onError: () => toast.error('게시글 작성에 실패했습니다.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Post> }) => postsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post'] });
      toast.success('게시글이 수정되었습니다.');
      setEditingPost(null);
      setSelectedPost(null);
    },
    onError: () => toast.error('게시글 수정에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => postsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      toast.success('게시글이 삭제되었습니다.');
      setSelectedPost(null);
    },
    onError: () => toast.error('게시글 삭제에 실패했습니다.'),
  });

  const handleTabChange = (type: BoardType) => {
    setActiveBoardType(type);
    setPage(1);
    setSearchQuery('');
  };

  const handleDelete = (id: number) => {
    if (window.confirm('정말 이 게시글을 삭제하시겠습니까?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setPage(1);
  };

  const sortedPosts = [...posts].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">게시판</h1>
          <p className="text-gray-500 mt-1 text-[16px]">공지사항과 게시글을 관리합니다</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 bg-blue-600 text-white px-7 py-3.5 rounded-xl text-[17px] font-bold hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-lg shadow-blue-200"
          style={{ minHeight: 52 }}
        >
          <Plus size={22} strokeWidth={2.5} />
          새 글 작성
        </button>
      </div>

      {/* Board Type Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          {BOARD_TABS.map(tab => {
            const tabColors = TAB_COLORS[tab.color];
            const Icon = tab.icon;
            const isActive = activeBoardType === tab.type;
            return (
              <button
                key={tab.type}
                onClick={() => handleTabChange(tab.type)}
                className={`flex items-center gap-2.5 px-5 py-3.5 rounded-xl text-[16px] font-bold transition-all ${
                  isActive ? tabColors.active : tabColors.inactive
                }`}
                style={{ minHeight: 52 }}
              >
                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search Bar */}
      <SearchBar onSearch={handleSearch} value={searchQuery} />

      {/* Post List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* List Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            {(() => {
              const Icon = activeTab.icon;
              return <Icon size={20} className="text-gray-500" />;
            })()}
            <span className="text-[16px] font-bold text-gray-700">{activeTab.label}</span>
            <span className="text-[14px] text-gray-400 ml-1">
              ({pagination.total}건)
            </span>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-col justify-center items-center py-24">
            <Loader2 size={40} className="animate-spin text-blue-500 mb-4" />
            <p className="text-[16px] text-gray-400">게시글을 불러오는 중입니다...</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col justify-center items-center py-24">
            <AlertCircle size={48} className="text-red-400 mb-4" />
            <p className="text-[17px] font-semibold text-gray-700 mb-2">
              게시글을 불러올 수 없습니다
            </p>
            <p className="text-[15px] text-gray-400 mb-6">
              네트워크 연결을 확인하고 다시 시도해주세요
            </p>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white text-[16px] font-bold hover:bg-blue-700 transition-colors"
              style={{ minHeight: 48 }}
            >
              <RefreshCw size={18} />
              다시 시도
            </button>
          </div>
        ) : sortedPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-5">
              <MessageSquare size={36} className="text-gray-300" />
            </div>
            <p className="text-[17px] font-semibold text-gray-500 mb-1">
              {searchQuery
                ? `"${searchQuery}" 검색 결과가 없습니다`
                : '등록된 게시글이 없습니다'}
            </p>
            <p className="text-[15px] text-gray-400">
              {searchQuery
                ? '다른 검색어로 시도해보세요'
                : '첫 번째 게시글을 작성해보세요'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sortedPosts.map(post => (
              <PostListItem
                key={post.id}
                post={post}
                colors={colors}
                onClick={() => setSelectedPost(post)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-6 py-5 border-t border-gray-100 bg-gray-50/30">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-5 py-3 rounded-xl text-[16px] font-bold bg-white text-gray-600 hover:bg-gray-100 border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ minHeight: 48 }}
            >
              <ChevronLeft size={20} />
              이전
            </button>

            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === pagination.totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                  acc.push('...');
                }
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-[16px]">
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-12 h-12 rounded-xl text-[16px] font-bold transition-all ${
                      page === p
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}

            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className="flex items-center gap-1.5 px-5 py-3 rounded-xl text-[16px] font-bold bg-white text-gray-600 hover:bg-gray-100 border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ minHeight: 48 }}
            >
              다음
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>

      {/* Create Post Modal */}
      {showCreateModal && (
        <CreatePostModal
          boardType={activeBoardType}
          isAdmin={isAdmin}
          onClose={() => setShowCreateModal(false)}
          onSubmit={data => createMutation.mutate(data)}
          isSubmitting={createMutation.isPending}
        />
      )}

      {/* Post Detail Modal */}
      {selectedPost && !editingPost && (
        <PostDetailModal
          post={postDetail ?? selectedPost}
          isAdmin={isAdmin}
          currentUserId={user?.id}
          onClose={() => setSelectedPost(null)}
          onEdit={() => setEditingPost(postDetail ?? selectedPost)}
          onDelete={() => handleDelete(selectedPost.id)}
        />
      )}

      {/* Edit Post Modal */}
      {editingPost && (
        <EditPostModal
          post={editingPost}
          isAdmin={isAdmin}
          onClose={() => {
            setEditingPost(null);
            setSelectedPost(null);
          }}
          onSubmit={data => updateMutation.mutate({ id: editingPost.id, data })}
          isSubmitting={updateMutation.isPending}
        />
      )}
    </div>
  );
}

/* =====================================================
   Search Bar
   ===================================================== */
function SearchBar({
  onSearch,
  value,
}: {
  onSearch: (query: string) => void;
  value: string;
}) {
  const [input, setInput] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(value);
  }, [value]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(input.trim());
  };

  const handleClear = () => {
    setInput('');
    onSearch('');
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative">
        <Search
          size={22}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="게시글 제목으로 검색..."
          className="w-full pl-12 pr-24 py-3.5 text-[16px] bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          style={{ minHeight: 52 }}
        />
        {input && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-20 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        )}
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-blue-600 text-white text-[15px] font-bold rounded-lg hover:bg-blue-700 transition-colors"
          style={{ minHeight: 40 }}
        >
          검색
        </button>
      </div>
    </form>
  );
}

/* =====================================================
   Post List Item
   ===================================================== */
function PostListItem({
  post,
  colors,
  onClick,
}: {
  post: Post;
  colors: { badge: string };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-4 px-6 py-4.5 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer ${
        post.isUrgent ? 'border-l-4 border-red-500 bg-red-50/40' : ''
      }`}
      style={{ minHeight: 72 }}
    >
      {/* Unread + Pin indicators */}
      <div className="flex-shrink-0 w-7 flex flex-col items-center gap-1">
        {!post.isRead && (
          <div
            className="w-3 h-3 bg-blue-500 rounded-full ring-4 ring-blue-100"
            title="읽지 않음"
          />
        )}
        {post.isPinned && (
          <Pin size={16} className="text-amber-500" />
        )}
      </div>

      {/* Title & info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {post.isUrgent && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-red-100 text-red-700 text-[13px] font-bold flex-shrink-0">
              <AlertTriangle size={14} />
              긴급
            </span>
          )}
          {post.isPinned && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[13px] font-bold flex-shrink-0">
              고정
            </span>
          )}
          <p className="text-[16px] font-bold text-gray-900 truncate">
            {post.title}
          </p>
        </div>
        <div className="flex items-center gap-2.5 mt-1.5 text-[14px] text-gray-400">
          <span className="font-semibold text-gray-500">
            {post.isAnonymous ? '익명' : post.author.name}
          </span>
          <span className="text-gray-300">|</span>
          <span>{format(new Date(post.createdAt), 'yyyy.MM.dd (EEE)', { locale: ko })}</span>
          {post.route && (
            <>
              <span className="text-gray-300">|</span>
              <span className={`font-semibold ${colors.badge.includes('blue') ? 'text-blue-600' : 'text-purple-600'}`}>
                {post.route.routeNumber} {post.route.name}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Read count */}
      <div className="flex-shrink-0 flex items-center gap-1.5 text-[14px] text-gray-400 bg-gray-50 px-3 py-1.5 rounded-lg">
        <Eye size={16} />
        <span className="font-semibold">{post.readCount}</span>
      </div>
    </button>
  );
}

/* =====================================================
   Create Post Modal
   ===================================================== */
function CreatePostModal({
  boardType,
  isAdmin,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  boardType: BoardType;
  isAdmin: boolean;
  onClose: () => void;
  onSubmit: (data: {
    boardType: string;
    title: string;
    content: string;
    isAnonymous?: boolean;
    isPinned?: boolean;
    isUrgent?: boolean;
    routeId?: number;
  }) => void;
  isSubmitting: boolean;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedBoardType, setSelectedBoardType] = useState<BoardType>(boardType);
  const [isPinned, setIsPinned] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      toast.error('내용을 입력해주세요.');
      return;
    }
    onSubmit({
      boardType: selectedBoardType,
      title: title.trim(),
      content: content.trim(),
      isPinned,
      isUrgent,
      isAnonymous: selectedBoardType === 'SUGGESTION' ? isAnonymous : false,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white p-6 border-b border-gray-100 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-bold text-gray-900">새 게시글 작성</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Board type select */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 mb-2">
              게시판 선택
            </label>
            <select
              value={selectedBoardType}
              onChange={e => setSelectedBoardType(e.target.value as BoardType)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              style={{ minHeight: 52 }}
            >
              {BOARD_TABS.map(tab => (
                <option key={tab.type} value={tab.type}>
                  {tab.label}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 mb-2">제목</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="제목을 입력하세요"
              className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              style={{ minHeight: 52 }}
              maxLength={200}
              autoFocus
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 mb-2">내용</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="내용을 입력하세요"
              rows={10}
              className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y leading-relaxed"
            />
          </div>

          {/* Options */}
          <div className="space-y-3 bg-gray-50 rounded-xl p-4">
            <p className="text-[14px] font-bold text-gray-500 uppercase tracking-wider mb-2">
              옵션
            </p>
            {isAdmin && (
              <>
                <label className="flex items-center gap-3 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={e => setIsPinned(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Pin size={18} className="text-amber-500" />
                  <span className="text-[16px] text-gray-700 font-semibold">상단 고정</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={isUrgent}
                    onChange={e => setIsUrgent(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <AlertTriangle size={18} className="text-red-500" />
                  <span className="text-[16px] text-gray-700 font-semibold">긴급 공지</span>
                </label>
              </>
            )}
            {selectedBoardType === 'SUGGESTION' && (
              <label className="flex items-center gap-3 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={e => setIsAnonymous(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
                />
                <Eye size={18} className="text-gray-400" />
                <span className="text-[16px] text-gray-700 font-semibold">익명으로 작성</span>
              </label>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3.5 rounded-xl text-[16px] font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300 transition-colors"
              style={{ minHeight: 52 }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-[16px] font-bold bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-blue-200"
              style={{ minHeight: 52 }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  등록 중...
                </>
              ) : (
                '등록하기'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* =====================================================
   Post Detail Modal
   ===================================================== */
function PostDetailModal({
  post,
  isAdmin,
  currentUserId,
  onClose,
  onEdit,
  onDelete,
}: {
  post: Post;
  isAdmin: boolean;
  currentUserId?: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canModify = isAdmin || post.authorId === currentUserId;
  const boardTab = BOARD_TABS.find(t => t.type === post.boardType);
  const colors = boardTab ? TAB_COLORS[boardTab.color] : TAB_COLORS.blue;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white p-6 border-b border-gray-100 rounded-t-2xl z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-bold ${colors.badge}`}
              >
                {boardTab &&
                  (() => {
                    const Icon = boardTab.icon;
                    return <Icon size={16} />;
                  })()}
                {boardTab?.label}
              </span>
              {post.isPinned && (
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 text-[14px] font-bold text-amber-700">
                  <Pin size={14} />
                  고정
                </span>
              )}
              {post.isUrgent && (
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-100 text-[14px] font-bold text-red-700">
                  <AlertTriangle size={14} />
                  긴급
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
          <h2 className="text-[20px] font-bold text-gray-900 leading-snug">{post.title}</h2>
          <div className="flex items-center gap-3 mt-3 text-[14px] text-gray-400">
            <span className="font-bold text-gray-600">
              {post.isAnonymous ? '익명' : post.author.name}
            </span>
            <span className="text-gray-300">|</span>
            <span>
              {format(new Date(post.createdAt), 'yyyy년 MM월 dd일 (EEE) HH:mm', { locale: ko })}
            </span>
            <span className="text-gray-300">|</span>
            <span className="flex items-center gap-1">
              <Eye size={14} />
              조회 {post.readCount}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="text-[16px] text-gray-800 leading-relaxed whitespace-pre-wrap min-h-[120px]">
            {post.content}
          </div>

          {post.route && (
            <div className="mt-6 p-4 bg-purple-50 rounded-xl border border-purple-100">
              <div className="flex items-center gap-2 text-[15px] text-purple-700 font-semibold">
                <Bus size={18} />
                관련 노선: {post.route.routeNumber} {post.route.name}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white p-6 border-t border-gray-100 rounded-b-2xl flex flex-wrap gap-3">
          {canModify && (
            <>
              <button
                onClick={onEdit}
                className="flex items-center gap-2 px-5 py-3.5 rounded-xl text-[16px] font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 active:bg-amber-200 border border-amber-200 transition-colors"
                style={{ minHeight: 52 }}
              >
                <Edit size={18} />
                수정
              </button>
              <button
                onClick={onDelete}
                className="flex items-center gap-2 px-5 py-3.5 rounded-xl text-[16px] font-bold bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200 border border-red-200 transition-colors"
                style={{ minHeight: 52 }}
              >
                <Trash2 size={18} />
                삭제
              </button>
            </>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-7 py-3.5 rounded-xl text-[16px] font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300 transition-colors"
            style={{ minHeight: 52 }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================
   Edit Post Modal
   ===================================================== */
function EditPostModal({
  post,
  isAdmin,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  post: Post;
  isAdmin: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Post>) => void;
  isSubmitting: boolean;
}) {
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const [isPinned, setIsPinned] = useState(post.isPinned);
  const [isUrgent, setIsUrgent] = useState(post.isUrgent);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      toast.error('내용을 입력해주세요.');
      return;
    }
    onSubmit({
      title: title.trim(),
      content: content.trim(),
      isPinned,
      isUrgent,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white p-6 border-b border-gray-100 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-bold text-gray-900">게시글 수정</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 mb-2">제목</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="제목을 입력하세요"
              className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              style={{ minHeight: 52 }}
              maxLength={200}
              autoFocus
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 mb-2">내용</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="내용을 입력하세요"
              rows={10}
              className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y leading-relaxed"
            />
          </div>

          {/* Options */}
          {isAdmin && (
            <div className="space-y-3 bg-gray-50 rounded-xl p-4">
              <p className="text-[14px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                옵션
              </p>
              <label className="flex items-center gap-3 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={e => setIsPinned(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Pin size={18} className="text-amber-500" />
                <span className="text-[16px] text-gray-700 font-semibold">상단 고정</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={isUrgent}
                  onChange={e => setIsUrgent(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <AlertTriangle size={18} className="text-red-500" />
                <span className="text-[16px] text-gray-700 font-semibold">긴급 공지</span>
              </label>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3.5 rounded-xl text-[16px] font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300 transition-colors"
              style={{ minHeight: 52 }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-[16px] font-bold bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-blue-200"
              style={{ minHeight: 52 }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  수정 중...
                </>
              ) : (
                '수정하기'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
