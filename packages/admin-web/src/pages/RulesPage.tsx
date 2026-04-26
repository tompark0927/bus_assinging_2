import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  BookOpen,
  Plus,
  Edit,
  Trash2,
  Search,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Filter,
  ToggleLeft,
  ToggleRight,
  Sparkles,
  ShieldCheck,
  Users,
  MapPin,
  Clock,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { rulesApi } from '../services/api';
import toast from 'react-hot-toast';

interface Rule {
  id: number;
  title: string;
  content: string;
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

const CATEGORIES = [
  { value: 'all', label: '전체', icon: Filter, color: 'gray' },
  { value: 'general', label: '일반', icon: FileText, color: 'blue' },
  { value: 'work-pattern', label: '근무 패턴', icon: Clock, color: 'indigo' },
  { value: 'safety', label: '안전 규정', icon: ShieldCheck, color: 'red' },
  { value: 'driver-type', label: '기사 유형', icon: Users, color: 'green' },
  { value: 'route', label: '노선 규정', icon: MapPin, color: 'purple' },
  { value: 'ai-extracted', label: 'AI 추출', icon: Sparkles, color: 'amber' },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  general: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  'work-pattern': { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  safety: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  'driver-type': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  route: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  'ai-extracted': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
};

export default function RulesPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState({ title: '', content: '', category: 'general' });
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const {
    data: rules = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: () => rulesApi.list().then(r => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => rulesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      toast.success('규칙이 등록되었습니다.');
      setShowModal(false);
      resetForm();
    },
    onError: () => toast.error('규칙 등록에 실패했습니다.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Rule> }) =>
      rulesApi.update(id, data as Record<string, unknown>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      toast.success('규칙이 수정되었습니다.');
      setShowModal(false);
      setEditing(null);
      resetForm();
    },
    onError: () => toast.error('규칙 수정에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => rulesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      toast.success('규칙이 삭제되었습니다.');
      setDeleteConfirmId(null);
    },
    onError: () => toast.error('규칙 삭제에 실패했습니다.'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      rulesApi.update(id, { isActive }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      toast.success(variables.isActive ? '규칙이 활성화되었습니다.' : '규칙이 비활성화되었습니다.');
    },
    onError: () => toast.error('상태 변경에 실패했습니다.'),
  });

  const resetForm = () => {
    setForm({ title: '', content: '', category: 'general' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    if (!form.content.trim()) {
      toast.error('내용을 입력해주세요.');
      return;
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const openCreateModal = () => {
    setEditing(null);
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (rule: Rule) => {
    setEditing(rule);
    setForm({ title: rule.title, content: rule.content, category: rule.category });
    setShowModal(true);
  };

  const getCategoryLabel = (cat: string) =>
    CATEGORIES.find(c => c.value === cat)?.label || cat;

  const getCategoryColors = (cat: string) =>
    CATEGORY_COLORS[cat] || CATEGORY_COLORS.general;

  // Filter and search
  const filteredRules = rules.filter(rule => {
    const matchesCategory = activeCategory === 'all' || rule.category === activeCategory;
    const matchesSearch =
      !searchQuery ||
      rule.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.content.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const activeRulesCount = rules.filter(r => r.isActive).length;
  const inactiveRulesCount = rules.filter(r => !r.isActive).length;

  // Category counts
  const categoryCounts = CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    if (cat.value === 'all') {
      acc[cat.value] = rules.length;
    } else {
      acc[cat.value] = rules.filter(r => r.category === cat.value).length;
    }
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">회사 규칙 관리</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-[16px]">
            AI 배차 생성 시 이 규칙들이 자동으로 적용됩니다
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center justify-center gap-2 bg-blue-600 text-white px-7 py-3.5 rounded-xl text-[17px] font-bold hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-lg shadow-blue-200"
          style={{ minHeight: 52 }}
        >
          <Plus size={22} strokeWidth={2.5} />
          규칙 추가
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <p className="text-[14px] font-bold text-gray-400 mb-1">전체 규칙</p>
          <p className="text-[28px] font-bold text-gray-900 dark:text-gray-100">{rules.length}건</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-green-100 dark:border-green-900 p-5">
          <p className="text-[14px] font-bold text-green-500 mb-1">활성 규칙</p>
          <p className="text-[28px] font-bold text-green-700 dark:text-green-400">{activeRulesCount}건</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <p className="text-[14px] font-bold text-gray-400 mb-1">비활성 규칙</p>
          <p className="text-[28px] font-bold text-gray-500 dark:text-gray-400">{inactiveRulesCount}건</p>
        </div>
      </div>

      {/* Category Filter */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex flex-wrap gap-2.5">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.value;
            const count = categoryCounts[cat.value] || 0;
            return (
              <button
                key={cat.value}
                onClick={() => setActiveCategory(cat.value)}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[15px] font-bold transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                    : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600'
                }`}
                style={{ minHeight: 48 }}
              >
                <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                {cat.label}
                <span
                  className={`ml-0.5 px-2 py-0.5 rounded-md text-[13px] font-bold ${
                    isActive ? 'bg-blue-500 text-blue-100' : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search Bar */}
      <RulesSearchBar value={searchQuery} onChange={setSearchQuery} />

      {/* Rules List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col justify-center items-center py-24">
            <Loader2 size={40} className="animate-spin text-blue-500 mb-4" />
            <p className="text-[16px] text-gray-400">규칙을 불러오는 중입니다...</p>
          </div>
        ) : isError ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col justify-center items-center py-24">
            <AlertCircle size={48} className="text-red-400 mb-4" />
            <p className="text-[17px] font-semibold text-gray-700 dark:text-gray-200 mb-2">
              규칙을 불러올 수 없습니다
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
        ) : filteredRules.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center justify-center py-24">
            <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-5">
              <BookOpen size={36} className="text-gray-300" />
            </div>
            {searchQuery || activeCategory !== 'all' ? (
              <>
                <p className="text-[17px] font-semibold text-gray-500 mb-1">
                  {searchQuery
                    ? `"${searchQuery}" 검색 결과가 없습니다`
                    : '해당 카테고리에 등록된 규칙이 없습니다'}
                </p>
                <p className="text-[15px] text-gray-400 mb-5">
                  다른 조건으로 검색하거나 새 규칙을 추가해보세요
                </p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setActiveCategory('all');
                  }}
                  className="px-5 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[15px] font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  style={{ minHeight: 48 }}
                >
                  필터 초기화
                </button>
              </>
            ) : (
              <>
                <p className="text-[17px] font-semibold text-gray-500 mb-1">
                  등록된 규칙이 없습니다
                </p>
                <p className="text-[15px] text-gray-400 mb-5">
                  AI 챗봇에서 규칙을 입력하거나 직접 추가하세요
                </p>
                <button
                  onClick={openCreateModal}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white text-[16px] font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                  style={{ minHeight: 48 }}
                >
                  <Plus size={18} />
                  첫 번째 규칙 추가하기
                </button>
              </>
            )}
          </div>
        ) : (
          filteredRules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              isExpanded={expandedRuleId === rule.id}
              isDeleteConfirm={deleteConfirmId === rule.id}
              onToggleExpand={() =>
                setExpandedRuleId(expandedRuleId === rule.id ? null : rule.id)
              }
              onEdit={() => openEditModal(rule)}
              onDelete={() => setDeleteConfirmId(rule.id)}
              onDeleteConfirm={() => deleteMutation.mutate(rule.id)}
              onDeleteCancel={() => setDeleteConfirmId(null)}
              onToggleActive={() =>
                toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })
              }
              getCategoryLabel={getCategoryLabel}
              getCategoryColors={getCategoryColors}
              isDeleting={deleteMutation.isPending}
            />
          ))
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <RuleModal
          editing={editing}
          form={form}
          setForm={setForm}
          onClose={() => {
            setShowModal(false);
            setEditing(null);
            resetForm();
          }}
          onSubmit={handleSubmit}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
}

/* =====================================================
   Search Bar
   ===================================================== */
function RulesSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <Search size={22} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="규칙 제목 또는 내용으로 검색..."
        className="w-full pl-12 pr-12 py-3.5 text-[16px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100"
        style={{ minHeight: 52 }}
      />
      {value && (
        <button
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/* =====================================================
   Rule Card
   ===================================================== */
function RuleCard({
  rule,
  isExpanded,
  isDeleteConfirm,
  onToggleExpand,
  onEdit,
  onDelete,
  onDeleteConfirm,
  onDeleteCancel,
  onToggleActive,
  getCategoryLabel,
  getCategoryColors,
  isDeleting,
}: {
  rule: Rule;
  isExpanded: boolean;
  isDeleteConfirm: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onToggleActive: () => void;
  getCategoryLabel: (cat: string) => string;
  getCategoryColors: (cat: string) => { bg: string; text: string; border: string };
  isDeleting: boolean;
}) {
  const colors = getCategoryColors(rule.category);
  const isLongContent = rule.content.length > 120;
  const displayContent =
    isLongContent && !isExpanded ? rule.content.slice(0, 120) + '...' : rule.content;

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-all ${
        !rule.isActive
          ? 'border-gray-200 dark:border-gray-600 opacity-70'
          : `${colors.border} border`
      }`}
    >
      {/* Main Content */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Left: Badge + Content */}
          <div className="flex-1 min-w-0">
            {/* Category + Status badges */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-bold ${colors.bg} ${colors.text}`}
              >
                {(() => {
                  const cat = CATEGORIES.find(c => c.value === rule.category);
                  if (cat) {
                    const Icon = cat.icon;
                    return <Icon size={15} />;
                  }
                  return null;
                })()}
                {getCategoryLabel(rule.category)}
              </span>
              {!rule.isActive && (
                <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[14px] font-bold">
                  비활성
                </span>
              )}
              {rule.category === 'ai-extracted' && (
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-[13px] font-bold">
                  <Sparkles size={13} />
                  AI
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="text-[17px] font-bold text-gray-900 dark:text-gray-100 mb-2">{rule.title}</h3>

            {/* Content */}
            <p className="text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
              {displayContent}
            </p>

            {/* Expand/Collapse */}
            {isLongContent && (
              <button
                onClick={onToggleExpand}
                className="flex items-center gap-1 mt-2 text-[14px] font-semibold text-blue-600 hover:text-blue-700 transition-colors"
              >
                {isExpanded ? (
                  <>
                    접기 <ChevronUp size={16} />
                  </>
                ) : (
                  <>
                    전체 보기 <ChevronDown size={16} />
                  </>
                )}
              </button>
            )}

            {/* Date */}
            {rule.createdAt && (
              <p className="text-[13px] text-gray-400 mt-3">
                등록일:{' '}
                {format(new Date(rule.createdAt), 'yyyy년 MM월 dd일', { locale: ko })}
              </p>
            )}
          </div>

          {/* Right: Action buttons */}
          <div className="flex-shrink-0 flex flex-col items-center gap-2">
            {/* Toggle */}
            <button
              onClick={onToggleActive}
              className={`p-2 rounded-xl transition-colors ${
                rule.isActive
                  ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30'
                  : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={rule.isActive ? '비활성화' : '활성화'}
              style={{ minWidth: 48, minHeight: 48 }}
            >
              {rule.isActive ? (
                <ToggleRight size={28} />
              ) : (
                <ToggleLeft size={28} />
              )}
            </button>

            {/* Edit */}
            <button
              onClick={onEdit}
              className="p-2 rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              title="수정"
              style={{ minWidth: 48, minHeight: 48 }}
            >
              <Edit size={22} />
            </button>

            {/* Delete */}
            <button
              onClick={onDelete}
              className="p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              title="삭제"
              style={{ minWidth: 48, minHeight: 48 }}
            >
              <Trash2 size={22} />
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {isDeleteConfirm && (
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 bg-red-50/50 dark:bg-red-900/20 rounded-b-2xl">
          <p className="text-[15px] font-semibold text-red-700 mb-3">
            이 규칙을 정말 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onDeleteCancel}
              className="px-5 py-3 rounded-xl text-[15px] font-bold bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors"
              style={{ minHeight: 48 }}
            >
              취소
            </button>
            <button
              onClick={onDeleteConfirm}
              disabled={isDeleting}
              className="flex items-center gap-2 px-5 py-3 rounded-xl text-[15px] font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              style={{ minHeight: 48 }}
            >
              {isDeleting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  삭제 중...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  삭제하기
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =====================================================
   Rule Create/Edit Modal
   ===================================================== */
function RuleModal({
  editing,
  form,
  setForm,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  editing: Rule | null;
  form: { title: string; content: string; category: string };
  setForm: React.Dispatch<React.SetStateAction<{ title: string; content: string; category: string }>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
}) {
  const formCategories = CATEGORIES.filter(c => c.value !== 'all');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 p-6 border-b border-gray-100 dark:border-gray-700 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-bold text-gray-900 dark:text-gray-100">
              {editing ? '규칙 수정' : '새 규칙 추가'}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 dark:text-gray-200 mb-2">제목</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              required
              placeholder="예: 메인 기사 5일 근무 2일 휴무 패턴"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              style={{ minHeight: 52 }}
              autoFocus
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 dark:text-gray-200 mb-2">카테고리</label>
            <select
              value={form.category}
              onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              style={{ minHeight: 52 }}
            >
              {formCategories.map(c => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Content */}
          <div>
            <label className="block text-[16px] font-bold text-gray-700 dark:text-gray-200 mb-2">내용</label>
            <textarea
              value={form.content}
              onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              required
              placeholder="규칙 내용을 상세하게 입력하세요. AI가 배차 생성 시 이 내용을 참고합니다."
              rows={6}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3.5 text-[16px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y leading-relaxed bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3.5 rounded-xl text-[16px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 transition-colors"
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
                  {editing ? '수정 중...' : '등록 중...'}
                </>
              ) : editing ? (
                '수정하기'
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
