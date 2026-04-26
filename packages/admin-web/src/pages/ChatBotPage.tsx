import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Send,
  Plus,
  Trash2,
  Sparkles,
  Save,
  Bot,
  User,
  Loader2,
  AlertCircle,
  ChevronRight,
  X,
  BookOpen,
} from 'lucide-react';
import { chatApi } from '../services/api';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ChatSession {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

// ─────────────────────────────────────────
// Suggested prompts
// ─────────────────────────────────────────
const SUGGESTED_PROMPTS = [
  {
    label: '5일 근무 2일 휴무 규칙 설정',
    description: '기본 근무 사이클을 설정합니다',
  },
  {
    label: '메인 기사 배차 우선순위',
    description: '메인/스페어 기사 배정 규칙을 정합니다',
  },
  {
    label: '야간 근무 수당 규정',
    description: '야간 수당 계산 방식을 설정합니다',
  },
  {
    label: '공휴일 특별 배차 규칙',
    description: '공휴일 운행 편성을 계획합니다',
  },
];

// ─────────────────────────────────────────
// Lightweight markdown renderer
// ─────────────────────────────────────────
function renderMarkdown(text: string): JSX.Element {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let codeBlock: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = '';

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-1 my-2">
          {listItems.map((item, i) => (
            <li key={i} className="text-base leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
    if (orderedItems.length > 0) {
      elements.push(
        <ol key={`ol-${elements.length}`} className="list-decimal list-inside space-y-1 my-2">
          {orderedItems.map((item, i) => (
            <li key={i} className="text-base leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
      orderedItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div key={`code-${elements.length}`} className="my-2">
            {codeLanguage && (
              <div className="text-xs px-3 py-1 bg-gray-800 dark:bg-gray-900 text-gray-400 rounded-t-lg font-mono">
                {codeLanguage}
              </div>
            )}
            <pre
              className={`bg-gray-800 dark:bg-gray-900 text-gray-100 text-sm p-3 overflow-x-auto ${
                codeLanguage ? 'rounded-b-lg' : 'rounded-lg'
              }`}
            >
              <code>{codeBlock.join('\n')}</code>
            </pre>
          </div>
        );
        codeBlock = [];
        inCodeBlock = false;
        codeLanguage = '';
      } else {
        flushList();
        inCodeBlock = true;
        codeLanguage = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlock.push(line);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const className =
        level === 1
          ? 'text-xl font-bold mt-4 mb-2'
          : level === 2
          ? 'text-lg font-semibold mt-3 mb-1.5'
          : 'text-base font-semibold mt-2 mb-1';
      elements.push(
        <div key={`h-${elements.length}`} className={className}>
          {renderInline(text)}
        </div>
      );
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^\s*[-*+]\s+(.+)/);
    if (ulMatch) {
      if (orderedItems.length > 0) flushList();
      listItems.push(ulMatch[1]);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (olMatch) {
      if (listItems.length > 0) flushList();
      orderedItems.push(olMatch[1]);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      flushList();
      elements.push(
        <hr key={`hr-${elements.length}`} className="my-3 border-gray-300 dark:border-gray-600" />
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      flushList();
      elements.push(
        <blockquote
          key={`bq-${elements.length}`}
          className="border-l-4 border-blue-400 dark:border-blue-500 pl-3 my-2 text-gray-600 dark:text-gray-300 italic"
        >
          {renderInline(line.replace(/^>\s*/, ''))}
        </blockquote>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${elements.length}`} className="text-base leading-relaxed my-1">
        {renderInline(line)}
      </p>
    );
  }

  flushList();

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  // Process bold, italic, inline code, links
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold
      parts.push(
        <strong key={`b-${match.index}`} className="font-semibold">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // Italic
      parts.push(
        <em key={`i-${match.index}`} className="italic">
          {match[4]}
        </em>
      );
    } else if (match[5]) {
      // Inline code
      parts.push(
        <code
          key={`c-${match.index}`}
          className="bg-gray-200 dark:bg-gray-700 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded text-sm font-mono"
        >
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      // Link
      parts.push(
        <a
          key={`a-${match.index}`}
          href={match[9]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          {match[8]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// ─────────────────────────────────────────
// Delete confirmation modal
// ─────────────────────────────────────────
function DeleteConfirmModal({
  sessionTitle,
  onConfirm,
  onCancel,
}: {
  sessionTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <Trash2 size={20} className="text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">대화 삭제</h3>
        </div>
        <p className="text-base text-gray-600 dark:text-gray-300 mb-1">
          다음 대화를 삭제하시겠습니까?
        </p>
        <p className="text-base font-medium text-gray-800 dark:text-gray-200 mb-6 truncate">
          "{sessionTitle}"
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 h-12 rounded-xl border border-gray-300 dark:border-gray-600 text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white text-base font-medium transition-colors"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Main component
// ─────────────────────────────────────────
export default function ChatBotPage() {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [saveAsRule, setSaveAsRule] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const [pendingStructuredRules, setPendingStructuredRules] = useState<unknown>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // ─── Queries ───────────────────────────
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    isError: sessionsError,
  } = useQuery<ChatSession[]>({
    queryKey: ['chat-sessions'],
    queryFn: () => chatApi.getSessions().then((r) => r.data.data),
  });

  const {
    data: sessionData,
    isLoading: sessionLoading,
    isError: sessionError,
  } = useQuery({
    queryKey: ['chat-session', activeSessionId],
    queryFn: () => chatApi.getSession(activeSessionId!).then((r) => r.data.data),
    enabled: !!activeSessionId,
  });

  const messages: ChatMessage[] = useMemo(() => sessionData?.messages || [], [sessionData]);

  // ─── Mutations ─────────────────────────
  const createSessionMutation = useMutation({
    mutationFn: () => chatApi.createSession(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      setActiveSessionId(res.data.data.id);
      setInput('');
      setSaveAsRule(false);
      setPendingStructuredRules(null);
    },
    onError: () => toast.error('대화 생성에 실패했습니다.'),
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ message, save }: { message: string; save: boolean }) =>
      chatApi.sendMessage(activeSessionId!, message, save),
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['chat-session', activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      setPendingStructuredRules(res.data.data.structuredRules || null);
      if (variables.save && res.data.data.structuredRules) {
        toast.success('규칙이 저장되었습니다!');
        queryClient.invalidateQueries({ queryKey: ['rules'] });
      }
      setSaveAsRule(false);
    },
    onError: () => toast.error('AI 응답 중 오류가 발생했습니다. 다시 시도해주세요.'),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => chatApi.deleteSession(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      if (activeSessionId === deletedId) {
        setActiveSessionId(null);
        setPendingStructuredRules(null);
      }
      toast.success('대화가 삭제되었습니다.');
    },
    onError: () => toast.error('대화 삭제에 실패했습니다.'),
  });

  // ─── Auto-scroll ───────────────────────
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, sendMessageMutation.isPending]);

  // ─── Auto-resize textarea ──────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  // ─── Handlers ──────────────────────────
  const handleSend = useCallback(() => {
    if (!input.trim() || !activeSessionId || sendMessageMutation.isPending) return;
    const msg = input.trim();
    setInput('');
    sendMessageMutation.mutate({ message: msg, save: saveAsRule });
  }, [input, activeSessionId, sendMessageMutation, saveAsRule]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleSuggestedPrompt = useCallback(
    (prompt: string) => {
      if (!activeSessionId) {
        // Create session then set input
        createSessionMutation.mutate(undefined, {
          onSuccess: () => {
            setInput(prompt);
            setTimeout(() => textareaRef.current?.focus(), 100);
          },
        });
      } else {
        setInput(prompt);
        textareaRef.current?.focus();
      }
    },
    [activeSessionId, createSessionMutation]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      deleteSessionMutation.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteSessionMutation]);

  // ─── Render ────────────────────────────
  return (
    <div className="flex h-[calc(100vh-10rem)] gap-0 bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* ══════════════════════════════════════ */}
      {/* LEFT PANEL: Session List              */}
      {/* ══════════════════════════════════════ */}
      <div className="w-80 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <MessageSquare size={20} className="text-blue-600 dark:text-blue-400" />
              대화 목록
            </h2>
          </div>
          <button
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
            className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-xl transition-colors"
          >
            {createSessionMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Plus size={18} />
            )}
            새 대화 시작
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {sessionsLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <Loader2 size={28} className="animate-spin mb-3" />
              <p className="text-base">불러오는 중...</p>
            </div>
          )}

          {sessionsError && (
            <div className="flex flex-col items-center justify-center py-12 text-red-400">
              <AlertCircle size={28} className="mb-3" />
              <p className="text-base">목록을 불러올 수 없습니다</p>
            </div>
          )}

          {!sessionsLoading && !sessionsError && sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
              <MessageSquare size={40} className="mb-3 opacity-30" />
              <p className="text-base font-medium">대화 내역이 없습니다</p>
              <p className="text-sm mt-1">새 대화를 시작해보세요</p>
            </div>
          )}

          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={`group flex items-start gap-3 p-3.5 rounded-xl cursor-pointer transition-all ${
                activeSessionId === session.id
                  ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 shadow-sm'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-transparent'
              }`}
            >
              <div
                className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  activeSessionId === session.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300'
                }`}
              >
                <MessageSquare size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-base font-medium truncate ${
                    activeSessionId === session.id
                      ? 'text-blue-900 dark:text-blue-100'
                      : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {session.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {formatDistanceToNow(new Date(session.updatedAt), {
                      addSuffix: true,
                      locale: ko,
                    })}
                  </span>
                  <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {session._count.messages}개 메시지
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(session);
                }}
                className="opacity-0 group-hover:opacity-100 mt-0.5 p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                title="대화 삭제"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════ */}
      {/* RIGHT PANEL: Chat Interface           */}
      {/* ══════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeSessionId ? (
          /* ── Welcome State ────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
              <Bot size={40} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              AI 배차 도우미
            </h2>
            <p className="text-base text-gray-500 dark:text-gray-400 text-center max-w-md mb-2">
              AI 배차 도우미에게 무엇이든 물어보세요
            </p>
            <p className="text-base text-gray-400 dark:text-gray-500 text-center max-w-md mb-8">
              회사 규칙, 인천시 규정, 배차 관련 질문 등을 입력하면
              <br />
              AI가 분석하고 최적의 배차표 생성에 활용합니다.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  onClick={() => handleSuggestedPrompt(prompt.label)}
                  disabled={createSessionMutation.isPending}
                  className="flex items-start gap-3 p-4 text-left bg-gray-50 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 rounded-xl transition-all group"
                >
                  <ChevronRight
                    size={18}
                    className="text-gray-300 dark:text-gray-600 group-hover:text-blue-500 mt-0.5 flex-shrink-0 transition-colors"
                  />
                  <div>
                    <p className="text-base font-medium text-gray-700 dark:text-gray-200 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                      {prompt.label}
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
                      {prompt.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => createSessionMutation.mutate()}
              disabled={createSessionMutation.isPending}
              className="mt-8 h-12 px-8 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-xl transition-colors shadow-sm"
            >
              {createSessionMutation.isPending ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Plus size={18} />
              )}
              새 대화 시작하기
            </button>
          </div>
        ) : (
          <>
            {/* ── Session Header ──────────────── */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Bot size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">
                    {sessionData?.title || '대화'}
                  </h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    AI 배차 도우미
                  </p>
                </div>
              </div>
              {sessionLoading && (
                <Loader2 size={18} className="animate-spin text-gray-400" />
              )}
            </div>

            {/* ── Messages Area ───────────────── */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto px-6 py-4 space-y-5 bg-gray-50/50 dark:bg-gray-900/50"
            >
              {/* Loading state */}
              {sessionLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
                  <Loader2 size={32} className="animate-spin mb-3" />
                  <p className="text-base">메시지를 불러오는 중...</p>
                </div>
              )}

              {/* Error state */}
              {sessionError && (
                <div className="flex flex-col items-center justify-center py-20 text-red-400">
                  <AlertCircle size={32} className="mb-3" />
                  <p className="text-base font-medium">메시지를 불러올 수 없습니다</p>
                  <p className="text-sm mt-1">네트워크를 확인하고 다시 시도해주세요</p>
                </div>
              )}

              {/* Empty session - prompt suggestions */}
              {!sessionLoading && !sessionError && messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-2xl flex items-center justify-center mb-4">
                    <Sparkles
                      size={28}
                      className="text-blue-600 dark:text-blue-400"
                    />
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-1">
                    새로운 대화
                  </h3>
                  <p className="text-base text-gray-500 dark:text-gray-400 mb-6 text-center">
                    아래 주제를 선택하거나 자유롭게 질문해보세요
                  </p>
                  <div className="grid grid-cols-1 gap-2 w-full max-w-md">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt.label}
                        onClick={() => {
                          setInput(prompt.label);
                          textareaRef.current?.focus();
                        }}
                        className="flex items-center gap-3 p-3.5 text-left bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 rounded-xl transition-all group"
                      >
                        <BookOpen
                          size={16}
                          className="text-gray-300 dark:text-gray-600 group-hover:text-blue-500 flex-shrink-0 transition-colors"
                        />
                        <span className="text-base text-gray-600 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                          {prompt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message bubbles */}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 ${
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      msg.role === 'user'
                        ? 'bg-blue-600'
                        : 'bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <User size={16} className="text-white" />
                    ) : (
                      <Bot size={16} className="text-gray-600 dark:text-gray-200" />
                    )}
                  </div>

                  {/* Bubble */}
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-md'
                        : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-md border border-gray-200 dark:border-gray-700 shadow-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="prose-sm">{renderMarkdown(msg.content)}</div>
                    ) : (
                      <p className="text-base leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    )}
                    <p
                      className={`text-xs mt-2 ${
                        msg.role === 'user'
                          ? 'text-blue-200'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {format(new Date(msg.createdAt), 'a h:mm', { locale: ko })}
                    </p>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {sendMessageMutation.isPending && (
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-600 dark:to-gray-700 flex items-center justify-center flex-shrink-0">
                    <Bot size={16} className="text-gray-600 dark:text-gray-200" />
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-md px-5 py-4 shadow-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1.5">
                        {[0, 1, 2].map((i) => (
                          <div
                            key={i}
                            className="w-2.5 h-2.5 bg-blue-400 dark:bg-blue-500 rounded-full animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                      <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">
                        AI가 응답을 작성하고 있습니다...
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Structured rules banner ─────── */}
            {pendingStructuredRules && (
              <div className="mx-4 mb-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-800/40 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Save size={18} className="text-green-600 dark:text-green-400" />
                </div>
                <p className="text-base text-green-700 dark:text-green-300 flex-1">
                  규칙이 감지되었습니다. 회사 규칙으로 저장하시겠습니까?
                </p>
                <button
                  onClick={() => {
                    setSaveAsRule(true);
                    setPendingStructuredRules(null);
                    toast.success('다음 메시지와 함께 규칙이 저장됩니다.');
                  }}
                  className="h-10 px-4 text-base bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex-shrink-0"
                >
                  저장
                </button>
                <button
                  onClick={() => setPendingStructuredRules(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {/* ── Input Area ──────────────────── */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              {/* Save as rule checkbox */}
              <div className="flex items-center gap-2 mb-3">
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={saveAsRule}
                    onChange={(e) => setSaveAsRule(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-base text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors flex items-center gap-1.5">
                    <BookOpen size={16} />
                    규칙으로 저장
                  </span>
                </label>
                {saveAsRule && (
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium animate-fade-in">
                    AI 응답이 회사 규칙으로 자동 저장됩니다
                  </span>
                )}
              </div>

              {/* Input row */}
              <div className="flex gap-3 items-end">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    className="w-full min-h-[52px] max-h-[160px] px-4 py-3 text-base bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                    rows={1}
                    placeholder="회사 규칙이나 배차 관련 질문을 입력하세요... (Shift+Enter로 줄바꿈)"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sendMessageMutation.isPending}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={
                    !input.trim() || sendMessageMutation.isPending
                  }
                  className="h-[52px] w-[52px] flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl transition-colors flex-shrink-0 shadow-sm"
                  title="메시지 전송 (Enter)"
                >
                  {sendMessageMutation.isPending ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Send size={20} />
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Delete Confirmation Modal ───────── */}
      {deleteTarget && (
        <DeleteConfirmModal
          sessionTitle={deleteTarget.title}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
